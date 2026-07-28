import { describe, expect, test } from 'bun:test';
import { seedUser } from '../src/server/ai/evals/db-support';
import { db } from '../src/server/db';

const BYTES = new Uint8Array([1, 2, 3, 4]);

async function makeCredential(userId: string, defaultModelId: string, enabledModelIds: string[]) {
	return db.aiProviderCredential.create({
		data: {
			authTag: BYTES,
			ciphertext: BYTES,
			defaultModelId,
			enabledModelIds,
			iv: BYTES,
			kid: 'k1',
			provider: 'ANTHROPIC',
			userId
		}
	});
}

describe('AiProviderCredential.enabledModelIds', () => {
	test('round-trips a multi-model set', async () => {
		const userId = await seedUser('byok-enabled-multi');
		const row = await makeCredential(userId, 'claude-opus-5', ['claude-opus-5', 'claude-sonnet-5']);

		const read = await db.aiProviderCredential.findUniqueOrThrow({ where: { id: row.id } });
		expect(read.enabledModelIds).toEqual(['claude-opus-5', 'claude-sonnet-5']);
		expect(read.enabledModelIds).toContain(read.defaultModelId);
	});

	test('the migration backfills a legacy row to exactly its defaultModelId', async () => {
		// Simulate a pre-migration row: the column exists now, so emulate the legacy state by
		// clearing it, then run the migration's backfill statement verbatim and assert the result.
		const userId = await seedUser('byok-enabled-backfill');
		const row = await makeCredential(userId, 'claude-opus-5', []);

		await db.$executeRawUnsafe(
			`
			UPDATE "AiProviderCredential"
			SET "enabledModelIds" = ARRAY["defaultModelId"]
			WHERE cardinality("enabledModelIds") = 0 AND "id" = $1
		`,
			row.id
		);

		const read = await db.aiProviderCredential.findUniqueOrThrow({ where: { id: row.id } });
		expect(read.enabledModelIds).toEqual(['claude-opus-5']);
	});
});
