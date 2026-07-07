import { env } from '@/env';
import type { Currency } from '@/lib/currency';
import { db } from '@/server/db';
import { buildPoint, type DailyBar, influxWriteApi, Point } from '@/server/influx';
import {
	type CapitalGainEvent,
	type ChartStatus,
	classifyChartResponse,
	type DividendEvent,
	type SplitEvent,
	type YahooChartResponse
} from '@/server/yahoo-chart-parse';

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

export function sleep(ms: number) {
	return new Promise((res) => setTimeout(res, ms));
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
): Promise<{
	status: ChartStatus;
	bars: DailyBar[];
	dividends: DividendEvent[];
	splits: SplitEvent[];
	capitalGains: CapitalGainEvent[];
	currency?: string;
}> {
	const base = env.YAHOO_API_URL.replace(/\/$/, '');
	const url = new URL(`${base}/chart/${encodeURIComponent(symbol)}`);
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
	return classifyChartResponse(json);
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
	// Always fetch currency metadata, even if we have data
	const { bars, dividends, splits, capitalGains, currency, status } = await fetchYahooDaily(symbol, {
		includePrePost: false,
		interval: '1d',
		period1: 1,
		period2: Math.floor(Date.now() / 1000)
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

	if (bars.length > 0) await writeBars(symbol, bars);
	if (dividends.length > 0) await writeDividends(symbol, dividends);
	if (splits.length > 0) await writeSplits(symbol, splits);
	if (capitalGains.length > 0) await writeCapitalGains(symbol, capitalGains);
	return { count: bars.length, currency: mapCurrencyString(currency), skipped: false, status } as const;
}
