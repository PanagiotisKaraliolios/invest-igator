import { z } from 'zod';
import { listTransactions, MAX_TRANSACTION_LIMIT } from '@/server/services/transactions';
import { boundArrayElements } from './result-bounds';
import type { AppTool } from './types';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected yyyy-mm-dd');

/**
 * Upper bound on `limit`. Well below MAX_TRANSACTION_LIMIT (the service's own 200-row hard
 * cap): a Transaction row's `note` has no DB-level length cap, so even 100 "normal" rows can
 * approach MAX_TOOL_RESULT_TOKENS — the runtime boundArrayElements() call below is what makes
 * the bound provable regardless of note length, but this keeps the common case sane and keeps
 * the `+1` hasMore probe (below) safely under the service's hard cap.
 */
const MAX_LIMIT = 100;

const inputSchema = z.strictObject({
	dateFrom: isoDate.optional().describe('Inclusive lower bound, yyyy-mm-dd.'),
	dateTo: isoDate.optional().describe('Inclusive upper bound, yyyy-mm-dd.'),
	limit: z.number().int().min(1).max(MAX_LIMIT).default(50),
	side: z.enum(['BUY', 'SELL']).optional(),
	symbol: z.string().min(1).max(32).optional().describe('Case-insensitive substring match on the symbol.')
});

const transactionRowSchema = z.strictObject({
	date: z.string(),
	fee: z.number().nullable(),
	feeCurrency: z.string().nullable(),
	id: z.string(),
	note: z.string().nullable(),
	price: z.number(),
	priceCurrency: z.string(),
	quantity: z.number(),
	side: z.enum(['BUY', 'SELL']),
	symbol: z.string()
});

const outputSchema = z.strictObject({
	/** Rows RETURNED (never more than `limit`) — not the total number of matches. */
	count: z.number().int(),
	/** true when more matching rows exist than were returned — from the query, or from the
	 *  result-size bound. Either way, the model must say "showing the first N", never "here
	 *  are all your transactions". */
	hasMore: z.boolean(),
	transactions: z.array(transactionRowSchema)
});

export const transactionsSearchTool: AppTool<typeof inputSchema, typeof outputSchema> = {
	annotations: { openWorldHint: false, readOnlyHint: true, title: 'Search transactions' },
	description:
		"Search the user's own buy/sell transactions, newest first, optionally filtered by symbol, side and date range. Returns at most `limit` rows; `count` is how many were returned, not how many exist — check `hasMore`. Use this for questions about what the user bought or sold and when.",
	execute: async (input, ctx) => {
		// Ask for one extra row so we can tell "exactly `limit` matched" from "more exist"
		// without a separate count query. Capped at MAX_TRANSACTION_LIMIT so the probe itself
		// is never silently clamped by the service in a way that would hide the signal.
		const probeLimit = Math.min(input.limit + 1, MAX_TRANSACTION_LIMIT);
		const raw = await listTransactions(ctx.userId, {
			dateFrom: input.dateFrom,
			dateTo: input.dateTo,
			limit: probeLimit,
			side: input.side,
			symbol: input.symbol
		});
		const queryHasMore = raw.length > input.limit;
		const capped = raw.slice(0, input.limit);

		// Even within `limit` rows, a handful of long `note` values (unbounded in the DB) can
		// still blow the token budget — this measures the ACTUAL envelope, not an estimate.
		const bounded = boundArrayElements(capped, (slice) => ({
			count: slice.length,
			hasMore: false,
			transactions: slice
		}));

		return { count: bounded.items.length, hasMore: queryHasMore || bounded.truncated, transactions: bounded.items };
	},
	inputSchema,
	mutates: false,
	name: 'transactions.search',
	outputSchema,
	requiredScope: 'transactions:read'
};
