import { z } from 'zod';

/**
 * The 10 supported currencies. Task 2 makes this the source for `type Currency` and
 * `supportedCurrencies` once the Postgres Currency enum is dropped; kept separate here so this
 * task stays typecheck-green (widening `type Currency` to 10 while @prisma/generated stays 6 breaks interop).
 */
export const SUPPORTED_CURRENCIES = ['EUR', 'USD', 'GBP', 'HKD', 'CHF', 'RUB', 'JPY', 'CAD', 'AUD', 'SGD'] as const;

export const supportedCurrencies = ['EUR', 'USD', 'GBP', 'HKD', 'CHF', 'RUB'] as const;
export type Currency = (typeof supportedCurrencies)[number];

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
