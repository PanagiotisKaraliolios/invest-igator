import { z } from 'zod';
import { currencySchema } from '@/lib/currency';
import { toLocalIsoDate } from '@/lib/date';
import { type FullSeriesPoint, getCachedFullSeries } from '@/server/portfolio-compute';
import { boundArrayElements } from './result-bounds';
import type { AppTool } from './types';

/**
 * Upper bound on `maxPoints`. A NAV point is 4 numeric fields (~90 bytes serialized); 1000 of
 * them is ~90KB (~22.5K tokens, 2.7x MAX_TOOL_RESULT_TOKENS). 250 leaves comfortable margin
 * (measured, not assumed — see the "provably bounded" tests in registry.test.ts) while still
 * covering most trailing windows a user would ask about.
 */
const MAX_MAX_POINTS = 250;

/**
 * Upper bound on how many `unconvertedSymbols` are returned VERBATIM. `unconvertedSymbols` is a
 * second, independently-sized array in this tool's output — `boundArrayElements` below only ever
 * shrinks `points`, so without a cap of its own this array is MEASURED (it counts toward the
 * envelope size `boundArrayElements` re-renders) but can never be SHRUNK: once `points` has been
 * dropped to zero there is nothing left for the bounder to remove, and an oversized
 * `unconvertedSymbols` would sail through anyway. It is reachable without an attacker:
 * `navOnDate` (portfolio-compute.ts) adds a symbol here for every day with no FX row for it, and
 * there is no cap on distinct symbols per user — a bulk CSV import easily crosses this. Capped
 * to 50, with the TRUE total surfaced via `unconvertedSymbolCount` so the model never mistakes
 * "first 50" for "all of them".
 */
const MAX_UNCONVERTED_SYMBOLS = 50;

/** Caps `unconvertedSymbols` to a fixed, small size while preserving the true total count. */
function boundUnconvertedSymbols(symbols: readonly string[]): { count: number; symbols: string[] } {
	return { count: symbols.length, symbols: symbols.slice(0, MAX_UNCONVERTED_SYMBOLS) };
}

const inputSchema = z.strictObject({
	days: z.number().int().min(1).max(3650).default(365).describe('Length of the trailing window, in days.'),
	maxPoints: z
		.number()
		.int()
		.min(2)
		.max(MAX_MAX_POINTS)
		.default(180)
		.describe('The series is evenly downsampled to at most this many points; first and last are always kept.')
});

const outputSchema = z.strictObject({
	currency: currencySchema,
	/** Money-weighted return over the window, in percent. Computed on the TRUE endpoints. */
	mwrPct: z.number(),
	points: z.array(
		z.strictObject({
			date: z.string(),
			mwrIndex: z.number(),
			nav: z.number(),
			twrIndex: z.number()
		})
	),
	/**
	 * true when `points` is an EVENLY sampled view of the window (first/last always kept). This
	 * is a deliberate, harmless reshaping for readability — NOT data loss. Contrast `truncated`.
	 */
	pointsAreDownsampled: z.boolean(),
	/**
	 * true when either `points` or `unconvertedSymbols` had to drop real data to fit the response
	 * budget — i.e. data loss, not just resampling. When true for `points`, the OLDEST points
	 * were dropped and the most recent NAV is still present (see result-bounds.ts `keep: 'tail'`).
	 * When `unconvertedSymbols` was capped, `unconvertedSymbolCount` still reports the true total.
	 */
	truncated: z.boolean(),
	/** Time-weighted return over the window, in percent. Computed on the TRUE endpoints. */
	twrPct: z.number(),
	/** The TRUE number of unconverted holdings — may exceed unconvertedSymbols.length. */
	unconvertedSymbolCount: z.number().int(),
	/** Holdings excluded from NAV because no FX rate was available. Capped; see unconvertedSymbolCount. */
	unconvertedSymbols: z.array(z.string())
});

/** Percent change between two index levels; 0 when the base is not positive. */
const pctChange = (from: number, to: number): number => (from > 0 ? (to / from - 1) * 100 : 0);

/**
 * Evenly sample down to `maxPoints`, always retaining the first and last element.
 * A 10-year window is 3650 daily points — handing that to a model burns the context
 * window (and, on MCP, the client's) for no analytical gain.
 */
function downsample(points: FullSeriesPoint[], maxPoints: number): FullSeriesPoint[] {
	if (points.length <= maxPoints) return points;
	const step = (points.length - 1) / (maxPoints - 1); // > 1 whenever we get here
	const out: FullSeriesPoint[] = [];
	for (let i = 0; i < maxPoints; i += 1) {
		const p = points[Math.round(i * step)];
		if (p) out.push(p);
	}
	return out;
}

export const portfolioPerformanceTool: AppTool<typeof inputSchema, typeof outputSchema> = {
	annotations: { openWorldHint: false, readOnlyHint: true, title: 'Portfolio performance' },
	description:
		"The user's NAV and time-weighted / money-weighted return series over a trailing window, in their display currency. The returns cover the whole window; the point series may be downsampled (harmless — `pointsAreDownsampled`) and, rarely, further size-truncated (data loss — check `truncated`; the most recent point is always kept, the oldest may be missing). `unconvertedSymbolCount` may exceed `unconvertedSymbols.length` — treat the list as a sample, not the full set, when that happens. Use this for questions about how the portfolio has performed.",
	execute: async (input, ctx) => {
		const { full, unconvertedSymbols: rawUnconvertedSymbols } = await getCachedFullSeries(
			ctx.userId,
			ctx.currency,
			toLocalIsoDate(new Date())
		);
		const { count: unconvertedSymbolCount, symbols: unconvertedSymbols } =
			boundUnconvertedSymbols(rawUnconvertedSymbols);
		const window = full.slice(-input.days);
		const first = window[0];
		const last = window[window.length - 1];
		if (!first || !last) {
			return {
				currency: ctx.currency,
				mwrPct: 0,
				points: [],
				pointsAreDownsampled: false,
				truncated: unconvertedSymbolCount > unconvertedSymbols.length,
				twrPct: 0,
				unconvertedSymbolCount,
				unconvertedSymbols
			};
		}
		const sampled = downsample(window, input.maxPoints);
		// `points` is ordered oldest -> newest, so a size-based truncation must drop from the
		// HEAD (oldest), keeping the tail (most recent NAV) — `keep: 'tail'`. Dropping from the
		// tail here would hand the model a series that stops short of today while twrPct/mwrPct
		// (computed on the TRUE window endpoints below) still claim to run to the present.
		// Belt-and-suspenders otherwise: sampled is already <= MAX_MAX_POINTS numeric points,
		// which is well within budget on its own, but this keeps every array-returning tool on
		// the same measured guarantee rather than a per-tool assumption.
		const bounded = boundArrayElements(
			sampled,
			(slice) => ({
				currency: ctx.currency,
				mwrPct: 0,
				points: slice,
				pointsAreDownsampled: true,
				truncated: true,
				twrPct: 0,
				unconvertedSymbolCount,
				unconvertedSymbols
			}),
			{ keep: 'tail' }
		);
		return {
			currency: ctx.currency,
			mwrPct: pctChange(first.mwrIndex, last.mwrIndex),
			points: bounded.items,
			pointsAreDownsampled: sampled.length < window.length,
			truncated: bounded.truncated || unconvertedSymbolCount > unconvertedSymbols.length,
			twrPct: pctChange(first.twrIndex, last.twrIndex),
			unconvertedSymbolCount,
			unconvertedSymbols
		};
	},
	inputSchema,
	mutates: false,
	name: 'portfolio.performance',
	outputSchema,
	requiredScope: 'portfolio:read'
};
