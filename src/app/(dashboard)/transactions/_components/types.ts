import type { Currency } from '@/lib/currency';

export type RowData = {
	id: string;
	date: string;
	symbol: string;
	side: 'BUY' | 'SELL';
	quantity: number;
	price: number;
	fee?: number | null;
	note?: string | null;
	priceCurrency: Currency;
	feeCurrency?: Currency | null;
};
