import { cookies } from 'next/headers';
import { z } from 'zod';
import { protectedProcedure } from '@/server/api/trpc';

export const currencyProcedures = {
	getCurrency: protectedProcedure.query(async ({ ctx }) => {
		const user = await ctx.db.user.findUnique({
			select: { currency: true },
			where: { id: ctx.session.user.id }
		});
		const c = user?.currency;
		if (!c) return { currency: null } as const;
		return { currency: c } as const;
	}),

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
