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
