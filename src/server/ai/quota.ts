import { createId } from '@paralleldrive/cuid2';

import { MAX_OUTPUT_TOKENS, MAX_STEPS, MAX_TOOL_RESULT_TOKENS } from '@/server/ai/guardrails';
import { estimateCeilingNanoUsd } from '@/server/ai/pricing/price';
import { db } from '@/server/db';

export type Reservation = {
	id: string;
	userId: string;
	ceilingNanoUsd: bigint;
};

export class QuotaExceededError extends Error {
	readonly ceilingNanoUsd: bigint;
	readonly userId: string;

	constructor(userId: string, ceilingNanoUsd: bigint) {
		super(`AI quota exceeded for user ${userId}: could not reserve ${ceilingNanoUsd} nanoUSD`);
		this.ceilingNanoUsd = ceilingNanoUsd;
		this.name = 'QuotaExceededError';
		this.userId = userId;
	}
}

/** $1.00. Admin-set per tier later; there is no billing in Phase 0. */
const DEFAULT_LIMIT_NANO_USD = 1_000_000_000n;

/** A process that crashes mid-call leaves its ceiling held forever. Ten minutes is the grace. */
export const ORPHAN_AGE_MS = 10 * 60 * 1000;

/**
 * Every AI SDK call site (Task 10) MUST pass `abortSignal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)`
 * to `generateText`/`streamText`. Without an enforced upper bound on wall-clock time, a request
 * can still be running past `ORPHAN_AGE_MS`, at which point the sweeper (`sweepOrphanedReservations`)
 * releases its ceiling back to the pool — while the original request is STILL spending provider
 * money against it. A second request can then reserve and spend that same budget, so total spend
 * exceeds `limitNanoUsd`. Kept comfortably below `ORPHAN_AGE_MS` (not just under it) so that, even
 * accounting for clock skew and the sweeper's own polling interval, a request is guaranteed to be
 * dead (aborted client-side) well before its reservation is ever eligible for sweeping. See the
 * `REQUEST_TIMEOUT_MS < ORPHAN_AGE_MS` assertion in `prisma/ai-quota.test.ts`.
 */
export const REQUEST_TIMEOUT_MS = 5 * 60 * 1000;

/**
 * Creates the user's quota row if it is missing. `ON CONFLICT DO NOTHING` rather than a Prisma
 * upsert, because two replicas can race this and a Prisma upsert would surface a P2002 on one.
 *
 * `limitNanoUsd` and `periodStart` are set explicitly — NEITHER has a database-level default
 * (confirmed against `prisma/migrations/20260713130000_ai_layer_phase0/migration.sql`: `periodStart`
 * is `TIMESTAMP(3) NOT NULL` with no `DEFAULT`, and a `limitNanoUsd` default of 0 would lock every
 * new user out). `tier`, `spentNanoUsd` and `reservedNanoUsd` come from their DB-level defaults.
 * `updatedAt` has NO DB default either — Prisma drives `@updatedAt` client-side — so a raw INSERT
 * must set it, or the NOT NULL constraint fires.
 */
export async function ensureQuotaRow(userId: string): Promise<void> {
	await db.$executeRaw`
		INSERT INTO "AiQuota" ("userId", "limitNanoUsd", "periodStart", "updatedAt")
		VALUES (${userId}, ${DEFAULT_LIMIT_NANO_USD}::bigint, NOW(), NOW())
		ON CONFLICT ("userId") DO NOTHING`;
}

/**
 * Sizes a quota reservation for a WHOLE multi-step tool-calling request, not one provider call.
 * THE ONE place this formula is defined — callers (Task 10) MUST call this rather than
 * re-deriving the arithmetic themselves, so there is exactly one definition to get right and
 * exactly one place to fix if the model of conversation growth is wrong.
 *
 * With tool-calling and `stopWhen`, a single `generateText`/`streamText` request can issue up to
 * `MAX_STEPS` (guardrails.ts) provider calls, each independently clamped to `MAX_OUTPUT_TOKENS`.
 * Two things get re-sent as input on every subsequent step and so compound the conversation:
 *   - the model's own output from every prior step (bounded by `MAX_OUTPUT_TOKENS`), and
 *   - the RESULT of every tool call from every prior step (bounded by `MAX_TOOL_RESULT_TOKENS`,
 *     guardrails.ts) — a fact the ORIGINAL version of this formula omitted entirely. Tool results
 *     appear nowhere in a "conversation grows by model output only" model, but they are appended
 *     to the conversation exactly like model output and re-sent on every following step. Modeling
 *     growth as output-only under-reserves as soon as any tool result is non-trivially sized (a
 *     few KB of JSON is enough), which lets a request's actual cost exceed its reservation.
 *
 * At step `k` (0-indexed), the input is bounded by
 * `estimatedInputTokens + k * (MAX_OUTPUT_TOKENS + MAX_TOOL_RESULT_TOKENS)`. Rather than sum a
 * tight per-step bound (which requires re-deriving `price()`'s tiering logic here), every step's
 * input is conservatively bounded by the FULL `MAX_STEPS`-step growth, then multiplied by
 * `MAX_STEPS` steps — simple, and safe because it can only over-reserve, never under-reserve.
 *
 * `prisma/ai-quota.test.ts`'s sizing tests prove this against the real `price()` for: no tool
 * calls, a max-size tool result on every step, and one max-size tool result that lands early and
 * is re-sent on every subsequent step — and prove the PREVIOUS (output-only) formula fails the
 * middle case.
 *
 * This reservation is only sound if `MAX_TOOL_RESULT_TOKENS` is actually enforced — Task 10 MUST
 * truncate (or paginate/summarize) any tool result before appending it to the conversation, or an
 * oversized result can blow through this reservation exactly like an unbounded model output would.
 */
