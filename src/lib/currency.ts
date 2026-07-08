import { z } from 'zod';

/**
 * The 10 supported currencies. This is the single source of truth for `type Currency` and
 * `supportedCurrencies` now that the Postgres `Currency` enum has been dropped in favor of a
 * plain ISO-4217 String column.
 */
export const SUPPORTED_CURRENCIES = ['EUR', 'USD', 'GBP', 'HKD', 'CHF', 'RUB', 'JPY', 'CAD', 'AUD', 'SGD'] as const;

export const supportedCurrencies = SUPPORTED_CURRENCIES;
export type Currency = (typeof SUPPORTED_CURRENCIES)[number];

export const currencySchema = z.enum(SUPPORTED_CURRENCIES);

export function isSupportedCurrency(x: string): x is (typeof SUPPORTED_CURRENCIES)[number] {
	return (SUPPORTED_CURRENCIES as readonly string[]).includes(x);
}

export function formatCurrency(n: number, currency: string, maximumFractionDigits?: number): string {
	return new Intl.NumberFormat(undefined, {
		currency,
		maximumFractionDigits,
		style: 'currency'
	}).format(n);
}
