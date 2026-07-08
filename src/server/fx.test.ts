import { describe, expect, test } from 'bun:test';
import { convertAmount, type FxMatrix, MissingFxRateError } from './fx';

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