export function estimateRequestCeilingNanoUsd(resolvedModel: string, estimatedInputTokens: number): bigint {
	const requestOutputCeiling = MAX_STEPS * MAX_OUTPUT_TOKENS;
	const perStepGrowth = MAX_OUTPUT_TOKENS + MAX_TOOL_RESULT_TOKENS; // model output + tool result, per prior step
	const requestInputCeiling = MAX_STEPS * (estimatedInputTokens + MAX_STEPS * perStepGrowth);
	return estimateCeilingNanoUsd(resolvedModel, requestInputCeiling, requestOutputCeiling);
}

/**
 * Reserve-then-settle. ONE atomic statement: the limit check, the increment AND the creation of the
 * reservation row are a single data-modifying CTE, so there is no window between them.
 *
 * Why it cannot be an UPDATE plus a Prisma `create`:
 *   - We run N replicas (#78). A module-scope counter, or a SELECT-then-UPDATE, is a BYPASS: two
 *     replicas both read "spent 900 of 1000", both decide there is room, and both spend.
 *   - Worse, if the process dies between the UPDATE and the create, the ceiling is held by a quota
 *     row with NO reservation row — invisible to the sweeper, and the user's budget is burned for
 *     good.
 * Postgres row-locks the UPDATE; a blocked writer re-evaluates the WHERE clause against the
 * winner's committed row and finds no room, so the INSERT selects zero rows and nothing is written.
 *
 * The reservation id is generated here: Prisma's `@default(cuid())` is a CLIENT-side default and
 * does not exist in the database, so a raw INSERT must supply it.
 *
 * `ceilingNanoUsd` MUST cover the WHOLE request, not one provider call — pass
 * `estimateRequestCeilingNanoUsd(resolvedModel, estimatedInputTokens)`. Reserving
 * `estimateCeilingNanoUsd(model, estimatedInput, MAX_OUTPUT_TOKENS)` directly — sized for a
 * single call — is the exact "reserve 1K, model returns 8K" bypass this design exists to close,
 * one level up.
 *
 * BYOK CALLERS MUST NOT CALL THIS AT ALL. A BYOK call skips reserve/settle entirely (the user is
 * paying their own provider) but still writes an AiCall row with `billedTo: USER`.
 */
export async function reserve(userId: string, ceilingNanoUsd: bigint, requestId: string): Promise<Reservation> {
	// A zero or negative ceiling is not a cheap call — it is a bypass: the UPDATE would DECREMENT
	// `reservedNanoUsd` and hand back free budget. Refuse it at the door.
	if (ceilingNanoUsd <= 0n) {
		throw new RangeError(`reserve() requires a positive ceiling, got ${ceilingNanoUsd}`);
	}

	await ensureQuotaRow(userId);

	const id = createId();

	const created = await db.$queryRaw<Array<{ id: string }>>`
		WITH admitted AS (
			UPDATE "AiQuota"
			   SET "reservedNanoUsd" = "reservedNanoUsd" + ${ceilingNanoUsd}::bigint,
			       "updatedAt" = NOW()
			 WHERE "userId" = ${userId}
			   AND "spentNanoUsd" + "reservedNanoUsd" + ${ceilingNanoUsd}::bigint <= "limitNanoUsd"
			RETURNING "userId"
		)
		INSERT INTO "AiQuotaReservation" ("id", "userId", "requestId", "ceilingNanoUsd")
		SELECT ${id}, a."userId", ${requestId}, ${ceilingNanoUsd}::bigint
		  FROM admitted a
		RETURNING "id"`;

	// Zero rows inserted => the UPDATE matched nothing => no room. 429.
	if (created.length === 0) {
		throw new QuotaExceededError(userId, ceilingNanoUsd);
	}

	return { ceilingNanoUsd, id, userId };
}

