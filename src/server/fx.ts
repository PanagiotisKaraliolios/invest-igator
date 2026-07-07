import { db } from '@/server/db';

export type FxMatrix = Record<string, Record<string, number>>;

export async function getFxMatrix(): Promise<FxMatrix> {
	const rows = await db.fxRate.findMany({});
	const out = {} as FxMatrix;
	const currencies = ['EUR', 'USD', 'GBP', 'HKD', 'CHF', 'RUB'];
	for (const c of currencies) {
		out[c] = {} as Record<string, number>;
		out[c][c] = 1;
	}
	for (const r of rows) {
		const baseRow = out[r.base] ?? {};
		baseRow[r.quote] = r.rate;
		out[r.base] = baseRow;
		if (r.rate !== 0) {
			const quoteRow = out[r.quote] ?? {};
			quoteRow[r.base] = 1 / r.rate;
			out[r.quote] = quoteRow;
		}
	}
	return out;
}

export function convertAmount(amount: number, from: string, to: string, m: FxMatrix): number {
	if (from === to) return amount;
	const direct = m[from]?.[to];
	if (typeof direct === 'number') return amount * direct;
	// Fallback via USD if possible
	const via = m[from]?.USD && m.USD?.[to] ? amount * m[from].USD * m.USD[to] : undefined;
	return typeof via === 'number' ? via : amount; // if missing, return unchanged
}
