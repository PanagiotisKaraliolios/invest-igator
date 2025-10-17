import type { Currency } from '@prisma/client';
import { env } from '@/env';
import { db } from '@/server/db';
import { buildPoint, type DailyBar, influxWriteApi, Point, symbolHasAnyData } from '@/server/influx';

function mapCurrencyString(currencyStr?: string): Currency {
	if (!currencyStr) return 'USD';

	const upper = currencyStr.toUpperCase();
	switch (upper) {
		case 'EUR':
			return 'EUR';
		case 'USD':
			return 'USD';
		case 'GBP':
			return 'GBP';
		case 'HKD':
			return 'HKD';
		case 'CHF':
			return 'CHF';
		case 'RUB':
			return 'RUB';
		default:
			return 'USD'; // Default fallback
	}
}

interface YahooChartResponse {
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
				// other event types may appear; we ignore unknowns safely
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

export function sleep(ms: number) {
	return new Promise((res) => setTimeout(res, ms));
}

function toDateStringFromEpochSec(epochSec: number, gmtoffset?: number): string {
	const offsetMs = (gmtoffset ?? 0) * 1000;
	const d = new Date(epochSec * 1000 + offsetMs);
	const y = d.getUTCFullYear();
	const m = String(d.getUTCMonth() + 1).padStart(2, '0');
	const day = String(d.getUTCDate()).padStart(2, '0');
	return `${y}-${m}-${day}`;
}

type DividendEvent = { date: string; amount: number };
type SplitEvent = { date: string; numerator: number; denominator: number; ratio: number };
type CapitalGainEvent = { date: string; amount: number };

export async function fetchYahooDaily(
	symbol: string,
	options?: {
		period1?: number;
		period2?: number;
		interval?: '5m' | '1d' | '1wk' | '1mo';
		includePrePost?: boolean;
		events?: string;
	}
): Promise<{
	bars: DailyBar[];
	dividends: DividendEvent[];
	splits: SplitEvent[];
	capitalGains: CapitalGainEvent[];
	currency?: string;
}> {
	const base = env.YAHOO_CHART_API_URL.replace(/\/$/, '');
	const url = new URL(`${base}/${encodeURIComponent(symbol)}`);
	url.searchParams.set('interval', options?.interval ?? '1d');
	url.searchParams.set('includePrePost', String(options?.includePrePost ?? true));
	url.searchParams.set('formatted', 'true');
	url.searchParams.set('events', options?.events ?? 'capitalGain|div|split|earn');
	url.searchParams.set('lang', 'en-US');
	url.searchParams.set('region', 'US');
	url.searchParams.set('source', 'invest-igator');
	if (options?.period1) url.searchParams.set('period1', String(options.period1));
	if (options?.period2) url.searchParams.set('period2', String(options.period2));
	if (!options?.period1 && !options?.period2) url.searchParams.set('range', 'max');

	const rsp = await fetch(url.toString(), {
		headers: {
			Accept: 'application/json, text/plain, */*',
			'User-Agent': 'Mozilla/5.0 (compatible; invest-igator/1.0)'
		}
	});
	if (!rsp.ok) throw new Error(`Yahoo chart HTTP ${rsp.status} for ${symbol}`);
	const json = (await rsp.json()) as YahooChartResponse;
	const res = json.chart?.result?.[0];
	if (!res) return { bars: [], capitalGains: [], dividends: [], splits: [] };

	const currency = res.meta?.currency;
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
			const v = quote.volume?.[i] ?? 0; // default missing volume to 0
			if (o == null || h == null || l == null || c == null) continue;
			if ([o, h, l, c].some((n) => Number.isNaN(Number(n)))) continue;
			bars.push({
				close: Number(c),
				high: Number(h),
				low: Number(l),
				open: Number(o),
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
		dividends.push({
			amount,
			date: toDateStringFromEpochSec(dateSec, gmtoffset ?? 0)
		});
	}
	dividends.sort((a, b) => a.date.localeCompare(b.date));

	const splits: SplitEvent[] = [];
	const splitsMap = res.events?.splits ?? {};
	for (const key of Object.keys(splitsMap)) {
		const ev = splitsMap[key]!;
		const dateSec = ev.date ?? Number(key);
		const numerator = Number(ev.numerator ?? Number.NaN);
		const denominator = Number(ev.denominator ?? Number.NaN);
		// Some payloads include splitRatio; compute ratio if missing and numbers are valid
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
		splits.push({
			date: toDateStringFromEpochSec(dateSec, gmtoffset ?? 0),
			denominator,
			numerator,
			ratio
		});
	}
	splits.sort((a, b) => a.date.localeCompare(b.date));

	const capitalGains: CapitalGainEvent[] = [];
	const capMap = res.events?.capitalGains ?? {};
	for (const key of Object.keys(capMap)) {
		const ev = capMap[key]!;
		const amount = Number(ev.amount ?? Number.NaN);
		const dateSec = ev.date ?? Number(key);
		if (!Number.isFinite(amount) || !Number.isFinite(dateSec)) continue;
		capitalGains.push({
			amount,
			date: toDateStringFromEpochSec(dateSec, gmtoffset ?? 0)
		});
	}
	capitalGains.sort((a, b) => a.date.localeCompare(b.date));

	return { bars, capitalGains, currency, dividends, splits };
}

export async function writeBars(symbol: string, bars: DailyBar[]) {
	if (bars.length === 0) return;
	const BATCH = 1000;
	for (let i = 0; i < bars.length; i += BATCH) {
		const slice = bars.slice(i, i + BATCH);
		const points = slice.map((bar) => buildPoint(symbol, bar));
		let attempt = 1;
		const maxAttempts = 5;
		while (true) {
			try {
				influxWriteApi.writePoints(points);
				await influxWriteApi.flush();
				break;
			} catch (err) {
				if (attempt >= maxAttempts) throw err;
				await sleep(Math.min(30_000, 2_000 * attempt));
				attempt += 1;
			}
		}
	}
}

export async function writeDividends(symbol: string, events: DividendEvent[]) {
	if (events.length === 0) return;
	const BATCH = 1000;
	for (let i = 0; i < events.length; i += BATCH) {
		const slice = events.slice(i, i + BATCH);
		const points = slice.map((ev) =>
			new Point('dividends')
				.tag('symbol', symbol)
				.floatField('amount', ev.amount)
				.timestamp(new Date(ev.date + 'T00:00:00Z'))
		);
		let attempt = 1;
		const maxAttempts = 5;
		while (true) {
			try {
				influxWriteApi.writePoints(points);
				await influxWriteApi.flush();
				break;
			} catch (err) {
				if (attempt >= maxAttempts) throw err;
				await sleep(Math.min(30_000, 2_000 * attempt));
				attempt += 1;
			}
		}
	}
}

export async function writeSplits(symbol: string, events: SplitEvent[]) {
	if (events.length === 0) return;
	const BATCH = 1000;
	for (let i = 0; i < events.length; i += BATCH) {
		const slice = events.slice(i, i + BATCH);
		const points = slice.map((ev) =>
			new Point('splits')
				.tag('symbol', symbol)
				.floatField('numerator', ev.numerator)
				.floatField('denominator', ev.denominator)
				.floatField('ratio', ev.ratio)
				.timestamp(new Date(ev.date + 'T00:00:00Z'))
		);
		let attempt = 1;
		const maxAttempts = 5;
		while (true) {
			try {
				influxWriteApi.writePoints(points);
				await influxWriteApi.flush();
				break;
			} catch (err) {
				if (attempt >= maxAttempts) throw err;
				await sleep(Math.min(30_000, 2_000 * attempt));
				attempt += 1;
			}
		}
	}
}

export async function writeCapitalGains(symbol: string, events: CapitalGainEvent[]) {
	if (events.length === 0) return;
	const BATCH = 1000;
	for (let i = 0; i < events.length; i += BATCH) {
		const slice = events.slice(i, i + BATCH);
		const points = slice.map((ev) =>
			new Point('capital_gains')
				.tag('symbol', symbol)
				.floatField('amount', ev.amount)
				.timestamp(new Date(ev.date + 'T00:00:00Z'))
		);
		let attempt = 1;
		const maxAttempts = 5;
		while (true) {
			try {
				influxWriteApi.writePoints(points);
				await influxWriteApi.flush();
				break;
			} catch (err) {
				if (attempt >= maxAttempts) throw err;
				await sleep(Math.min(30_000, 2_000 * attempt));
				attempt += 1;
			}
		}
	}
}

export async function ingestYahooSymbol(symbol: string, options?: { userId?: string }) {
	const has = await symbolHasAnyData(symbol);

	// Always fetch currency metadata, even if we have data
	const { bars, dividends, splits, capitalGains, currency } = await fetchYahooDaily(symbol, {
		includePrePost: false,
		interval: '1d',
		period1: 1,
		period2: Date.now()
	});

	// Update watchlist item with currency if userId is provided
	if (options?.userId && currency) {
		try {
			const mappedCurrency = mapCurrencyString(currency);
			await db.watchlistItem.updateMany({
				data: {
					currency: mappedCurrency
				},
				where: {
					symbol: symbol,
					userId: options.userId
				}
			});
		} catch (error) {
			// Log error but don't fail the ingestion
			console.warn(`Failed to update watchlist currency for ${symbol}:`, error);
		}
	}

	// Only write data if we don't already have it
	// if (has) {
	// 	return { count: 0, currency: mapCurrencyString(currency), skipped: true } as const;
	// }

	if (bars.length > 0) await writeBars(symbol, bars);
	if (dividends.length > 0) await writeDividends(symbol, dividends);
	if (splits.length > 0) await writeSplits(symbol, splits);
	if (capitalGains.length > 0) await writeCapitalGains(symbol, capitalGains);
	return { count: bars.length, currency: mapCurrencyString(currency), skipped: false } as const;
}
