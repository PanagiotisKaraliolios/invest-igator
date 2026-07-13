import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { db } from '../src/server/db';
import { buildAiCallRow, dbSink } from '../src/server/ai/telemetry';

/**
 * I5: `dbSink` (telemetry.ts:59-66) has ZERO runtime coverage in `src/server/ai/telemetry.test.ts`
 * — every test there injects a fake sink, so `db.aiCall.create` / `db.aiToolCall.create` are only
 * ever compiler-checked, never executed. Combined with `safeWrite` correctly swallowing sink
 * failures, a ledger that silently writes nothing in production would be indistinguishable from a
 * healthy one. This test exercises the REAL sink against a live Postgres.
 *
 * Lives outside `src/` (alongside `prisma/ai-schema.test.ts`) and is run by explicit path so that
 * `bun run test:unit` (`bun test --isolate src`) stays hermetic — no DB.
 */
const userId = `ai-telemetry-dbsink-${Date.now()}`;
const requestId = `req-${userId}`;

beforeAll(async () => {
	await db.user.create({
		data: { email: `${userId}@example.test`, id: userId, name: 'AI telemetry dbSink round-trip' }
	});
});

afterAll(async () => {
	await db.aiToolCall.deleteMany({ where: { requestId } });
	await db.aiCall.deleteMany({ where: { requestId } });
	await db.user.delete({ where: { id: userId } });
});

describe('dbSink — the real Postgres-backed sink', () => {
	test('writeCall and writeToolCall land real rows in Postgres, correlated by requestId', async () => {
		const row = buildAiCallRow({
			callId: 'call-1',
			ctx: {
				byok: false,
				functionId: 'eval.telemetry',
				requestId,
				resolvedModel: 'gpt-5.4-mini',
				surface: 'EVAL',
				userId
			},
			errorCode: null,
			errorMessage: null,
			finishReason: 'stop',
			latencyMs: 42,
			modelId: 'gpt-5.4-mini',
			outcome: 'OK',
			provider: 'openai',
			responseId: 'resp-1', // also proves I3: responseId must round-trip, not be silently dropped
			usage: undefined
		});

		await dbSink.writeCall(row);
		await dbSink.writeToolCall({
			durationMs: 10,
			errorMessage: null,
			inputHash: null,
			ok: true,
			requestId,
			surface: 'EVAL',
			toolCallId: 'tc-1',
			toolName: 'portfolio.structure',
			userId
		});

		const savedCall = await db.aiCall.findFirstOrThrow({ where: { requestId } });
		const savedTool = await db.aiToolCall.findFirstOrThrow({ where: { requestId } });

		expect(savedCall.requestId).toBe(requestId);
		expect(savedTool.requestId).toBe(requestId);
		expect(savedCall.requestId).toBe(savedTool.requestId); // correlated by requestId, not AiCall.id
		expect(savedCall.responseId).toBe('resp-1');
		expect(savedCall.modelId).toBe('gpt-5.4-mini');
		expect(savedTool.toolName).toBe('portfolio.structure');
		expect(savedTool.ok).toBe(true);
	});
});
