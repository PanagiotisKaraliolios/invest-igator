import { cookies } from 'next/headers';
import { z } from 'zod';
import { protectedProcedure } from '@/server/api/trpc';

/**
 * Theme procedures - manages user theme preferences (light/dark mode).
 * All procedures require authentication (protectedProcedure).
 *
 * @example
 * // Get user's theme preference
 * const result = await api.theme.getTheme.query();
 *
 * @example
 * // Set user's theme preference
 * await api.theme.setTheme.mutate('dark');
 */
export const themeProcedures = {
	/**
	 * Retrieves the user's theme preference.
	 *
	 * @returns {theme: 'light' | 'dark' | null} The user's theme preference or null if not set
	 *
	 * @example
	 * const result = await api.theme.getTheme.query();
	 * console.log(result.theme); // 'dark', 'light', or null
	 */
	getTheme: protectedProcedure.query(async ({ ctx }) => {
		const user = await ctx.db.user.findUnique({
			select: { theme: true },
			where: { id: ctx.session.user.id }
		});
		const t = user?.theme;
		if (!t) return { theme: null } as const;
		return { theme: t === 'DARK' ? 'dark' : 'light' } as const;
	}),

	/**
	 * Sets the user's theme preference.
	 * Updates both database and cookie for SSR rendering.
	 *
	 * @input Theme value ('light' or 'dark')
	 *
	 * @returns {ok: true} Success indicator
	 *
	 * @example
	 * await api.theme.setTheme.mutate('dark');
	 */
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
