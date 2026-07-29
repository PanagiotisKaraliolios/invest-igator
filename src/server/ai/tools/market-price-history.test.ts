import { describe, expect, mock, test } from 'bun:test';

let behavior: 'ok' | 'throw' = 'ok';
mock.module('@/server/services/market', () => ({
	getPriceHistory: async () => {
		if (behavior === 'throw') throw new Error('ECONNREFUSED');
		return [{ date: '2026-01-01', value: 10 }];
	}
}));

const { marketPriceHistoryTool } = await import('./market-price-history');
const ctx = { currency: 'USD', scopes: new Set(['watchlist:read']), surface: 'chat', userId: 'u1' } as never;

describe('market.priceHistory tool — graceful degradation', () => {
	test('a data-source failure returns an empty series instead of throwing (chat turn survives)', async () => {
		behavior = 'throw';
		const out = await marketPriceHistoryTool.execute({ days: 90, field: 'close', symbol: 'SPCX' }, ctx);
		expect(out).toEqual({ fetched: false, field: 'close', points: [], symbol: 'SPCX', truncated: false });
	});

	test('a healthy data source still returns its points', async () => {
		behavior = 'ok';
		const out = await marketPriceHistoryTool.execute({ days: 90, field: 'close', symbol: 'AAPL' }, ctx);
		expect(out.points).toEqual([{ date: '2026-01-01', value: 10 }]);
		expect(out.truncated).toBe(false);
	});
});
