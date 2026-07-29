import { beforeEach, describe, expect, mock, test } from 'bun:test';
import { randomUUID } from 'node:crypto';
import type { ListModelsResult } from '@/server/ai/list-models';
import type { createTRPCContext } from '@/server/api/trpc';

/**
 * Same rationale as `ai-credentials.test.ts` (read there first): a real Prisma client is not
 * usable under `bun test --isolate src` (Tier 0 — no Postgres in CI's `unit` job), so `@/server/db`
 * is mocked with a small in-memory store. This file reuses that file's `callerFor` harness and its
 * `@/server/db` / `@/server/ai/probe` / `@/server/ai/crypto` mocking style verbatim: `@/server/db`
 * is fully replaced (not spread) with an in-memory store, `@/server/ai/probe` is spread from the
 * real module with only `probeCredential` overridden, and `@/server/ai/crypto` is NOT mocked at
 * all — `seal`/`open` run for real, so a row sealed by `seal()` in `seedCredential` below is
 * decrypted by the router's real `open()` call. `@/server/ai/list-models` is mocked the same
 * spread-and-override way as `@/server/ai/probe`, since `listStoredModels`/`updateModels` reach it
 * and a real network call must never happen in a unit test.
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
	enabledModelIds: string[];
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
const findFirstArgs: Array<{ where?: Record<string, unknown> }> = [];
const updateArgs: Array<{ data: Partial<Row>; where: { id: string } }> = [];

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
		enabledModelIds: [],
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
			create: async ({ data }: { data: Partial<Row> }) => {
				const row = { ...defaultRow(), ...data } as Row;
				rows.push(row);
				return row;
			},
			findFirst: async (args: { where?: Record<string, unknown> } = {}) => {
				findFirstArgs.push(args);
				return rows.find((row) => matchesWhere(row, args.where)) ?? null;
			},
			update: async ({ data, where }: { data: Partial<Row>; where: { id: string } }) => {
				updateArgs.push({ data, where });
				const row = rows.find((candidate) => candidate.id === where.id);
				if (!row) throw new Error('row not found');
				Object.assign(row, data);
				return row;
			}
		}
	}
}));

let probeResult: { error?: string; ok: boolean } = { ok: true };
let probeCalls = 0;
const actualProbe = await import('@/server/ai/probe');
mock.module('@/server/ai/probe', () => ({
	...actualProbe,
	probeCredential: async () => {
		probeCalls += 1;
		return probeResult;
	}
}));

let listModelsResult: ListModelsResult = { models: ['gpt-5.4-mini', 'gpt-5.4'], supported: true };
const listProviderModelsArgs: unknown[] = [];
const actualListModels = await import('@/server/ai/list-models');
mock.module('@/server/ai/list-models', () => ({
	...actualListModels,
	listProviderModels: async (params: unknown) => {
		listProviderModelsArgs.push(params);
		return listModelsResult;
	}
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
			enabledModelIds: ['gpt-5.4-mini'],
			iv: blob.iv,
			kid: blob.kid,
			provider: 'OPENAI',
			userId
		}
	});
}

describe('aiCredentials.updateModels / listStoredModels — editing without re-entering the key', () => {
	let userA = '';

	beforeEach(() => {
		process.env.AI_CRED_KEYS = JSON.stringify({ k1: KEY });
		process.env.AI_CRED_ACTIVE_KID = 'k1';
		rows = [];
		findFirstArgs.length = 0;
		updateArgs.length = 0;
		listProviderModelsArgs.length = 0;
		probeResult = { ok: true };
		probeCalls = 0;
		listModelsResult = { models: ['gpt-5.4-mini', 'gpt-5.4'], supported: true };
		userA = `cred-a-${randomUUID()}`;
	});

	// Case 1: zod's superRefine must fire before any DB or provider call — an invalid
	// combination is a client-side form error, not a wasted round trip.
	test('updateModels rejects when defaultModelId is not a member of enabledModelIds, before any DB or provider call', async () => {
		await expect(
			callerFor(userA).aiCredentials.updateModels({
				defaultModelId: 'gpt-5.4',
				enabledModelIds: ['gpt-5.4-mini'],
				provider: 'OPENAI'
			})
		).rejects.toThrow(/primary model must be one of the enabled models/i);
		expect(findFirstArgs).toHaveLength(0);
		expect(probeCalls).toBe(0);
	});

	// Case 2: no row for this (userId, provider) at all.
	test('updateModels rejects with NOT_FOUND when the user has no credential for that provider', async () => {
		await expect(
			callerFor(userA).aiCredentials.updateModels({
				defaultModelId: 'gpt-5.4-mini',
				enabledModelIds: ['gpt-5.4-mini'],
				provider: 'OPENAI'
			})
		).rejects.toThrow(/no saved key/i);
	});

	// Case 3: exactly one probe call regardless of how many models are being enabled, and the
	// persisted `update()` args carry the new set.
	test('updateModels probes exactly once and persists enabledModelIds + defaultModelId on success', async () => {
		const row = await seedCredential(userA, SECRET_A);

		const result = await callerFor(userA).aiCredentials.updateModels({
			defaultModelId: 'gpt-5.4',
			enabledModelIds: ['gpt-5.4-mini', 'gpt-5.4', 'gpt-5.4-nano', 'gpt-5.4-turbo'],
			provider: 'OPENAI'
		});

		// Regardless of 4 models being enabled, only the NEW primary was probed once.
		expect(probeCalls).toBe(1);

		expect(updateArgs).toHaveLength(1);
		expect(updateArgs[0]?.where).toEqual({ id: row.id });
		expect(updateArgs[0]?.data).toMatchObject({
			defaultModelId: 'gpt-5.4',
			enabledModelIds: ['gpt-5.4-mini', 'gpt-5.4', 'gpt-5.4-nano', 'gpt-5.4-turbo']
		});

		expect(result.defaultModelId).toBe('gpt-5.4');
		expect(result.enabledModelIds).toEqual(['gpt-5.4-mini', 'gpt-5.4', 'gpt-5.4-nano', 'gpt-5.4-turbo']);
	});

	// Case 4: a rejected probe must not write anything, and the surfaced message is the
	// (already-redacted, per `probeCredential`'s own contract) probe error text.
	test('updateModels does not persist when the probe fails, and surfaces the redacted probe error', async () => {
		await seedCredential(userA, SECRET_A);
		probeResult = { error: 'AuthenticationError: 401 invalid api key', ok: false };

		await expect(
			callerFor(userA).aiCredentials.updateModels({
				defaultModelId: 'gpt-5.4',
				enabledModelIds: ['gpt-5.4-mini', 'gpt-5.4'],
				provider: 'OPENAI'
			})
		).rejects.toThrow(/rejected this model.*AuthenticationError: 401 invalid api key/i);

		expect(updateArgs).toHaveLength(0);
	});

	// Case 5: the browser has no secret for an existing credential to send. `storedProviderInput`
	// only has a `provider` field, so the call succeeds with just `{ provider }`; and even if a
	// `secret` were smuggled onto the input, the router never uses it — `listProviderModels` is
	// always called with the STORED, decrypted secret, proving the client-sent value (if any) is
	// never the one that reaches the provider.
	test('listStoredModels returns the provider models and never receives a secret from the input', async () => {
		await seedCredential(userA, SECRET_A);

		const result = await callerFor(userA).aiCredentials.listStoredModels({ provider: 'OPENAI' });
		expect(result).toEqual({ models: ['gpt-5.4-mini', 'gpt-5.4'], supported: true });

		const call = listProviderModelsArgs.at(-1) as { secret?: string } | undefined;
		expect(call?.secret).toBe(SECRET_A);

		// Even a client that smuggles a bogus `secret` onto the input never gets it used: zod
		// strips it (the schema has no such field), and the real, stored key is used instead.
		listProviderModelsArgs.length = 0;
		await callerFor(userA).aiCredentials.listStoredModels({
			provider: 'OPENAI',
			secret: 'sk-attacker-supplied-should-be-ignored'
		} as never);
		const smuggled = listProviderModelsArgs.at(-1) as { secret?: string } | undefined;
		expect(smuggled?.secret).toBe(SECRET_A);
	});

	// Case 6: the credential lookup is scoped by userId — a provider the caller does not own
	// (or another tenant's row for the SAME provider) is a NOT_FOUND, never that tenant's row.
	test('the credential lookup is scoped by userId', async () => {
		await seedCredential(userA, SECRET_A);

		await callerFor(userA).aiCredentials.listStoredModels({ provider: 'OPENAI' });

		expect(findFirstArgs.at(-1)).toEqual({ where: { enabled: true, provider: 'OPENAI', userId: userA } });

		const userB = `cred-b-${randomUUID()}`;
		await expect(callerFor(userB).aiCredentials.listStoredModels({ provider: 'OPENAI' })).rejects.toThrow(
			/no saved key/i
		);
	});
});
