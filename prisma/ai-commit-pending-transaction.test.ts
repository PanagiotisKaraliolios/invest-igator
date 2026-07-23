import { beforeEach, describe, expect, test } from 'bun:test';
import { resetAiTables, seedUser } from '../src/server/ai/evals/db-support';
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
			Promise.resolve(
				db.aiMutationCommit.create({ data: { jti: 'jti-1', tool: 'transactions.create', userId } })
			)
		).rejects.toThrow();
	});
});
