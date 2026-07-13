import { z } from 'zod';
import { listGoals } from '@/server/services/goals';
import { boundArrayElements } from './result-bounds';
import type { AppTool } from './types';

const inputSchema = z.strictObject({});

const outputSchema = z.strictObject({
	count: z.number().int(),
	goals: z.array(
		z.strictObject({
			id: z.string(),
			note: z.string().nullable(),
			targetAmount: z.number(),
			targetCurrency: z.string(),
			targetDate: z.string().nullable(),
			title: z.string()
		})
	),
	/** true when the user has more goals than were returned — see result-bounds.ts. */
	hasMore: z.boolean()
});

export const goalsListTool: AppTool<typeof inputSchema, typeof outputSchema> = {
	annotations: { openWorldHint: false, readOnlyHint: true, title: 'List goals' },
	description: "The user's financial goals: title, target amount, target currency and target date.",
	execute: async (_input, ctx) => {
		const goals = await listGoals(ctx.userId);
		// `note` (and `title`) have no DB-level length cap, so this is a real guarantee.
		const bounded = boundArrayElements(goals, (slice) => ({ count: slice.length, goals: slice, hasMore: false }));
		return { count: bounded.items.length, goals: bounded.items, hasMore: bounded.truncated };
	},
	inputSchema,
	mutates: false,
	name: 'goals.list',
	outputSchema,
	requiredScope: 'goals:read'
};
