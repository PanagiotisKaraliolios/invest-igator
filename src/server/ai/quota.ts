import { createId } from '@paralleldrive/cuid2';

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
const ORPHAN_AGE_MS = 10 * 60 * 1000;

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
 * `ceilingNanoUsd` MUST cover the WHOLE request, not one provider call. With tool-calling and
 * `stopWhen`, a single `generateText`/`streamText` request can issue up to `MAX_STEPS` (guardrails.ts)
 * provider calls, each independently clamped to `MAX_OUTPUT_TOKENS` — so a request can legally cost
 * up to `MAX_STEPS * MAX_OUTPUT_TOKENS` output tokens, and the input side compounds too (each step
 * re-sends the growing conversation). Reserving `estimateCeilingNanoUsd(model, estimatedInput,
 * MAX_OUTPUT_TOKENS)` — sized for a single call — is the exact "reserve 1K, model returns 8K" bypass
 * this design exists to close, one level up. A conservative, safe sizing a caller can use:
 *
 *   const perStepOutput = MAX_STEPS * MAX_OUTPUT_TOKENS;                      // worst-case total output
 *   const perStepInput = MAX_STEPS * (estimatedInputTokens + perStepOutput);  // worst-case total input
 *   const ceiling = estimateCeilingNanoUsd(resolvedModel, perStepInput, perStepOutput);
 *
 * (`prisma/ai-quota.test.ts`'s "8-step tool loop" test proves this formula dominates a simulated
 * worst-case run — every step maxed at `MAX_OUTPUT_TOKENS`, each step's input inflated by every
 * prior step's max output — and that a naive single-call reservation does not.)
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
 * `actualNanoUsd` is `AiCall.costNanoUsd`, which is `null` — never `0` — for an unknown model
 * (Task 7 / `price()`). Silently releasing the reservation for free on a `null` cost is itself a
 * bypass (an unpriced model becomes a way to spend platform budget at zero recorded cost), so a
 * caller must never pass `null` through as `0n`. Since this contract takes a `bigint`, not
 * `bigint | null`, that decision is pushed to the caller at the type level: resolve `null` to the
 * full reserved ceiling (fail safe — bill the worst case) before calling `settle`, never to `0n`.
 *
 * `GREATEST(0, ...)` so `reservedNanoUsd` can never go negative.
 * `settle()` must be called AT MOST ONCE per reservation — put it in a `finally`. It is deliberately
 * not idempotent on the spend leg (see above), so calling it twice double-bills.
 */
export async function settle(reservation: Reservation, actualNanoUsd: bigint): Promise<void> {
	await db.$executeRaw`
		WITH claimed AS (
			UPDATE "AiQuotaReservation"
			   SET "settledAt" = NOW()
			 WHERE "id" = ${reservation.id}
			   AND "settledAt" IS NULL
			RETURNING "ceilingNanoUsd"
		)
		UPDATE "AiQuota" q
		   SET "spentNanoUsd" = q."spentNanoUsd" + ${actualNanoUsd}::bigint,
		       "reservedNanoUsd" = GREATEST(
		           0::bigint,
		           q."reservedNanoUsd" - COALESCE((SELECT "ceilingNanoUsd" FROM claimed), 0::bigint)
		       ),
		       "updatedAt" = NOW()
		 WHERE q."userId" = ${reservation.userId}`;
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
