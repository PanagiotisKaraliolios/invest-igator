import { z } from 'zod';
import { getPriceHistory } from '@/server/services/market';
import { boundArrayElements } from './result-bounds';
import type { AppTool } from './types';

const fieldSchema = z.enum(['open', 'high', 'low', 'close']);

/**
 * Upper bound on `days`. `getPriceHistory` (the service) allows up to 3650 days — correct for
 * the service, which also backs a UI chart that must not be hobbled by an AI token budget.
 * But 3650 daily points is ~132KB (~33.7K tokens, ~4.1x MAX_TOOL_RESULT_TOKENS) — far too big
 * for a tool result. 400 days is ~4.4K tokens even in the worst realistic case (see the
 * "provably bounded" tests in registry.test.ts) — comfortable margin under the 8192 ceiling.
 */
const MAX_DAYS = 400;

const inputSchema = z.strictObject({
	days: z.number().int().min(1).max(MAX_DAYS).default(90),
	field: fieldSchema.default('close'),
	symbol: z.string().min(1).max(32)
});

const outputSchema = z.strictObject({
	field: fieldSchema,
	points: z.array(z.strictObject({ date: z.string(), value: z.number() })),
	symbol: z.string(),
	/** true when `points` is a prefix rather than the whole requested window. */
	truncated: z.boolean()
});

/**
 * Scoped watchlist:read rather than a scope of its own: this serves market data the user can
 * already reach through the watchlist, and a `market` scope would fork PERMISSION_SCOPES for
 * no authorization benefit. It is the one tool with no tenant dimension — the data is public —
 * so it takes no userId, and the symbol is normalised + validated inside the service before any
 * Flux is authored.
 */
export const marketPriceHistoryTool: AppTool<typeof inputSchema, typeof outputSchema> = {
	annotations: { openWorldHint: false, readOnlyHint: true, title: 'Price history' },
	description:
		'Daily price history for one symbol over a trailing window (at most 400 days). Returns an empty series for an unknown or malformed symbol.',
	execute: async (input) => {
		const points = await getPriceHistory(input.symbol, input.days, input.field);
		// Numeric-only points, but the same measured guarantee every array-returning tool
		// uses — this is the bound a reverted/removed clamp would blow through.
		const bounded = boundArrayElements(points, (slice) => ({
			field: input.field,
			points: slice,
			symbol: input.symbol,
			truncated: false
		}));
		return { field: input.field, points: bounded.items, symbol: input.symbol, truncated: bounded.truncated };
	},
	inputSchema,
	mutates: false,
	name: 'market.priceHistory',
	outputSchema,
	requiredScope: 'watchlist:read'
};
