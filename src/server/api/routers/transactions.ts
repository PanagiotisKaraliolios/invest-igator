import type { Currency } from '@prisma/client';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { env } from '@/env';
import { createTRPCRouter, protectedProcedure } from '@/server/api/trpc';

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
