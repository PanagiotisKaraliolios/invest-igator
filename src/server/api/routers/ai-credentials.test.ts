import { beforeEach, describe, expect, mock, test } from 'bun:test';
import { randomUUID } from 'node:crypto';
import type { createTRPCContext } from '@/server/api/trpc';

/**
 * `src/server/ai/evals/db-support.ts` (`resetAiTables`/`seedUser`) is explicitly documented as
 * "must NEVER be imported by anything that runs under `bun test --isolate src` (Tier 0), because
 * every function below hits a real Postgres" — and this file lives under `src/`, so `test:unit`
 * collects it. CI's `unit` job (`ci.yml`) sets a DATABASE_URL for that job but never starts a
 * Postgres container (unlike `e2e`/`db_tests`/`migration-check`, which all `docker run` one first),
 * so any real connection attempt here would pass locally (there IS a reachable dev Postgres) and
 * FAIL in CI — the exact "green in my sandbox, red in CI" trap this task warns about. So: a real
 * Prisma client is not usable here. Instead we mock `@/server/db` with a small in-memory store that
 * mirrors Prisma's `where`-clause AND-semantics closely enough to reproduce the two security
 * mutations verbatim (list decrypting the real key; delete dropping the userId filter) — this
 * tests the ROUTER'S query construction, the same thing `resolve-model.test.ts` does by recording
 * and asserting on `findFirst` call args, just closer to real behaviour because the fake actually
 * filters.
 */

type Row = {
	apiVersion: string | null;
	authTag: Uint8Array;
	baseURL: string | null;
	ciphertext: Uint8Array;
	createdAt: Date;
	defaultModelId: string;
	deployment: string | null;
	enabled: boolean;
	id: string;
	iv: Uint8Array;
	kid: string;
	label: string | null;
	lastUsedAt: Date | null;
	lastVerifiedAt: Date | null;
	provider: string;
	resourceName: string | null;
	updatedAt: Date;
	userId: string;
};

let rows: Row[] = [];

function matchesWhere(row: Row, where: Record<string, unknown> | undefined): boolean {
	if (!where) return true;
	return Object.entries(where).every(([key, value]) => {
		if (key === 'userId_provider' && value && typeof value === 'object') {
			const compound = value as { provider: string; userId: string };
			return row.userId === compound.userId && row.provider === compound.provider;
		}
		return (row as unknown as Record<string, unknown>)[key] === value;
	});
}

function defaultRow(): Omit<Row, 'ciphertext' | 'defaultModelId' | 'iv' | 'kid' | 'provider' | 'userId' | 'authTag'> {
	return {
		apiVersion: null,
		baseURL: null,
		createdAt: new Date(),
		deployment: null,
		enabled: true,
		id: randomUUID(),
		label: null,
		lastUsedAt: null,
		lastVerifiedAt: null,
		resourceName: null,
		updatedAt: new Date()
	};
}

mock.module('@/server/db', () => ({
	db: {
		aiProviderCredential: {
			count: async ({ where }: { where?: Record<string, unknown> } = {}) =>
				rows.filter((row) => matchesWhere(row, where)).length,
			create: async ({ data }: { data: Partial<Row> }) => {
				const row = { ...defaultRow(), ...data } as Row;
				rows.push(row);
				return row;
			},
			deleteMany: async ({ where }: { where?: Record<string, unknown> } = {}) => {
				const before = rows.length;
				rows = rows.filter((row) => !matchesWhere(row, where));
				return { count: before - rows.length };
			},
			findMany: async ({
				orderBy,
				where
			}: {
				orderBy?: { createdAt?: 'asc' | 'desc' };
				where?: Record<string, unknown>;
			} = {}) => {
				const filtered = rows.filter((row) => matchesWhere(row, where));
				if (orderBy?.createdAt === 'desc') {
					filtered.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
				}
				return filtered;
			},
			update: async ({ data, where }: { data: Partial<Row>; where: { id: string } }) => {
				const row = rows.find((candidate) => candidate.id === where.id);
				if (!row) throw new Error('row not found');
				Object.assign(row, data);
				return row;
			},
			upsert: async ({
				create,
				update,
				where
			}: {
				create: Partial<Row>;
				update: Partial<Row>;
				where: Record<string, unknown>;
			}) => {
				const existing = rows.find((row) => matchesWhere(row, where));
				if (existing) {
					Object.assign(existing, update);
					return existing;
				}
				const row = { ...defaultRow(), ...create } as Row;
				rows.push(row);
				return row;
			}
		}
	}
}));

let probeResult: { error?: string; ok: boolean } = { ok: true };
const actualProbe = await import('@/server/ai/probe');
mock.module('@/server/ai/probe', () => ({
	...actualProbe,
	probeCredential: async () => probeResult
}));

const { seal } = await import('@/server/ai/crypto');
const { createCaller } = await import('@/server/api/root');
const { db } = await import('@/server/db');
type Ctx = Awaited<ReturnType<typeof createTRPCContext>>;

