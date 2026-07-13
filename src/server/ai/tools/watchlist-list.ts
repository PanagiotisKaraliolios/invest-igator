import { z } from 'zod';
import { listWatchlist } from '@/server/services/watchlist';
import { boundArrayElements } from './result-bounds';
import type { AppTool } from './types';

const inputSchema = z.strictObject({});

const outputSchema = z.strictObject({
	count: z.number().int(),
	/** true when the watchlist is larger than what's returned — see result-bounds.ts. */
	hasMore: z.boolean(),
	items: z.array(
		z.strictObject({
			currency: z.string(),
			description: z.string().nullable(),
			displaySymbol: z.string().nullable(),
			starred: z.boolean(),
			symbol: z.string()
		})
	)
});

export const watchlistListTool: AppTool<typeof inputSchema, typeof outputSchema> = {
	annotations: { openWorldHint: false, readOnlyHint: true, title: 'List watchlist' },
	description:
		"The symbols on the user's watchlist, starred ones first. Use this to find out which instruments the user is tracking.",
	execute: async (_input, ctx) => {
		const items = await listWatchlist(ctx.userId);
		// `description` has no DB-level length cap, so this is a real (measured) guarantee,
		// not just "a watchlist is usually short".
		const bounded = boundArrayElements(items, (slice) => ({ count: slice.length, hasMore: false, items: slice }));
		return { count: bounded.items.length, hasMore: bounded.truncated, items: bounded.items };
	},
	inputSchema,
	mutates: false,
	name: 'watchlist.list',
	outputSchema,
	requiredScope: 'watchlist:read'
};
