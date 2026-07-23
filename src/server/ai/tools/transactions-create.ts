import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { env } from '@/env';
import { type Currency, SUPPORTED_CURRENCIES } from '@/lib/currency';
import { normalizeSymbol } from '@/lib/validation';
import { signMutation } from '@/server/ai/mutations/token';
import { db } from '@/server/db';
import { fetchYahooDaily } from '@/server/jobs/yahoo-lib';
import { searchYahooSymbols, symbolExistsOnYahoo } from '@/server/yahoo-search';
import type { AppTool, ToolCtx } from './types';

const CONFIRM_TTL_SECONDS = 120;
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected yyyy-mm-dd');

export type ProposedTransaction = {
	date: string;
	symbol: string;
	side: 'BUY' | 'SELL';
	quantity: number;
	price: number;
	priceCurrency: string;
	fee?: number;
	feeCurrency?: string;
	note?: string;
};

const inputSchema = z.strictObject({
	date: isoDate
		.optional()
		.describe('Trade date yyyy-mm-dd; defaults to today. Resolve relative dates before calling.'),
	fee: z.number().nonnegative().optional(),
	feeCurrency: z.enum(SUPPORTED_CURRENCIES).optional(),
	note: z.string().max(500).optional(),
	price: z.number().positive().describe('Price per share, in the security currency.'),
	priceCurrency: z.enum(SUPPORTED_CURRENCIES).optional(),
	quantity: z.number().positive(),
	side: z.enum(['BUY', 'SELL']),
	symbol: z.string().min(1).max(64).describe('Ticker or company name, e.g. "AAPL" or "Apple".')
});

const confirmBranch = z.strictObject({
	confirmationToken: z.string(),
	description: z.string().optional(),
	expiresAt: z.string(),
	preview: z.string(),
	proposed: z.strictObject({
		date: z.string(),
		fee: z.number().optional(),
		feeCurrency: z.string().optional(),
		note: z.string().optional(),
		price: z.number(),
		priceCurrency: z.string(),
		quantity: z.number(),
		side: z.enum(['BUY', 'SELL']),
		symbol: z.string()
	}),
	requiresConfirmation: z.literal(true)
});
const errorBranch = z.strictObject({ error: z.string(), requiresConfirmation: z.literal(false) });
const outputSchema = z.discriminatedUnion('requiresConfirmation', [confirmBranch, errorBranch]);

type Input = z.infer<typeof inputSchema>;

function todayIso(): string {
	return new Date().toISOString().slice(0, 10);
}
function isSupportedCurrency(c: string | undefined): c is Currency {
	return !!c && (SUPPORTED_CURRENCIES as readonly string[]).includes(c);
}

/** One human-readable line for the preview + confirm card. */
export function formatProposed(p: ProposedTransaction): string {
	const verb = p.side === 'BUY' ? 'Buy' : 'Sell';
	const fee = p.fee ? ` (fee ${p.fee} ${p.feeCurrency ?? p.priceCurrency})` : '';
	return `${verb} ${p.quantity} ${p.symbol} @ ${p.price} ${p.priceCurrency} on ${p.date}${fee}`;
}

type Resolved = { ok: true; proposed: ProposedTransaction; description?: string } | { ok: false; error: string };

/** Resolve symbol + currency + date. READ-ONLY (Yahoo + user currency). No writes. */
export async function resolveProposed(input: Input, ctx: ToolCtx): Promise<Resolved> {
	const raw = normalizeSymbol(input.symbol);
	let symbol = raw;
	let description: string | undefined;

	const existence = await symbolExistsOnYahoo(raw);
	if (existence === 'unreachable') {
		return { error: `Couldn't reach the market data service to verify ${raw}. Please try again.`, ok: false };
	}
	if (existence === 'no') {
		const matches = await searchYahooSymbols(input.symbol);
		const top = matches[0];
		if (!top) return { error: `I couldn't find a tradable security matching "${input.symbol}".`, ok: false };
		symbol = top.symbol;
		description = top.description;
	}

	// Listing currency (field access — robust to fetchYahooDaily's status), then user default.
	let listing: string | undefined;
	try {
		listing = (await fetchYahooDaily(symbol)).currency;
	} catch {
		listing = undefined;
	}
	const user = await db.user.findUnique({ select: { currency: true }, where: { id: ctx.userId } });
	const userDefault = (user?.currency ?? 'USD') as string;
	const priceCurrency = input.priceCurrency ?? (isSupportedCurrency(listing) ? listing : userDefault);

	const date = input.date ?? todayIso();
	if (date > todayIso()) return { error: `The trade date ${date} is in the future.`, ok: false };

	const proposed: ProposedTransaction = {
		date,
		price: input.price,
		priceCurrency,
		quantity: input.quantity,
		side: input.side,
		symbol,
		...(input.fee !== undefined ? { fee: input.fee } : {}),
		...(input.feeCurrency ? { feeCurrency: input.feeCurrency } : {}),
		...(input.note ? { note: input.note } : {})
	};
	return { description, ok: true, proposed };
}

export const transactionsCreateTool: AppTool<typeof inputSchema, typeof outputSchema> = {
	annotations: {
		destructiveHint: false,
		idempotentHint: false,
		openWorldHint: true,
		readOnlyHint: false,
		title: 'Record a transaction'
	},
	description:
		'Record a transaction the user says they made (buy/sell). Resolves the symbol and previews the ' +
		'trade for the user to confirm — it does NOT write until the user confirms. Ask for the price if unstated.',
	execute: async (input, ctx) => {
		const secret = env.AI_MUTATION_SECRET;
		if (!secret)
			return {
				error: 'Transaction entry is not configured on this server.',
				requiresConfirmation: false as const
			};
		const r = await resolveProposed(input, ctx);
		if (!r.ok) return { error: r.error, requiresConfirmation: false as const };

		const iat = Math.floor(Date.now() / 1000);
		const exp = iat + CONFIRM_TTL_SECONDS;
		const token = signMutation(
			{ args: r.proposed, exp, iat, jti: randomUUID(), tool: 'transactions.create', userId: ctx.userId, v: 1 },
			secret
		);
		return {
			preview: formatProposed(r.proposed),
			proposed: r.proposed,
			requiresConfirmation: true as const,
			...(r.description ? { description: r.description } : {}),
			confirmationToken: token,
			expiresAt: new Date(exp * 1000).toISOString()
		};
	},
	inputSchema,
	mutates: true,
	name: 'transactions.create',
	outputSchema,
	preview: async (input, ctx) => {
		const r = await resolveProposed(input, ctx);
		return r.ok ? formatProposed(r.proposed) : r.error;
	},
	requiredScope: 'transactions:write'
};