/**
 * Add the ACTUAL cost to spent, and release the CEILING from reserved.
 *
 * One statement, not a two-statement `$transaction`: a data-modifying CTE is atomic in Postgres and
 * strictly stronger, because the release is conditional on THIS call being the one that claimed the
 * reservation. If the sweeper already released it (a call that ran past `ORPHAN_AGE_MS`), `claimed`
 * is empty and the ceiling is not released twice — but the real spend IS still recorded, because
 * under-billing is the failure that actually costs money.
 *
 * The row updated in `AiQuota` is looked up via `owner` — a SELECT on `AiQuotaReservation` keyed
 * by `id` (the primary key) — NOT via `reservation.userId` as passed in by the caller. `id` is
 * generated server-side by `reserve()` and is trustworthy; `reservation.userId` is a plain field
 * on a plain object and is not. Keying the billed row off the caller-supplied field would mean a
 * `Reservation` whose `userId` had been tampered with (or simply copy-pasted wrong) debits
 * whatever user that field names, not the reservation's real owner. Deriving the target from the
 * database closes that off entirely: it does not matter what `reservation.userId` says, only what
 * row `reservation.id` actually names.
 *
 * `actualNanoUsd` is `bigint | null` — it is exactly `AiCall.costNanoUsd`, which is `null`, never
 * `0`, for an unknown model (Task 7 / `price()`). A docstring saying "resolve null to the full
 * ceiling before calling settle" is not an invariant: `settle(r, call.costNanoUsd ?? 0n)` type-checks,
 * is the natural thing a hurried caller writes, and bills an unpriced-model call as FREE — unlimited
 * platform inference for any model absent from the price snapshot. So the coalescing happens HERE,
 * inside `settle`, where no caller can get it wrong: a `null` actual cost bills the full reserved
 * ceiling (fail safe — bill the worst case), never `0n`.
 *
 * `GREATEST(0, ...)` so `reservedNanoUsd` can never go negative.
 * `settle()` must be called AT MOST ONCE per reservation — put it in a `finally`. It is deliberately
 * not idempotent on the spend leg (see above), so calling it twice double-bills.
 */
export async function settle(reservation: Reservation, actualNanoUsd: bigint | null): Promise<void> {
	const actual = actualNanoUsd ?? reservation.ceilingNanoUsd;
	await db.$executeRaw`
		WITH owner AS (
			SELECT "userId" FROM "AiQuotaReservation" WHERE "id" = ${reservation.id}
		),
		claimed AS (
			UPDATE "AiQuotaReservation"
			   SET "settledAt" = NOW()
			 WHERE "id" = ${reservation.id}
			   AND "settledAt" IS NULL
			RETURNING "ceilingNanoUsd"
		)
		UPDATE "AiQuota" q
		   SET "spentNanoUsd" = q."spentNanoUsd" + ${actual}::bigint,
		       "reservedNanoUsd" = GREATEST(
		           0::bigint,
		           q."reservedNanoUsd" - COALESCE((SELECT "ceilingNanoUsd" FROM claimed), 0::bigint)
		       ),
		       "updatedAt" = NOW()
		 WHERE q."userId" = (SELECT "userId" FROM owner)`;
}

/**
 * Releases ceilings held by reservations that were never settled — a replica that was OOM-killed
 * or redeployed mid-call. Without this, a crash permanently burns quota the user never spent.
 *
 * Data-modifying CTEs in Postgres are executed exactly once and always to completion, whether or
 * not the primary query reads their output, so `released` runs even though the SELECT only reads
 * `orphaned`. Two sweepers racing is safe: `settledAt IS NULL` is the claim, and only one of them
 * can win it.
 */
export async function sweepOrphanedReservations(olderThanMs: number = ORPHAN_AGE_MS): Promise<number> {
	const cutoff = new Date(Date.now() - olderThanMs);

	const swept = await db.$queryRaw<Array<{ id: string }>>`
		WITH orphaned AS (
			UPDATE "AiQuotaReservation"
			   SET "settledAt" = NOW()
			 WHERE "settledAt" IS NULL
			   AND "createdAt" < ${cutoff}
			RETURNING "id", "userId", "ceilingNanoUsd"
		),
		released AS (
			UPDATE "AiQuota" q
			   SET "reservedNanoUsd" = GREATEST(0::bigint, q."reservedNanoUsd" - agg."total"),
			       "updatedAt" = NOW()
			  FROM (
			      SELECT "userId", SUM("ceilingNanoUsd")::bigint AS "total"
			        FROM orphaned
			       GROUP BY "userId"
			  ) agg
			 WHERE q."userId" = agg."userId"
			RETURNING q."userId"
		)
		SELECT "id" FROM orphaned`;

	return swept.length;
}
