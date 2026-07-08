import { describe, expect, test } from 'bun:test';
import { normalizeYahooCurrency } from './currency-normalize';

describe('normalizeYahooCurrency', () => {
	test('GBp / GBX -> GBP with 0.01 scale (pence to pounds)', () => {
		expect(normalizeYahooCurrency('GBp')).toEqual({ currency: 'GBP', scale: 0.01 });
		expect(normalizeYahooCurrency('GBX')).toEqual({ currency: 'GBP', scale: 0.01 });
		expect(normalizeYahooCurrency('gbx')).toEqual({ currency: 'GBP', scale: 0.01 });
	});
	test('ISO codes pass through uppercased, scale 1', () => {
		expect(normalizeYahooCurrency('JPY')).toEqual({ currency: 'JPY', scale: 1 });
		expect(normalizeYahooCurrency('usd')).toEqual({ currency: 'USD', scale: 1 });
	});
	test('empty -> USD, scale 1', () => {
		expect(normalizeYahooCurrency(undefined)).toEqual({ currency: 'USD', scale: 1 });
		expect(normalizeYahooCurrency('')).toEqual({ currency: 'USD', scale: 1 });
	});
});
