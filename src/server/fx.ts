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

/**
 * Build an FxMatrix from USD legs. `usdPerUnit` maps a non-USD currency to its Yahoo
 * `${C}USD=X` close (USD per 1 unit of C). Identity diagonal is seeded for every supported
 * currency; only USD legs + reciprocals are stored — convertAmount derives cross rates via USD.
 */
export function buildFxMatrixFromUsdLegs(usdPerUnit: Map<string, number>): FxMatrix {
	const out: FxMatrix = {};
	for (const c of SUPPORTED_CURRENCIES) out[c] = { [c]: 1 };
	out.USD ??= { USD: 1 };
	for (const [c, rate] of usdPerUnit) {
		if (!(rate > 0)) continue;
		(out[c] ??= {})[c] = 1;
		out[c].USD = rate;
		out.USD[c] = 1 / rate;
	}
	return out;
}

/**
 * Forward-fill a single currency's rate series across an ordered list of ISO date keys,
 * seeded by the latest value strictly before the first key. Mirrors the price carry-forward in
 * portfolio.performance. Dates with no known value (no seed yet) are omitted from the result.
 */
export function forwardFill(raw: Map<string, number>, dateKeys: string[]): Map<string, number> {
	const first = dateKeys[0];
	let seed: number | undefined;
	if (first !== undefined) {
		for (const [iso, v] of Array.from(raw.entries()).sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
			if (iso < first) seed = v;
		}
	}
	const out = new Map<string, number>();
	let last = seed;
	for (const iso of dateKeys) {
		const v = raw.get(iso);
		if (v != null && Number.isFinite(v)) last = v;
		if (last != null && Number.isFinite(last)) out.set(iso, last);
	}
	return out;
}

/**
 * Assemble a per-date FxMatrix map: forward-fill each currency's series across `dateKeys`, then
 * build one matrix per date from the currencies that have a known rate on that date.
 */
export function assembleFxByDate(
	rawByCurrency: Map<string, Map<string, number>>,
	dateKeys: string[]
): Map<string, FxMatrix> {
	const filledByCurrency = new Map<string, Map<string, number>>();
	for (const [c, raw] of rawByCurrency) filledByCurrency.set(c, forwardFill(raw, dateKeys));
	const out = new Map<string, FxMatrix>();
	for (const iso of dateKeys) {
		const legs = new Map<string, number>();
		for (const [c, filled] of filledByCurrency) {
			const r = filled.get(iso);
			if (r != null && Number.isFinite(r)) legs.set(c, r);
		}
		out.set(iso, buildFxMatrixFromUsdLegs(legs));
	}
	return out;
}
