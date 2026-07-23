import { randomUUID } from 'node:crypto';
import { db } from '@/server/db';

/**
 * DB-backed helpers for the AI-layer integration suites that live under `prisma/` (alongside
 * `ai-quota.test.ts`, `ai-schema.test.ts`, `ai-telemetry-dbsink.test.ts`) rather than under
 * `src/`. This module is plain, dependency-light and contains no tests itself, so it is safe to
 * live here and be imported by relative path from `prisma/*.test.ts` — but it must NEVER be
 * imported by anything that runs under `bun test --isolate src` (Tier 0), because every function
 * below hits a real Postgres.
 */

/** A fresh correlation id. Every eval scopes its assertions by requestId, never by "the last row". */
export function newRequestId(): string {
	return `eval-${randomUUID()}`;
}

/**
 * Creates a throwaway user and returns its id.
 * `email` is unique, so every seeded user gets a uuid-suffixed address, and
 * `resetAiTables` finds them all by the @invest-igator.test suffix.
 */
export async function seedUser(label: string): Promise<string> {
	const user = await db.user.create({
		data: {
			currency: 'EUR',
			email: `eval-${label}-${randomUUID()}@invest-igator.test`,
			name: `eval-${label}`
		}
	});
	return user.id;
}

/**
 * Wipes every table these evals touch, plus the users they created.
 * Deleting the eval users cascades to their transactions, watchlist, goals, quota and
 * credentials (all `onDelete: Cascade` in schema.prisma). `AiCall.userId` is `onDelete: SetNull`,
 * not cascaded, so `AiCall`/`AiToolCall` rows are cleared explicitly and FIRST — otherwise a
 * user delete would merely null out `AiCall.userId` and leave stale rows for the next test to
 * trip over. `AiMutationCommit.userId` has no FK relation at all (plain String), so a user
 * delete does NOTHING to its rows — it too is cleared explicitly, or a stale `jti` from a
 * prior test bleeds across runs.
 */
export async function resetAiTables(): Promise<void> {
	await db.aiToolCall.deleteMany({});
	await db.aiCall.deleteMany({});
	await db.aiMutationCommit.deleteMany({});
	await db.aiQuotaReservation.deleteMany({});
	await db.aiQuota.deleteMany({});
	await db.aiProviderCredential.deleteMany({});
	await db.user.deleteMany({ where: { email: { endsWith: '@invest-igator.test' } } });
}
