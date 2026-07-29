import { z } from 'zod';
import { searchYahooSymbols } from '@/server/yahoo-search';
import type { AppTool } from './types';

/**
 * Enough listings to disambiguate a multi-exchange ETF (VUAA lists on ~6 venues) without
 * spending the tool-result budget on a long tail the user will never pick.
 */
const MAX_CANDIDATES = 8;

const inputSchema = z.strictObject({
	query: z.string().min(1).max(64)
});

const outputSchema = z.strictObject({
	candidates: z.array(
		z.strictObject({
			exchange: z.string(),
			name: z.string(),
			symbol: z.string(),
			type: z.string()
		})
	),
	query: z.string(),
	/** true when more listings matched than were returned. */
	truncated: z.boolean()
});

/**
 * Resolve a company/fund name or an ambiguous ticker root to concrete, tradeable tickers.
 *
 * Exists because `market.priceHistory` takes an exact symbol and returns an empty series for
 * anything else: without this, "the price of VUAA" is a dead end, since VUAA alone is not a
 * ticker — VUAA.L, VUAA.DE and VUAA.MI are, and they are different listings of one fund.
 *
 * Same `watchlist:read` scope as `market.priceHistory`: this is public reference data with no
 * tenant dimension, so it takes no userId.
 */
export const symbolSearchTool: AppTool<typeof inputSchema, typeof outputSchema> = {
	annotations: { openWorldHint: true, readOnlyHint: true, title: 'Symbol search' },
	description:
		'Find tradeable tickers matching a company/fund name or an ambiguous ticker root. Returns candidate listings (symbol, name, exchange, type) — one per exchange, so the same fund appears several times. Use this whenever the user names an instrument that is not already an exact ticker, or when market.priceHistory returned an empty series. Present the candidates and let the user choose; do NOT guess a listing on their behalf.',
	execute: async (input) => {
		let results: Awaited<ReturnType<typeof searchYahooSymbols>>;
		try {
			results = await searchYahooSymbols(input.query);
		} catch (err) {
			// Degrade like every other tool: an unreachable provider must not kill the chat turn.
			console.error(`symbol.search: lookup failed for ${input.query}:`, err);
			results = [];
		}

		const candidates = results.slice(0, MAX_CANDIDATES).map((r) => ({
			exchange: r.exchange,
			name: r.description,
			symbol: r.symbol,
			type: r.type
		}));

		return { candidates, query: input.query, truncated: results.length > candidates.length };
	},
	inputSchema,
	mutates: false,
	name: 'symbol.search',
	outputSchema,
	requiredScope: 'watchlist:read'
};
