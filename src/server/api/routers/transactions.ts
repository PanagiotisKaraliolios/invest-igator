import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { type Currency, currencySchema, SUPPORTED_CURRENCIES } from '@/lib/currency';
import { parseIsoDateUtc } from '@/lib/date';
import { isValidSymbol as isValidSymbolFormat, normalizeSymbol } from '@/lib/validation';
import { createTransactionInput, updateTransactionInput } from '@/server/api/routers/transactions.schemas';
import { createTRPCRouter, protectedProcedure } from '@/server/api/trpc';
import { invalidatePortfolioCache } from '@/server/portfolio-compute';
import {
	bulkCreateTransactions,
	type CanonicalRecord,
	createDefaultHeader,
	detectDuplicates,
	normalizeFeeCurrencyValue,
	normalizeHeader,
	parseCsv,
	resolveUnknownSymbols,
	validateRow
} from '@/server/services/transaction-import';
import { buildTransactionWhere, createTransaction, toTransactionRow } from '@/server/services/transactions';
import { symbolExistsOnYahoo } from '@/server/yahoo-search';

const supportedCurrencies = SUPPORTED_CURRENCIES;

/**
 * Transactions router - manages investment transactions (buys/sells).
 * All procedures require authentication (protectedProcedure).
 *
 * Supports:
 * - Creating, updating, and deleting transactions
 * - Bulk operations
 * - CSV import/export with duplicate detection
 * - Filtering, sorting, and pagination
 *
 * @example
 * // Create a transaction
 * await api.transactions.create.mutate({
 *   symbol: 'AAPL',
 *   side: 'BUY',
 *   quantity: 10,
 *   price: 150.50,
 *   priceCurrency: 'USD',
 *   date: '2024-01-15'
 * });
 *
 * @example
 * // List transactions with filters
 * const result = await api.transactions.list.query({
 *   symbol: 'AAPL',
 *   page: 1,
 *   pageSize: 20,
 *   sortBy: 'date',
 *   sortDir: 'desc'
 * });
 */
