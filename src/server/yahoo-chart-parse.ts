import { normalizeYahooCurrency } from '@/server/currency-normalize';
import type { DailyBar } from '@/server/influx';

export type ChartStatus = 'found' | 'empty' | 'not-found';
export type DividendEvent = { date: string; amount: number };
export type SplitEvent = { date: string; numerator: number; denominator: number; ratio: number };
export type CapitalGainEvent = { date: string; amount: number };

export interface YahooChartResponse {
	chart?: {
		result?: Array<{
			meta?: { currency: string; gmtoffset?: number };
			timestamp?: number[];
			events?: {
				dividends?: Record<string, { amount?: number; date?: number }>;
				splits?: Record<
					string,
					{ date?: number; numerator?: number; denominator?: number; splitRatio?: number }
				>;
				capitalGains?: Record<string, { amount?: number; date?: number }>;
			};
			indicators?: {
				quote?: Array<{
					open?: Array<number | null>;
					high?: Array<number | null>;
					low?: Array<number | null>;
					close?: Array<number | null>;
					volume?: Array<number | null>;
				}>;
			};
		}>;
		error?: unknown;
	};
}

export function toDateStringFromEpochSec(epochSec: number, gmtoffset?: number): string {
	const offsetMs = (gmtoffset ?? 0) * 1000;
	const d = new Date(epochSec * 1000 + offsetMs);
	const y = d.getUTCFullYear();
	const m = String(d.getUTCMonth() + 1).padStart(2, '0');
	const day = String(d.getUTCDate()).padStart(2, '0');
	return `${y}-${m}-${day}`;
}

/**
 * Classify a Yahoo chart response and extract bars/events.
 * - not-found: Yahoo returned no result[0] (unknown symbol; chart.error is typically set)
 * - empty: result[0] present but zero usable bars (valid symbol, no data in range)
 * - found: at least one usable bar
 */
export function classifyChartResponse(json: YahooChartResponse): {
	status: ChartStatus;
	bars: DailyBar[];
	dividends: DividendEvent[];
	splits: SplitEvent[];
	capitalGains: CapitalGainEvent[];
	currency?: string;
} {
	const res = json.chart?.result?.[0];
	if (!res) {
		return { bars: [], capitalGains: [], dividends: [], splits: [], status: 'not-found' };
	}

	const { currency, scale } = normalizeYahooCurrency(res.meta?.currency);
	const quote = res.indicators?.quote?.[0];
	const gmtoffset = res.meta?.gmtoffset;
	const bars: DailyBar[] = [];
	if (quote && res.timestamp) {
		const timestamps = res.timestamp ?? [];
		for (let i = 0; i < timestamps.length; i++) {
			const ts = timestamps[i]!;
			const o = quote.open?.[i] ?? null;
			const h = quote.high?.[i] ?? null;
			const l = quote.low?.[i] ?? null;
			const c = quote.close?.[i] ?? null;
			const v = quote.volume?.[i] ?? 0;
			if (o == null || h == null || l == null || c == null) continue;
			if ([o, h, l, c].some((n) => Number.isNaN(Number(n)))) continue;
			bars.push({
				close: Number(c) * scale,
				high: Number(h) * scale,
				low: Number(l) * scale,
				open: Number(o) * scale,
				time: toDateStringFromEpochSec(ts, gmtoffset ?? 0),
				volume: Math.max(0, Math.round(Number(v ?? 0)))
			});
		}
		bars.sort((a, b) => a.time.localeCompare(b.time));
	}

	const dividends: DividendEvent[] = [];
	const dividendsMap = res.events?.dividends ?? {};
	for (const key of Object.keys(dividendsMap)) {
		const ev = dividendsMap[key]!;
		const amount = Number(ev.amount ?? Number.NaN);
		const dateSec = ev.date ?? Number(key);
		if (!Number.isFinite(amount) || !Number.isFinite(dateSec)) continue;
		dividends.push({ amount: amount * scale, date: toDateStringFromEpochSec(dateSec, gmtoffset ?? 0) });
	}
	dividends.sort((a, b) => a.date.localeCompare(b.date));

	const splits: SplitEvent[] = [];
	const splitsMap = res.events?.splits ?? {};
	for (const key of Object.keys(splitsMap)) {
		const ev = splitsMap[key]!;
		const dateSec = ev.date ?? Number(key);
		const numerator = Number(ev.numerator ?? Number.NaN);
		const denominator = Number(ev.denominator ?? Number.NaN);
		const ratio = Number(
			Number.isFinite(ev.splitRatio as number)
				? (ev.splitRatio as number)
				: Number.isFinite(numerator) && Number.isFinite(denominator) && denominator !== 0
					? numerator / denominator
					: Number.NaN
		);
		if (
			!Number.isFinite(dateSec) ||
			!Number.isFinite(numerator) ||
			!Number.isFinite(denominator) ||
			!Number.isFinite(ratio)
		)
			continue;
		splits.push({ date: toDateStringFromEpochSec(dateSec, gmtoffset ?? 0), denominator, numerator, ratio });
	}
	splits.sort((a, b) => a.date.localeCompare(b.date));

	const capitalGains: CapitalGainEvent[] = [];
	const capMap = res.events?.capitalGains ?? {};
	for (const key of Object.keys(capMap)) {
		const ev = capMap[key]!;
		const amount = Number(ev.amount ?? Number.NaN);
		const dateSec = ev.date ?? Number(key);
		if (!Number.isFinite(amount) || !Number.isFinite(dateSec)) continue;
		capitalGains.push({ amount: amount * scale, date: toDateStringFromEpochSec(dateSec, gmtoffset ?? 0) });
	}
	capitalGains.sort((a, b) => a.date.localeCompare(b.date));

	return { bars, capitalGains, currency, dividends, splits, status: bars.length > 0 ? 'found' : 'empty' };
}
