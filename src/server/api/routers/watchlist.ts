import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { env } from '@/env';
import { createTRPCRouter, withPermissions } from '@/server/api/trpc';
import { escapeFluxString, influxQueryApi, isValidSymbol, measurement, symbolHasAnyData } from '@/server/influx';
import { ingestYahooSymbol } from '@/server/jobs/yahoo-lib';

/**
 * Normalizes a symbol by trimming whitespace and converting to uppercase.
 * Also validates the symbol format.
 *
 * @param symbol - The symbol to normalize
 * @returns Normalized symbol
 * @throws {TRPCError} If symbol format is invalid
 */
function normalizeAndValidateSymbol(symbol: string): string {
	const normalized = symbol.trim().toUpperCase();
	if (!isValidSymbol(normalized)) {
		throw new TRPCError({
			code: 'BAD_REQUEST',
			message:
				'Invalid symbol format. Only alphanumeric characters, dots, hyphens, underscores, and carets are allowed.'
		});
	}
	return normalized;
}

/**
 * Watchlist router - manages user watchlists and market data.
 * All procedures require authentication (protectedProcedure).
 *
 * Features:
 * - Add/remove symbols from watchlist
 * - Retrieve historical price data from InfluxDB
 * - Corporate events (dividends, splits, capital gains)
 * - Symbol search via Finnhub API
 * - Star/favorite symbols (max 5)
 *
 * @example
 * // Add a symbol to watchlist
 * await api.watchlist.add.mutate({ symbol: 'AAPL' });
 *
 * @example
 * // Get price history
 * const data = await api.watchlist.history.query({
 *   symbols: ['AAPL', 'MSFT'],
 *   days: 90
 * });
 */
