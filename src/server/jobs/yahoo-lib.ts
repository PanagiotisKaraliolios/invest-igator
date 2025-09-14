import { env } from '@/env';
import { buildPoint, type DailyBar, influxWriteApi, symbolHasAnyData } from '@/server/influx';

interface YahooChartResponse {
	chart?: {
		result?: Array<{
			meta?: { gmtoffset?: number };
			timestamp?: number[];
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

export async function fetchYahooDaily(
	symbol: string,
	options?: {
		period1?: number;
		period2?: number;
		interval?: '5m' | '1d' | '1wk' | '1mo';
		includePrePost?: boolean;
		events?: string;
	}
): Promise<DailyBar[]> {
	const base = env.YAHOO_CHART_API_URL.replace(/\/$/, '');
	const url = new URL(`${base}/${encodeURIComponent(symbol)}`);
	url.searchParams.set('interval', options?.interval ?? '1d');
	url.searchParams.set('includePrePost', String(options?.includePrePost ?? true));
	url.searchParams.set('events', options?.events ?? 'div|split|earn');
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
	if (!res || !res.timestamp || !res.indicators?.quote?.[0]) return [];

	const quote = res.indicators.quote[0]!;
	const gmtoffset = res.meta?.gmtoffset;
	const timestamps = res.timestamp ?? [];
	const bars: DailyBar[] = [];
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
	return bars;
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

export async function ingestYahooSymbol(symbol: string) {
	//   const has = await symbolHasAnyData(symbol);
	//   if (has) return { skipped: true } as const;
	const bars = await fetchYahooDaily(symbol, {
		includePrePost: false,
		interval: '1d',
		period1: 1,
		period2: Date.now()
	});
	if (bars.length > 0) await writeBars(symbol, bars);
	return { count: bars.length, skipped: false } as const;
}
