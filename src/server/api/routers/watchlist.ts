import { z } from 'zod';
import { env } from '@/env';
import { createTRPCRouter, protectedProcedure } from '@/server/api/trpc';
import { influxQueryApi, measurement } from '@/server/influx';

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
			try {
				return await ctx.db.watchlistItem.create({
					data: { userId, ...input }
				});
			} catch (e) {
				// upsert-like behavior for unique(userId,symbol)
						await ctx.db.watchlistItem.update({
							data: { ...input },
							where: { userId_symbol: { symbol: input.symbol, userId } }
						});
						return { alreadyExists: true } as const;
			}
		}),
	list: protectedProcedure.query(async ({ ctx }) => {
		const userId = ctx.session.user.id;
		return ctx.db.watchlistItem.findMany({
			orderBy: { createdAt: 'desc' },
			where: { userId }
		});
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
				days: z.number().int().min(1).max(3650).default(90),
				field: z.enum(['open', 'high', 'low', 'close']).default('close')
			})
		)
		.query(async ({ ctx, input }) => {
			const userId = ctx.session.user.id;
			let symbols = input.symbols;
			if (!symbols) {
				const rows = await ctx.db.watchlistItem.findMany({
					where: { userId },
					select: { symbol: true }
				});
				symbols = Array.from(new Set(rows.map((r) => r.symbol.trim().toUpperCase())));
			}
			// small safety limit
			symbols = symbols.slice(0, 12);

			const series: Record<string, Array<{ date: string; value: number }>> = {};
			for (const sym of symbols) {
				const flux = `from(bucket: "${env.INFLUXDB_BUCKET}")
  |> range(start: -${input.days}d)
  |> filter(fn: (r) => r._measurement == "${measurement}" and r._field == "${input.field}" and r.symbol == "${sym}")
  |> keep(columns: ["_time", "_value"]) 
  |> sort(columns: ["_time"])`;

				const arr: Array<{ date: string; value: number }> = [];
				for await (const row of influxQueryApi.iterateRows(flux)) {
					// row is [string[] values, TableMeta meta]
					const values = Array.isArray(row) ? (row[0] as string[]) : (row as unknown as string[]);
					const meta = Array.isArray(row) ? (row[1] as { columns: { label: string }[] }) : undefined;
					// Fallback column indices for common labels
					let timeIdx = -1;
					let valueIdx = -1;
					if (meta?.columns) {
						for (let i = 0; i < meta.columns.length; i++) {
							if (meta.columns[i]?.label === '_time') timeIdx = i;
							if (meta.columns[i]?.label === '_value') valueIdx = i;
						}
					}
					if (timeIdx < 0) timeIdx = 0;
					if (valueIdx < 0) valueIdx = values.length - 1;
					const t = values[timeIdx] as string; // RFC3339
					const v = Number(values[valueIdx]);
					const d = t.slice(0, 10); // YYYY-MM-DD
					arr.push({ date: d, value: v });
				}
				series[sym] = arr;
			}
			return { series } as const;
		})
});

export type WatchlistRouter = typeof watchlistRouter;
