import { z } from 'zod';
import { createTRPCRouter, withPermissions } from '@/server/api/trpc';
import { getFxMatrix } from '@/server/fx';

/**
 * FX router - provides foreign exchange rate information.
 * Requires authentication and fx:read permission.
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
	 * Requires: fx:read permission
	 *
	 * @returns FX matrix object with currency pair rates
	 *
	 * @example
	 * const rates = await api.fx.matrix.query();
	 * const usdToEur = rates['USD']['EUR'];
	 */
	matrix: withPermissions('fx', 'read')
		.input(z.void())
		.query(async () => {
			const m = await getFxMatrix();
			return m;
		})
});
