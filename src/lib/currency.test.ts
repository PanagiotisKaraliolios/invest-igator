import { describe, expect, test } from 'bun:test';
import { currencySchema, isSupportedCurrency, SUPPORTED_CURRENCIES } from './currency';

describe('SUPPORTED_CURRENCIES', () => {
	test('has the 10 expected currencies in order', () => {
		expect(SUPPORTED_CURRENCIES).toEqual(['EUR', 'USD', 'GBP', 'HKD', 'CHF', 'RUB', 'JPY', 'CAD', 'AUD', 'SGD']);
	});

	test('isSupportedCurrency accepts supported, rejects others', () => {
		expect(isSupportedCurrency('JPY')).toBe(true);
		expect(isSupportedCurrency('USD')).toBe(true);
		expect(isSupportedCurrency('INR')).toBe(false);
		expect(isSupportedCurrency('gbp')).toBe(false); // case-sensitive by design (codes are stored uppercase)
	});

	test('currencySchema parses supported and rejects unsupported', () => {
		expect(currencySchema.parse('CAD')).toBe('CAD');
		expect(currencySchema.safeParse('INR').success).toBe(false);
	});
});
