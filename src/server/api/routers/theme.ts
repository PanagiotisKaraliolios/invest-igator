import { cookies } from 'next/headers';
import { z } from 'zod';
import { protectedProcedure } from '@/server/api/trpc';

export const themeProcedures = {
	getTheme: protectedProcedure.query(async ({ ctx }) => {
		const user = await ctx.db.user.findUnique({
			select: { theme: true },
			where: { id: ctx.session.user.id }
		});
		const t = user?.theme;
		if (!t) return { theme: null } as const;
		return { theme: t === 'DARK' ? 'dark' : 'light' } as const;
	}),

	setTheme: protectedProcedure.input(z.enum(['light', 'dark'])).mutation(async ({ ctx, input }) => {
		const dbVal: 'LIGHT' | 'DARK' = input === 'dark' ? 'DARK' : 'LIGHT';
		await ctx.db.user.update({
			data: { theme: dbVal },
			select: { id: true },
			where: { id: ctx.session.user.id }
		});
		// Also set a cookie so SSR layout can pick it up on next request
		const jar = await cookies();
		jar.set('ui-theme', input, { maxAge: 60 * 60 * 24 * 365, path: '/', sameSite: 'lax' });
		return { ok: true } as const;
	})
};
