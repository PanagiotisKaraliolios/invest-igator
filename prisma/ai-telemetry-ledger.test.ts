import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { generateText, wrapLanguageModel } from 'ai';
import { register } from '../src/instrumentation';
import { type AiCallContext, runWithAiContext } from '../src/server/ai/context';
import { newRequestId, resetAiTables, seedUser } from '../src/server/ai/evals/db-support';
import { guardrails } from '../src/server/ai/registry';
import { recordingModel, throwingModel } from '../src/server/ai/evals/support';
import { db } from '../src/server/db';

/**
 * `telemetry.test.ts` (in `src/`, hermetic) already proves the INTEGRATION LOGIC end to end —
 * exactly one row on success, a row on a failed call via onError, no prompt text — but against
 * an INJECTED FAKE sink. `ai-telemetry-dbsink.test.ts` (in `prisma/`) already proves the REAL
 * `dbSink` writes real Postgres rows — but by calling `dbSink.writeCall`/`writeToolCall`
 * DIRECTLY, bypassing `register()`, the global `registerTelemetry` wiring, and `generateText`
 * entirely.
 *
 * Neither proves the WIRING: that Task 7's actual Next.js entry point (`register()` in
 * `src/instrumentation.ts`) — called once, at boot, with no per-call setup — is enough to make
 * every subsequent `generateText` call land a real row in real Postgres. That is the one
 * gap left, and it is the point of this file. Lives outside `src/` (like `ai-quota.test.ts` and
 * `ai-telemetry-dbsink.test.ts`) so `bun test --isolate src` stays hermetic, gated instead by
 * `db_tests` via `bun run test:db`.
 *
 * TWO BUGS an earlier draft of this fixture shipped, both silent (they would not fail loudly —
 * the ledger would simply, permanently, write nothing):
 *
 * 1. `register()` early-returns unless `process.env.NEXT_RUNTIME === 'nodejs'` (it must, so the
 *    ledger's Prisma/node:async_hooks imports never reach the edge bundle). Next.js sets that
 *    var itself at boot; a bare `bun test` process never does. Calling `register()` without
 *    simulating it is a silent no-op: `registerAiTelemetryOnce()` is never reached, so
 *    `registerTelemetry` from `ai` is never called, so NOTHING below would ever write a row —
 *    every test in this file would fail on `rows.length`, not on a single fixed assertion.
 * 2. `register()` is `async`. `beforeAll(() => { register(); register(); })` — with no
 *    `await` — returns `undefined` immediately; Bun does not wait for the dynamic
 *    `import('@/server/ai/telemetry')` inside it to resolve before running the first test. A
 *    race, not a guarantee.
 */
const ctx = (requestId: string, userId: string): AiCallContext => ({
	byok: false,
	functionId: 'eval.ledger',
	requestId,
	resolvedModel: 'gpt-5.4-mini',
	surface: 'EVAL',
	userId
});

describe('Tier 0 (DB) — register() wires generateText all the way to a real Postgres row (R3, R4)', () => {
	let userId = '';
	const previousNextRuntime = process.env.NEXT_RUNTIME;

	beforeAll(async () => {
		// Simulates what Next.js does at boot in the nodejs runtime — register()'s own guard
		// would otherwise no-op it silently in a bare `bun test` process. See bug (1) above.
		process.env.NEXT_RUNTIME = 'nodejs';
		// Idempotent: instrumentation guards on a globalThis symbol. Double registration would
		// double-write every row. AWAITED — see bug (2) above.
		await register();
		await register();
	});

	afterAll(() => {
		if (previousNextRuntime === undefined) delete process.env.NEXT_RUNTIME;
		else process.env.NEXT_RUNTIME = previousNextRuntime;
	});

	beforeEach(async () => {
		await resetAiTables();
		userId = await seedUser('ledger');
	});

	test('a successful call writes exactly ONE AiCall row, priced, outcome OK — with NO per-call sink wiring', async () => {
		const requestId = newRequestId();
		const rec = recordingModel();

		await runWithAiContext(ctx(requestId, userId), async () => {
			await generateText({
				instructions: 'x',
				model: wrapLanguageModel({ middleware: [guardrails], model: rec.model }),
				prompt: 'ping',
				telemetry: { functionId: 'eval.ledger', recordInputs: false, recordOutputs: false }
			});
		});

		const rows = await db.aiCall.findMany({ where: { requestId } });
		expect(rows).toHaveLength(1);
		const row = rows[0];
		if (!row) throw new Error('unreachable');
		expect(row.outcome).toBe('OK');
		expect(row.resolvedModel).toBe('gpt-5.4-mini');
		expect(row.billedTo).toBe('PLATFORM');
		expect(row.inputTokens).toBe(11);
		expect(row.outputTokens).toBe(7);
	});

	test('a FAILED call is not invisible — onLanguageModelCallEnd never fires, onError must', async () => {
		const requestId = newRequestId();

		await expect(
			runWithAiContext(ctx(requestId, userId), async () => {
				await generateText({
					instructions: 'x',
					model: wrapLanguageModel({ middleware: [guardrails], model: throwingModel('content_filter') }),
					prompt: 'ping',
					telemetry: { functionId: 'eval.ledger', recordInputs: false, recordOutputs: false }
				});
			})
		).rejects.toThrow();

		const rows = await db.aiCall.findMany({ where: { requestId } });
		expect(rows).toHaveLength(1);
		const row = rows[0];
		if (!row) throw new Error('unreachable');
		expect(row.outcome).not.toBe('OK');
		expect(row.errorMessage ?? '').not.toContain('api-key');
	});

	test('no prompt text is ever persisted', async () => {
		const requestId = newRequestId();
		const rec = recordingModel();
		await runWithAiContext(ctx(requestId, userId), async () => {
			await generateText({
				instructions: 'SECRET-INSTRUCTIONS-MARKER',
				model: wrapLanguageModel({ middleware: [guardrails], model: rec.model }),
				prompt: 'SECRET-PROMPT-MARKER',
				telemetry: { functionId: 'eval.ledger', recordInputs: false, recordOutputs: false }
			});
		});
		const dump = JSON.stringify(await db.aiCall.findMany({ where: { requestId } }), (_k, v: unknown) =>
			typeof v === 'bigint' ? v.toString() : v
		);
		expect(dump).not.toContain('SECRET-PROMPT-MARKER');
		expect(dump).not.toContain('SECRET-INSTRUCTIONS-MARKER');
	});
});
