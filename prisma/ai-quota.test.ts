import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { MAX_OUTPUT_TOKENS, MAX_STEPS } from '../src/server/ai/guardrails';
import { estimateCeilingNanoUsd, price } from '../src/server/ai/pricing/price';
import { QuotaExceededError, ensureQuotaRow, reserve, settle, sweepOrphanedReservations } from '../src/server/ai/quota';
import { db } from '../src/server/db';

/**
 * Lives outside `src/` (alongside `prisma/ai-schema.test.ts` and `prisma/ai-telemetry-dbsink.test.ts`)
 * and is run by explicit path so that `bun run test:unit` (`bun test --isolate src`) stays
 * hermetic — no DB. "THE MULTI-REPLICA BYPASS TEST" below needs a REAL Postgres: N concurrent
 * reserve() calls only prove anything against real row-locking and EvalPlanQual — simulating it
 * would prove nothing about the property this whole task exists to guarantee.
 */

let userId = '';

async function setLimit(limitNanoUsd: bigint): Promise<void> {
	await db.aiQuota.update({
		data: { limitNanoUsd, reservedNanoUsd: 0n, spentNanoUsd: 0n },
		where: { userId }
	});
}

beforeEach(async () => {
	const user = await db.user.create({ data: {} }); // User has no required scalar fields
	userId = user.id;
	await ensureQuotaRow(userId);
});

afterEach(async () => {
	await db.aiQuotaReservation.deleteMany({ where: { userId } });
	await db.user.delete({ where: { id: userId } }); // cascades AiQuota
});

describe('ensureQuotaRow', () => {
	test('is idempotent and never clobbers an existing row', async () => {
		await setLimit(999n);
		await ensureQuotaRow(userId);
		await ensureQuotaRow(userId);
		const q = await db.aiQuota.findUniqueOrThrow({ where: { userId } });
		expect(q.limitNanoUsd).toBe(999n);
	});

	test('a fresh row gets the default limit, not 0 — a 0 default would lock every new user out', async () => {
		const q = await db.aiQuota.findUniqueOrThrow({ where: { userId } });
		expect(q.limitNanoUsd).toBeGreaterThan(0n);
		expect(q.spentNanoUsd).toBe(0n);
		expect(q.reservedNanoUsd).toBe(0n);
	});
});

describe('reserve', () => {
	test('a reservation within the limit succeeds and increments reservedNanoUsd', async () => {
		await setLimit(1_000n);
		const r = await reserve(userId, 400n, 'req-1');
		expect(r.userId).toBe(userId);
		expect(r.ceilingNanoUsd).toBe(400n);

		const q = await db.aiQuota.findUniqueOrThrow({ where: { userId } });
		expect(q.reservedNanoUsd).toBe(400n);
		expect(q.spentNanoUsd).toBe(0n);

		const row = await db.aiQuotaReservation.findUniqueOrThrow({ where: { id: r.id } });
		expect(row.requestId).toBe('req-1');
		expect(row.settledAt).toBeNull();
	});

	test('auto-creates the quota row for a user who has none', async () => {
		await db.aiQuota.delete({ where: { userId } });
		const r = await reserve(userId, 1n, 'req-1');
		expect(r.id).not.toBe('');
		expect((await db.aiQuota.findUniqueOrThrow({ where: { userId } })).reservedNanoUsd).toBe(1n);
	});

	test('a ceiling exactly equal to the remaining budget is admitted (the bound is <=)', async () => {
		await setLimit(1_000n);
		await reserve(userId, 600n, 'req-1');
		await reserve(userId, 400n, 'req-2');
		expect((await db.aiQuota.findUniqueOrThrow({ where: { userId } })).reservedNanoUsd).toBe(1_000n);
	});

	test('a reservation that would cross the limit throws QuotaExceededError and mutates NOTHING', async () => {
		await setLimit(1_000n);
		await reserve(userId, 900n, 'req-1');
		await expect(reserve(userId, 200n, 'req-2')).rejects.toBeInstanceOf(QuotaExceededError);

		const q = await db.aiQuota.findUniqueOrThrow({ where: { userId } });
		expect(q.reservedNanoUsd).toBe(900n);
		// The rejected reserve must not have left an orphan reservation row behind.
		expect(await db.aiQuotaReservation.count({ where: { userId } })).toBe(1);
	});

	test('already-SPENT budget counts against the limit, not just reserved', async () => {
		await setLimit(1_000n);
		await db.aiQuota.update({ data: { spentNanoUsd: 950n }, where: { userId } });
		await expect(reserve(userId, 100n, 'req-1')).rejects.toBeInstanceOf(QuotaExceededError);
	});

	test('a non-positive ceiling is REJECTED — a negative ceiling would decrement reserved and bypass the cap', async () => {
		await setLimit(1_000n);
		await expect(reserve(userId, -5_000n, 'req-1')).rejects.toBeInstanceOf(RangeError);
		await expect(reserve(userId, 0n, 'req-2')).rejects.toBeInstanceOf(RangeError);

		const q = await db.aiQuota.findUniqueOrThrow({ where: { userId } });
		expect(q.reservedNanoUsd).toBe(0n);
		expect(await db.aiQuotaReservation.count({ where: { userId } })).toBe(0);
	});
});

