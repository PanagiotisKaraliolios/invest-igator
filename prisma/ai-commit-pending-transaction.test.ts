import { beforeEach, describe, expect, test } from 'bun:test';
import { resetAiTables, seedUser } from '../src/server/ai/evals/db-support';
import { commitPendingTransaction } from '../src/server/ai/mutations/commit';
import { signMutation } from '../src/server/ai/mutations/token';
import { db } from '../src/server/db';

describe('AiMutationCommit — single-use jti', () => {
	let userId: string;
	beforeEach(async () => {
		await resetAiTables();
		userId = await seedUser('a');
	});

	test('a duplicate jti is rejected (P2002)', async () => {
		await db.aiMutationCommit.create({ data: { jti: 'jti-1', tool: 'transactions.create', userId } });
		// Prisma 7's PrismaPromise is a thenable but not `instanceof Promise`, so Bun's
		// `.rejects` matcher can't detect it directly — Promise.resolve() adapts it (same
		// workaround as prisma/ai-schema.test.ts's ApiKey.keyHmac uniqueness test).
		await expect(
			Promise.resolve(db.aiMutationCommit.create({ data: { jti: 'jti-1', tool: 'transactions.create', userId } }))
		).rejects.toThrow();
	});
});

const SECRET = 'z'.repeat(32);
function tokenFor(userId: string, over: Record<string, unknown> = {}, secret = SECRET): string {
	const iat = 1_000_000;
	return signMutation(
		{
			args: {
				date: '2026-01-02',
				price: 150,
				priceCurrency: 'USD',
				quantity: 10,
				side: 'BUY',
				symbol: 'AAPL'
			},
			exp: iat + 120,
			iat,
			jti: (over.jti as string) ?? 'commit-jti-1',
			tool: 'transactions.create',
			userId,
			v: 1,
			...over
		},
		secret
	);
}

describe('commitPendingTransaction core', () => {
	let userId: string;
	beforeEach(async () => {
		await resetAiTables();
		userId = await seedUser('a');
	});

	test('valid token writes exactly one transaction + a jti row, returns the id', async () => {
		const { id } = await commitPendingTransaction({
			now: 1_000_010,
			secret: SECRET,
			sessionUserId: userId,
			token: tokenFor(userId)
		});
		expect((await db.transaction.findUnique({ where: { id } }))?.symbol).toBe('AAPL');
		expect(await db.aiMutationCommit.findUnique({ where: { jti: 'commit-jti-1' } })).not.toBeNull();
	});

	test('a replayed token is rejected and writes no second transaction', async () => {
		const token = tokenFor(userId);
		await commitPendingTransaction({ now: 1_000_010, secret: SECRET, sessionUserId: userId, token });
		await expect(
			Promise.resolve(commitPendingTransaction({ now: 1_000_010, secret: SECRET, sessionUserId: userId, token }))
		).rejects.toThrow();
		expect(await db.transaction.count({ where: { userId } })).toBe(1);
	});

	test('an expired token is rejected, no write', async () => {
		await expect(
			Promise.resolve(
				commitPendingTransaction({
					now: 9_999_999,
					secret: SECRET,
					sessionUserId: userId,
					token: tokenFor(userId)
				})
			)
		).rejects.toThrow();
		expect(await db.transaction.count({ where: { userId } })).toBe(0);
	});

	test('a token signed with a different secret is rejected, no write', async () => {
		await expect(
			Promise.resolve(
				commitPendingTransaction({
					now: 1_000_010,
					secret: SECRET,
					sessionUserId: userId,
					token: tokenFor(userId, {}, 'w'.repeat(32))
				})
			)
		).rejects.toThrow();
		expect(await db.transaction.count({ where: { userId } })).toBe(0);
	});

	test('a token whose userId != the session user is rejected (non-transferable), no write', async () => {
		const other = await seedUser('b');
		await expect(
			Promise.resolve(
				commitPendingTransaction({
					now: 1_000_010,
					secret: SECRET,
					sessionUserId: userId,
					token: tokenFor(other)
				})
			)
		).rejects.toThrow();
		expect(await db.transaction.count({ where: { userId } })).toBe(0);
	});
});
