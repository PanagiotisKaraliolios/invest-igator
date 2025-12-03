import type { Currency } from '@prisma/generated';
import { db } from '@/server/db';

export type FxMatrix = Record<Currency, Record<Currency, number>>;

export async function getFxMatrix(): Promise<FxMatrix> {
	const rows = await db.fxRate.findMany({});
	const out = {} as FxMatrix;
	const currencies = ['EUR', 'USD', 'GBP', 'HKD', 'CHF', 'RUB'] as Currency[];
	for (const c of currencies) {
		out[c] = {} as Record<Currency, number>;
		out[c][c] = 1;
	}
	for (const r of rows) {
		out[r.base][r.quote] = r.rate;
		if (!out[r.quote]) out[r.quote] = {} as any;
		if (r.rate !== 0) out[r.quote][r.base] = 1 / r.rate;
	}
	return out;
}

export function convertAmount(amount: number, from: Currency, to: Currency, m: FxMatrix): number {
	if (from === to) return amount;
	const direct = m[from]?.[to];
	if (typeof direct === 'number') return amount * direct;
	// Fallback via USD if possible
	const via = m[from]?.USD && m.USD?.[to] ? amount * m[from].USD * m.USD[to] : undefined;
	return typeof via === 'number' ? via : amount; // if missing, return unchanged
}
