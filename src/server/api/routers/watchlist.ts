import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { env } from '@/env';
import { createTRPCRouter, protectedProcedure } from '@/server/api/trpc';
import { influxQueryApi, measurement, symbolHasAnyData } from '@/server/influx';
import { ingestYahooSymbol } from '@/server/jobs/yahoo-lib';

export const watchlistRouter = createTRPCRouter({
	add: protectedProcedure
		.input(
			z.object({
				description: z.string().optional(),
				displaySymbol: z.string().optional(),
				symbol: z.string().min(1),
				type: z.string().optional()
			})
		)
		.mutation(async ({ ctx, input }) => {
			const userId = ctx.session.user.id;
			let created = false;
			let result: any;
			try {
				result = await ctx.db.watchlistItem.create({
					data: { userId, ...input }
				});
				created = true;
			} catch (e) {
				// upsert-like behavior for unique(userId,symbol)
				await ctx.db.watchlistItem.update({
					data: { ...input },
					where: { userId_symbol: { symbol: input.symbol, userId } }
				});
				result = { alreadyExists: true } as const;
			}

			// Fire-and-forget ingestion if symbol has no data yet
			void (async () => {
				try {
					const sym = input.symbol.trim().toUpperCase();
					const has = await symbolHasAnyData(sym);
					if (!has) {
						await ingestYahooSymbol(sym);
					}
				} catch {}
			})();

			return result ?? { alreadyExists: !created };
		}),
	list: protectedProcedure.query(async ({ ctx }) => {
		const userId = ctx.session.user.id;
		return ctx.db.watchlistItem.findMany({
			orderBy: [{ starred: 'desc' }, { createdAt: 'desc' }],
			where: { userId }
		});
	}),
	toggleStar: protectedProcedure
		.input(z.object({ symbol: z.string().min(1), starred: z.boolean().optional() }))
		.mutation(async ({ ctx, input }) => {
			const userId = ctx.session.user.id;
			const current = await ctx.db.watchlistItem.findUnique({
				where: { userId_symbol: { userId, symbol: input.symbol } },
				select: { starred: true },
			});
			const next = input.starred ?? !current?.starred;

			// Enforce max 5 starred items. Only check when transitioning to starred.
			if (next && !current?.starred) {
				const count = await ctx.db.watchlistItem.count({
					where: { userId, starred: true },
				});
				if (count >= 5) {
					throw new TRPCError({ code: 'BAD_REQUEST', message: 'You can only star up to 5 assets.' });
				}
			}
			await ctx.db.watchlistItem.update({
				where: { userId_symbol: { userId, symbol: input.symbol } },
				data: { starred: next },
			});
			return { symbol: input.symbol, starred: next } as const;
		}),

	remove: protectedProcedure.input(z.object({ symbol: z.string().min(1) })).mutation(async ({ ctx, input }) => {
		const userId = ctx.session.user.id;
		await ctx.db.watchlistItem.delete({
			where: { userId_symbol: { symbol: input.symbol, userId } }
		});
		return { success: true };
	}),

	search: protectedProcedure.input(z.object({ q: z.string().min(1) })).query(async ({ input }) => {
		const url = new URL(`${env.FINNHUB_API_URL}/search`);
		url.searchParams.set('q', input.q);
		url.searchParams.set('token', env.FINNHUB_API_KEY);

		const res = await fetch(url.toString());
		if (!res.ok) {
			throw new Error(`Finnhub search failed: ${res.status}`);
		}
		const data = (await res.json()) as {
			count: number;
			result: Array<{
				description: string;
				displaySymbol: string;
				symbol: string;
				type: string;
			}>;
		};
		return data;
	}),

	// Historical daily series from InfluxDB (default: close). If no symbols provided, use user's watchlist.
	history: protectedProcedure
		.input(
			z.object({
				symbols: z.array(z.string()).optional(),
				days: z.number().int().min(1).default(90),
				field: z.enum(['open', 'high', 'low', 'close']).default('close')
			})
		)
		.query(async ({ ctx, input }) => {
			const userId = ctx.session.user.id;
			let symbols = input.symbols;
			if (!symbols) {
				const rows = await ctx.db.watchlistItem.findMany({
					where: { userId },
					select: { symbol: true },
					orderBy: [{ starred: 'desc' }, { createdAt: 'desc' }],
				});
				symbols = Array.from(new Set(rows.map((r) => r.symbol.trim().toUpperCase()))).slice(0, 5);
			}
				// safety limit
				symbols = (symbols ?? []).slice(0, 12);

			const series: Record<string, Array<{ date: string; value: number }>> = {};
			// Choose aggregation bucket to cap points for large ranges
			const days = input.days;
			let every: string;
			if (days > 3650) {
				every = '7d';
			} else if (days > 1825) {
				every = '3d';
			} else if (days > 730) {
				every = '1d';
			} else if (days > 365) {
				every = '1d';
			} else {
				every = '1d';
			}

			for (const sym of symbols) {
				const flux = `from(bucket: "${env.INFLUXDB_BUCKET}")
  |> range(start: -${days+3}d)
  |> filter(fn: (r) => r._measurement == "${measurement}" and r._field == "${input.field}" and r.symbol == "${sym}")
  |> aggregateWindow(every: ${every}, fn: last, createEmpty: true)
  |> fill(usePrevious: true)
  |> keep(columns: ["_time", "_value"]) 
  |> sort(columns: ["_time"])`;

				const arr: Array<{ date: string; value: number }> = [];
					for await (const row of influxQueryApi.iterateRows(flux)) {
						let values: unknown;
						let tableMeta: any;
						if (Array.isArray(row)) {
							values = row[0];
							tableMeta = row[1];
						} else if (row && typeof row === 'object' && 'values' in (row as any)) {
							values = (row as any).values;
							tableMeta = (row as any).tableMeta;
						}

						if (!values || !tableMeta || typeof tableMeta.toObject !== 'function') continue;
						const obj = tableMeta.toObject(values as string[]);
						const t = (obj._time as string) || '';
						const v = Number(obj._value);
						if (!t) continue;
						const d = t.slice(0, 10);
						arr.push({ date: d, value: v });
					}
				series[sym] = arr;
			}
			return { series } as const;
		})
});

export type WatchlistRouter = typeof watchlistRouter;