function callerFor(userId: string) {
	const ctx = {
		apiKeyPermissions: null,
		db,
		headers: new Headers(),
		session: {
			session: { id: 'test-session', token: 'test', userId },
			user: { email: `${userId}@invest-igator.test`, id: userId, name: 'test', role: 'user' }
		}
	} as unknown as Ctx;
	return createCaller(ctx);
}

const KEY = Buffer.alloc(32, 0x11).toString('base64');
const SECRET_A = 'sk-live-USER-A-KEY-1111';

async function seedCredential(userId: string, secret: string) {
	const blob = seal(secret, userId, 'OPENAI');
	return db.aiProviderCredential.create({
		data: {
			authTag: blob.authTag,
			ciphertext: blob.ciphertext,
			defaultModelId: 'gpt-5.4-mini',
			iv: blob.iv,
			kid: blob.kid,
			provider: 'OPENAI',
			userId
		}
	});
}

describe('aiCredentials — the secret never crosses the wire', () => {
	let userA = '';
	let userB = '';

	beforeEach(() => {
		process.env.AI_CRED_KEYS = JSON.stringify({ k1: KEY });
		process.env.AI_CRED_ACTIVE_KID = 'k1';
		rows = [];
		probeResult = { ok: true };
		userA = `cred-a-${randomUUID()}`;
		userB = `cred-b-${randomUUID()}`;
	});

	test('list returns a masked hint and no key material at all', async () => {
		await seedCredential(userA, SECRET_A);
		const rows = await callerFor(userA).aiCredentials.list();
		expect(rows).toHaveLength(1);
		const row = rows[0];
		if (!row) throw new Error('unreachable');
		expect(row.hint).toBe('••••1111');

		const dump = JSON.stringify(rows);
		expect(dump).not.toContain(SECRET_A);
		expect(dump).not.toContain('ciphertext');
		expect(dump).not.toContain('authTag');
		expect(dump).not.toContain('kid');
		expect(dump).not.toContain('iv');
	});

	test("list is scoped to the caller — user B never sees user A's credential", async () => {
		await seedCredential(userA, SECRET_A);
		expect(await callerFor(userB).aiCredentials.list()).toEqual([]);
	});

	test("delete cannot touch another tenant's credential, even with the right id", async () => {
		const row = await seedCredential(userA, SECRET_A);
		await expect(callerFor(userB).aiCredentials.delete({ id: row.id })).rejects.toThrow(/not found/i);
		expect(await db.aiProviderCredential.count({ where: { userId: userA } })).toBe(1);
	});

	test('the owner can delete their own credential', async () => {
		const row = await seedCredential(userA, SECRET_A);
		expect(await callerFor(userA).aiCredentials.delete({ id: row.id })).toEqual({ deleted: 1 });
		expect(await db.aiProviderCredential.count({ where: { userId: userA } })).toBe(0);
	});

	test('a row whose sealing key was retired shows hint=null instead of pretending to work', async () => {
		// AAD binds the blob to (userId, provider). Re-tag the row to another provider and
		// open() must fail — the same failure shape a retired kid produces.
		const row = await seedCredential(userA, SECRET_A);
		await db.aiProviderCredential.update({ data: { provider: 'ANTHROPIC' }, where: { id: row.id } });
		const rows = await callerFor(userA).aiCredentials.list();
		expect(rows[0]?.hint).toBeNull();
	});

	// Beyond the brief: `create()` is a router response too, and the STANDING LESSON asks for
	// "not anywhere in ANY router response" — not just `list`. The probe is mocked to `{ ok: true }`
	// so this never touches the network.
	test('create returns a masked hint and never echoes the plaintext secret anywhere', async () => {
		const result = await callerFor(userA).aiCredentials.create({
			defaultModelId: 'gpt-5.4-mini',
			provider: 'OPENAI',
			secret: SECRET_A
		});
		expect(result.hint).toBe('••••1111');

		const dump = JSON.stringify(result);
		expect(dump).not.toContain(SECRET_A);
		expect(dump).not.toContain('ciphertext');
		expect(dump).not.toContain('authTag');
	});

	test('create surfaces a rejected credential as BAD_REQUEST, not a 500, and persists nothing', async () => {
		probeResult = { error: 'AuthenticationError: 401 invalid api key', ok: false };
		await expect(
			callerFor(userA).aiCredentials.create({
				defaultModelId: 'gpt-5.4-mini',
				provider: 'OPENAI',
				secret: 'sk-bad-key-000000'
			})
		).rejects.toThrow(/rejected this credential/i);
		expect(await db.aiProviderCredential.count({ where: { userId: userA } })).toBe(0);
	});

	// R2: `ctx.session.user.id` can never actually contain '|' (Better Auth cuids), but Task 3's
	// AAD guard exists precisely because "should be unreachable" isn't a proof. A malformed userId
	// must surface as a form error, not an unhandled 500 from seal()'s internal throw.
	test('a malformed userId is rejected as BAD_REQUEST, not an unhandled crash', async () => {
		await expect(
			callerFor('evil|user').aiCredentials.create({
				defaultModelId: 'gpt-5.4-mini',
				provider: 'OPENAI',
				secret: SECRET_A
			})
		).rejects.toThrow(/delimiter/i);
	});
});
