import { describe, expect, mock, test } from 'bun:test';

const searchYahooSymbols = mock(async (_q: string) => [] as Array<Record<string, string>>);
mock.module('@/server/yahoo-search', () => ({ searchYahooSymbols }));

const { symbolSearchTool } = await import('./symbol-search');

const CTX = {} as never;

describe('symbol.search', () => {
	test('maps Yahoo results to candidates', async () => {
		searchYahooSymbols.mockResolvedValueOnce([
			{ description: 'Vanguard S&P 500 UCITS ETF', exchange: 'London', symbol: 'VUAA.L', type: 'ETF' },
			{ description: 'Vanguard S&P 500 UCITS ETF USD Acc', exchange: 'XETRA', symbol: 'VUAA.DE', type: 'ETF' }
		]);

		const out = await symbolSearchTool.execute({ query: 'VUAA' }, CTX);

		expect(out.query).toBe('VUAA');
		expect(out.candidates).toEqual([
			{ exchange: 'London', name: 'Vanguard S&P 500 UCITS ETF', symbol: 'VUAA.L', type: 'ETF' },
			{ exchange: 'XETRA', name: 'Vanguard S&P 500 UCITS ETF USD Acc', symbol: 'VUAA.DE', type: 'ETF' }
		]);
	});

	test('caps the candidate list', async () => {
		searchYahooSymbols.mockResolvedValueOnce(
			Array.from({ length: 25 }, (_, i) => ({
				description: `Name ${i}`,
				exchange: 'X',
				symbol: `SYM${i}`,
				type: 'EQUITY'
			}))
		);

		const out = await symbolSearchTool.execute({ query: 'many' }, CTX);

		expect(out.candidates.length).toBeLessThanOrEqual(8);
		expect(out.truncated).toBe(true);
	});

	test('an empty result is not an error', async () => {
		searchYahooSymbols.mockResolvedValueOnce([]);
		const out = await symbolSearchTool.execute({ query: 'zzzz' }, CTX);
		expect(out.candidates).toEqual([]);
		expect(out.truncated).toBe(false);
	});

	test('a provider failure degrades to no candidates rather than throwing', async () => {
		searchYahooSymbols.mockImplementationOnce(async () => {
			throw new Error('yahoo down');
		});
		const out = await symbolSearchTool.execute({ query: 'VUAA' }, CTX);
		expect(out.candidates).toEqual([]);
	});

	test('is read-only and shares the watchlist scope', () => {
		expect(symbolSearchTool.mutates).toBe(false);
		expect(symbolSearchTool.requiredScope).toBe('watchlist:read');
		expect(symbolSearchTool.name).toBe('symbol.search');
		expect(symbolSearchTool.name).not.toContain('_');
	});
});
