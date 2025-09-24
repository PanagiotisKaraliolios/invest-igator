import type { Currency } from '@prisma/client';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { createTRPCRouter, protectedProcedure } from '@/server/api/trpc';

const supportedCurrencies: Currency[] = ['EUR', 'USD', 'GBP', 'HKD', 'CHF', 'RUB'];

export const goalsRouter = createTRPCRouter({
	create: protectedProcedure
		.input(
			z.object({
				note: z.string().optional(),
				targetAmount: z.number().positive('Target amount must be greater than 0'),
				targetCurrency: z.enum(['EUR', 'USD', 'GBP', 'HKD', 'CHF', 'RUB']).default('USD'),
				targetDate: z.string().optional(), // YYYY-MM-DD (client uses <input type="date">)
				title: z.string().min(1, 'Title is required')
			})
		)
		.mutation(async ({ ctx, input }) => {
			const userId = ctx.session.user.id;
			const goal = await ctx.db.goal.create({
				data: {
					note: input.note?.trim() ?? null,
					targetAmount: input.targetAmount,
					targetCurrency: input.targetCurrency as Currency,
					targetDate: input.targetDate ? new Date(input.targetDate) : null,
					title: input.title.trim(),
					userId
				}
			});
			return { id: goal.id } as const;
		}),
	list: protectedProcedure.query(async ({ ctx }) => {
		const userId = ctx.session.user.id;
		return ctx.db.goal.findMany({
			orderBy: [
				// upcoming target dates first, then most recent created
				{ targetDate: 'asc' },
				{ createdAt: 'desc' }
			],
			where: { userId }
		});
	}),

	remove: protectedProcedure.input(z.object({ id: z.string().min(1) })).mutation(async ({ ctx, input }) => {
		const userId = ctx.session.user.id;
		const current = await ctx.db.goal.findUnique({ where: { id: input.id } });
		if (!current || current.userId !== userId) {
			throw new TRPCError({ code: 'NOT_FOUND', message: 'Goal not found' });
		}
		await ctx.db.goal.delete({ where: { id: input.id } });
		return { deleted: true } as const;
	}),

	update: protectedProcedure
		.input(
			z.object({
				id: z.string().min(1),
				note: z.string().nullable().optional(),
				targetAmount: z.number().positive().optional(),
				targetCurrency: z.enum(['EUR', 'USD', 'GBP', 'HKD', 'CHF', 'RUB']).optional(),
				targetDate: z.string().nullable().optional(),
				title: z.string().min(1).optional()
			})
		)
		.mutation(async ({ ctx, input }) => {
			const userId = ctx.session.user.id;
			const current = await ctx.db.goal.findUnique({ where: { id: input.id } });
			if (!current || current.userId !== userId) {
				throw new TRPCError({ code: 'NOT_FOUND', message: 'Goal not found' });
			}
			await ctx.db.goal.update({
				data: {
					note: input.note === undefined ? undefined : (input.note?.trim() ?? null),
					targetAmount: input.targetAmount,
					targetCurrency: (input.targetCurrency as Currency | undefined) ?? undefined,
					targetDate:
						input.targetDate === undefined
							? undefined
							: input.targetDate === null
								? null
								: new Date(input.targetDate),
					title: input.title?.trim()
				},
				where: { id: input.id }
			});
			return { updated: true } as const;
		})
});
