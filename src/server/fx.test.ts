import { describe, expect, test } from 'bun:test';
import {
	assembleFxByDate,
	buildFxMatrixFromUsdLegs,
	convertAmount,
	type FxMatrix,
	forwardFill,
	MissingFxRateError
} from './fx';

const m: FxMatrix = {
	EUR: { EUR: 1, USD: 1 / 0.9 },
	USD: { EUR: 0.9, USD: 1 }
};

describe('convertAmount', () => {
	test('identity when from === to', () => {
		expect(convertAmount(100, 'USD', 'USD', m)).toBe(100);
	});
	test('direct rate', () => {
		expect(convertAmount(100, 'USD', 'EUR', m)).toBeCloseTo(90);
	});
	test('throws MissingFxRateError when no rate exists', () => {
		expect(() => convertAmount(100, 'JPY', 'USD', m)).toThrow(MissingFxRateError);
	});
});

describe('buildFxMatrixFromUsdLegs', () => {
	test('identity diagonal for every supported currency', () => {
		const m = buildFxMatrixFromUsdLegs(new Map());
		expect(m.USD?.USD).toBe(1);
		expect(m.EUR?.EUR).toBe(1);
		expect(m.JPY?.JPY).toBe(1);
	});
	test('sets C->USD to the leg and USD->C to its reciprocal', () => {
		const m = buildFxMatrixFromUsdLegs(new Map([['EUR', 1.08]]));
		expect(m.EUR?.USD).toBeCloseTo(1.08);
		expect(m.USD?.EUR).toBeCloseTo(1 / 1.08);
	});
	test('skips non-positive legs', () => {
		const m = buildFxMatrixFromUsdLegs(new Map([['EUR', 0]]));
		expect(m.EUR?.USD).toBeUndefined();
	});
	test('convertAmount crosses two legs via USD pivot', () => {
		const m = buildFxMatrixFromUsdLegs(
			new Map([
				['EUR', 1.08],
				['GBP', 1.27]
			])
		);
		// 100 EUR -> USD -> GBP
		expect(convertAmount(100, 'EUR', 'GBP', m)).toBeCloseTo((100 * 1.08) / 1.27);
	});
	test('convertAmount throws for a currency with no leg', () => {
		const m = buildFxMatrixFromUsdLegs(new Map([['EUR', 1.08]]));
		expect(() => convertAmount(100, 'CAD', 'EUR', m)).toThrow();
	});
});

describe('forwardFill', () => {
	const keys = ['2020-01-01', '2020-01-02', '2020-01-03', '2020-01-04'];
	test('carries the last known value across gaps', () => {
		const filled = forwardFill(new Map([['2020-01-02', 1.1]]), keys);
		expect(filled.get('2020-01-02')).toBe(1.1);
		expect(filled.get('2020-01-03')).toBe(1.1);
		expect(filled.get('2020-01-04')).toBe(1.1);
	});
	test('seeds from the latest value strictly before the first key', () => {
		const filled = forwardFill(
			new Map([
				['2019-12-31', 1.05],
				['2020-01-03', 1.2]
			]),
			keys
		);
		expect(filled.get('2020-01-01')).toBe(1.05);
		expect(filled.get('2020-01-03')).toBe(1.2);
	});
	test('leaves early keys unset when there is no seed', () => {
		const filled = forwardFill(new Map([['2020-01-03', 1.2]]), keys);
		expect(filled.has('2020-01-01')).toBe(false);
		expect(filled.get('2020-01-03')).toBe(1.2);
	});
});

describe('assembleFxByDate', () => {
	const keys = ['2020-01-01', '2020-01-02'];
	test('builds one forward-filled matrix per date', () => {
		const raw = new Map([['EUR', new Map([['2020-01-01', 1.1]])]]);
		const byDate = assembleFxByDate(raw, keys);
		expect(byDate.get('2020-01-01')?.EUR?.USD).toBeCloseTo(1.1);
		// 2020-01-02 has no EUR bar but forward-fills from 01-01
		expect(byDate.get('2020-01-02')?.EUR?.USD).toBeCloseTo(1.1);
	});
	test('a date with no leg for a currency omits that leg (convertAmount throws)', () => {
		const raw = new Map([['EUR', new Map([['2020-01-02', 1.1]])]]);
		const byDate = assembleFxByDate(raw, keys);
		expect(() => convertAmount(1, 'EUR', 'USD', byDate.get('2020-01-01')!)).toThrow();
	});
});
