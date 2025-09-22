export const supportedCurrencies = ['EUR', 'USD', 'GBP', 'HKD', 'CHF', 'RUB'] as const;
export type Currency = (typeof supportedCurrencies)[number];

export function formatCurrency(n: number, currency: Currency, maximumFractionDigits?: number): string {
	return new Intl.NumberFormat(undefined, {
		currency,
		maximumFractionDigits: maximumFractionDigits,
		style: 'currency'
	}).format(n);
}
