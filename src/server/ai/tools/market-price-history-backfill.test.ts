import { beforeEach, describe, expect, mock, test } from 'bun:test';

const getPriceHistory = mock(
	async (_s: string, _d: number, _f: string) => [] as Array<{ date: string; value: number }>
);
const symbolHasAnyData = mock(async (_s: string) => false);
const symbolExistsOnYahoo = mock(async (_s: string) => 'no' as 'yes' | 'no' | 'unreachable');
const ingestYahooSymbol = mock(async (_s: string) => ({}) as never);

mock.module('@/server/services/market', () => ({ getPriceHistory }));
mock.module('@/server/influx', () => ({ symbolHasAnyData }));
mock.module('@/server/yahoo-search', () => ({ symbolExistsOnYahoo }));
mock.module('@/server/jobs/yahoo-lib', () => ({ ingestYahooSymbol }));

const { marketPriceHistoryTool } = await import('./market-price-history');

const CTX = {} as never;
const POINTS = [{ date: '2026-07-24', value: 115.07 }];

beforeEach(() => {
	getPriceHistory.mockReset();
	symbolHasAnyData.mockReset();
	symbolExistsOnYahoo.mockReset();
	ingestYahooSymbol.mockReset();
});

describe('market.priceHistory on-demand backfill', () => {
	test('does not fetch when the symbol already has data', async () => {
		getPriceHistory.mockResolvedValue(POINTS);

		const out = await marketPriceHistoryTool.execute({ days: 90, field: 'close', symbol: 'AAPL' }, CTX);

		expect(out.points).toEqual(POINTS);
		expect(out.fetched).toBe(false);
		expect(ingestYahooSymbol).not.toHaveBeenCalled();
	});

	test('fetches, then re-queries, when the symbol is unknown but exists on Yahoo', async () => {
		getPriceHistory.mockResolvedValueOnce([]).mockResolvedValueOnce(POINTS);
		symbolHasAnyData.mockResolvedValue(false);
		symbolExistsOnYahoo.mockResolvedValue('yes');

		const out = await marketPriceHistoryTool.execute({ days: 90, field: 'close', symbol: 'VUAA.L' }, CTX);

		expect(ingestYahooSymbol).toHaveBeenCalledTimes(1);
		expect(out.points).toEqual(POINTS);
		expect(out.fetched).toBe(true);
	});

	test('does NOT fetch a symbol Yahoo does not know', async () => {
		getPriceHistory.mockResolvedValue([]);
		symbolHasAnyData.mockResolvedValue(false);
		symbolExistsOnYahoo.mockResolvedValue('no');

		const out = await marketPriceHistoryTool.execute({ days: 90, field: 'close', symbol: 'NOPE' }, CTX);

		expect(ingestYahooSymbol).not.toHaveBeenCalled();
		expect(out.points).toEqual([]);
		expect(out.fetched).toBe(false);
	});

	test('does NOT fetch when the symbol is already stored but the window is empty', async () => {
		// A delisted/stale symbol legitimately has no points in the trailing window — refetching
		// it on every turn would hammer Yahoo for nothing.
		getPriceHistory.mockResolvedValue([]);
		symbolHasAnyData.mockResolvedValue(true);

		await marketPriceHistoryTool.execute({ days: 90, field: 'close', symbol: 'OLD' }, CTX);

		expect(symbolExistsOnYahoo).not.toHaveBeenCalled();
		expect(ingestYahooSymbol).not.toHaveBeenCalled();
	});

	test('a failing backfill degrades to an empty series instead of throwing', async () => {
		getPriceHistory.mockResolvedValue([]);
		symbolHasAnyData.mockResolvedValue(false);
		symbolExistsOnYahoo.mockResolvedValue('yes');
		ingestYahooSymbol.mockImplementationOnce(async () => {
			throw new Error('ingest exploded');
		});

		const out = await marketPriceHistoryTool.execute({ days: 90, field: 'close', symbol: 'VUAA.L' }, CTX);

		expect(out.points).toEqual([]);
		expect(out.fetched).toBe(false);
	});
});
