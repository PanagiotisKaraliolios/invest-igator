import { z } from 'zod';
import { env } from '@/env';
import { createTRPCRouter, protectedProcedure } from '@/server/api/trpc';

export const watchlistRouter = createTRPCRouter({
	add: protectedProcedure
		.input(
			z.object({
				description: z.string().optional(),
				displaySymbol: z.string().optional(),
				symbol: z.string().min(1),
				type: z.string().optional()
			})
		)
		.mutation(async ({ ctx, input }) => {
			const userId = ctx.session.user.id;
			try {
				return await ctx.db.watchlistItem.create({
					data: { userId, ...input }
				});
			} catch (e) {
				// upsert-like behavior for unique(userId,symbol)
						await ctx.db.watchlistItem.update({
							data: { ...input },
							where: { userId_symbol: { symbol: input.symbol, userId } }
						});
						return { alreadyExists: true } as const;
			}
		}),
	list: protectedProcedure.query(async ({ ctx }) => {
		const userId = ctx.session.user.id;
		return ctx.db.watchlistItem.findMany({
			orderBy: { createdAt: 'desc' },
			where: { userId }
		});
	}),

	remove: protectedProcedure.input(z.object({ symbol: z.string().min(1) })).mutation(async ({ ctx, input }) => {
		const userId = ctx.session.user.id;
		await ctx.db.watchlistItem.delete({
			where: { userId_symbol: { symbol: input.symbol, userId } }
		});
		return { success: true };
	}),

	search: protectedProcedure.input(z.object({ q: z.string().min(1) })).query(async ({ input }) => {
		const url = new URL(`${env.FINNHUB_API_URL}/search`);
		url.searchParams.set('q', input.q);
		url.searchParams.set('token', env.FINNHUB_API_KEY);

		const res = await fetch(url.toString());
		if (!res.ok) {
			throw new Error(`Finnhub search failed: ${res.status}`);
		}
		const data = (await res.json()) as {
			count: number;
			result: Array<{
				description: string;
				displaySymbol: string;
				symbol: string;
				type: string;
			}>;
		};
		return data;
	})
});

export type WatchlistRouter = typeof watchlistRouter;
