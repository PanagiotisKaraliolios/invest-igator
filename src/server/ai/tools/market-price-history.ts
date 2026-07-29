import { z } from 'zod';
import { normalizeSymbol } from '@/lib/validation';
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

/**
 * How long ONE tool call waits, inside a single turn, for a full-history Yahoo backfill before
 * giving up on getting the ingest's result THIS turn. `ingestYahooSymbol` (yahoo-lib.ts, out of
 * scope for this change) fetches the ENTIRE history with no timeout and no abort signal of its
 * own, and a turn can chain up to 8 tool steps — without a bound here, one hung Yahoo connection
 * could consume the whole `streamText` request (the chat route's `maxDuration = 60`).
 * 8 steps * BACKFILL_WAIT_MS (5s) = 40s worst case, comfortably inside the 60s ceiling.
 * Losing the race does NOT cancel the ingest: it keeps running and still writes to Influx, so a
 * later turn — or another user — hits the cache instead of Yahoo (the prompt already tells the
 * model a first-time empty result does not mean the instrument has no prices).
 */
export const BACKFILL_WAIT_MS = 5_000;

/**
 * A symbol Yahoo's *search* endpoint knows (`symbolExistsOnYahoo` said 'yes') but whose *chart*
 * endpoint yields no bars never gets anything written to Influx, so `symbolHasAnyData` would
 * stay false forever and every future turn would retry the full-history ingest. This in-process
 * map remembers, for a while, that a backfill attempt for a given normalized symbol produced
 * nothing — so a single instance stops re-attempting it on every turn.
 *
 * This is a RATE LIMITER, not a correctness store: deliberately per-instance and in-memory, not
 * durable. It only gates whether a NEW backfill is attempted — the plain Influx read above is
 * never gated by it, so if data legitimately lands (from this ingest finishing late, or from any
 * other source) a later turn still sees it immediately. A restart, a deploy, or a second
 * instance simply repeats one wasted Yahoo call; that is an acceptable cost for not needing a
 * new persistence layer.
 */
const NEGATIVE_BACKFILL_TTL_MS = 60 * 60 * 1000;
const negativeBackfillCache = new Map<string, number>();

function pruneNegativeBackfillCache(now: number): void {
	for (const [symbol, expiresAt] of negativeBackfillCache) {
		if (expiresAt <= now) negativeBackfillCache.delete(symbol);
	}
}

function isNegativelyCached(symbol: string): boolean {
	const expiresAt = negativeBackfillCache.get(symbol);
	return expiresAt !== undefined && expiresAt > Date.now();
}

function recordNegativeBackfill(symbol: string): void {
	const now = Date.now();
	pruneNegativeBackfillCache(now); // prune on every write, not on a separate timer
	negativeBackfillCache.set(symbol, now + NEGATIVE_BACKFILL_TTL_MS);
}

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
	execute: async (input, ctx) => {
		// Normalized EXACTLY ONCE and reused for every call below (the read, both existence
		// checks, the ingest, and the returned `symbol`). Previously each call normalized
		// independently — `getPriceHistory`/`symbolHasAnyData` internally, but `ingestYahooSymbol`
		// received the model's raw string — so a lowercase/whitespace-padded input (e.g.
		// 'vuaa.l') ingested under a DIFFERENT key than every read looked for, poisoning Influx
		// with an orphan series nothing ever queries and forcing a full re-ingest on every turn.
		const symbol = normalizeSymbol(input.symbol);

		let points: Awaited<ReturnType<typeof getPriceHistory>> = [];
		let fetched = false;
		try {
			points = await getPriceHistory(symbol, input.days, input.field);

			// An empty series for a symbol we have NEVER stored usually means "nobody has asked for
			// this ticker yet", not "this ticker has no prices". Fetch it once, on demand, then
			// re-query. `ingestYahooSymbol` writes to Influx, so the next turn — and every other
			// user — hits the cache instead of Yahoo.
			//
			// Gated deliberately:
			//  - bail out if the turn was already cancelled — starting a fresh backfill for a
			//    response nobody will see is pure waste;
			//  - the negative cache next, so a symbol whose backfill recently produced nothing
			//    (search knows it but chart can't serve it, or the last attempt timed out/failed)
			//    is not retried on every single turn;
			//  - `symbolHasAnyData`, so a delisted symbol that legitimately has no points in the
			//    trailing window is not refetched on every single turn;
			//  - then `symbolExistsOnYahoo`, so a typo never triggers a full-history ingest.
			if (
				points.length === 0 &&
				!ctx.abortSignal?.aborted &&
				!isNegativelyCached(symbol) &&
				!(await symbolHasAnyData(symbol))
			) {
				if ((await symbolExistsOnYahoo(symbol)) === 'yes') {
					// Bounded WAIT, not a bounded fetch: `ingestYahooSymbol` itself has no timeout
					// (yahoo-lib.ts is out of scope here) and always runs to completion on its own.
					// Racing a timer against it means a slow/hung Yahoo connection can only ever
					// cost THIS turn BACKFILL_WAIT_MS — never the rest of the request — while the
					// ingest keeps running in the background regardless of which side wins.
					const ingestOutcome = ingestYahooSymbol(symbol).then(
						() => 'settled' as const,
						(err) => {
							// Handled on the promise itself, right here — so a rejection can never
							// become an unhandled rejection, whether the timer or the ingest wins.
							console.error(`market.priceHistory: backfill ingest failed for ${symbol}:`, err);
							return 'failed' as const;
						}
					);
					const timeout = new Promise<'timeout'>((resolve) => {
						setTimeout(() => resolve('timeout'), BACKFILL_WAIT_MS);
					});
					const outcome = await Promise.race([ingestOutcome, timeout]);

					if (outcome === 'settled') {
						fetched = true;
						points = await getPriceHistory(symbol, input.days, input.field);
						// Search knew the symbol but chart served nothing — negative-cache it so we
						// stop re-attempting this exact dead end every turn.
						if (points.length === 0) recordNegativeBackfill(symbol);
					} else if (outcome === 'timeout') {
						// Still running in the background and will still land in Influx — the
						// prompt already tells the model a first-time empty result does not mean
						// the instrument has no prices, so the NEXT turn is where this pays off.
						fetched = true;
						recordNegativeBackfill(symbol);
					} else {
						// The ingest itself failed (not merely slow) — nothing was fetched.
						recordNegativeBackfill(symbol);
					}
				}
			}
		} catch (err) {
			// Degrade gracefully: an unreachable/slow data source (e.g. Influx down) or a failed
			// backfill must NOT throw out of a chat turn — that leaves the assistant with a silent,
			// empty reply. Treat any failure the same as "no data" (the documented empty-series
			// contract) and log it for ops; the model then tells the user it has no price data
			// instead of the turn dying. `fetched` is deliberately left untouched here: if the
			// ingest above already succeeded and only the RE-QUERY that follows it threw, Influx
			// genuinely holds the data now, and reporting `fetched: false` would be a lie.
			console.error(`market.priceHistory: price data unavailable for ${symbol}:`, err);
			points = [];
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
				symbol,
				truncated: false
			}),
			{ keep: 'tail' }
		);
		return {
			fetched,
			field: input.field,
			points: bounded.items,
			symbol,
			truncated: bounded.truncated
		};
	},
	inputSchema,
	mutates: false,
	name: 'market.priceHistory',
	outputSchema,
	requiredScope: 'watchlist:read'
};
