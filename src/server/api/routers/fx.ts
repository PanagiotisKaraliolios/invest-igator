import { z } from 'zod';
import { createTRPCRouter, publicProcedure } from '@/server/api/trpc';
import { getFxMatrix } from '@/server/fx';

/**
 * FX router - provides foreign exchange rate information.
 * All procedures are public (no authentication required).
 *
 * @example
 * // Get current FX matrix
 * const rates = await api.fx.matrix.query();
 * console.log(rates['USD']['EUR']); // USD to EUR rate
 */
export const fxRouter = createTRPCRouter({
	/**
	 * Retrieves the current foreign exchange rate matrix.
	 * Returns conversion rates between all supported currency pairs.
	 *
	 * @returns FX matrix object with currency pair rates
	 *
	 * @example
	 * const rates = await api.fx.matrix.query();
	 * const usdToEur = rates['USD']['EUR'];
	 */
	matrix: publicProcedure.input(z.void()).query(async () => {
		const m = await getFxMatrix();
		return m;
	})
});
