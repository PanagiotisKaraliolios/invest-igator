import { describe, expect, test } from 'bun:test';
import type { Currency } from '@/lib/currency';
import type { FxMatrix } from '@/server/fx';
import { buildFullSeries } from './portfolio-compute';

// Local-midnight date for a calendar day so toLocalIsoDate() keys line up with the
// price/fx maps built with the same 'yyyy-mm-dd' strings.
const day = (y: number, m: number, d: number) => new Date(y, m - 1, d);

const tx = (over: Partial<Parameters<typeof buildFullSeries>[0]['txs'][number]>) => ({
	date: day(2024, 1, 1),
	fee: null,
	feeCurrency: null,
	price: 100,
	priceCurrency: 'USD' as string | null,
	quantity: 10,
	side: 'BUY',
	symbol: 'AAPL',
	...over
});

const emptyFx = new Map<string, FxMatrix>(); // USD->USD is identity, needs no matrix

describe('buildFullSeries', () => {
	test('chain-links TWR/MWR over a simple price appreciation', () => {
		const { full, unconvertedSymbols } = buildFullSeries({
			fxByDate: emptyFx,
			inceptionDate: day(2024, 1, 1),
			latestTxCurrencyBySymbol: new Map([['AAPL', { currency: 'USD' as Currency, date: day(2024, 1, 1) }]]),
			priceBySymbolDate: new Map([
				[
					'AAPL',
					new Map([
						['2024-01-01', 100],
						['2024-01-02', 110],
						['2024-01-03', 121]
					])
				]
			]),
			symbolCurrencies: new Map([['AAPL', 'USD']]),
			target: 'USD' as Currency,
			toDate: day(2024, 1, 3),
			txs: [tx({})]
		});

		expect(unconvertedSymbols).toEqual([]);
		expect(full.map((p) => p.date)).toEqual(['2024-01-01', '2024-01-02', '2024-01-03']);
		expect(full.map((p) => p.nav)).toEqual([1000, 1100, 1210]);
		expect(full[0]!.twrIndex).toBeCloseTo(100, 6);
		expect(full[1]!.twrIndex).toBeCloseTo(110, 6);
		expect(full[2]!.twrIndex).toBeCloseTo(121, 6);
		// MWR tracks TWR when there are no interim cash flows
		expect(full[2]!.mwrIndex).toBeCloseTo(121, 6);
	});

	test('a pure contribution with no price move yields 0% (TWR excludes flows)', () => {
		const { full } = buildFullSeries({
			fxByDate: emptyFx,
			inceptionDate: day(2024, 1, 1),
			latestTxCurrencyBySymbol: new Map([['AAPL', { currency: 'USD' as Currency, date: day(2024, 1, 1) }]]),
			priceBySymbolDate: new Map([
				[
					'AAPL',
					new Map([
						['2024-01-01', 100],
						['2024-01-02', 100],
						['2024-01-03', 110]
					])
				]
			]),
			symbolCurrencies: new Map([['AAPL', 'USD']]),
			target: 'USD' as Currency,
			toDate: day(2024, 1, 3),
			txs: [tx({}), tx({ date: day(2024, 1, 2) })] // second BUY 10 @ 100 on day 2
		});

		expect(full.map((p) => p.nav)).toEqual([1000, 2000, 2200]);
		// Day 2: +$1000 in, price flat → 0% return, index unchanged
		expect(full[1]!.twrIndex).toBeCloseTo(100, 6);
		expect(full[1]!.mwrIndex).toBeCloseTo(100, 6);
		// Day 3: +10% price move on 20 shares
		expect(full[2]!.twrIndex).toBeCloseTo(110, 6);
	});

	test('flags symbols with a missing FX rate instead of throwing', () => {
		const { full, unconvertedSymbols } = buildFullSeries({
			fxByDate: emptyFx, // no EUR legs anywhere → EUR->USD is unconvertible
			inceptionDate: day(2024, 1, 1),
			latestTxCurrencyBySymbol: new Map([['SAP.DE', { currency: 'EUR' as Currency, date: day(2024, 1, 1) }]]),
			priceBySymbolDate: new Map([['SAP.DE', new Map([['2024-01-01', 100]])]]),
			symbolCurrencies: new Map([['SAP.DE', 'EUR']]),
			target: 'USD' as Currency,
			toDate: day(2024, 1, 1),
			txs: [tx({ priceCurrency: 'EUR', symbol: 'SAP.DE' })]
		});

		expect(unconvertedSymbols).toContain('SAP.DE');
		// Unconvertible position contributes 0 to NAV rather than crashing
		expect(full[0]!.nav).toBe(0);
	});

	test('returns an empty series when there are no dates', () => {
		const { full, unconvertedSymbols } = buildFullSeries({
			fxByDate: emptyFx,
			inceptionDate: day(2024, 1, 2),
			latestTxCurrencyBySymbol: new Map(),
			priceBySymbolDate: new Map(),
			symbolCurrencies: new Map(),
			target: 'USD' as Currency,
			toDate: day(2024, 1, 1), // toDate < inception → no days
			txs: []
		});
		expect(full).toEqual([]);
		expect(unconvertedSymbols).toEqual([]);
	});
});
