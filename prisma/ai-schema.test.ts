import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { db } from '../src/server/db';

const userId = `ai-schema-${Date.now()}`;
const requestId = `req-${userId}`;

beforeAll(async () => {
	await db.user.create({
		data: { email: `${userId}@example.test`, id: userId, name: 'AI schema round-trip' }
	});
});

afterAll(async () => {
	await db.aiToolCall.deleteMany({ where: { requestId } });
	await db.aiQuotaReservation.deleteMany({ where: { userId } });
	await db.aiCall.deleteMany({ where: { requestId } });
	await db.user.delete({ where: { id: userId } });
});

describe('AI layer schema round-trip', () => {
	test('AiProviderCredential stores the sealed blob byte-exactly', async () => {
		const iv = Buffer.alloc(12, 0x01);
		const ciphertext = Buffer.from('not-really-ciphertext', 'utf8');
		const authTag = Buffer.alloc(16, 0x02);

		const created = await db.aiProviderCredential.create({
			data: {
				authTag,
				ciphertext,
				defaultModelId: 'gpt-5.4-mini',
				deployment: 'my-deployment',
				iv,
				kid: 'k1',
				provider: 'AZURE',
				resourceName: 'my-resource',
				userId
			}
		});

		const row = await db.aiProviderCredential.findUniqueOrThrow({ where: { id: created.id } });
		// Prisma 7 hands Bytes back as Uint8Array, NOT Buffer — Task 6 must Buffer.from() it
		// before calling open(). Assert the runtime shape so that contract cannot silently drift.
		// Buffer is a subclass of Uint8Array, so toBeInstanceOf(Uint8Array) alone would also
		// pass for a Buffer — explicitly rule that out too.
		expect(row.iv).toBeInstanceOf(Uint8Array);
		expect(Buffer.isBuffer(row.iv)).toBe(false);
		expect(row.kid).toBe('k1');
		expect(Buffer.from(row.iv).byteLength).toBe(12);
		expect(Buffer.from(row.authTag).byteLength).toBe(16);
		expect(Buffer.from(row.ciphertext).equals(ciphertext)).toBe(true);
		expect(row.enabled).toBe(true);
		expect(row.apiVersion).toBeNull();
		expect(row.lastVerifiedAt).toBeNull();
	});

	test('AiCall stores costNanoUsd as a bigint and defaults pricingStatus to PRICED', async () => {
		const created = await db.aiCall.create({
			data: {
				billedTo: 'PLATFORM',
				cacheReadTokens: 128,
				costNanoUsd: 9_007_199_254_740_993n, // > Number.MAX_SAFE_INTEGER: proves no float coercion
				functionId: 'chat.turn',
				inputTokens: 1000,
				latencyMs: 1234,
				modelId: 'my-deployment',
				outcome: 'OK',
				outputTokens: 250,
				priceSnapshotId: 'sha256:test',
				provider: 'azure',
				requestId,
				resolvedModel: 'gpt-5.4-mini',
				surface: 'CHAT',
				userId
			}
		});

		const row = await db.aiCall.findUniqueOrThrow({ where: { id: created.id } });
		expect(typeof row.costNanoUsd).toBe('bigint');
		expect(row.costNanoUsd).toBe(9_007_199_254_740_993n);
		expect(row.pricingStatus).toBe('PRICED');
		expect(row.kind).toBe('LANGUAGE_MODEL');
		expect(row.modelId).toBe('my-deployment');
		expect(row.resolvedModel).toBe('gpt-5.4-mini'); // Azure: deployment != model. Price on resolvedModel.
	});

	test('AiCall permits a null cost for an unknown model — never zero', async () => {
		const created = await db.aiCall.create({
			data: {
				billedTo: 'USER',
				costNanoUsd: null,
				functionId: 'chat.turn',
				modelId: 'mystery',
				outcome: 'ERROR',
				priceSnapshotId: 'sha256:test',
				pricingStatus: 'UNKNOWN_MODEL',
				provider: 'openai',
				requestId,
				resolvedModel: 'mystery',
				surface: 'CHAT',
				userId
			}
		});
		const row = await db.aiCall.findUniqueOrThrow({ where: { id: created.id } });
		expect(row.costNanoUsd).toBeNull();
		expect(row.pricingStatus).toBe('UNKNOWN_MODEL');
	});

	test('AiToolCall round-trips, correlated by requestId', async () => {
		const created = await db.aiToolCall.create({
			data: {
				durationMs: 42,
				inputHash: 'sha256:abc',
				ok: true,
				requestId,
				surface: 'CHAT',
				toolCallId: 'call_1',
				toolName: 'portfolio.structure',
				userId
			}
		});
		const row = await db.aiToolCall.findUniqueOrThrow({ where: { id: created.id } });
		expect(row.requestId).toBe(requestId);
		expect(row.ok).toBe(true);
	});

	test('AiQuota round-trips bigints and defaults spent/reserved to 0', async () => {
		const created = await db.aiQuota.create({
			data: { limitNanoUsd: 5_000_000_000n, periodStart: new Date(), userId }
		});
		expect(created.tier).toBe('free');
		expect(created.spentNanoUsd).toBe(0n);
		expect(created.reservedNanoUsd).toBe(0n);
		expect(created.limitNanoUsd).toBe(5_000_000_000n);

		const updated = await db.aiQuota.update({
			data: { reservedNanoUsd: { increment: 1_000_000n } },
			where: { userId }
		});
		expect(updated.reservedNanoUsd).toBe(1_000_000n);
	});

	test('AiQuotaReservation round-trips and starts unsettled', async () => {
		const created = await db.aiQuotaReservation.create({
			data: { ceilingNanoUsd: 250_000n, requestId, userId }
		});
		const row = await db.aiQuotaReservation.findUniqueOrThrow({ where: { id: created.id } });
		expect(row.ceilingNanoUsd).toBe(250_000n);
		expect(row.settledAt).toBeNull();
	});

	test('AiQuotaReservation survives user deletion (the sweeper has no FK to lean on)', async () => {
		const tmpId = `${userId}-resv`;
		await db.user.create({ data: { email: `${tmpId}@example.test`, id: tmpId, name: 'tmp resv' } });
		const resv = await db.aiQuotaReservation.create({
			data: { ceilingNanoUsd: 1n, requestId: `${requestId}-resv`, userId: tmpId }
		});
		await db.user.delete({ where: { id: tmpId } });
		// No FK on AiQuotaReservation.userId by design: sweepOrphanedReservations must still see it.
		expect(await db.aiQuotaReservation.findUnique({ where: { id: resv.id } })).not.toBeNull();
		await db.aiQuotaReservation.delete({ where: { id: resv.id } });
	});

	test('AiChat cascades to AiMessage on delete', async () => {
		const chat = await db.aiChat.create({ data: { title: 'Round trip', userId } });
		await db.aiMessage.create({
			data: {
				chatId: chat.id,
				id: `msg-${chat.id}`,
				metadata: { aiGenerated: true },
				parts: [{ text: 'hello', type: 'text' }],
				role: 'assistant'
			}
		});

		const message = await db.aiMessage.findUniqueOrThrow({ where: { id: `msg-${chat.id}` } });
		expect(Array.isArray(message.parts)).toBe(true);
		expect(message.metadata).toEqual({ aiGenerated: true });

		await db.aiChat.delete({ where: { id: chat.id } });
		expect(await db.aiMessage.findUnique({ where: { id: `msg-${chat.id}` } })).toBeNull();
	});

	test('ApiKey.keyHmac is nullable and unique', async () => {
		const hmac = `hmac-${userId}`;
		const key = await db.apiKey.create({
			data: { key: `hashed-${userId}`, keyHmac: hmac, name: 'round-trip', userId }
		});
		expect(key.keyHmac).toBe(hmac);

		const found = await db.apiKey.findUnique({ where: { keyHmac: hmac } });
		expect(found?.id).toBe(key.id);

		// Prisma 7's PrismaPromise is a thenable but not `instanceof Promise`, so Bun's
		// `.rejects` matcher can't detect it directly — Promise.resolve() adapts it.
		await expect(
			Promise.resolve(db.apiKey.create({ data: { key: `hashed-2-${userId}`, keyHmac: hmac, userId } }))
		).rejects.toThrow();

		// nullable-unique: Postgres permits many NULLs, so pre-existing keys are unaffected
		const legacy = await db.apiKey.create({ data: { key: `hashed-3-${userId}`, userId } });
		const legacy2 = await db.apiKey.create({ data: { key: `hashed-4-${userId}`, userId } });
		expect(legacy.keyHmac).toBeNull();
		expect(legacy2.keyHmac).toBeNull();

		await db.apiKey.deleteMany({ where: { userId } });
	});

	test('deleting the user cascades credentials/quota/chats but SetNulls AiCall', async () => {
		const tmpId = `${userId}-tmp`;
		await db.user.create({ data: { email: `${tmpId}@example.test`, id: tmpId, name: 'tmp' } });

		const credential = await db.aiProviderCredential.create({
			data: {
				authTag: Buffer.alloc(16, 0x02),
				ciphertext: Buffer.from('not-really-ciphertext', 'utf8'),
				defaultModelId: 'gpt-5.4-mini',
				deployment: 'my-deployment',
				iv: Buffer.alloc(12, 0x01),
				kid: 'k1',
				provider: 'AZURE',
				resourceName: 'my-resource',
				userId: tmpId
			}
		});

		const chat = await db.aiChat.create({ data: { title: 'tmp chat', userId: tmpId } });
		const message = await db.aiMessage.create({
			data: {
				chatId: chat.id,
				id: `msg-${chat.id}`,
				parts: [{ text: 'hello', type: 'text' }],
				role: 'assistant'
			}
		});

		await db.aiQuota.create({
			data: { limitNanoUsd: 1n, periodStart: new Date(), userId: tmpId }
		});
		const call = await db.aiCall.create({
			data: {
				billedTo: 'PLATFORM',
				costNanoUsd: 1n,
				functionId: 'chat.turn',
				modelId: 'd',
				outcome: 'OK',
				priceSnapshotId: 'sha256:test',
				provider: 'azure',
				requestId: `${requestId}-tmp`,
				resolvedModel: 'gpt-5.4-mini',
				surface: 'CHAT',
				userId: tmpId
			}
		});

		await db.user.delete({ where: { id: tmpId } });

		expect(await db.aiProviderCredential.findUnique({ where: { id: credential.id } })).toBeNull();
		expect(await db.aiChat.findUnique({ where: { id: chat.id } })).toBeNull();
		expect(await db.aiMessage.findUnique({ where: { id: message.id } })).toBeNull();
		expect(await db.aiQuota.findUnique({ where: { userId: tmpId } })).toBeNull();
		const kept = await db.aiCall.findUniqueOrThrow({ where: { id: call.id } });
		expect(kept.userId).toBeNull(); // aggregate spend survives; the PII linkage does not
		expect(kept.costNanoUsd).toBe(1n);

		await db.aiCall.delete({ where: { id: call.id } });
	});
});
