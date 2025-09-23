import type { Currency } from '@prisma/client';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { env } from '@/env';
import { createTRPCRouter, protectedProcedure } from '@/server/api/trpc';

const supportedCurrencies: Currency[] = ['EUR', 'USD', 'GBP', 'HKD', 'CHF', 'RUB'];

async function isValidSymbol(symbol: string): Promise<boolean> {
	try {
		const url = new URL(`${env.FINNHUB_API_URL}/search`);
		url.searchParams.set('q', symbol);
		url.searchParams.set('token', env.FINNHUB_API_KEY);
		const res = await fetch(url.toString());
		if (!res.ok) return false;
		const data = (await res.json()) as {
			result?: Array<{ symbol?: string; displaySymbol?: string }>;
		};
		const up = symbol.trim().toUpperCase();
		return (
			Array.isArray(data.result) &&
			data.result.some(
				(r) =>
					(r.symbol && r.symbol.toUpperCase() === up) ||
					(r.displaySymbol && r.displaySymbol.toUpperCase() === up)
			)
		);
	} catch {
		return false;
	}
}

export const transactionsRouter = createTRPCRouter({
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
			return { deleted: res.count } as const;
		}),

	create: protectedProcedure
		.input(
			z.object({
				date: z.string().transform((s) => new Date(s)),
				fee: z.number().optional(),
				feeCurrency: z.enum(['EUR', 'USD', 'GBP', 'HKD', 'CHF', 'RUB']).optional(),
				note: z.string().optional(),
				price: z.number(),
				priceCurrency: z.enum(['EUR', 'USD', 'GBP', 'HKD', 'CHF', 'RUB']).default('USD'),
				quantity: z.number(),
				side: z.enum(['BUY', 'SELL']),
				symbol: z.string().min(1)
			})
		)
		.mutation(async ({ ctx, input }) => {
			const userId = ctx.session.user.id;
			const symbol = input.symbol.trim().toUpperCase();
			// Fast-path: accept if symbol already on user's watchlist; else validate via Finnhub
			const exists = await ctx.db.watchlistItem.findUnique({
				select: { symbol: true },
				where: { userId_symbol: { symbol, userId } }
			});
			if (!exists) {
				const ok = await isValidSymbol(symbol);
				if (!ok) {
					throw new TRPCError({
						code: 'BAD_REQUEST',
						message: 'Unknown symbol. Please select from suggestions.'
					});
				}
			}
			const created = await ctx.db.transaction.create({
				data: {
					date: input.date,
					fee: input.fee,
					feeCurrency: (input.feeCurrency as Currency | undefined) ?? null,
					note: input.note,
					price: input.price,
					priceCurrency: input.priceCurrency as Currency,
					quantity: input.quantity,
					side: input.side,
					symbol,
					userId
				}
			});

			// Ensure the asset exists in the user's watchlist
			try {
				await ctx.db.watchlistItem.upsert({
					create: { symbol: created.symbol, userId },
					update: {},
					where: { userId_symbol: { symbol: created.symbol, userId } }
				});
			} catch {}
			return { id: created.id } as const;
		}),

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
					new Date(t.date)
						.toISOString()
						.slice(0, 10),
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
			const headerColumns = useHeader ? normalizeHeader(headerRow) : undefined;
			const records: Array<{
				date: Date;
				fee: number | null;
				feeCurrency: Currency | null;
				note: string | null;
				price: number;
				priceCurrency: Currency;
				quantity: number;
				side: 'BUY' | 'SELL';
				symbol: string;
			}> = [];
			const errors: Array<{ line: number; message: string }> = [];

			const data = useHeader ? dataRows : rows;
			const header = headerColumns ?? createDefaultHeader(headerRow.length);
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

			const supportedCurrencySet = new Set(supportedCurrencies);

			data.forEach((rawRow, index) => {
				const lineNumber = useHeader ? index + 2 : index + 1;
				if (rawRow.every((cell) => cell.trim() === '')) return;
				const byColumn = (name: string) => {
					const idx = headerMap.get(name);
					return idx != null ? (rawRow[idx] ?? '') : '';
				};

				try {
					const symbol = byColumn('symbol').trim().toUpperCase();
					if (!symbol) throw new Error('Symbol is required.');

					const sideRaw = byColumn('side').trim().toUpperCase();
					if (sideRaw !== 'BUY' && sideRaw !== 'SELL') {
						throw new Error('Side must be BUY or SELL.');
					}

					const quantity = Number(byColumn('quantity'));
					if (!Number.isFinite(quantity) || quantity <= 0) {
						throw new Error('Quantity must be a positive number.');
					}

					const price = Number(byColumn('price'));
					if (!Number.isFinite(price) || price <= 0) {
						throw new Error('Price must be a positive number.');
					}

					const priceCurrencyRaw = byColumn('priceCurrency').trim().toUpperCase() || 'USD';
					if (!supportedCurrencySet.has(priceCurrencyRaw as Currency)) {
						throw new Error(`Unsupported price currency "${priceCurrencyRaw}".`);
					}

					let feeCurrency: Currency | null = null;
					const feeCurrencyValue = byColumn('feeCurrency').trim().toUpperCase();
					if (feeCurrencyValue) {
						if (!supportedCurrencySet.has(feeCurrencyValue as Currency)) {
							throw new Error(`Unsupported fee currency "${feeCurrencyValue}".`);
						}
						feeCurrency = feeCurrencyValue as Currency;
					}

					const feeRaw = byColumn('fee').trim();
					let fee: number | null = null;
					if (feeRaw !== '') {
						const parsedFee = Number(feeRaw);
						if (!Number.isFinite(parsedFee) || parsedFee < 0) {
							throw new Error('Fee must be a positive number.');
						}
						fee = parsedFee;
						if (!feeCurrency) {
							feeCurrency = priceCurrencyRaw as Currency;
						}
					}

					const noteRaw = byColumn('note').trim();
					const dateRaw = byColumn('date').trim();
					if (!dateRaw) throw new Error('Date is required.');
					const date = new Date(`${dateRaw}T00:00:00Z`);
					if (Number.isNaN(date.getTime())) {
						throw new Error(`Invalid date "${dateRaw}".`);
					}

					records.push({
						date,
						fee,
						feeCurrency,
						note: noteRaw ? noteRaw : null,
						price,
						priceCurrency: priceCurrencyRaw as Currency,
						quantity,
						side: sideRaw,
						symbol
					});
				} catch (error) {
					const message = error instanceof Error ? error.message : 'Unknown parsing error';
					errors.push({ line: lineNumber, message });
				}
			});

			if (records.length === 0) {
				return { errors, imported: 0, duplicates: [] } as const;
			}

			const symbolsInUpload = Array.from(new Set(records.map((r) => r.symbol)));
			const existing = symbolsInUpload.length
				? await ctx.db.transaction.findMany({
					select: {
						date: true,
						fee: true,
						feeCurrency: true,
						id: true,
						note: true,
						price: true,
						priceCurrency: true,
						quantity: true,
						side: true,
						symbol: true
					},
					where: {
						symbol: { in: symbolsInUpload },
						userId
					}
				})
				: [];
			const existingByKey = new Map<string, typeof existing>();
			for (const row of existing) {
				const key = makeDuplicateKey({
					date: row.date,
					fee: row.fee ?? null,
					feeCurrency: (row.feeCurrency ?? null) as Currency | null,
					note: row.note ?? null,
					price: row.price,
					priceCurrency: row.priceCurrency as Currency,
					quantity: row.quantity,
					side: row.side,
					symbol: row.symbol
				});
				const list = existingByKey.get(key);
				if (list) {
					list.push(row);
				} else {
					existingByKey.set(key, [row]);
				}
			}

			const duplicates: Array<{
				id: string;
				incoming: {
					date: string;
					fee: number | null;
					feeCurrency: Currency | null;
					note: string | null;
					price: number;
					priceCurrency: Currency;
					quantity: number;
					side: 'BUY' | 'SELL';
					symbol: string;
				};
				existing: Array<{
					id: string;
					date: string;
					fee: number | null;
					feeCurrency: Currency | null;
					note: string | null;
					price: number;
					priceCurrency: Currency;
					quantity: number;
					side: 'BUY' | 'SELL';
					symbol: string;
				}>;
			}> = [];
			const toInsert: typeof records = [];
			const duplicateCounts = new Map<string, number>();
			for (const record of records) {
				const key = makeDuplicateKey(record);
				const matches = existingByKey.get(key);
				if (matches && matches.length > 0) {
					const indexForKey = duplicateCounts.get(key) ?? 0;
					duplicateCounts.set(key, indexForKey + 1);
					const normalizedFeeCurrency = normalizeFeeCurrencyValue(
						record.fee,
						record.feeCurrency,
						record.priceCurrency
					);
					duplicates.push({
						id: `${key}#${indexForKey}`,
						incoming: {
							date: toDateOnlyISOString(record.date),
							fee: record.fee,
							feeCurrency: normalizedFeeCurrency,
							note: record.note,
							price: record.price,
							priceCurrency: record.priceCurrency,
							quantity: record.quantity,
							side: record.side,
							symbol: record.symbol
						},
						existing: matches.map((row) => ({
							id: row.id,
							date: toDateOnlyISOString(row.date),
							fee: row.fee ?? null,
							feeCurrency: normalizeFeeCurrencyValue(
								row.fee ?? null,
								(row.feeCurrency ?? null) as Currency | null,
								row.priceCurrency as Currency
							),
							note: row.note ?? null,
							price: row.price,
							priceCurrency: row.priceCurrency as Currency,
							quantity: row.quantity,
							side: row.side,
							symbol: row.symbol
						}))
					});
				} else {
					toInsert.push(record);
				}
			}

			if (toInsert.length > 0) {
				const uniqueSymbols = Array.from(new Set(toInsert.map((r) => r.symbol)));
				await ctx.db.$transaction(async (trx) => {
					await trx.transaction.createMany({
						data: toInsert.map((r) => ({
							date: r.date,
							fee: r.fee,
							feeCurrency: r.feeCurrency,
							note: r.note,
							price: r.price,
							priceCurrency: r.priceCurrency,
							quantity: r.quantity,
							side: r.side,
							symbol: r.symbol,
							userId
						}))
					});

					for (const symbol of uniqueSymbols) {
						await trx.watchlistItem.upsert({
							create: { symbol, userId },
							update: {},
							where: { userId_symbol: { symbol, userId } }
						});
					}
				});
			}

			return { errors, imported: toInsert.length, duplicates } as const;
		}),
	importDuplicates: protectedProcedure
		.input(
			z.object({
				items: z
					.array(
						z.object({
							duplicateId: z.string().min(1),
							date: z.string().min(1),
							fee: z.number().nonnegative().nullable().optional(),
							feeCurrency: z.enum(['EUR', 'USD', 'GBP', 'HKD', 'CHF', 'RUB']).nullable().optional(),
							note: z.string().nullable().optional(),
							price: z.number().positive(),
							priceCurrency: z.enum(['EUR', 'USD', 'GBP', 'HKD', 'CHF', 'RUB']),
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
				const date = new Date(`${item.date}T00:00:00Z`);
				if (Number.isNaN(date.getTime())) {
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
					duplicateId: item.duplicateId,
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
					}
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
			return { created: prepared.length, processedIds };
		}),
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
			const userId = ctx.session.user.id;
			const where: any = { userId };
			if (input.symbol && input.symbol.trim() !== '') {
				where.symbol = { contains: input.symbol.trim(), mode: 'insensitive' };
			}
			if (input.side) {
				where.side = input.side;
			}
			if (input.dateFrom || input.dateTo) {
				where.date = {} as any;
				if (input.dateFrom) (where.date as any).gte = new Date(input.dateFrom);
				if (input.dateTo) {
					const dt = new Date(input.dateTo);
					dt.setHours(23, 59, 59, 999);
					(where.date as any).lte = dt;
				}
			}

			const total = await ctx.db.transaction.count({ where });
			const rows = await ctx.db.transaction.findMany({
				orderBy: [{ [input.sortBy]: input.sortDir } as any],
				skip: (input.page - 1) * input.pageSize,
				take: input.pageSize,
				where
			});
			return {
				items: rows.map((t) => ({
					date: t.date.toISOString(),
					fee: t.fee ?? null,
					feeCurrency: (t as any).feeCurrency ?? null,
					id: t.id,
					note: t.note ?? null,
					price: t.price,
					priceCurrency: (t as any).priceCurrency,
					quantity: t.quantity,
					side: t.side,
					symbol: t.symbol
				})),
				page: input.page,
				pageSize: input.pageSize,
				total
			} as const;
		}),

	remove: protectedProcedure.input(z.object({ id: z.string().min(1) })).mutation(async ({ ctx, input }) => {
		const userId = ctx.session.user.id;
		const current = await ctx.db.transaction.findUnique({ where: { id: input.id } });
		if (!current || current.userId !== userId) {
			throw new TRPCError({ code: 'NOT_FOUND', message: 'Transaction not found' });
		}
		await ctx.db.transaction.delete({ where: { id: input.id } });
		return { success: true } as const;
	}),

	update: protectedProcedure
		.input(
			z.object({
				date: z
					.string()
					.transform((s) => new Date(s))
					.optional(),
				fee: z.number().nullable().optional(),
				feeCurrency: z.enum(['EUR', 'USD', 'GBP', 'HKD', 'CHF', 'RUB']).nullable().optional(),
				id: z.string().min(1),
				note: z.string().nullable().optional(),
				price: z.number().optional(),
				priceCurrency: z.enum(['EUR', 'USD', 'GBP', 'HKD', 'CHF', 'RUB']).optional(),
				quantity: z.number().optional(),
				side: z.enum(['BUY', 'SELL']).optional(),
				symbol: z.string().min(1).optional()
			})
		)
		.mutation(async ({ ctx, input }) => {
			const userId = ctx.session.user.id;
			const current = await ctx.db.transaction.findUnique({ where: { id: input.id } });
			if (!current || current.userId !== userId) {
				throw new TRPCError({ code: 'NOT_FOUND', message: 'Transaction not found' });
			}

			let nextSymbol: string | undefined;
			if (input.symbol) {
				nextSymbol = input.symbol.trim().toUpperCase();
				const exists = await ctx.db.watchlistItem.findUnique({
					select: { symbol: true },
					where: { userId_symbol: { symbol: nextSymbol, userId } }
				});
				if (!exists) {
					const ok = await isValidSymbol(nextSymbol);
					if (!ok) {
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
			return { success: true } as const;
		})
});

function parseCsv(text: string): string[][] {
	const rows: string[][] = [];
	let current = '';
	let inQuotes = false;
	let row: string[] = [];
	for (let i = 0; i < text.length; i++) {
		const char = text[i]!;
		if (char === '"') {
			if (inQuotes && text[i + 1] === '"') {
				current += '"';
				i++;
			} else {
				inQuotes = !inQuotes;
			}
		} else if (char === ',' && !inQuotes) {
			row.push(current);
			current = '';
		} else if ((char === '\n' || char === '\r') && !inQuotes) {
			if (char === '\r' && text[i + 1] === '\n') {
				i++;
			}
			row.push(current);
			if (row.some((cell) => cell.trim() !== '')) {
				rows.push(row);
			}
			row = [];
			current = '';
		} else {
			current += char;
		}
	}
	if (current !== '' || row.length > 0) {
		row.push(current);
		if (row.some((cell) => cell.trim() !== '')) {
			rows.push(row);
		}
	}
	return rows;
}

function normalizeHeader(row: string[]): string[] {
	const alias: Record<string, string> = {
		currency: 'priceCurrency',
		date: 'date',
		fee: 'fee',
		feecurrency: 'feeCurrency',
		fees: 'fee',
		note: 'note',
		notes: 'note',
		price: 'price',
		pricecurrency: 'priceCurrency',
		qty: 'quantity',
		quantity: 'quantity',
		side: 'side',
		symbol: 'symbol'
	};
	return row.map((cell) => {
		const normalized = cell
			.trim()
			.toLowerCase()
			.replace(/[^a-z]/g, '');
		return alias[normalized] ?? cell.trim();
	});
}

function createDefaultHeader(length: number): string[] {
	const defaults = ['date', 'symbol', 'side', 'quantity', 'price', 'priceCurrency', 'fee', 'feeCurrency', 'note'];
	return defaults.slice(0, length);
}

function toDateOnlyISOString(date: Date): string {
	return date.toISOString().slice(0, 10);
}

function normalizeFeeCurrencyValue(
	fee: number | null,
	feeCurrency: Currency | null,
	priceCurrency: Currency
): Currency | null {
	if (fee == null) return null;
	return feeCurrency ?? priceCurrency;
}

type DuplicateKeyPayload = {
	date: Date;
	fee: number | null;
	feeCurrency: Currency | null;
	note?: string | null;
	price: number;
	priceCurrency: Currency;
	quantity: number;
	side: 'BUY' | 'SELL';
	symbol: string;
};

function makeDuplicateKey(record: DuplicateKeyPayload): string {
	const feeCurrency = normalizeFeeCurrencyValue(record.fee, record.feeCurrency, record.priceCurrency);
	const feePart = record.fee != null ? String(record.fee) : '';
	const feeCurrencyPart = feeCurrency ?? '';
	return [
		toDateOnlyISOString(record.date),
		record.symbol,
		record.side,
		String(record.quantity),
		String(record.price),
		record.priceCurrency,
		feePart,
		feeCurrencyPart
	].join('|');
}
