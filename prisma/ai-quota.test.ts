import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { MAX_OUTPUT_TOKENS, MAX_STEPS, MAX_TOOL_RESULT_TOKENS } from '../src/server/ai/guardrails';
import { estimateCeilingNanoUsd, price } from '../src/server/ai/pricing/price';
import {
	ensureQuotaRow,
	estimateRequestCeilingNanoUsd,
	ORPHAN_AGE_MS,
	QuotaExceededError,
	REQUEST_TIMEOUT_MS,
	reserve,
	settle,
	sweepOrphanedReservations
} from '../src/server/ai/quota';
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

	test('settle(r, null) bills the FULL ceiling, not zero — an unpriced model must never be free', async () => {
		// price() returns null (never 0n) for a model absent from the snapshot. A caller who does
		// `settle(r, call.costNanoUsd ?? 0n)` would release the ceiling and bill nothing: unlimited
		// free platform inference for any unpriced model. settle() must resolve null to the ceiling
		// itself, inside the function, so no caller can get this wrong.
		await setLimit(10_000n);
		const r = await reserve(userId, 7_000n, 'req-unpriced-model');
		await settle(r, null);

		const q = await db.aiQuota.findUniqueOrThrow({ where: { userId } });
		expect(q.spentNanoUsd).toBe(7_000n); // the full ceiling, not 0n
		expect(q.reservedNanoUsd).toBe(0n);
	});

	test('settle() is NOT idempotent on the spend leg — calling it twice double-bills (pinned current behaviour)', async () => {
		// The ceiling is only ever released ONCE (claimed via settledAt IS NULL), but nothing stops
		// a second call from adding actualNanoUsd to spentNanoUsd again. settle() must be called at
		// most once per reservation (documented loudly in its docstring) — this test pins today's
		// behaviour so a future change either fixes it deliberately or this test catches the drift.
		await setLimit(10_000n);
		const r = await reserve(userId, 5_000n, 'req-double-settle');
		await settle(r, 2_000n);
		await settle(r, 2_000n);

		const q = await db.aiQuota.findUniqueOrThrow({ where: { userId } });
		expect(q.spentNanoUsd).toBe(4_000n); // billed twice — settle() must be called at most once
		expect(q.reservedNanoUsd).toBe(0n); // the ceiling itself was only released once
	});

	test("settle() ignores a tampered reservation.userId — it derives the real owner from the database via id, not the caller's field", async () => {
		// If settle() trusted `reservation.userId` for its billing target, a Reservation whose
		// `userId` field had been corrupted (or simply mismatched by a caller bug) would debit an
		// unrelated user's quota for an amount the caller controls — a griefing vector needing only
		// knowledge of a valid reservation `id`, not that user's credentials.
		await setLimit(10_000n);
		const other = await db.user.create({ data: {} });
		await ensureQuotaRow(other.id);
		await db.aiQuota.update({
			data: { limitNanoUsd: 10_000n, reservedNanoUsd: 0n, spentNanoUsd: 0n },
			where: { userId: other.id }
		});

		const r = await reserve(userId, 3_000n, 'req-owner');
		const tampered = { ...r, userId: other.id }; // same id, forged userId

		await settle(tampered, 1_000n);

		// The unrelated user must be completely untouched by the forged call...
		const otherQ = await db.aiQuota.findUniqueOrThrow({ where: { userId: other.id } });
		expect(otherQ.spentNanoUsd).toBe(0n);
		expect(otherQ.reservedNanoUsd).toBe(0n);

		// ...and the REAL owner must be billed exactly as if userId had never been tampered with.
		const ownerQ = await db.aiQuota.findUniqueOrThrow({ where: { userId } });
		expect(ownerQ.spentNanoUsd).toBe(1_000n);
		expect(ownerQ.reservedNanoUsd).toBe(0n);

		await db.aiQuota.delete({ where: { userId: other.id } });
		await db.user.delete({ where: { id: other.id } });
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

	test('sweeping the SAME orphan twice only releases its ceiling ONCE', async () => {
		// The mutation this guards against: deleting `AND "settledAt" IS NULL` from the `orphaned`
		// CTE. Without that guard, a row's `createdAt` stays < cutoff forever once it is stale, so
		// EVERY subsequent sweep would re-match it and re-decrement reservedNanoUsd by its ceiling
		// again — a genuine double-release that would eventually drive reservedNanoUsd to 0 even
		// while other, real reservations are still held (masked here only because of the
		// GREATEST(0, ...) floor, which is a different, already-tested guard).
		await setLimit(10_000n);
		const stale = await reserve(userId, 3_000n, 'req-stale');
		const fresh = await reserve(userId, 2_000n, 'req-fresh'); // must survive both sweeps untouched

		await db.aiQuotaReservation.update({
			data: { createdAt: new Date(Date.now() - 20 * 60 * 1000) },
			where: { id: stale.id }
		});

		expect(await sweepOrphanedReservations()).toBe(1); // first sweep: releases the stale one

		const afterFirst = await db.aiQuota.findUniqueOrThrow({ where: { userId } });
		expect(afterFirst.reservedNanoUsd).toBe(2_000n); // only req-fresh's ceiling remains

		// stale.createdAt is STILL < cutoff — a settledAt-blind sweep would match it again.
		expect(await sweepOrphanedReservations()).toBe(0); // second sweep: nothing left to claim

		const afterSecond = await db.aiQuota.findUniqueOrThrow({ where: { userId } });
		expect(afterSecond.reservedNanoUsd).toBe(2_000n); // unchanged — NOT re-decremented

		expect((await db.aiQuotaReservation.findUniqueOrThrow({ where: { id: fresh.id } })).settledAt).toBeNull();
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
	// The inherited warning from Task 6: MAX_OUTPUT_TOKENS bounds ONE provider call, not a
	// request. With `stopWhen`, one request can issue up to MAX_STEPS provider calls. What C1
	// fixed: the ORIGINAL formula modeled conversation growth from model OUTPUT alone. But a
	// tool-calling loop also appends each STEP'S TOOL RESULT to the conversation, and that result
	// is re-sent as input on every subsequent step exactly like model output is — tool results
	// appeared nowhere in the old formula. `estimateRequestCeilingNanoUsd` (quota.ts) is the fix:
	// it charges every prior step for BOTH MAX_OUTPUT_TOKENS AND MAX_TOOL_RESULT_TOKENS of growth.
	const model = 'gpt-5.4-mini';
	const estimatedInputTokens = 1_000; // the initial conversation, before any tool round-trips

	/**
	 * Simulates the actual cost of a MAX_STEPS request where each step (except the last, which has
	 * no following step to re-send into) produces `toolResultTokensAt(step)` tokens of tool result.
	 * Both that result and the step's own MAX_OUTPUT_TOKENS output persist in the conversation and
	 * are re-sent as input on every subsequent step — mirroring how a real tool-calling loop grows.
	 */
	function simulateActualNanoUsd(toolResultTokensAt: (step: number) => number): bigint {
		let total = 0n;
		let priorGrowth = 0;
		for (let step = 0; step < MAX_STEPS; step++) {
			const stepInputTokens = estimatedInputTokens + priorGrowth;
			const stepCost = price(model, {
				cacheReadTokens: null,
				cacheWriteTokens: null,
				inputTokens: stepInputTokens,
				outputTokens: MAX_OUTPUT_TOKENS
			});
			expect(stepCost).not.toBeNull();
			total += stepCost?.nanoUsd ?? 0n;
			priorGrowth += MAX_OUTPUT_TOKENS + toolResultTokensAt(step);
		}
		return total;
	}

	/**
	 * THE ORIGINAL (pre-C1) formula, reconstructed here — NOT reintroduced into quota.ts — purely
	 * so this suite can prove it is insufficient. It models conversation growth from model output
	 * alone; tool results appear nowhere in it. This is the exact blind spot C1 closed.
	 */
	function legacyOutputOnlyCeiling(): bigint {
		const requestOutputCeiling = MAX_STEPS * MAX_OUTPUT_TOKENS;
		const requestInputCeiling = MAX_STEPS * (estimatedInputTokens + requestOutputCeiling);
		return estimateCeilingNanoUsd(model, requestInputCeiling, requestOutputCeiling);
	}

	test('no tool calls: the real ceiling survives MAX_STEPS at MAX_OUTPUT_TOKENS output every step', async () => {
		const ceiling = estimateRequestCeilingNanoUsd(model, estimatedInputTokens);
		const actual = simulateActualNanoUsd(() => 0);
		expect(actual <= ceiling).toBe(true);

		await setLimit(ceiling);
		const reservation = await reserve(userId, ceiling, 'req-no-tools');
		await settle(reservation, actual);
		const q = await db.aiQuota.findUniqueOrThrow({ where: { userId } });
		expect(q.spentNanoUsd).toBe(actual);
		expect(q.reservedNanoUsd).toBe(0n);
	});

	test('a MAX_TOOL_RESULT_TOKENS tool result on EVERY step stays within the real ceiling — the legacy output-only formula does NOT survive this', async () => {
		const ceiling = estimateRequestCeilingNanoUsd(model, estimatedInputTokens);
		const actual = simulateActualNanoUsd(() => MAX_TOOL_RESULT_TOKENS);

		// THE property C1 exists to guarantee: actual cost never exceeds the real ceiling, even
		// with a worst-case tool result appended on every step.
		expect(actual <= ceiling).toBe(true);

		// And the bug is real: the legacy formula never budgeted for tool results at all, so this
		// exact worst case blows through it. (Before the fix, this was RED against the real
		// `estimateRequestCeilingNanoUsd` too — see the C1 fix-wave report.)
		expect(actual > legacyOutputOnlyCeiling()).toBe(true);

		await setLimit(ceiling);
		const reservation = await reserve(userId, ceiling, 'req-max-tool-result-every-step');
		await settle(reservation, actual);
		const q = await db.aiQuota.findUniqueOrThrow({ where: { userId } });
		expect(q.spentNanoUsd).toBe(actual);
		expect(q.reservedNanoUsd).toBe(0n);
	});

	test('one MAX_TOOL_RESULT_TOKENS result at step 0, re-sent on every later step, stays within the real ceiling', async () => {
		const ceiling = estimateRequestCeilingNanoUsd(model, estimatedInputTokens);
		const actual = simulateActualNanoUsd((step) => (step === 0 ? MAX_TOOL_RESULT_TOKENS : 0));
		expect(actual <= ceiling).toBe(true);

		await setLimit(ceiling);
		const reservation = await reserve(userId, ceiling, 'req-one-fat-result-early');
		await settle(reservation, actual);
		const q = await db.aiQuota.findUniqueOrThrow({ where: { userId } });
		expect(q.spentNanoUsd).toBe(actual);
		expect(q.reservedNanoUsd).toBe(0n);
	});

	test('a naive SINGLE-CALL ceiling is still blown through many times over by the 8-step loop, even with zero tool results', async () => {
		const naiveSingleCallCeiling = estimateCeilingNanoUsd(model, estimatedInputTokens, MAX_OUTPUT_TOKENS);
		const actual = simulateActualNanoUsd(() => 0);
		expect(actual > naiveSingleCallCeiling).toBe(true);
	});
});

describe('REQUEST_TIMEOUT_MS vs ORPHAN_AGE_MS', () => {
	test('the request timeout is comfortably below the sweeper orphan age, so a request is guaranteed dead before it can be swept out from under itself', () => {
		// If this ever inverted, a request still legitimately running would have its reservation
		// released by the sweeper while it is still spending provider money — a second request
		// could then reserve and spend the same budget, breaking the limitNanoUsd cap entirely.
		expect(REQUEST_TIMEOUT_MS).toBeLessThan(ORPHAN_AGE_MS);
	});
});
