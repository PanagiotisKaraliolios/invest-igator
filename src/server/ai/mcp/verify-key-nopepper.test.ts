import { describe, expect, mock, test } from 'bun:test';

mock.module('@/env', () => ({ env: { AI_API_KEY_PEPPER: undefined } }));
mock.module('@/server/db', () => ({
	db: { apiKey: { findMany: async () => [], findUnique: async () => null, update: async () => null } }
}));
mock.module('bcryptjs', () => ({ default: { compareSync: () => false } }));

const { verifyMcpKey } = await import('./verify-key');

describe('verifyMcpKey without a configured pepper', () => {
	test('cannot authenticate anyone → null', async () => {
		expect(await verifyMcpKey('any-token')).toBeNull();
	});
});
