import { describe, expect, test } from 'bun:test';
import { permissionsToScopes } from './verify-key';

describe('permissionsToScopes', () => {
	test('maps a read action on a tool resource to `${resource}:read`', () => {
		const scopes = permissionsToScopes(JSON.stringify({ portfolio: ['read'], fx: ['read'] }));
		expect([...scopes].sort()).toEqual(['fx:read', 'portfolio:read']);
	});

	test('ignores write actions (Phase 2 is read-only)', () => {
		const scopes = permissionsToScopes(JSON.stringify({ portfolio: ['read', 'write'], transactions: ['write'] }));
		expect([...scopes]).toEqual(['portfolio:read']);
	});

	test('ignores non-tool resources (account/admin/ai/apiKeys)', () => {
		const scopes = permissionsToScopes(JSON.stringify({ ai: ['use'], admin: ['read'], account: ['read'] }));
		expect(scopes.size).toBe(0);
	});

	test('null, empty, and malformed permissions yield an empty set (fail closed)', () => {
		expect(permissionsToScopes(null).size).toBe(0);
		expect(permissionsToScopes('').size).toBe(0);
		expect(permissionsToScopes('{not json').size).toBe(0);
		expect(permissionsToScopes(JSON.stringify(['portfolio'])).size).toBe(0);
	});

	test('a full read-only key yields exactly the five read scopes', () => {
		const scopes = permissionsToScopes(
			JSON.stringify({ portfolio: ['read'], transactions: ['read'], watchlist: ['read'], goals: ['read'], fx: ['read'] })
		);
		expect([...scopes].sort()).toEqual(['fx:read', 'goals:read', 'portfolio:read', 'transactions:read', 'watchlist:read']);
	});
});

import { beforeEach, describe as describe2, expect as expect2, mock, test as test2 } from 'bun:test';
import { createHmac } from 'node:crypto';

const PEPPER = 'x'.repeat(32);
function hmacOf(token: string): string {
	return createHmac('sha256', PEPPER).update(token).digest('hex');
}

type Row = {
	id: string;
	key: string;
	keyHmac: string | null;
	start: string | null;
	enabled: boolean;
	expiresAt: Date | null;
	permissions: string | null;
	userId: string;
};

let rows: Row[] = [];
const updates: Array<{ id: string; keyHmac: string }> = [];

mock.module('@/env', () => ({ env: { AI_API_KEY_PEPPER: PEPPER } }));
mock.module('@/server/db', () => ({
	db: {
		apiKey: {
			findUnique: async ({ where }: { where: { keyHmac: string } }) =>
				rows.find((r) => r.keyHmac === where.keyHmac) ?? null,
			findMany: async ({ where }: { where: { keyHmac: null; start: string } }) =>
				rows.filter((r) => r.keyHmac === null && r.start === where.start),
			update: async ({ where, data }: { where: { id: string }; data: { keyHmac: string } }) => {
				updates.push({ id: where.id, keyHmac: data.keyHmac });
				const r = rows.find((x) => x.id === where.id);
				if (r) r.keyHmac = data.keyHmac;
				return r;
			}
		}
	}
}));

// bcryptjs is used for the legacy fallback; stub compareSync so "raw==='secret'+id" matches its hash.
mock.module('bcryptjs', () => ({
	default: { compareSync: (raw: string, hash: string) => hash === `bcrypt:${raw}` }
}));

const { verifyMcpKey: verify } = await import('./verify-key');

function baseRow(over: Partial<Row> = {}): Row {
	return {
		id: 'k1',
		key: 'bcrypt:secret-token',
		keyHmac: hmacOf('secret-token'),
		start: 'secret',
		enabled: true,
		expiresAt: null,
		permissions: JSON.stringify({ portfolio: ['read'] }),
		userId: 'owner-1',
		...over
	};
}

describe2('verifyMcpKey', () => {
	beforeEach(() => {
		rows = [];
		updates.length = 0;
	});

	test2('fast path: valid hmac hit returns owner + mapped scopes', async () => {
		rows = [baseRow()];
		const res = await verify('secret-token');
		expect2(res).not.toBeNull();
		expect2(res?.userId).toBe('owner-1');
		expect2([...(res?.scopes ?? [])]).toEqual(['portfolio:read']);
		expect2(updates).toHaveLength(0); // no backfill needed
	});

	test2('rejects a disabled key', async () => {
		rows = [baseRow({ enabled: false })];
		expect2(await verify('secret-token')).toBeNull();
	});

	test2('rejects an expired key', async () => {
		rows = [baseRow({ expiresAt: new Date(Date.now() - 1000) })];
		expect2(await verify('secret-token')).toBeNull();
	});

	test2('unknown token returns null', async () => {
		rows = [baseRow()];
		expect2(await verify('not-the-token')).toBeNull();
	});

	test2('legacy fallback: keyHmac=null key matches by start-bucket + bcrypt and is backfilled', async () => {
		rows = [baseRow({ keyHmac: null })];
		const res = await verify('secret-token');
		expect2(res?.userId).toBe('owner-1');
		expect2(updates).toEqual([{ id: 'k1', keyHmac: hmacOf('secret-token') }]); // lazily backfilled
	});

	test2('empty bearer returns null', async () => {
		expect2(await verify('   ')).toBeNull();
	});
});