describe('settle', () => {
	test('moves the ACTUAL cost to spent and releases the CEILING from reserved', async () => {
		await setLimit(10_000n);
		const r = await reserve(userId, 5_000n, 'req-1'); // ceiling
		await settle(r, 1_234n); // actual

		const q = await db.aiQuota.findUniqueOrThrow({ where: { userId } });
		expect(q.spentNanoUsd).toBe(1_234n);
		expect(q.reservedNanoUsd).toBe(0n);

		const row = await db.aiQuotaReservation.findUniqueOrThrow({ where: { id: r.id } });
		expect(row.settledAt).not.toBeNull();
	});

	test('reserved can never go negative', async () => {
		await setLimit(10_000n);
		const r = await reserve(userId, 5_000n, 'req-1');
		await db.aiQuota.update({ data: { reservedNanoUsd: 0n }, where: { userId } }); // simulate a sweep
		await settle(r, 100n);

		const q = await db.aiQuota.findUniqueOrThrow({ where: { userId } });
		expect(q.reservedNanoUsd).toBe(0n);
		expect(q.spentNanoUsd).toBe(100n);
	});

	test('a model that blows past its output estimate cannot exceed the reserved ceiling', async () => {
		// The classic bug: reserve for 1K output tokens, model returns 8K. The ceiling is what
		// protects the limit; settle just reconciles the truth afterwards.
		await setLimit(10_000n);
		const r = await reserve(userId, 5_000n, 'req-1');
		await settle(r, 9_999n);
		const q = await db.aiQuota.findUniqueOrThrow({ where: { userId } });
		expect(q.spentNanoUsd).toBe(9_999n);
		expect(q.reservedNanoUsd).toBe(0n);
	});

	test('settling a reservation the sweeper already released bills the spend, but does NOT release the ceiling twice', async () => {
		await setLimit(10_000n);
		const r = await reserve(userId, 5_000n, 'req-1');
		await reserve(userId, 1_000n, 'req-2'); // a second, still-held reservation

		await db.aiQuotaReservation.update({
			data: { createdAt: new Date(Date.now() - 20 * 60 * 1000) },
			where: { id: r.id }
		});
		expect(await sweepOrphanedReservations()).toBe(1);

		await settle(r, 2_000n);

		const q = await db.aiQuota.findUniqueOrThrow({ where: { userId } });
		expect(q.spentNanoUsd).toBe(2_000n); // real spend is recorded — under-billing is what costs money
		expect(q.reservedNanoUsd).toBe(1_000n); // req-2's ceiling only; the 5_000 was NOT released twice
	});
});

describe('sweepOrphanedReservations', () => {
	test('releases reservations orphaned by a crashed process and leaves fresh ones alone', async () => {
		await setLimit(10_000n);
		const stale = await reserve(userId, 3_000n, 'req-stale');
		const fresh = await reserve(userId, 2_000n, 'req-fresh');

		await db.aiQuotaReservation.update({
			data: { createdAt: new Date(Date.now() - 20 * 60 * 1000) },
			where: { id: stale.id }
		});

		const swept = await sweepOrphanedReservations();
		expect(swept).toBe(1);

		const q = await db.aiQuota.findUniqueOrThrow({ where: { userId } });
		expect(q.reservedNanoUsd).toBe(2_000n); // only the fresh one is still held
		expect(q.spentNanoUsd).toBe(0n); // a sweep releases; it does not bill

		expect((await db.aiQuotaReservation.findUniqueOrThrow({ where: { id: stale.id } })).settledAt).not.toBeNull();
		expect((await db.aiQuotaReservation.findUniqueOrThrow({ where: { id: fresh.id } })).settledAt).toBeNull();
	});

	test('a sweep with nothing to do returns 0 and touches nothing', async () => {
		await setLimit(10_000n);
		await reserve(userId, 1_000n, 'req-1');
		expect(await sweepOrphanedReservations()).toBe(0);
		expect((await db.aiQuota.findUniqueOrThrow({ where: { userId } })).reservedNanoUsd).toBe(1_000n);
	});
});

