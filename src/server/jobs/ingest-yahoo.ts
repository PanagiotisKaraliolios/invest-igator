import { env } from '@/env';
import { db } from '../db';
import { buildPoint, type DailyBar, influxWriteApi, symbolHasAnyData } from '../influx';

// Minimal subset of Yahoo chart response used for daily bars
interface YahooChartResponse {
	chart?: {
		result?: Array<{
			meta?: {
				currency?: string;
				symbol?: string;
				exchangeName?: string;
				gmtoffset?: number; // seconds
				timezone?: string;
				dataGranularity?: string;
			};
			timestamp?: number[]; // epoch seconds
			indicators?: {
				quote?: Array<{
					open?: Array<number | null>;
					high?: Array<number | null>;
					low?: Array<number | null>;
					close?: Array<number | null>;
					volume?: Array<number | null>;
				}>;
				adjclose?: Array<{
					adjclose?: Array<number | null>;
				}>;
			};
		}>;
		error?: unknown;
	};
}

async function sleep(ms: number) {
	await new Promise((res) => setTimeout(res, ms));
}

function toDateStringFromEpochSec(epochSec: number, gmtoffset?: number): string {
	// Yahoo timestamps are exchange-local epoch seconds; normalize to date in that zone.
	// We only need the YYYY-MM-DD for our daily bars. We'll derive by applying gmtoffset
	// if provided and then taking UTC date components.
	const offsetMs = (gmtoffset ?? 0) * 1000;
	const d = new Date(epochSec * 1000 + offsetMs);
	const y = d.getUTCFullYear();
	const m = String(d.getUTCMonth() + 1).padStart(2, '0');
	const day = String(d.getUTCDate()).padStart(2, '0');
	return `${y}-${m}-${day}`;
}

async function fetchYahooDaily(
	symbol: string,
	options?: {
		period1?: number; // epoch seconds inclusive
		period2?: number; // epoch seconds inclusive
		interval?: '5m' | '1d' | '1wk' | '1mo';
		includePrePost?: boolean;
		events?: string; // e.g. 'div|split|earn'
	}
): Promise<DailyBar[]> {
	console.log('🚀 ~ ingest-yahoo.ts:56 ~ fetchYahooDaily ~ period1:', options?.period1);
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
	// If no explicit periods are requested, ask for full history
	if (!options?.period1 && !options?.period2) {
		url.searchParams.set('range', 'max');
	}

	const rsp = await fetch(url.toString(), {
		headers: {
			// Emulate a browser-ish client to avoid 403 on some Yahoo edges
			Accept: 'application/json, text/plain, */*',
			'User-Agent':
				'Mozilla/5.0 (compatible; invest-igator/1.0; +https://github.com/PanagiotisKaraliolios/invest-igator)'
		}
	});
	if (!rsp.ok) {
		throw new Error(`Yahoo chart HTTP ${rsp.status} for ${symbol}`);
	}
	const json = (await rsp.json()) as YahooChartResponse;
	const res = json.chart?.result?.[0];
	if (!res || !res.timestamp || !res.indicators?.quote?.[0]) return [];

	const quote = res.indicators.quote[0];
	const gmtoffset = res.meta?.gmtoffset;
	const timestamps = res.timestamp ?? [];
	const n = timestamps.length;

	const bars: DailyBar[] = [];
	for (let i = 0; i < n; i++) {
		const ts = timestamps[i]!;
		const open = quote.open?.[i] ?? null;
		const high = quote.high?.[i] ?? null;
		const low = quote.low?.[i] ?? null;
		const close = quote.close?.[i] ?? null;
		const volume = quote.volume?.[i] ?? null;
		// Skip rows with missing essential fields
		if (
			open == null ||
			high == null ||
			low == null ||
			close == null ||
			volume == null ||
			Number.isNaN(open) ||
			Number.isNaN(high) ||
			Number.isNaN(low) ||
			Number.isNaN(close) ||
			Number.isNaN(volume)
		) {
			continue;
		}
		bars.push({
			close: Number(close),
			high: Number(high),
			low: Number(low),
			open: Number(open),
			time: toDateStringFromEpochSec(ts, gmtoffset ?? 0),
			volume: Math.round(Number(volume))
		});
	}

	// Ensure chronological order (oldest first)
	bars.sort((a, b) => a.time.localeCompare(b.time));
	return bars;
}

async function getDistinctWatchlistSymbols(): Promise<string[]> {
	const rows = await db.watchlistItem.findMany({
		distinct: ['symbol'],
		select: { symbol: true },
		where: { symbol: { not: '' } }
	});
	const set = new Set(rows.map((r) => r.symbol.trim().toUpperCase()));
	return Array.from(set.values());
}

async function writeBars(symbol: string, bars: DailyBar[]) {
	if (bars.length === 0) return;
	const BATCH = 1000;
	for (let i = 0; i < bars.length; i += BATCH) {
		const slice = bars.slice(i, i + BATCH);
		const points = slice.map((bar) => buildPoint(symbol, bar));
		let attempt = 1;
		const maxAttempts = 5;
		// eslint-disable-next-line no-constant-condition
		while (true) {
			try {
				influxWriteApi.writePoints(points);
				await influxWriteApi.flush();
				break;
			} catch (err) {
				if (attempt >= maxAttempts) {
					throw new Error(`Failed writing batch for ${symbol} after ${attempt} attempts: ${String(err)}`);
				}
				const delay = Math.min(30_000, 2_000 * attempt);
				console.warn(
					`Write to InfluxDB failed (attempt ${attempt}/${maxAttempts}) for ${symbol}. Retrying in ${delay}ms...`,
					err
				);
				await sleep(delay);
				attempt += 1;
			}
		}
	}
}

async function main() {
	console.log('Starting Yahoo ingestion job...');
	const symbols = await getDistinctWatchlistSymbols();
	if (symbols.length === 0) {
		console.log('No symbols found in watchlist. Nothing to ingest.');
		return;
	}
	console.log(`Found ${symbols.length} distinct watchlist symbol(s).`);

	let fetched = 0;
	let skipped = 0;

	for (const symbol of symbols) {
		try {
			// const hasData = await symbolHasAnyData(symbol);
			// if (hasData) {
			// 	skipped += 1;
			// 	console.log(`Skip ${symbol}: already has data in Influx.`);
			// 	continue;
			// }

			console.log(`Fetching Yahoo daily for ${symbol}...`);
			const bars = await fetchYahooDaily(symbol, {
				includePrePost: false,
				interval: '1d',
				// for period 1, use the timestamp for 1 Jan 1970 to get full history
				period1: 1,
				period2: Date.now()
			});
			if (bars.length === 0) {
				console.warn(`No data returned for ${symbol}.`);
				continue;
			}

			await writeBars(symbol, bars);
			fetched += 1;
			console.log(`Ingested ${bars.length} bars for ${symbol}.`);

			// Gentle pacing; Yahoo has dynamic protections. 2s per request is safe.
			await sleep(2_000);
		} catch (err) {
			console.error(`Error processing ${symbol}:`, err);
			await sleep(2_000);
		}
	}

	console.log(`Done. Symbols fetched: ${fetched}, skipped: ${skipped}. Flushing writes...`);
	await influxWriteApi.close().catch((e) => console.error('Error closing Influx write API:', e));
	await db.$disconnect().catch((e) => console.error('Error disconnecting Prisma:', e));
	console.log('Yahoo ingestion job complete.');
}

// Allow running directly: `bun run src/server/jobs/ingest-yahoo.ts`
// eslint-disable-next-line @typescript-eslint/no-floating-promises
main();
