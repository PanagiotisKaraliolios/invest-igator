import { beforeEach, describe, expect, test } from 'bun:test';
import { resetAiTables, seedUser } from '../src/server/ai/evals/db-support';
import { buildToolset } from '../src/server/ai/tools/registry';
import type { Scope, ToolCtx } from '../src/server/ai/tools/types';
import { db } from '../src/server/db';

/**
 * `tools/registry.test.ts` (in `src/`, hermetic) already proves cross-tenant isolation —
 * but ONLY against `mock.module`-replaced services. That proves the TOOL forwards ctx.userId
 * to whatever service function is loaded; it does NOT prove the REAL service's Prisma query
 * actually filters by userId in Postgres. A service that dropped its `where: { userId }` clause
 * (e.g. `db.transaction.findMany()` with no filter) would sail straight through the mocked
 * suite, because the mock never touches a WHERE clause at all.
 *
 * This file is the genuine gap the mocked suite cannot close: real `buildToolset`, real
 * services, real Prisma, real Postgres. It lives outside `src/` (alongside `ai-quota.test.ts`)
 * so `bun test --isolate src` stays hermetic — no DB — and is gated instead by the `db_tests`
 * CI job (already Postgres-provisioned) via `bun run test:db`.
 */

const ALL_SCOPES: Scope[] = ['fx:read', 'goals:read', 'portfolio:read', 'transactions:read', 'watchlist:read'];

const ctxFor = (userId: string, scopes: Scope[] = ALL_SCOPES): ToolCtx => ({
	currency: 'EUR',
	scopes: new Set(scopes),
	surface: 'eval',
	userId
});

describe('Tier 0 (DB) — tool authorization: user B cannot read user A (§5.4)', () => {
	let userA = '';
	let userB = '';

	beforeEach(async () => {
		await resetAiTables();
		userA = await seedUser('a');
		userB = await seedUser('b');
		await db.transaction.createMany({
			data: [
				{ date: new Date('2026-01-05'), price: 100, quantity: 10, side: 'BUY', symbol: 'AAAA', userId: userA },
				{ date: new Date('2026-01-06'), price: 200, quantity: 20, side: 'BUY', symbol: 'BBBB', userId: userB }
			]
		});
		await db.watchlistItem.createMany({
			data: [
				{ symbol: 'AAAA', userId: userA },
				{ symbol: 'BBBB', userId: userB }
			]
		});
	});

	test("transactions.search under B's ctx returns only B's rows, from a REAL Prisma query", async () => {
		const tool = buildToolset(ctxFor(userB)).find((t) => t.name === 'transactions.search');
		if (!tool) throw new Error('transactions.search missing from the toolset');
		const out = (await tool.execute({}, ctxFor(userB))) as { transactions: Array<{ symbol: string }> };
		const symbols = out.transactions.map((t) => t.symbol);
		expect(symbols).toContain('BBBB');
		expect(symbols).not.toContain('AAAA');
	});

	test("watchlist.list under B's ctx returns only B's rows, from a REAL Prisma query", async () => {
		const tool = buildToolset(ctxFor(userB)).find((t) => t.name === 'watchlist.list');
		if (!tool) throw new Error('watchlist.list missing from the toolset');
		const out = (await tool.execute({}, ctxFor(userB))) as { items: Array<{ symbol: string }> };
		expect(out.items.map((i) => i.symbol)).toEqual(['BBBB']);
	});

	test('buildToolset filters on requiredScope — a caller without transactions:read never sees the tool', () => {
		const names = buildToolset(ctxFor(userB, ['portfolio:read'])).map((t) => t.name);
		expect(names).not.toContain('transactions.search');
		expect(names).toContain('portfolio.structure');
	});

	test('a caller with no scopes gets an empty toolset', () => {
		expect(buildToolset(ctxFor(userB, []))).toEqual([]);
	});
});
