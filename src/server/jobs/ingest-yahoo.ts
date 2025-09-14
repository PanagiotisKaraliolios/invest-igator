import { db } from '../db';
import { influxWriteApi } from '../influx';
import { ingestYahooSymbol, sleep } from './yahoo-lib';

// Local fetch/write helpers moved to './yahoo-lib'

async function getDistinctWatchlistSymbols(): Promise<string[]> {
	const rows = await db.watchlistItem.findMany({
		distinct: ['symbol'],
		select: { symbol: true },
		where: { symbol: { not: '' } }
	});
	const set = new Set(rows.map((r) => r.symbol.trim().toUpperCase()));
	return Array.from(set.values());
}

// writeBars now handled in './yahoo-lib'

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
			const res = await ingestYahooSymbol(symbol);
			if (res.skipped) {
				skipped += 1;
				console.log(`Skip ${symbol}: already has data in Influx.`);
			} else {
				fetched += 1;
				console.log(`Ingested ${res.count} bars for ${symbol}.`);
			}

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
