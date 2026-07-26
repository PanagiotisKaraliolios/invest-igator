import { beforeEach, describe, expect, test } from 'bun:test';
import { createCaller } from '../src/server/api/root';
import type { createTRPCContext } from '../src/server/api/trpc';
import { resetAiTables, seedUser } from '../src/server/ai/evals/db-support';
import { db } from '../src/server/db';

/**
 * `transactions.bulkImport` re-validates every submitted row server-side (never trusts the
 * client) and writes via the same `detectDuplicates` / `bulkCreateTransactions` machinery as
 * `importCsv`. Duplicate detection and the watchlist upsert are relational, so — like
 * `ai-chat-router.test.ts` — this exercises a `protectedProcedure` end-to-end against a REAL
 * Postgres rather than the mocked-`@/server/db` `src/**` pattern.
 */

type Ctx = Awaited<ReturnType<typeof createTRPCContext>>;

function caller(userId: string) {
	const ctx = {
		apiKeyPermissions: null,
		db,
		headers: new Headers(),
		session: {
			session: { id: 'test-session', token: 'test', userId },
			user: { email: `${userId}@invest-igator.test`, id: userId, name: 'test', role: 'user' }
		}
	} as unknown as Ctx;
	return createCaller(ctx);
}

const row = (over: Record<string, unknown> = {}) => ({
	date: '2026-01-15',
	symbol: 'AAPL',
	side: 'BUY',
	quantity: 10,
	price: 150.5,
	priceCurrency: 'USD',
	...over
});

describe('transactions.bulkImport', () => {
	let userId: string;
	beforeEach(async () => {
		await resetAiTables();
		userId = await seedUser('bulk');
	});

	test('writes valid rows and adds them to the watchlist', async () => {
		const res = await caller(userId).transactions.bulkImport({ rows: [row(), row({ symbol: 'MSFT' })] });
		expect(res.imported).toBe(2);
		const count = await db.transaction.count({ where: { userId } });
		expect(count).toBe(2);
		const wl = await db.watchlistItem.count({ where: { userId } });
		expect(wl).toBe(2);
	});

	test('skips a row that duplicates an existing transaction', async () => {
		await caller(userId).transactions.bulkImport({ rows: [row()] });
		const res = await caller(userId).transactions.bulkImport({ rows: [row()] });
		expect(res.imported).toBe(0);
		expect(res.skipped).toBe(1);
		expect(await db.transaction.count({ where: { userId } })).toBe(1);
	});

	test('rejects a row with a bad symbol format without writing anything', async () => {
		// `symbolSchema` (SYMBOL_REGEX) rejects internal whitespace, and the mutation's input is
		// `z.array(createTransactionInput)` — a single invalid symbol fails zod's input parsing
		// before the procedure body ever runs, so the ENTIRE call rejects and nothing is written.
		await expect(
			caller(userId).transactions.bulkImport({ rows: [row({ symbol: 'a b c' }), row()] })
		).rejects.toThrow();
		expect(await db.transaction.count({ where: { userId } })).toBe(0);
	});
});
