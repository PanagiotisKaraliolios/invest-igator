import type { Currency } from '@prisma/client';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { createTRPCRouter, protectedProcedure } from '@/server/api/trpc';

const supportedCurrencies: Currency[] = ['EUR', 'USD', 'GBP', 'HKD', 'CHF', 'RUB'];

/**
 * Goals router - manages user financial goals.
 * All procedures require authentication (protectedProcedure).
 *
 * @example
 * // Create a new goal
 * await api.goals.create.mutate({
 *   title: 'Buy a house',
 *   targetAmount: 50000,
 *   targetCurrency: 'USD',
 *   targetDate: '2025-12-31'
 * });
 *
 * @example
 * // List all goals
 * const goals = await api.goals.list.query();
 */
export const goalsRouter = createTRPCRouter({
	/**
	 * Creates a new financial goal for the user.
	 *
	 * @input title - Goal title (required)
	 * @input targetAmount - Target amount (positive number, required)
	 * @input targetCurrency - Currency for the target amount (default: USD)
	 * @input targetDate - Optional target date (YYYY-MM-DD format)
	 * @input note - Optional notes about the goal
	 *
	 * @returns {id: string} The ID of the created goal
	 *
	 * @example
	 * const result = await api.goals.create.mutate({
	 *   title: 'Emergency Fund',
	 *   targetAmount: 10000,
	 *   targetCurrency: 'USD',
	 *   note: 'Six months expenses'
	 * });
	 */
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
	/**
	 * Retrieves all goals for the current user.
	 * Results are ordered by target date (ascending) then creation date (descending).
	 *
	 * @returns Array of goal objects with all fields
	 *
	 * @example
	 * const goals = await api.goals.list.query();
	 * goals.forEach(goal => console.log(goal.title, goal.targetAmount));
	 */
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

	/**
	 * Removes a goal by ID.
	 * Only the goal owner can remove it.
	 *
	 * @input id - The ID of the goal to remove
	 *
	 * @throws {TRPCError} NOT_FOUND - If goal not found or not owned by user
	 * @returns {deleted: true} Success indicator
	 *
	 * @example
	 * await api.goals.remove.mutate({ id: 'goal_123' });
	 */
	remove: protectedProcedure.input(z.object({ id: z.string().min(1) })).mutation(async ({ ctx, input }) => {
		const userId = ctx.session.user.id;
		const current = await ctx.db.goal.findUnique({ where: { id: input.id } });
		if (!current || current.userId !== userId) {
			throw new TRPCError({ code: 'NOT_FOUND', message: 'Goal not found' });
		}
		await ctx.db.goal.delete({ where: { id: input.id } });
		return { deleted: true } as const;
	}),

	/**
	 * Updates an existing goal.
	 * Only provided fields will be updated; omitted fields remain unchanged.
	 *
	 * @input id - The ID of the goal to update (required)
	 * @input title - New title (optional)
	 * @input targetAmount - New target amount (optional)
	 * @input targetCurrency - New currency (optional)
	 * @input targetDate - New target date or null to clear (optional)
	 * @input note - New note or null to clear (optional)
	 *
	 * @throws {TRPCError} NOT_FOUND - If goal not found or not owned by user
	 * @returns {updated: true} Success indicator
	 *
	 * @example
	 * await api.goals.update.mutate({
	 *   id: 'goal_123',
	 *   targetAmount: 15000,
	 *   note: 'Increased target'
	 * });
	 */
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