export const transactionsRouter = createTRPCRouter({
	/**
	 * Removes multiple transactions by their IDs in a single operation.
	 * Only transactions owned by the user can be deleted.
	 *
	 * @input ids - Array of transaction IDs to delete (min 1)
	 *
	 * @returns {deleted: number} Count of transactions deleted
	 *
	 * @example
	 * const result = await api.transactions.bulkRemove.mutate({
	 *   ids: ['tx1', 'tx2', 'tx3']
	 * });
	 * console.log(`Deleted ${result.deleted} transactions`);
	 */
	bulkRemove: protectedProcedure
		.input(z.object({ ids: z.array(z.string().min(1)).min(1) }))
		.mutation(async ({ ctx, input }) => {
			const userId = ctx.session.user.id;
			const toDelete = await ctx.db.transaction.findMany({
				select: { id: true },
				where: { id: { in: input.ids }, userId }
			});
			if (toDelete.length === 0) return { deleted: 0 } as const;
			const res = await ctx.db.transaction.deleteMany({ where: { id: { in: toDelete.map((t) => t.id) } } });
			await invalidatePortfolioCache(userId);
			return { deleted: res.count } as const;
		}),

	/**
	 * Creates a new transaction record.
	 * Validates symbol via Yahoo Finance if not already on user's watchlist.
	 * Automatically adds symbol to watchlist.
	 *
	 * @input symbol - Stock symbol (required)
	 * @input side - Transaction type: 'BUY' or 'SELL'
	 * @input quantity - Number of shares
	 * @input price - Price per share
	 * @input priceCurrency - Currency of the price (default: USD)
	 * @input date - Transaction date (ISO string)
	 * @input fee - Optional transaction fee
	 * @input feeCurrency - Optional fee currency
	 * @input note - Optional note
	 *
	 * @throws {TRPCError} BAD_REQUEST - If symbol is invalid
	 * @returns {id: string} The ID of the created transaction
	 *
	 * @example
	 * await api.transactions.create.mutate({
	 *   symbol: 'TSLA',
	 *   side: 'BUY',
	 *   quantity: 5,
	 *   price: 250.00,
	 *   priceCurrency: 'USD',
	 *   date: '2024-06-15',
	 *   fee: 9.99,
	 *   feeCurrency: 'USD'
	 * });
	 */
	create: protectedProcedure.input(createTransactionInput).mutation(async ({ ctx, input }) => {
		const userId = ctx.session.user.id;
		const symbol = normalizeSymbol(input.symbol);
		// Fast-path: accept if symbol already on user's watchlist; else validate via Yahoo Finance
		const exists = await ctx.db.watchlistItem.findUnique({
			select: { symbol: true },
			where: { userId_symbol: { symbol, userId } }
		});
		if (!exists) {
			const existence = await symbolExistsOnYahoo(symbol);
			if (existence === 'unreachable') {
				throw new TRPCError({
					code: 'BAD_REQUEST',
					message: `Couldn't reach Yahoo to verify ${symbol}. Please try again.`
				});
			}
			if (existence === 'no') {
				throw new TRPCError({
					code: 'BAD_REQUEST',
					message: 'Unknown symbol. Please select from suggestions.'
				});
			}
		}
		// Symbol validated above; the shared service owns the write (transaction + watchlist upsert).
		const { id } = await createTransaction(userId, input);
		await invalidatePortfolioCache(userId);
		return { id } as const;
	}),

	/**
	 * Exports transactions to CSV format with optional filters.
	 * Results are capped at 10,000 rows.
	 *
	 * @input symbol - Optional symbol filter
	 * @input side - Optional side filter (BUY/SELL)
	 * @input dateFrom - Optional start date filter
	 * @input dateTo - Optional end date filter
	 * @input sortBy - Sort field (default: 'date')
	 * @input sortDir - Sort direction (default: 'desc')
	 *
	 * @returns CSV string with header row and transaction data
	 *
	 * @example
	 * const csv = await api.transactions.exportCsv.query({
	 *   symbol: 'AAPL',
	 *   dateFrom: '2024-01-01',
	 *   dateTo: '2024-12-31'
	 * });
	 * // Download or process CSV
	 */
	exportCsv: protectedProcedure
		.input(
			z.object({
				dateFrom: z.string().optional(),
				dateTo: z.string().optional(),
				side: z.enum(['BUY', 'SELL']).optional(),
				sortBy: z.enum(['date', 'symbol', 'quantity', 'price']).default('date'),
				sortDir: z.enum(['asc', 'desc']).default('desc'),
				symbol: z.string().optional()
			})
		)
		.query(async ({ ctx, input }) => {
			const userId = ctx.session.user.id;
			const where: any = { userId };
			if (input.symbol && input.symbol.trim() !== '') {
				where.symbol = { contains: input.symbol.trim(), mode: 'insensitive' };
			}
			if (input.side) where.side = input.side;
			if (input.dateFrom || input.dateTo) {
				where.date = {} as any;
				if (input.dateFrom) (where.date as any).gte = new Date(input.dateFrom);
				if (input.dateTo) {
					const dt = new Date(input.dateTo);
					dt.setHours(23, 59, 59, 999);
					(where.date as any).lte = dt;
				}
			}
			const rows = await ctx.db.transaction.findMany({
				orderBy: [{ [input.sortBy]: input.sortDir } as any],
				// safety cap
				take: 10000,
				where
			});
			const header = [
				'date',
				'symbol',
				'side',
				'quantity',
				'price',
				'priceCurrency',
				'fee',
				'feeCurrency',
				'note'
			];
			const escapeCsv = (val: string) => '"' + val.replaceAll('"', '""') + '"';
			const lines = [header.join(',')];
			for (const t of rows) {
				const line = [
					// use YYYY-MM-DD
					new Date(t.date).toISOString().slice(0, 10),
					t.symbol,
					t.side,
					String(t.quantity),
					String(t.price),
					(t as any).priceCurrency,
					t.fee == null ? '' : String(t.fee),
					(t as any).feeCurrency ?? '',
					t.note ? escapeCsv(t.note) : ''
				].join(',');
				lines.push(line);
			}
			return lines.join('\n');
		}),
	/**
	 * Imports transactions from CSV with duplicate detection.
	 * Parses CSV, validates data, detects duplicates, and imports new records.
	 * Automatically adds symbols to watchlist.
	 *
	 * @input csv - CSV content string
	 * @input skipHeader - Whether first row is a header (default: true)
	 *
	 * @returns Import result with:
	 *   - imported: Number of new transactions created
	 *   - errors: Array of {line, message} for validation errors
	 *   - duplicates: Array of detected duplicates with incoming and existing data
	 *
	 * @throws {TRPCError} BAD_REQUEST - If CSV is empty or missing required columns
	 *
	 * @example
	 * const result = await api.transactions.importCsv.mutate({
	 *   csv: csvFileContent,
	 *   skipHeader: true
	 * });
	 * console.log(`Imported ${result.imported}, ${result.duplicates.length} duplicates`);
	 */
	importCsv: protectedProcedure
		.input(
			z.object({
				csv: z.string().min(1, 'File appears to be empty'),
				skipHeader: z.boolean().optional()
			})
		)
		.mutation(async ({ ctx, input }) => {
			const userId = ctx.session.user.id;
			const rows = parseCsv(input.csv);
			if (rows.length === 0) {
				throw new TRPCError({ code: 'BAD_REQUEST', message: 'No rows found in uploaded file.' });
			}

			const [maybeHeader, ...dataRows] = rows;
			const headerRow = maybeHeader ?? [];
			const useHeader = input.skipHeader !== false;
			const header = useHeader ? normalizeHeader(headerRow) : createDefaultHeader(headerRow.length);
			const headerMap = new Map(header.map((h, idx) => [h, idx]));
			const requiredColumns = ['date', 'symbol', 'side', 'quantity', 'price'] as const;
			for (const col of requiredColumns) {
				if (!headerMap.has(col)) {
					throw new TRPCError({
						code: 'BAD_REQUEST',
						message: `Missing required column "${col}".`
					});
				}
			}
			const data = useHeader ? dataRows : rows;

			// Pre-validate distinct, format-valid, not-yet-tracked symbols against Yahoo once each.
			const distinctSymbols: string[] = [];
			for (const rawRow of data) {
				if (rawRow.every((cell) => cell.trim() === '')) continue;
				const idx = headerMap.get('symbol');
				distinctSymbols.push(idx != null ? (rawRow[idx] ?? '') : '');
			}
			const unknownSymbols = await resolveUnknownSymbols(userId, distinctSymbols);

			const records: CanonicalRecord[] = [];
			const errors: Array<{ line: number; message: string }> = [];
			data.forEach((rawRow, index) => {
				const lineNumber = useHeader ? index + 2 : index + 1;
				if (rawRow.every((cell) => cell.trim() === '')) return;
				const res = validateRow(rawRow, headerMap, unknownSymbols);
				if (res.ok) records.push(res.record);
				else errors.push({ line: lineNumber, message: res.message });
			});

			if (records.length === 0) {
				return { duplicates: [], errors, imported: 0 } as const;
			}

			const { toInsert, duplicates } = await detectDuplicates(userId, records);
			await bulkCreateTransactions(userId, toInsert, ctx.db);

			await invalidatePortfolioCache(userId);
			return { duplicates, errors, imported: toInsert.length } as const;
		}),
	/**
	 * Imports duplicate transactions that were previously detected.
	 * Used as a follow-up after importCsv when user confirms duplicate imports.
	 *
	 * @input items - Array of transaction objects with duplicateId to import
	 *
	 * @returns Import result with created count and processed duplicate IDs
	 *
	 * @throws {TRPCError} BAD_REQUEST - If validation fails
	 *
	 * @example
	 * await api.transactions.importDuplicates.mutate({
	 *   items: [{ duplicateId: 'dup1', symbol: 'AAPL', ... }]
	 * });
	 */
	importDuplicates: protectedProcedure
		.input(
			z.object({
				items: z
					.array(
						z.object({
							date: z.string().min(1),
							duplicateId: z.string().min(1),
							fee: z.number().nonnegative().nullable().optional(),
							feeCurrency: currencySchema.nullable().optional(),
							note: z.string().nullable().optional(),
							price: z.number().positive(),
							priceCurrency: currencySchema,
							quantity: z.number().positive(),
							side: z.enum(['BUY', 'SELL']),
							symbol: z.string().min(1)
						})
					)
					.min(1)
			})
		)
		.mutation(async ({ ctx, input }) => {
			const userId = ctx.session.user.id;
			if (input.items.length === 0) {
				return { created: 0, processedIds: [] as string[] };
			}

			const supportedCurrencySet = new Set(supportedCurrencies);
			const prepared = input.items.map((item) => {
				const symbol = item.symbol.trim().toUpperCase();
				if (!symbol) {
					throw new TRPCError({ code: 'BAD_REQUEST', message: 'Symbol is required.' });
				}
				if (!supportedCurrencySet.has(item.priceCurrency)) {
					throw new TRPCError({
						code: 'BAD_REQUEST',
						message: `Unsupported price currency "${item.priceCurrency}".`
					});
				}
				const date = parseIsoDateUtc(item.date);
				if (!date) {
					throw new TRPCError({
						code: 'BAD_REQUEST',
						message: `Invalid date "${item.date}".`
					});
				}

				const fee = item.fee ?? null;
				const feeCurrency = normalizeFeeCurrencyValue(
					fee,
					(item.feeCurrency ?? null) as Currency | null,
					item.priceCurrency as Currency
				);
				if (feeCurrency && !supportedCurrencySet.has(feeCurrency)) {
					throw new TRPCError({
						code: 'BAD_REQUEST',
						message: `Unsupported fee currency "${feeCurrency}".`
					});
				}

				const noteTrimmed = item.note?.trim() ?? '';
				const note = noteTrimmed === '' ? null : noteTrimmed;
				return {
					data: {
						date,
						fee,
						feeCurrency,
						note,
						price: item.price,
						priceCurrency: item.priceCurrency as Currency,
						quantity: item.quantity,
						side: item.side,
						symbol
					},
					duplicateId: item.duplicateId
				};
			});

			if (prepared.length === 0) {
				return { created: 0, processedIds: [] as string[] };
			}

			const symbols = Array.from(new Set(prepared.map((r) => r.data.symbol)));
			await ctx.db.$transaction(async (trx) => {
				await trx.transaction.createMany({
					data: prepared.map((r) => ({
						date: r.data.date,
						fee: r.data.fee,
						feeCurrency: r.data.feeCurrency,
						note: r.data.note,
						price: r.data.price,
						priceCurrency: r.data.priceCurrency,
						quantity: r.data.quantity,
						side: r.data.side,
						symbol: r.data.symbol,
						userId
					}))
				});

				for (const symbol of symbols) {
					await trx.watchlistItem.upsert({
						create: { symbol, userId },
						update: {},
						where: { userId_symbol: { symbol, userId } }
					});
				}
			});

			const processedIds = prepared.map((r) => r.duplicateId);
			await invalidatePortfolioCache(userId);
			return { created: prepared.length, processedIds };
		}),
	/**
	 * Lists transactions with filtering, sorting, and pagination.
	 *
	 * @input symbol - Optional symbol filter (partial match)
	 * @input side - Optional side filter (BUY/SELL)
	 * @input dateFrom - Optional start date filter
	 * @input dateTo - Optional end date filter (inclusive, extends to end of day)
	 * @input page - Page number (default: 1)
	 * @input pageSize - Items per page (default: 10, max: 200)
	 * @input sortBy - Sort field (default: 'date')
	 * @input sortDir - Sort direction (default: 'desc')
	 *
	 * @returns Paginated result with items array, page, pageSize, total
	 *
	 * @example
	 * const result = await api.transactions.list.query({
	 *   symbol: 'AAPL',
	 *   page: 1,
	 *   pageSize: 50,
	 *   sortBy: 'date',
	 *   sortDir: 'desc'
	 * });
	 */
	list: protectedProcedure
		.input(
			z.object({
				dateFrom: z.string().optional(),
				dateTo: z.string().optional(),
				page: z.number().int().min(1).default(1),
				pageSize: z.number().int().min(1).max(200).default(10),
				side: z.enum(['BUY', 'SELL']).optional(),
				sortBy: z.enum(['date', 'symbol', 'quantity', 'price']).default('date'),
				sortDir: z.enum(['asc', 'desc']).default('desc'),
				symbol: z.string().optional()
			})
		)
		.query(async ({ ctx, input }) => {
			const where = buildTransactionWhere(ctx.session.user.id, {
				dateFrom: input.dateFrom,
				dateTo: input.dateTo,
				side: input.side,
				symbol: input.symbol
			});

			const total = await ctx.db.transaction.count({ where });
			const rows = await ctx.db.transaction.findMany({
				orderBy: [{ [input.sortBy]: input.sortDir } as any],
				skip: (input.page - 1) * input.pageSize,
				take: input.pageSize,
				where
			});
			return {
				items: rows.map(toTransactionRow),
				page: input.page,
				pageSize: input.pageSize,
				total
			} as const;
		}),

	/**
	 * Removes a single transaction by ID.
	 * Only the transaction owner can remove it.
	 *
	 * @input id - Transaction ID
	 *
	 * @throws {TRPCError} NOT_FOUND - If transaction not found or not owned by user
	 * @returns {success: true}
	 */
	remove: protectedProcedure.input(z.object({ id: z.string().min(1) })).mutation(async ({ ctx, input }) => {
		const userId = ctx.session.user.id;
		const current = await ctx.db.transaction.findUnique({ where: { id: input.id } });
		if (!current || current.userId !== userId) {
			throw new TRPCError({ code: 'NOT_FOUND', message: 'Transaction not found' });
		}
		await ctx.db.transaction.delete({ where: { id: input.id } });
		await invalidatePortfolioCache(userId);
		return { success: true } as const;
	}),

	/**
	 * Updates an existing transaction.
	 * Validates new symbol if changed. Only provided fields are updated.
	 * Automatically updates watchlist if symbol changes.
	 *
	 * @input id - Transaction ID (required)
	 * @input symbol, side, quantity, price, priceCurrency, date, fee, feeCurrency, note - Optional fields to update
	 *
	 * @throws {TRPCError} NOT_FOUND - If transaction not found or not owned by user
	 * @throws {TRPCError} BAD_REQUEST - If new symbol is invalid
	 * @returns {success: true}
	 *
	 * @example
	 * await api.transactions.update.mutate({
	 *   id: 'tx_123',
	 *   quantity: 15,
	 *   note: 'Updated quantity'
	 * });
	 */
	update: protectedProcedure.input(updateTransactionInput).mutation(async ({ ctx, input }) => {
		const userId = ctx.session.user.id;
		const current = await ctx.db.transaction.findUnique({ where: { id: input.id } });
		if (!current || current.userId !== userId) {
			throw new TRPCError({ code: 'NOT_FOUND', message: 'Transaction not found' });
		}

		let nextSymbol: string | undefined;
		if (input.symbol) {
			nextSymbol = normalizeSymbol(input.symbol);
			if (!isValidSymbolFormat(nextSymbol)) {
				throw new TRPCError({
					code: 'BAD_REQUEST',
					message: 'Symbol contains invalid characters.'
				});
			}
			const exists = await ctx.db.watchlistItem.findUnique({
				select: { symbol: true },
				where: { userId_symbol: { symbol: nextSymbol, userId } }
			});
			if (!exists) {
				const existence = await symbolExistsOnYahoo(nextSymbol);
				if (existence === 'unreachable') {
					throw new TRPCError({
						code: 'BAD_REQUEST',
						message: `Couldn't reach Yahoo to verify ${nextSymbol}. Please try again.`
					});
				}
				if (existence === 'no') {
					throw new TRPCError({
						code: 'BAD_REQUEST',
						message: 'Unknown symbol. Please select from suggestions.'
					});
				}
			}
		}
		await ctx.db.transaction.update({
			data: {
				date: input.date ?? undefined,
				fee: input.fee ?? undefined,
				feeCurrency: (input.feeCurrency as Currency | null | undefined) ?? undefined,
				note: input.note ?? undefined,
				price: input.price ?? undefined,
				priceCurrency: (input.priceCurrency as Currency | undefined) ?? undefined,
				quantity: input.quantity ?? undefined,
				side: input.side ?? undefined,
				symbol: nextSymbol ?? undefined
			},
			where: { id: input.id }
		});

		// Ensure the new asset exists in the user's watchlist if symbol changed
		if (nextSymbol) {
			try {
				await ctx.db.watchlistItem.upsert({
					create: { symbol: nextSymbol, userId },
					update: {},
					where: { userId_symbol: { symbol: nextSymbol, userId } }
				});
			} catch {}
		}
		await invalidatePortfolioCache(userId);
		return { success: true } as const;
	})
});
