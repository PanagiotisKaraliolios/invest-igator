import { cookies } from 'next/headers';
import { z } from 'zod';
import { protectedProcedure } from '@/server/api/trpc';

/**
 * Currency procedures - manages user currency preferences.
 * All procedures require authentication (protectedProcedure).
 *
 * @example
 * // Get user's currency preference
 * const result = await api.currency.getCurrency.query();
 *
 * @example
 * // Set user's currency preference
 * await api.currency.setCurrency.mutate('EUR');
 */
export const currencyProcedures = {
	/**
	 * Retrieves the user's preferred currency setting.
	 *
	 * @returns {currency: Currency | null} The user's currency preference or null if not set
	 *
	 * @example
	 * const result = await api.currency.getCurrency.query();
	 * console.log(result.currency); // 'USD', 'EUR', etc.
	 */
	getCurrency: protectedProcedure.query(async ({ ctx }) => {
		const user = await ctx.db.user.findUnique({
			select: { currency: true },
			where: { id: ctx.session.user.id }
		});
		const c = user?.currency;
		if (!c) return { currency: null } as const;
		return { currency: c } as const;
	}),

	/**
	 * Sets the user's preferred currency.
	 * Updates both database and cookie for SSR rendering.
	 *
	 * @input Currency enum value (EUR, USD, GBP, HKD, CHF, RUB)
	 *
	 * @returns {ok: true} Success indicator
	 *
	 * @example
	 * await api.currency.setCurrency.mutate('EUR');
	 */
	setCurrency: protectedProcedure
		.input(z.enum(['EUR', 'USD', 'GBP', 'HKD', 'CHF', 'RUB']))
		.mutation(async ({ ctx, input }) => {
			await ctx.db.user.update({
				data: { currency: input },
				select: { id: true },
				where: { id: ctx.session.user.id }
			});
			// Mirror to cookie for SSR picks
			const jar = await cookies();
			jar.set('ui-currency', input, { maxAge: 60 * 60 * 24 * 365, path: '/', sameSite: 'lax' });
			return { ok: true } as const;
		})
};