describe('THE MULTI-REPLICA BYPASS TEST', () => {
	test('N concurrent reserve() calls against a limit that admits only M: EXACTLY M succeed', async () => {
		// This is the entire reason quota lives in Postgres and not in a module-scope counter.
		// The conditional UPDATE takes a row lock; under READ COMMITTED each blocked writer
		// re-evaluates its WHERE clause against the row as updated by the winner (EvalPlanQual).
		const CEILING = 100n;
		const N = 40;
		const M = 10;
		await setLimit(CEILING * BigInt(M));

		const results = await Promise.allSettled(
			Array.from({ length: N }, (_, i) => reserve(userId, CEILING, `req-${i}`))
		);

		const fulfilled = results.filter((r) => r.status === 'fulfilled');
		const rejected = results.filter((r) => r.status === 'rejected');

		expect(fulfilled.length).toBe(M);
		expect(rejected.length).toBe(N - M);
		for (const r of rejected) {
			expect((r as PromiseRejectedResult).reason).toBeInstanceOf(QuotaExceededError);
		}

		const q = await db.aiQuota.findUniqueOrThrow({ where: { userId } });
		expect(q.reservedNanoUsd).toBe(CEILING * BigInt(M)); // not one nano over
		// And exactly M reservation rows: the admitted UPDATE and the INSERT are one statement, so
		// a losing caller can never leave a reservation row behind, nor a winner lose one.
		expect(await db.aiQuotaReservation.count({ where: { userId } })).toBe(M);
	});
});

describe('sizing a reservation for a whole multi-step tool-calling request', () => {
	test('a request-level ceiling sized off MAX_STEPS survives an 8-step tool loop maxed at MAX_OUTPUT_TOKENS every step', async () => {
		// The inherited warning from Task 6: MAX_OUTPUT_TOKENS bounds ONE provider call, not a
		// request. With `stopWhen`, one request can issue up to MAX_STEPS provider calls, each
		// independently clamped to MAX_OUTPUT_TOKENS — so a request can legally cost up to
		// MAX_STEPS * MAX_OUTPUT_TOKENS output tokens. Reserving a single-call ceiling for a whole
		// request is the "reserve 1K, model returns 8K" bug, one level up. This proves a request-sized
		// reservation survives the worst case, and that a naive single-call reservation would not.
		const model = 'gpt-5.4-mini';
		const estimatedInputTokens = 1_000; // the initial conversation, before any tool round-trips

		// Conservative sizing for the WHOLE request. Output: bounded tightly by MAX_STEPS *
		// MAX_OUTPUT_TOKENS (every step independently clamped by the guardrail). Input: compounds
		// too, since each step re-sends the growing conversation — step i's input can include up to
		// (i - 1) prior steps' worth of MAX_OUTPUT_TOKENS. Bounding EVERY step's input by the full
		// MAX_STEPS * MAX_OUTPUT_TOKENS (not just the steps that precede it) over-estimates, but is
		// simple and safe — it can only over-reserve, never under-reserve.
		const requestOutputCeiling = MAX_STEPS * MAX_OUTPUT_TOKENS;
		const requestInputCeiling = MAX_STEPS * (estimatedInputTokens + requestOutputCeiling);
		const requestCeiling = estimateCeilingNanoUsd(model, requestInputCeiling, requestOutputCeiling);

		await setLimit(requestCeiling); // exactly enough room for the whole request, no more
		const reservation = await reserve(userId, requestCeiling, 'req-8-step-loop');

		// Simulate the worst case this ceiling must survive: MAX_STEPS provider calls, each maxed at
		// MAX_OUTPUT_TOKENS output, each step's input inflated by every PRIOR step's max output (the
		// growing-conversation resend).
		let totalActualNanoUsd = 0n;
		for (let step = 0; step < MAX_STEPS; step++) {
			const stepInputTokens = estimatedInputTokens + step * MAX_OUTPUT_TOKENS;
			const stepCost = price(model, {
				cacheReadTokens: null,
				cacheWriteTokens: null,
				inputTokens: stepInputTokens,
				outputTokens: MAX_OUTPUT_TOKENS
			});
			expect(stepCost).not.toBeNull();
			totalActualNanoUsd += stepCost?.nanoUsd ?? 0n;
		}

		// THE property this whole task exists to guarantee: actual cost never exceeds the reserved
		// ceiling, even across a full MAX_STEPS tool loop maxed out every step.
		expect(totalActualNanoUsd <= requestCeiling).toBe(true);

		// And the bug this closes is real: a reservation sized for a SINGLE call is blown through
		// many times over by the actual cost of the 8-step loop.
		const naiveSingleCallCeiling = estimateCeilingNanoUsd(model, estimatedInputTokens, MAX_OUTPUT_TOKENS);
		expect(totalActualNanoUsd > naiveSingleCallCeiling).toBe(true);

		await settle(reservation, totalActualNanoUsd);
		const q = await db.aiQuota.findUniqueOrThrow({ where: { userId } });
		expect(q.spentNanoUsd).toBe(totalActualNanoUsd);
		expect(q.reservedNanoUsd).toBe(0n);
	});
});