export const watchlistRouter = createTRPCRouter({
	/**
	 * Adds a symbol to the user's watchlist.
	 * Creates or updates the watchlist item. Triggers background ingestion if no data exists.
	 *
	 * @input symbol - Stock symbol (required)
	 * @input displaySymbol - Optional display name
	 * @input description - Optional description
	 * @input type - Optional security type
	 *
	 * @returns Created watchlist item or {alreadyExists: true}
	 *
	 * @example
	 * await api.watchlist.add.mutate({
	 *   symbol: 'AAPL',
	 *   displaySymbol: 'Apple Inc.',
	 *   description: 'Technology company'
	 * });
	 */
	add: withPermissions('watchlist', 'write')
		.input(
			z.object({
				description: z.string().optional(),
				displaySymbol: z.string().optional(),
				symbol: z.string().min(1).max(20), // Add max length for symbols
				type: z.string().optional()
			})
		)
		.mutation(async ({ ctx, input }) => {
			const userId = ctx.session.user.id;

			// Normalize and validate symbol format to prevent injection attacks
			const symbol = normalizeAndValidateSymbol(input.symbol);

			let created = false;
			let result: any;
			try {
				result = await ctx.db.watchlistItem.create({
					data: { userId, ...input, symbol }
				});
				created = true;
			} catch (e) {
				// upsert-like behavior for unique(userId,symbol)
				await ctx.db.watchlistItem.update({
					data: { ...input, symbol },
					where: { userId_symbol: { symbol, userId } }
				});
				result = { alreadyExists: true } as const;
			}

			// Fire-and-forget ingestion if symbol has no data yet
			void (async () => {
				try {
					// const has = await symbolHasAnyData(symbol);
					// if (!has) {
					await ingestYahooSymbol(symbol, { userId });
					// }
				} catch {}
			})();

			return result ?? { alreadyExists: !created };
		}),

	/**
	 * Retrieves corporate events for specified symbols or user's watchlist.
	 * Returns dividends, stock splits, and capital gains distributions.
	 *
	 * @input symbols - Optional array of symbols (default: user's top 5 starred/recent)
	 * @input days - Lookback period in days (default: 365, min: 1)
	 *
	 * @returns Events object keyed by symbol with dividends, splits, capitalGains arrays
	 *
	 * @example
	 * const result = await api.watchlist.events.query({
	 *   symbols: ['AAPL', 'MSFT'],
	 *   days: 180
	 * });
	 * result.events['AAPL'].dividends.forEach(d => console.log(d.date, d.amount));
	 */
	// Corporate events per symbol (dividends, splits, capital gains)
	events: withPermissions('watchlist', 'read')
		.input(
			z.object({
				days: z.number().int().min(1).max(7300).default(365), // Cap at 20 years
				symbols: z.array(z.string()).optional()
			})
		)
		.query(async ({ ctx, input }) => {
			const userId = ctx.session.user.id;
			let symbols = input.symbols;
			if (!symbols) {
				const rows = await ctx.db.watchlistItem.findMany({
					orderBy: [{ starred: 'desc' }, { createdAt: 'desc' }],
					select: { symbol: true },
					where: { userId }
				});
				symbols = Array.from(new Set(rows.map((r) => r.symbol.trim().toUpperCase()))).slice(0, 5);
			}
			// safety limit
			symbols = (symbols ?? []).slice(0, 12);

			// Validate all symbols to prevent injection
			for (const sym of symbols) {
				if (!isValidSymbol(sym)) {
					throw new TRPCError({
						code: 'BAD_REQUEST',
						message: `Invalid symbol format: ${sym}`
					});
				}
			}

			type Div = { date: string; amount: number };
			type Split = { date: string; ratio: number; numerator?: number; denominator?: number };
			type CapG = { date: string; amount: number };
			const events: Record<string, { dividends: Div[]; splits: Split[]; capitalGains: CapG[] }> = {};

			const days = input.days;
			for (const sym of symbols) {
				const escapedSym = escapeFluxString(sym);
				// Dividends
				{
					const flux = `from(bucket: "${env.INFLUXDB_BUCKET}")
  |> range(start: -${days + 3}d)
  |> filter(fn: (r) => r._measurement == "dividends" and r._field == "amount" and r.symbol == "${escapedSym}")
  |> keep(columns: ["_time", "_value"]) 
  |> sort(columns: ["_time"])`;
					const arr: Div[] = [];
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
						if (!t || !Number.isFinite(v)) continue;
						arr.push({ amount: v, date: t.slice(0, 10) });
					}
					events[sym] = events[sym] ?? { capitalGains: [], dividends: [], splits: [] };
					events[sym].dividends = arr;
				}

				// Splits (use ratio field)
				{
					const flux = `from(bucket: "${env.INFLUXDB_BUCKET}")
  |> range(start: -${days + 3}d)
  |> filter(fn: (r) => r._measurement == "splits" and r._field == "ratio" and r.symbol == "${escapedSym}")
  |> keep(columns: ["_time", "_value"]) 
  |> sort(columns: ["_time"])`;
					const arr: Split[] = [];
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
						if (!t || !Number.isFinite(v)) continue;
						arr.push({ date: t.slice(0, 10), ratio: v });
					}
					events[sym] = events[sym] ?? { capitalGains: [], dividends: [], splits: [] };
					events[sym].splits = arr;
				}

				// Capital gains
				{
					const flux = `from(bucket: "${env.INFLUXDB_BUCKET}")
  |> range(start: -${days + 3}d)
  |> filter(fn: (r) => r._measurement == "capital_gains" and r._field == "amount" and r.symbol == "${escapedSym}")
  |> keep(columns: ["_time", "_value"]) 
  |> sort(columns: ["_time"])`;
					const arr: CapG[] = [];
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
						if (!t || !Number.isFinite(v)) continue;
						arr.push({ amount: v, date: t.slice(0, 10) });
					}
					events[sym] = events[sym] ?? { capitalGains: [], dividends: [], splits: [] };
					events[sym].capitalGains = arr;
				}
			}

			return { events } as const;
		}),

	/**
	 * Retrieves historical daily price series from InfluxDB.
	 * Supports adaptive aggregation for large date ranges.
	 *
	 * @input symbols - Optional array of symbols (default: user's top 5 starred/recent)
	 * @input days - Lookback period in days (default: 90, min: 1)
	 * @input field - Price field to retrieve (default: 'close', options: open/high/low/close)
	 *
	 * @returns Series object keyed by symbol with array of {date, value} points
	 *
	 * @example
	 * const result = await api.watchlist.history.query({
	 *   symbols: ['AAPL'],
	 *   days: 365,
	 *   field: 'close'
	 * });
	 * result.series['AAPL'].forEach(p => console.log(p.date, p.value));
	 */
	// Historical daily series from InfluxDB (default: close). If no symbols provided, use user's watchlist.
	history: withPermissions('watchlist', 'read')
		.input(
			z.object({
				days: z.number().int().min(1).max(7300).default(90), // Cap at 20 years
				field: z.enum(['open', 'high', 'low', 'close']).default('close'),
				symbols: z.array(z.string()).optional()
			})
		)
		.query(async ({ ctx, input }) => {
			const userId = ctx.session.user.id;
			let symbols = input.symbols;
			if (!symbols) {
				const rows = await ctx.db.watchlistItem.findMany({
					orderBy: [{ starred: 'desc' }, { createdAt: 'desc' }],
					select: { symbol: true },
					where: { userId }
				});
				symbols = Array.from(new Set(rows.map((r) => r.symbol.trim().toUpperCase()))).slice(0, 5);
			}
			// safety limit
			symbols = (symbols ?? []).slice(0, 12);

			// Validate all symbols to prevent injection
			for (const sym of symbols) {
				if (!isValidSymbol(sym)) {
					throw new TRPCError({
						code: 'BAD_REQUEST',
						message: `Invalid symbol format: ${sym}`
					});
				}
			}

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
				const escapedSym = escapeFluxString(sym);
				const flux = `from(bucket: "${env.INFLUXDB_BUCKET}")
  |> range(start: -${days + 3}d)
  |> filter(fn: (r) => r._measurement == "${measurement}" and r._field == "${input.field}" and r.symbol == "${escapedSym}")
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
		}),
	/**
	 * Lists all symbols in the user's watchlist.
	 * Ordered by starred status (starred first), then creation date (newest first).
	 *
	 * @returns Array of watchlist items
	 *
	 * @example
	 * const items = await api.watchlist.list.query();
	 * items.forEach(item => console.log(item.symbol, item.starred));
	 */
	list: withPermissions('watchlist', 'read').query(async ({ ctx }) => {
		const userId = ctx.session.user.id;
		return ctx.db.watchlistItem.findMany({
			orderBy: [{ starred: 'desc' }, { createdAt: 'desc' }],
			where: { userId }
		});
	}),

	/**
	 * Removes a symbol from the user's watchlist.
	 * Prevents removal if the symbol has associated transactions.
	 *
	 * @input symbol - Symbol to remove (min 1 character)
	 *
	 * @throws {TRPCError} BAD_REQUEST - If symbol has transactions
	 * @returns {success: true}
	 *
	 * @example
	 * await api.watchlist.remove.mutate({ symbol: 'AAPL' });
	 */
	remove: withPermissions('watchlist', 'delete')
		.input(z.object({ symbol: z.string().min(1).max(20) }))
		.mutation(async ({ ctx, input }) => {
			const userId = ctx.session.user.id;
			// Normalize and validate symbol format
			const symbol = normalizeAndValidateSymbol(input.symbol);

			const hasTx = await ctx.db.transaction.findFirst({
				select: { id: true },
				where: { symbol, userId }
			});
			if (hasTx) {
				throw new TRPCError({ code: 'BAD_REQUEST', message: 'Cannot remove a symbol that has transactions.' });
			}
			await ctx.db.watchlistItem.delete({
				where: { userId_symbol: { symbol, userId } }
			});
			return { success: true } as const;
		}),

	/**
	 * Searches for symbols using Finnhub API.
	 *
	 * @input q - Search query (min 1 character)
	 *
	 * @returns Search results with count and result array containing symbol, displaySymbol, description, type
	 *
	 * @throws {Error} If Finnhub API fails
	 *
	 * @example
	 * const results = await api.watchlist.search.query({ q: 'apple' });
	 * results.result.forEach(r => console.log(r.symbol, r.description));
	 */
	search: withPermissions('watchlist', 'read')
		.input(z.object({ q: z.string().min(1) }))
		.query(async ({ input }) => {
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

			if (process.env.NODE_ENV !== 'production') {
				console.log('[watchlist.search] Finnhub response', data);
			}

			return data;
		}),
	/**
	 * Toggles the starred status of a watchlist item.
	 * Enforces a maximum of 5 starred items per user.
	 *
	 * @input symbol - Symbol to toggle (min 1 character)
	 * @input starred - Optional explicit star value (if omitted, toggles current)
	 *
	 * @throws {TRPCError} BAD_REQUEST - If trying to star more than 5 items
	 * @returns {starred: boolean, symbol: string}
	 *
	 * @example
	 * await api.watchlist.toggleStar.mutate({ symbol: 'AAPL', starred: true });
	 */
	toggleStar: withPermissions('watchlist', 'write')
		.input(z.object({ starred: z.boolean().optional(), symbol: z.string().min(1).max(20) }))
		.mutation(async ({ ctx, input }) => {
			const userId = ctx.session.user.id;
			// Normalize and validate symbol format
			const symbol = normalizeAndValidateSymbol(input.symbol);

			const current = await ctx.db.watchlistItem.findUnique({
				select: { starred: true },
				where: { userId_symbol: { symbol, userId } }
			});
			const next = input.starred ?? !current?.starred;

			// Enforce max 5 starred items. Only check when transitioning to starred.
			if (next && !current?.starred) {
				const count = await ctx.db.watchlistItem.count({
					where: { starred: true, userId }
				});
				if (count >= 5) {
					throw new TRPCError({ code: 'BAD_REQUEST', message: 'You can only star up to 5 assets.' });
				}
			}
			await ctx.db.watchlistItem.update({
				data: { starred: next },
				where: { userId_symbol: { symbol, userId } }
			});
			return { starred: next, symbol } as const;
		})
});

export type WatchlistRouter = typeof watchlistRouter;
