import { describe, expect, mock, test } from 'bun:test';
import { verifyMutation } from '../mutations/token';

const SECRET = 'x'.repeat(32);
mock.module('@/env', () => ({ env: { AI_MUTATION_SECRET: SECRET } }));

let existence: 'yes' | 'no' | 'unreachable' = 'yes';
let searchResults: Array<{ symbol: string; description: string }> = [];
let dailyCurrency: string | undefined = 'USD';
mock.module('@/server/yahoo-search', () => ({
	searchYahooSymbols: async () => searchResults,
	symbolExistsOnYahoo: async () => existence
}));
mock.module('@/server/jobs/yahoo-lib', () => ({
	fetchYahooDaily: async () => ({ bars: [], currency: dailyCurrency, status: 'ok' })
}));
mock.module('@/server/db', () => ({ db: { user: { findUnique: async () => ({ currency: 'EUR' }) } } }));

const { transactionsCreateTool } = await import('./transactions-create');

const ctx = { currency: 'EUR', scopes: new Set(['transactions:write']), surface: 'chat', userId: 'u1' } as never;

describe('transactions.create tool', () => {
	test('is a mutating write tool with a preview and the write scope', () => {
		expect(transactionsCreateTool.name).toBe('transactions.create');
		expect(transactionsCreateTool.mutates).toBe(true);
		expect(transactionsCreateTool.requiredScope).toBe('transactions:write');
		expect(transactionsCreateTool.annotations.readOnlyHint).toBe(false);
		expect(typeof transactionsCreateTool.preview).toBe('function');
	});

	test('resolves a known symbol, signs a valid token, and writes NOTHING', async () => {
		existence = 'yes';
		dailyCurrency = 'USD';
		const out = await transactionsCreateTool.execute(
			{ date: '2026-01-02', price: 150, quantity: 10, side: 'BUY', symbol: 'AAPL' },
			ctx
		);
		expect(out.requiresConfirmation).toBe(true);
		if (!out.requiresConfirmation) throw new Error('expected confirm branch');
		expect(out.proposed).toMatchObject({
			date: '2026-01-02',
			price: 150,
			priceCurrency: 'USD',
			quantity: 10,
			side: 'BUY',
			symbol: 'AAPL'
		});
		const v = verifyMutation(out.confirmationToken, SECRET, Math.floor(Date.parse('2026-01-02') / 1000));
		expect(v.ok).toBe(true);
		if (v.ok) expect((v.payload.args as { symbol: string }).symbol).toBe('AAPL');
		expect(out.preview).toContain('AAPL');
	});

	test('falls back to the user default currency when the listing currency is unsupported', async () => {
		existence = 'yes';
		dailyCurrency = 'ZWL'; // not in SUPPORTED_CURRENCIES
		const out = await transactionsCreateTool.execute(
			{ date: '2026-01-02', price: 1, quantity: 1, side: 'BUY', symbol: 'AAPL' },
			ctx
		);
		if (!out.requiresConfirmation) throw new Error('expected confirm branch');
		expect(out.proposed.priceCurrency).toBe('EUR'); // user default from the db mock
	});

	test('resolves a company name via search when the raw symbol is unknown', async () => {
		existence = 'no';
		searchResults = [{ description: 'Apple Inc.', symbol: 'AAPL' }];
		dailyCurrency = 'USD';
		const out = await transactionsCreateTool.execute(
			{ date: '2026-01-02', price: 1, quantity: 1, side: 'BUY', symbol: 'Apple' },
			ctx
		);
		if (!out.requiresConfirmation) throw new Error('expected confirm branch');
		expect(out.proposed.symbol).toBe('AAPL');
		expect(out.description).toBe('Apple Inc.');
	});

	test('returns the error branch for an unresolvable symbol', async () => {
		existence = 'no';
		searchResults = [];
		const out = await transactionsCreateTool.execute(
			{ date: '2026-01-02', price: 1, quantity: 1, side: 'BUY', symbol: 'Zzz' },
			ctx
		);
		expect(out.requiresConfirmation).toBe(false);
		if (out.requiresConfirmation) throw new Error('expected error branch');
		expect(out.error.length).toBeGreaterThan(0);
	});
});
