import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { env } from '@/env';
import { isValidSymbol, normalizeSymbol, symbolSchema } from '@/lib/validation';
import { createTRPCRouter, withPermissions } from '@/server/api/trpc';
import { fluxStringLiteral, influxQueryApi, measurement } from '@/server/influx';
import { ingestYahooSymbol } from '@/server/jobs/yahoo-lib';
import { searchYahooSymbols, symbolExistsOnYahoo } from '@/server/yahoo-search';

/**
 * Watchlist router - manages user watchlists and market data.
 * All procedures require authentication (protectedProcedure).
 *
 * Features:
 * - Add/remove symbols from watchlist
 * - Retrieve historical price data from InfluxDB
 * - Corporate events (dividends, splits, capital gains)
 * - Symbol search via Yahoo Finance API
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
	 * Validates the symbol is recognized by Yahoo before persisting (rejects unknown symbols, and
	 * surfaces a retryable error if Yahoo is unreachable). Full price history is then ingested in the background.
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
				symbol: symbolSchema,
				type: z.string().optional()
			})
		)
		.mutation(async ({ ctx, input }) => {
			const userId = ctx.session.user.id;
			const symbol = normalizeSymbol(input.symbol);

			// Validate the symbol is recognized by Yahoo before persisting. Tri-state so a
			// transient Yahoo outage is retryable rather than a false "unknown symbol".
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
					message: `${symbol} is not a recognized Yahoo Finance symbol.`
				});
			}

			const data = { ...input, symbol };
			let created = false;
			let result: any;
			try {
				result = await ctx.db.watchlistItem.create({ data: { userId, ...data } });
				created = true;
			} catch (e) {
				// upsert-like behavior for unique(userId,symbol)
				await ctx.db.watchlistItem.update({
					data: { ...data },
					where: { userId_symbol: { symbol, userId } }
				});
				result = { alreadyExists: true } as const;
			}

			// Fire-and-forget full-history ingestion (errors swallowed; validated above).
			void (async () => {
				try {
					await ingestYahooSymbol(symbol, { userId });
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
				days: z.number().int().min(1).default(365),
				symbols: z.array(symbolSchema).optional()
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
			const normalizedSymbols = Array.from(
				new Set((symbols ?? []).map((sym) => normalizeSymbol(sym)).filter((sym) => isValidSymbol(sym)))
			).slice(0, 12);

			if (normalizedSymbols.length === 0) {
				return { events: {} } as const;
			}

			type Div = { date: string; amount: number };
			type Split = { date: string; ratio: number; numerator?: number; denominator?: number };
			type CapG = { date: string; amount: number };
			const events: Record<string, { dividends: Div[]; splits: Split[]; capitalGains: CapG[] }> = {};

			const days = input.days;
			const symbolFilter = normalizedSymbols.map((s) => `r.symbol == ${fluxStringLiteral(s)}`).join(' or ');
			for (const sym of normalizedSymbols) {
				events[sym] = { capitalGains: [], dividends: [], splits: [] };
			}

			const [dividendRows, splitRows, capitalGainRows] = await Promise.all([
				influxQueryApi.collectRows<{ symbol: string; _time: string; _value: number | string }>(
					`from(bucket: ${fluxStringLiteral(env.INFLUXDB_BUCKET)})
  |> range(start: -${days + 3}d)
  |> filter(fn: (r) => r._measurement == ${fluxStringLiteral('dividends')} and r._field == ${fluxStringLiteral('amount')} and (${symbolFilter}))
  |> keep(columns: ["_time", "_value", "symbol"])
  |> sort(columns: ["_time"])`
				),
				influxQueryApi.collectRows<{ symbol: string; _time: string; _value: number | string }>(
					`from(bucket: ${fluxStringLiteral(env.INFLUXDB_BUCKET)})
  |> range(start: -${days + 3}d)
  |> filter(fn: (r) => r._measurement == ${fluxStringLiteral('splits')} and r._field == ${fluxStringLiteral('ratio')} and (${symbolFilter}))
  |> keep(columns: ["_time", "_value", "symbol"])
  |> sort(columns: ["_time"])`
				),
				influxQueryApi.collectRows<{ symbol: string; _time: string; _value: number | string }>(
					`from(bucket: ${fluxStringLiteral(env.INFLUXDB_BUCKET)})
  |> range(start: -${days + 3}d)
  |> filter(fn: (r) => r._measurement == ${fluxStringLiteral('capital_gains')} and r._field == ${fluxStringLiteral('amount')} and (${symbolFilter}))
  |> keep(columns: ["_time", "_value", "symbol"])
  |> sort(columns: ["_time"])`
				)
			]);

			for (const r of dividendRows) {
				const bucket = events[normalizeSymbol(String(r.symbol))];
				if (!bucket) continue;
				const t = String(r._time);
				const v = Number(r._value);
				if (!t || !Number.isFinite(v)) continue;
				bucket.dividends.push({ amount: v, date: t.slice(0, 10) });
			}
			for (const r of splitRows) {
				const bucket = events[normalizeSymbol(String(r.symbol))];
				if (!bucket) continue;
				const t = String(r._time);
				const v = Number(r._value);
				if (!t || !Number.isFinite(v)) continue;
				bucket.splits.push({ date: t.slice(0, 10), ratio: v });
			}
			for (const r of capitalGainRows) {
				const bucket = events[normalizeSymbol(String(r.symbol))];
				if (!bucket) continue;
				const t = String(r._time);
				const v = Number(r._value);
				if (!t || !Number.isFinite(v)) continue;
				bucket.capitalGains.push({ amount: v, date: t.slice(0, 10) });
			}

			for (const bucket of Object.values(events)) {
				bucket.capitalGains.sort((a, b) => a.date.localeCompare(b.date));
				bucket.dividends.sort((a, b) => a.date.localeCompare(b.date));
				bucket.splits.sort((a, b) => a.date.localeCompare(b.date));
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
				days: z.number().int().min(1).default(90),
				field: z.enum(['open', 'high', 'low', 'close']).default('close'),
				symbols: z.array(symbolSchema).optional()
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
			const normalizedSymbols = Array.from(
				new Set((symbols ?? []).map((sym) => normalizeSymbol(sym)).filter((sym) => isValidSymbol(sym)))
			).slice(0, 12);

			if (normalizedSymbols.length === 0) {
				return { series: {} } as const;
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

			for (const sym of normalizedSymbols) {
				series[sym] = [];
			}

			const symbolFilter = normalizedSymbols.map((s) => `r.symbol == ${fluxStringLiteral(s)}`).join(' or ');
			const flux = `from(bucket: ${fluxStringLiteral(env.INFLUXDB_BUCKET)})
  |> range(start: -${days + 3}d)
  |> filter(fn: (r) => r._measurement == ${fluxStringLiteral(measurement)} and r._field == ${fluxStringLiteral(input.field)} and (${symbolFilter}))
  |> aggregateWindow(every: ${every}, fn: last, createEmpty: true)
  |> fill(usePrevious: true)
  |> keep(columns: ["_time", "_value", "symbol"])
  |> sort(columns: ["_time"])`;

			const rows = await influxQueryApi.collectRows<{ symbol: string; _time: string; _value: number | string }>(
				flux
			);
			for (const r of rows) {
				const bucket = series[normalizeSymbol(String(r.symbol))];
				if (!bucket) continue;
				const t = String(r._time);
				if (!t) continue;
				bucket.push({ date: t.slice(0, 10), value: Number(r._value) });
			}

			for (const bucket of Object.values(series)) {
				bucket.sort((a, b) => a.date.localeCompare(b.date));
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
		.input(z.object({ symbol: symbolSchema }))
		.mutation(async ({ ctx, input }) => {
			const userId = ctx.session.user.id;
			const symbol = normalizeSymbol(input.symbol);
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
	 * Searches for symbols using Yahoo Finance API.
	 *
	 * @input q - Search query (min 1 character)
	 *
	 * @returns Search results with count and result array containing symbol, displaySymbol, description, type, exchange
	 *
	 * @throws {Error} If Yahoo Finance search fails
	 *
	 * @example
	 * const results = await api.watchlist.search.query({ q: 'apple' });
	 * results.result.forEach(r => console.log(r.symbol, r.description));
	 */
	search: withPermissions('watchlist', 'read')
		.input(z.object({ q: z.string().min(1) }))
		.query(async ({ input }) => {
			const results = await searchYahooSymbols(input.q);
			const data = {
				count: results.length,
				result: results.map((r) => ({
					description: r.description,
					displaySymbol: r.symbol,
					exchange: r.exchange,
					symbol: r.symbol,
					type: r.type
				}))
			};
			if (process.env.NODE_ENV !== 'production') {
				console.log('[watchlist.search] Yahoo Finance response', data);
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
		.input(z.object({ starred: z.boolean().optional(), symbol: symbolSchema }))
		.mutation(async ({ ctx, input }) => {
			const userId = ctx.session.user.id;
			const symbol = normalizeSymbol(input.symbol);
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
