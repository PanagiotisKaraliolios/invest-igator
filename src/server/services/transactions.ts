import type { Prisma, Transaction } from '@prisma/generated';
import type { Currency } from '@/lib/currency';
import { normalizeSymbol } from '@/lib/validation';
import type { CreateTransactionInput } from '@/server/api/routers/transactions.schemas';
import { db } from '@/server/db';

/**
 * Transaction reads, shared by the tRPC router and the AI tool layer.
 * userId is ALWAYS the first argument and is ALWAYS the only tenant key — it is written
 * into the where-clause FIRST and no filter key can reach it, because buildTransactionWhere
 * reads only the four filter fields it knows about.
 */

export type TransactionFilters = {
	symbol?: string;
	side?: 'BUY' | 'SELL';
	dateFrom?: string; // yyyy-mm-dd
	dateTo?: string; // yyyy-mm-dd, inclusive
	limit?: number; // default 50, max 200
};

export type TransactionRow = {
	id: string;
	date: string; // ISO-8601 instant, as the router has always returned it
	symbol: string;
	side: 'BUY' | 'SELL';
	quantity: number;
	price: number;
	priceCurrency: string;
	fee: number | null;
	feeCurrency: string | null;
	note: string | null;
};

/** The subset of the Prisma record a row is built from. */
export type TransactionRecord = Pick<
	Transaction,
	'date' | 'fee' | 'feeCurrency' | 'id' | 'note' | 'price' | 'priceCurrency' | 'quantity' | 'side' | 'symbol'
>;

export const DEFAULT_TRANSACTION_LIMIT = 50;
export const MAX_TRANSACTION_LIMIT = 200;

/** The single place a Transaction `where` clause is authored. The model never authors one. */
export function buildTransactionWhere(
	userId: string,
	filters: Pick<TransactionFilters, 'dateFrom' | 'dateTo' | 'side' | 'symbol'>
): Prisma.TransactionWhereInput {
	const where: Prisma.TransactionWhereInput = { userId };

	const symbol = filters.symbol?.trim();
	if (symbol) {
		where.symbol = { contains: symbol, mode: 'insensitive' };
	}
	if (filters.side) {
		where.side = filters.side;
	}
	if (filters.dateFrom || filters.dateTo) {
		const date: Prisma.DateTimeFilter = {};
		if (filters.dateFrom) {
			date.gte = new Date(filters.dateFrom);
		}
		if (filters.dateTo) {
			const dt = new Date(filters.dateTo);
			dt.setHours(23, 59, 59, 999);
			date.lte = dt;
		}
		where.date = date;
	}
	return where;
}

export function clampTransactionLimit(limit: number | undefined): number {
	if (limit === undefined || !Number.isFinite(limit)) return DEFAULT_TRANSACTION_LIMIT;
	return Math.min(Math.max(Math.trunc(limit), 1), MAX_TRANSACTION_LIMIT);
}

export function toTransactionRow(t: TransactionRecord): TransactionRow {
	return {
		date: t.date.toISOString(),
		fee: t.fee ?? null,
		feeCurrency: t.feeCurrency ?? null,
		id: t.id,
		note: t.note ?? null,
		price: t.price,
		priceCurrency: t.priceCurrency,
		quantity: t.quantity,
		side: t.side,
		symbol: t.symbol
	};
}

export async function listTransactions(userId: string, filters: TransactionFilters): Promise<TransactionRow[]> {
	const rows = await db.transaction.findMany({
		// `id` breaks same-day ties, so a truncated list is stable across calls.
		orderBy: [{ date: 'desc' }, { id: 'desc' }],
		take: clampTransactionLimit(filters.limit),
		where: buildTransactionWhere(userId, filters)
	});
	return rows.map(toTransactionRow);
}

/**
 * The single transaction WRITE path, shared by the tRPC `create` mutation and the AI write-commit.
 * PURE: no Yahoo validation (callers do it — the tRPC path validates the symbol; the commit trusts
 * the signed token) and NO cache invalidation (callers invalidate after). Accepts a Prisma client
 * so the commit can run it inside a `$transaction` alongside the single-use `jti` insert.
 */
export async function createTransaction(
	userId: string,
	input: CreateTransactionInput,
	client: Pick<typeof db, 'transaction' | 'watchlistItem'> = db
): Promise<{ id: string }> {
	const symbol = normalizeSymbol(input.symbol);
	const created = await client.transaction.create({
		data: {
			date: input.date,
			fee: input.fee,
			feeCurrency: (input.feeCurrency as Currency | undefined) ?? null,
			note: input.note,
			price: input.price,
			priceCurrency: input.priceCurrency as Currency,
			quantity: input.quantity,
			side: input.side,
			symbol,
			userId
		}
	});
	try {
		await client.watchlistItem.upsert({
			create: { symbol: created.symbol, userId },
			update: {},
			where: { userId_symbol: { symbol: created.symbol, userId } }
		});
	} catch {}
	return { id: created.id };
}
