import { z } from 'zod';
import { currencySchema } from '@/lib/currency';
import { toLocalIsoDate } from '@/lib/date';
import { getCachedStructure } from '@/server/portfolio-compute';
import { boundArrayElements } from './result-bounds';
import type { AppTool } from './types';

const inputSchema = z.strictObject({});

const positionSchema = z.strictObject({
	avgCost: z.number(),
	price: z.number(),
	quantity: z.number(),
	symbol: z.string(),
	totalCost: z.number(),
	/** true when no FX rate was available, so the position is excluded from totals */
	unconverted: z.boolean(),
	value: z.number(),
	/** 0..100. StructureItem.weight is a fraction; it is converted here, once. */
	weightPct: z.number()
});

const outputSchema = z.strictObject({
	currency: currencySchema,
	positions: z.array(positionSchema),
	totalValue: z.number(),
	/** true when `positions` is a prefix rather than every holding — see boundArrayElements. */
	truncated: z.boolean()
});

export const portfolioStructureTool: AppTool<typeof inputSchema, typeof outputSchema> = {
	annotations: { openWorldHint: false, readOnlyHint: true, title: 'Portfolio structure' },
	description:
		"The user's current holdings, valued in their display currency: symbol, quantity, average cost, latest price, market value and portfolio weight as a percentage. `positions` may be a prefix of all holdings — check `truncated` before telling the user this is everything they own. Use this for any question about what the user owns or how concentrated they are.",
	execute: async (_input, ctx) => {
		const { items, totalValue } = await getCachedStructure(ctx.userId, ctx.currency, toLocalIsoDate(new Date()));
		const positions = items.map((i) => ({
			avgCost: i.avgCost,
			price: i.price,
			quantity: i.quantity,
			symbol: i.symbol,
			totalCost: i.totalCost,
			unconverted: i.unconverted,
			value: i.value,
			weightPct: i.weight * 100
		}));
		// Defense in depth: a user's holding count is normally small, but this keeps the
		// guarantee real (measured on the actual envelope) rather than assumed.
		const bounded = boundArrayElements(positions, (slice) => ({
			currency: ctx.currency,
			positions: slice,
			totalValue,
			truncated: false
		}));
		return {
			currency: ctx.currency,
			positions: bounded.items,
			totalValue,
			truncated: bounded.truncated
		};
	},
	inputSchema,
	mutates: false,
	name: 'portfolio.structure',
	outputSchema,
	requiredScope: 'portfolio:read'
};
