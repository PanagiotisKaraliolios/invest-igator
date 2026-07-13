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
	/** true when `points` is a sample of the window (downsampled AND/OR size-truncated). */
	pointsAreDownsampled: z.boolean(),
	/** Time-weighted return over the window, in percent. Computed on the TRUE endpoints. */
	twrPct: z.number(),
	/** Holdings excluded from NAV because no FX rate was available. */
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
		"The user's NAV and time-weighted / money-weighted return series over a trailing window, in their display currency. The returns cover the whole window; the point series may be downsampled. Use this for questions about how the portfolio has performed.",
	execute: async (input, ctx) => {
		const { full, unconvertedSymbols } = await getCachedFullSeries(
			ctx.userId,
			ctx.currency,
			toLocalIsoDate(new Date())
		);
		const window = full.slice(-input.days);
		const first = window[0];
		const last = window[window.length - 1];
		if (!first || !last) {
			return {
				currency: ctx.currency,
				mwrPct: 0,
				points: [],
				pointsAreDownsampled: false,
				twrPct: 0,
				unconvertedSymbols
			};
		}
		const sampled = downsample(window, input.maxPoints);
		// Belt-and-suspenders: sampled is already <= MAX_MAX_POINTS numeric points, which is
		// well within budget, but this keeps every array-returning tool on the same measured
		// guarantee rather than a per-tool assumption.
		const bounded = boundArrayElements(sampled, (slice) => ({
			currency: ctx.currency,
			mwrPct: 0,
			points: slice,
			pointsAreDownsampled: true,
			twrPct: 0,
			unconvertedSymbols
		}));
		return {
			currency: ctx.currency,
			mwrPct: pctChange(first.mwrIndex, last.mwrIndex),
			points: bounded.items,
			pointsAreDownsampled: bounded.truncated || bounded.items.length < window.length,
			twrPct: pctChange(first.twrIndex, last.twrIndex),
			unconvertedSymbols
		};
	},
	inputSchema,
	mutates: false,
	name: 'portfolio.performance',
	outputSchema,
	requiredScope: 'portfolio:read'
};
