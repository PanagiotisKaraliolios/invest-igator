#!/usr/bin/env bun
import { SUPPORTED_CURRENCIES } from '@/lib/currency';
import { db } from '@/server/db';
import { writeFxRates } from '@/server/fx-history';
import { fetchYahooDaily, sleep } from '@/server/jobs/yahoo-lib';

const PACING_MS = 2000;

/**
 * Source FX from Yahoo daily bars into the InfluxDB `fx_rates` measurement. For each non-USD
 * currency C we fetch the `${C}USD=X` pair (close = USD per 1 unit of C) over its full history and
 * store it. Idempotent (Influx overwrites by measurement+tag+timestamp), so this same job serves
 * both the one-off backfill and the daily refresh. Run: `bun run ingest:fx`.
 */
async function main() {
	const period2 = Math.floor(Date.now() / 1000);
	let written = 0;
	let failed = 0;
	const failures: string[] = [];

	for (const currency of SUPPORTED_CURRENCIES) {
		if (currency === 'USD') continue;
		const pair = `${currency}USD=X`;
		try {
			const { bars, status } = await fetchYahooDaily(pair, { interval: '1d', period1: 1, period2 });
			if (status === 'not-found' || bars.length === 0) {
				failed++;
				failures.push(`${currency} (${status}, ${bars.length} bars)`);
			} else {
				await writeFxRates(currency, bars);
				written++;
				console.log(`  ${currency}: ${bars.length} bars (${bars[0]?.time} … ${bars[bars.length - 1]?.time})`);
			}
		} catch (e) {
			failed++;
			failures.push(`${currency}: ${e instanceof Error ? e.message : String(e)}`);
		}
		await sleep(PACING_MS);
	}

	console.log(`FX ingest done — currencies written ${written}, failed ${failed}.`);
	if (failed > 0) {
		console.warn(`FX ingest failures (existing series left intact): ${failures.join(' | ')}`);
	}
}

try {
	await main();
} catch (e) {
	console.error(e);
	process.exitCode = 1;
} finally {
	await db.$disconnect();
}
