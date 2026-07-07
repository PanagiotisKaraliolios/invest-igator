import { SUPPORTED_CURRENCIES } from '@/lib/currency';
import { db } from '@/server/db';

export type FxMatrix = Record<string, Record<string, number>>;

export class MissingFxRateError extends Error {
	from: string;
	to: string;
	constructor(from: string, to: string) {
		super(`No FX rate to convert ${from} -> ${to}`);
		this.name = 'MissingFxRateError';
		this.from = from;
		this.to = to;
	}
}

export async function getFxMatrix(): Promise<FxMatrix> {
	const rows = await db.fxRate.findMany({});
	const out: FxMatrix = {};
	const currencies = SUPPORTED_CURRENCIES;
	for (const c of currencies) {
		out[c] = {};
		out[c][c] = 1;
	}
	for (const r of rows) {
		const baseRow = out[r.base] ?? (out[r.base] = {});
		baseRow[r.quote] = r.rate;
		if (r.rate !== 0) {
			const quoteRow = out[r.quote] ?? (out[r.quote] = {});
			quoteRow[r.base] = 1 / r.rate;
		}
	}
	return out;
}

export function convertAmount(amount: number, from: string, to: string, m: FxMatrix): number {
	if (from === to) return amount;
	const direct = m[from]?.[to];
	if (typeof direct === 'number') return amount * direct;
	const via = m[from]?.USD && m.USD?.[to] ? amount * m[from].USD * m.USD[to] : undefined;
	if (typeof via === 'number') return via;
	throw new MissingFxRateError(from, to);
}
