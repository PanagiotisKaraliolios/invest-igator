import { z } from 'zod';
import { symbolHasAnyData } from '@/server/influx';
import { ingestYahooSymbol } from '@/server/jobs/yahoo-lib';
import { getPriceHistory } from '@/server/services/market';
import { symbolExistsOnYahoo } from '@/server/yahoo-search';
import { boundArrayElements } from './result-bounds';
import type { AppTool } from './types';

const fieldSchema = z.enum(['open', 'high', 'low', 'close']);

/**
 * Upper bound on `days`. `getPriceHistory` (the service) allows up to 3650 days — correct for
 * the service, which also backs a UI chart that must not be hobbled by an AI token budget.
 * But 3650 daily points is ~132KB (~33.7K tokens, ~4.1x MAX_TOOL_RESULT_TOKENS) — far too big
 * for a tool result. 400 days is ~4.4K tokens even in the worst realistic case (see the
 * "provably bounded" tests in registry.test.ts) — comfortable margin under the 8192 ceiling.
 */
const MAX_DAYS = 400;

const inputSchema = z.strictObject({
	days: z.number().int().min(1).max(MAX_DAYS).default(90),
	field: fieldSchema.default('close'),
	symbol: z.string().min(1).max(32)
});

const outputSchema = z.strictObject({
	/** true when this call fetched the symbol's history on demand before answering. */
	fetched: z.boolean(),
	field: fieldSchema,
	points: z.array(z.strictObject({ date: z.string(), value: z.number() })),
	symbol: z.string(),
	/** true when `points` is a prefix rather than the whole requested window. */
	truncated: z.boolean()
});

/**
 * Scoped watchlist:read rather than a scope of its own: this serves market data the user can
 * already reach through the watchlist, and a `market` scope would fork PERMISSION_SCOPES for
 * no authorization benefit. It is the one tool with no tenant dimension — the data is public —
 * so it takes no userId, and the symbol is normalised + validated inside the service before any
 * Flux is authored.
 */
export const marketPriceHistoryTool: AppTool<typeof inputSchema, typeof outputSchema> = {
	annotations: { openWorldHint: false, readOnlyHint: true, title: 'Price history' },
	description:
		'Daily price history for one symbol over a trailing window (at most 400 days), oldest first. Returns an empty series for a malformed symbol, or for one that does not exist. A symbol this app has never seen is fetched on demand before answering (`fetched` is then true), so a first-time empty result does NOT mean the instrument has no prices — if the series is still empty, call symbol.search to find the right listing. If `truncated` is true, the OLDEST days within the window were dropped to fit the response budget — the most recent price is always present; treat the series as starting later than requested, not as the full window.',
	execute: async (input) => {
		let points: Awaited<ReturnType<typeof getPriceHistory>> = [];
		let fetched = false;
		try {
			points = await getPriceHistory(input.symbol, input.days, input.field);

			// An empty series for a symbol we have NEVER stored usually means "nobody has asked for
			// this ticker yet", not "this ticker has no prices". Fetch it once, on demand, then
			// re-query. `ingestYahooSymbol` writes to Influx, so the next turn — and every other
			// user — hits the cache instead of Yahoo.
			//
			// Gated deliberately: `symbolHasAnyData` first, so a delisted symbol that legitimately
			// has no points in the trailing window is not refetched on every single turn; then
			// `symbolExistsOnYahoo`, so a typo never triggers a full-history ingest.
			if (points.length === 0 && !(await symbolHasAnyData(input.symbol))) {
				if ((await symbolExistsOnYahoo(input.symbol)) === 'yes') {
					await ingestYahooSymbol(input.symbol);
					fetched = true;
					points = await getPriceHistory(input.symbol, input.days, input.field);
				}
			}
		} catch (err) {
			// Degrade gracefully: an unreachable/slow data source (e.g. Influx down) or a failed
			// backfill must NOT throw out of a chat turn — that leaves the assistant with a silent,
			// empty reply. Treat any failure the same as "no data" (the documented empty-series
			// contract) and log it for ops; the model then tells the user it has no price data
			// instead of the turn dying.
			console.error(`market.priceHistory: price data unavailable for ${input.symbol}:`, err);
			points = [];
			fetched = false;
		}
		// Numeric-only points, but the same measured guarantee every array-returning tool
		// uses — this is the bound a reverted/removed clamp would blow through.
		// Points are ordered oldest -> newest (see getPriceHistory), so a size-based truncation
		// must drop from the HEAD (oldest) and keep the tail (most recent price) — `keep: 'tail'`.
		// Dropping from the tail (the old default) would silently delete the newest prices instead.
		const bounded = boundArrayElements(
			points,
			(slice) => ({
				fetched,
				field: input.field,
				points: slice,
				symbol: input.symbol,
				truncated: false
			}),
			{ keep: 'tail' }
		);
		return {
			fetched,
			field: input.field,
			points: bounded.items,
			symbol: input.symbol,
			truncated: bounded.truncated
		};
	},
	inputSchema,
	mutates: false,
	name: 'market.priceHistory',
	outputSchema,
	requiredScope: 'watchlist:read'
};
