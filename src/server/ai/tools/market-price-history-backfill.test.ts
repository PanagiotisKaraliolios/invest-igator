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

const { BACKFILL_WAIT_MS, marketPriceHistoryTool } = await import('./market-price-history');

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
		ingestYahooSymbol.mockResolvedValue({} as never);

		const out = await marketPriceHistoryTool.execute({ days: 90, field: 'close', symbol: 'VUAA.L' }, CTX);

		expect(ingestYahooSymbol).toHaveBeenCalledTimes(1);
		expect(out.points).toEqual(POINTS);
		expect(out.fetched).toBe(true);
	});

	test('normalizes the symbol ONCE and reuses it for every downstream call — a lowercase input must not ingest under a different key than every read looks for', async () => {
		getPriceHistory.mockResolvedValueOnce([]).mockResolvedValueOnce(POINTS);
		symbolHasAnyData.mockResolvedValue(false);
		symbolExistsOnYahoo.mockResolvedValue('yes');
		ingestYahooSymbol.mockResolvedValue({} as never);

		const out = await marketPriceHistoryTool.execute({ days: 90, field: 'close', symbol: 'vuaa.l' }, CTX);

		// Every downstream call must see the SAME normalized form as the model's raw ('vuaa.l')
		// input — a mismatch here is exactly how the backfill used to ingest under 'vuaa.l' while
		// every read looked for 'VUAA.L', poisoning Influx with an orphan series nothing reads
		// and making gate 1 (`symbolHasAnyData`) never come true.
		expect(getPriceHistory).toHaveBeenNthCalledWith(1, 'VUAA.L', 90, 'close');
		expect(symbolHasAnyData).toHaveBeenCalledWith('VUAA.L');
		expect(symbolExistsOnYahoo).toHaveBeenCalledWith('VUAA.L');
		expect(ingestYahooSymbol).toHaveBeenCalledWith('VUAA.L');
		expect(getPriceHistory).toHaveBeenNthCalledWith(2, 'VUAA.L', 90, 'close');
		expect(out.symbol).toBe('VUAA.L');
		expect(out.points).toEqual(POINTS);
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

	test(
		'bounds the wait for a hung ingest — returns within BACKFILL_WAIT_MS with empty points and does not throw',
		async () => {
			getPriceHistory.mockResolvedValue([]);
			symbolHasAnyData.mockResolvedValue(false);
			symbolExistsOnYahoo.mockResolvedValue('yes');
			// Simulates a hung Yahoo connection: a promise that never settles.
			ingestYahooSymbol.mockImplementationOnce(() => new Promise(() => {}));

			const startedAt = performance.now();
			const out = await marketPriceHistoryTool.execute({ days: 90, field: 'close', symbol: 'TMOUT.L' }, CTX);
			const elapsedMs = performance.now() - startedAt;

			// Generous slack over the real constant for scheduler jitter — this must never approach
			// the turn's 8-tool-step budget (8 * BACKFILL_WAIT_MS = 40s, under the route's 60s cap).
			expect(elapsedMs).toBeLessThan(BACKFILL_WAIT_MS + 1_500);
			expect(out.points).toEqual([]);
			// The ingest is still running in the background and will still land in Influx — so the
			// model is told a fetch happened rather than "this instrument has no prices".
			expect(out.fetched).toBe(true);
		},
		BACKFILL_WAIT_MS + 5_000 // headroom over bun's own 5s default test timeout
	);

	test('negative-caches a symbol whose backfill produced nothing, so a second call does not re-invoke ingestYahooSymbol', async () => {
		// Yahoo SEARCH knows the symbol (symbolExistsOnYahoo -> 'yes') but Yahoo CHART never
		// serves any bars for it (getPriceHistory stays empty even after a successful ingest) —
		// the exact scenario the negative cache exists to stop from being retried every turn.
		getPriceHistory.mockResolvedValue([]);
		symbolHasAnyData.mockResolvedValue(false);
		symbolExistsOnYahoo.mockResolvedValue('yes');
		ingestYahooSymbol.mockResolvedValue({} as never);

		const first = await marketPriceHistoryTool.execute({ days: 90, field: 'close', symbol: 'DEDUPE.L' }, CTX);
		expect(ingestYahooSymbol).toHaveBeenCalledTimes(1);
		expect(symbolExistsOnYahoo).toHaveBeenCalledTimes(1);
		expect(first.points).toEqual([]);

		const second = await marketPriceHistoryTool.execute({ days: 90, field: 'close', symbol: 'DEDUPE.L' }, CTX);
		// Negative cache short-circuits BEFORE symbolHasAnyData/symbolExistsOnYahoo/ingestYahooSymbol.
		expect(ingestYahooSymbol).toHaveBeenCalledTimes(1);
		expect(symbolExistsOnYahoo).toHaveBeenCalledTimes(1);
		expect(symbolHasAnyData).toHaveBeenCalledTimes(1);
		expect(second.points).toEqual([]);
	});
});
