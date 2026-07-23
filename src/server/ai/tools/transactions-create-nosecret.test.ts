import { describe, expect, mock, test } from 'bun:test';

mock.module('@/env', () => ({ env: { AI_MUTATION_SECRET: undefined } }));
mock.module('@/server/yahoo-search', () => ({
	searchYahooSymbols: async () => [],
	symbolExistsOnYahoo: async () => 'yes'
}));
mock.module('@/server/jobs/yahoo-lib', () => ({
	fetchYahooDaily: async () => ({ bars: [], currency: 'USD', status: 'ok' })
}));
mock.module('@/server/db', () => ({ db: { user: { findUnique: async () => ({ currency: 'USD' }) } } }));
const { transactionsCreateTool } = await import('./transactions-create');

describe('transactions.create without a configured secret', () => {
	test('returns the error branch (fails closed, no token)', async () => {
		const out = await transactionsCreateTool.execute(
			{ date: '2026-01-02', price: 1, quantity: 1, side: 'BUY', symbol: 'AAPL' },
			{ currency: 'USD', scopes: new Set(['transactions:write']), surface: 'chat', userId: 'u1' } as never
		);
		expect(out.requiresConfirmation).toBe(false);
	});
});
