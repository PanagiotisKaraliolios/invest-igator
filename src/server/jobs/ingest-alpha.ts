import { env } from '@/env';
import { db } from '../db';
import { buildPoint, type DailyBar, influxWriteApi, symbolHasAnyData } from '../influx';

type AlphaDailyResponse =
	| {
			'Meta Data'?: Record<string, string>;
			'Time Series (Daily)'?: Record<
				string,
				{
					'1. open': string;
					'2. high': string;
					'3. low': string;
					'4. close': string;
					'5. volume': string;
				}
			>;
			Information?: string; // throttle note
			Note?: string; // another throttle key Alpha uses
			'Error Message'?: string;
	  }
	| undefined;

async function sleep(ms: number) {
	await new Promise((res) => setTimeout(res, ms));
}

async function fetchAlphaDailyFull(symbol: string, attempt = 1): Promise<DailyBar[]> {
	const url = new URL(env.ALPHAVANTAGE_API_URL);
	url.searchParams.set('function', 'TIME_SERIES_DAILY');
	url.searchParams.set('symbol', symbol);
	url.searchParams.set('datatype', 'json');
	url.searchParams.set('outputsize', 'full');
	url.searchParams.set('apikey', env.ALPHAVANTAGE_API_KEY);

	const rsp = await fetch(url.toString());
	if (!rsp.ok) {
		throw new Error(`Alpha Vantage HTTP ${rsp.status} for ${symbol}`);
	}
	const json = (await rsp.json()) as AlphaDailyResponse;

	// Handle throttle / informational responses
	if (json && (json.Note || json.Information)) {
		const note = json.Note ?? json.Information ?? '';
		const backoff = Math.min(60, 5 * attempt); // seconds
		console.warn(`Alpha Vantage throttled for ${symbol} (attempt ${attempt}): ${note}. Backing off ${backoff}s...`);
		await sleep(backoff * 1000);
		if (attempt < 5) return fetchAlphaDailyFull(symbol, attempt + 1);
		console.warn(`Giving up on ${symbol} after ${attempt} attempts due to throttling.`);
		return [];
	}

	if (!json || !json['Time Series (Daily)']) {
		if (json && json['Error Message']) {
			console.error(`Alpha Vantage error for ${symbol}: ${json['Error Message']}`);
		} else {
			console.warn(`No daily series found for ${symbol}.`);
		}
		return [];
	}

	const series = json['Time Series (Daily)'];
	const bars: DailyBar[] = Object.entries(series)
		.map(([date, ohlcv]) => ({
			close: Number.parseFloat(ohlcv['4. close']) || 0,
			high: Number.parseFloat(ohlcv['2. high']) || 0,
			low: Number.parseFloat(ohlcv['3. low']) || 0,
			open: Number.parseFloat(ohlcv['1. open']) || 0,
			time: date,
			volume: Number.parseInt(ohlcv['5. volume'], 10) || 0
		}))
		// oldest first so writes are chronological (not required by Influx, but nice)
		.sort((a, b) => a.time.localeCompare(b.time));

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
	// Write in moderately sized batches to avoid large memory spikes
	const BATCH = 1000;
	for (let i = 0; i < bars.length; i += BATCH) {
		const slice = bars.slice(i, i + BATCH);
		const points = slice.map((bar) => buildPoint(symbol, bar));
		// Retry writes on transient failures (e.g., timeouts)
		let attempt = 1;
		const maxAttempts = 5;
		// eslint-disable-next-line no-constant-condition
		while (true) {
			try {
				influxWriteApi.writePoints(points);
				// flush after each batch to ensure delivery
				await influxWriteApi.flush();
				break; // success
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
	console.log('Starting Alpha Vantage ingestion job...');
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
			// Skip symbols that already have any data in Influx
			const hasData = await symbolHasAnyData(symbol);
			if (hasData) {
				skipped += 1;
				console.log(`Skip ${symbol}: already has data in Influx.`);
				continue;
			}

			console.log(`Fetching Alpha Vantage daily (full) for ${symbol}...`);
			const bars = await fetchAlphaDailyFull(symbol);
			if (bars.length === 0) {
				console.warn(`No data returned for ${symbol}.`);
				continue;
			}

			await writeBars(symbol, bars);
			fetched += 1;
			console.log(`Ingested ${bars.length} bars for ${symbol}.`);

			// Respect Alpha Vantage free-tier rate limit (5 req/min)
			await sleep(15_000);
		} catch (err) {
			console.error(`Error processing ${symbol}:`, err);
			// brief pause before continuing to next symbol
			await sleep(5_000);
		}
	}

	console.log(`Done. Symbols fetched: ${fetched}, skipped: ${skipped}. Flushing writes...`);
	await influxWriteApi.close().catch((e) => console.error('Error closing Influx write API:', e));
	await db.$disconnect().catch((e) => console.error('Error disconnecting Prisma:', e));
	console.log('Ingestion job complete.');
}

// Allow running directly: `bun run src/server/jobs/ingest-alpha.ts`
// eslint-disable-next-line @typescript-eslint/no-floating-promises
main();
