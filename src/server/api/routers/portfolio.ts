import { z } from 'zod';
import { type Currency, currencySchema } from '@/lib/currency';
import { toLocalIsoDate } from '@/lib/date';
import { createTRPCRouter, protectedProcedure } from '@/server/api/trpc';
import { getCachedFullSeries, getCachedStructure } from '@/server/portfolio-compute';

/**
 * Portfolio router - provides portfolio analytics and performance metrics.
 * All procedures require authentication (protectedProcedure).
 *
 * The heavy inception-to-date computation and current structure live in
 * `@/server/portfolio-compute` and are served from the Next.js Data Cache
 * (per user + currency + day), invalidated on transaction/watchlist mutations.
 */
export const portfolioRouter = createTRPCRouter({
	/**
	 * Calculates portfolio performance metrics over a date range.
	 * Computes time-weighted return (TWR), money-weighted return (MWR), and daily NAV.
	 *
	 * The full inception-to-date chain is computed once (and cached); the requested
	 * `from`..`to` window is sliced from it and normalized to the first in-range point.
	 *
	 * @input from - Start date (ISO yyyy-mm-dd)
	 * @input to - End date (ISO yyyy-mm-dd)
	 * @input currency - Target currency for valuations (default: USD)
	 */
	performance: protectedProcedure
		.input(
			z.object({
				currency: currencySchema.default('USD'),
				from: z.string(), // ISO yyyy-mm-dd
				to: z.string() // ISO yyyy-mm-dd
			})
		)
		.query(async ({ ctx, input }) => {
			const userId = ctx.session.user.id;
			const target: Currency = input.currency as Currency;

			const fromDate = new Date(`${input.from}T00:00:00Z`);
			const toDate = new Date(`${input.to}T00:00:00Z`);
			if (Number.isNaN(fromDate.getTime()) || Number.isNaN(toDate.getTime())) {
				throw new Error('Invalid date range');
			}

			const { full, unconvertedSymbols } = await getCachedFullSeries(userId, target, toLocalIsoDate(toDate));

			if (full.length === 0) {
				return {
					points: [],
					prevDayReturnMwr: 0,
					prevDayReturnTwr: 0,
					totalReturnMwr: 0,
					totalReturnTwr: 0,
					unconvertedSymbols
				} as const;
			}

			// Chart points for the selected range, relative to the first point within it.
			const startIdx = full.findIndex((p) => p.date >= toLocalIsoDate(fromDate));
			const chartSlice = startIdx >= 0 ? full.slice(startIdx) : [];
			const baseTwr = chartSlice[0]?.twrIndex ?? 100;
			const baseMwr = chartSlice[0]?.mwrIndex ?? 100;
			const points = chartSlice.map((p) => ({
				date: p.date,
				netAssets: p.nav,
				yieldMwr: (p.mwrIndex / baseMwr - 1) * 100,
				yieldTwr: (p.twrIndex / baseTwr - 1) * 100
			}));

			// Inception-to-date totals
			const lastFull = full[full.length - 1]!;
			const prevFull = full.length > 1 ? full[full.length - 2]! : undefined;
			const totalReturnTwr = lastFull.twrIndex - 100;
			const totalReturnMwr = lastFull.mwrIndex - 100;
			const prevDayReturnTwr = prevFull ? (lastFull.twrIndex / prevFull.twrIndex - 1) * 100 : 0;
			const prevDayReturnMwr = prevFull ? (lastFull.mwrIndex / prevFull.mwrIndex - 1) * 100 : 0;

			return {
				points,
				prevDayReturnMwr,
				prevDayReturnTwr,
				totalReturnMwr,
				totalReturnTwr,
				unconvertedSymbols
			} as const;
		}),
	/**
	 * Retrieves the current portfolio structure with holdings breakdown.
	 * Cost basis converts at each transaction's date; current value at the latest FX.
	 *
	 * @input currency - Target currency for valuations (default: USD)
	 */
	structure: protectedProcedure
		.input(
			z.object({
				currency: currencySchema.default('USD')
			})
		)
		.query(async ({ ctx, input }) => {
			const target: Currency = input.currency as Currency;
			const userId = ctx.session.user.id;
			return getCachedStructure(userId, target, toLocalIsoDate(new Date()));
		})
});
