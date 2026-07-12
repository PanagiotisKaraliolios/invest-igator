import { describe, expect, test } from 'bun:test';
import { PERMISSION_SCOPES, PERMISSION_TEMPLATES, validatePermissionStructure } from './api-key-permissions';

describe('PERMISSION_SCOPES.ai', () => {
	test('exposes the ai capability scope with a single "use" action', () => {
		expect(PERMISSION_SCOPES.ai.actions).toEqual(['use']);
	});

	test('accepts { ai: ["use"] } as a valid permission structure', () => {
		expect(validatePermissionStructure({ ai: ['use'] })).toBe(true);
	});

	test('rejects actions the ai scope does not define', () => {
		expect(validatePermissionStructure({ ai: ['read'] })).toBe(false);
		expect(validatePermissionStructure({ ai: ['write'] })).toBe(false);
	});

	test('ai is a capability, not a resource — it grants no data access on its own', () => {
		// Task 10's `Scope` type is resource:action over
		// portfolio|transactions|watchlist|goals|fx. `ai` is deliberately not in it.
		const resourceScopes = ['portfolio', 'transactions', 'watchlist', 'goals', 'fx'];
		expect(resourceScopes).not.toContain('ai');
		expect(validatePermissionStructure({ ai: ['use'], portfolio: ['read'] })).toBe(true);
	});
});

describe('PERMISSION_TEMPLATES', () => {
	// This is the money test. Spending platform LLM quota must never be a side effect of
	// picking a convenient template — it is an explicit, deliberate grant.
	test('no template grants ai — spending money is always an explicit opt-in', () => {
		for (const [name, template] of Object.entries(PERMISSION_TEMPLATES)) {
			const permissions = template.permissions as Record<string, readonly string[]>;
			expect(`${name}:${'ai' in permissions}`).toBe(`${name}:false`);
		}
	});

	test('full-access specifically does not grant ai', () => {
		expect(Object.keys(PERMISSION_TEMPLATES['full-access'].permissions)).not.toContain('ai');
	});
});
