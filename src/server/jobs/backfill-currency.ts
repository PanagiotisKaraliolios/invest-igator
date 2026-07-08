#!/usr/bin/env bun
import { db } from '@/server/db';
import { fetchYahooDaily, sleep } from '@/server/jobs/yahoo-lib';

/**
 * One-off: re-derive WatchlistItem.currency for every distinct tracked symbol from Yahoo,
 * using the fixed normalizer (GBp->GBP, true ISO codes). Idempotent; paced. Does NOT touch
 * Transaction.priceCurrency (user-entered). Run once after deploy: `bun run currency:backfill`.
 */
async function main() {
	const rows = await db.watchlistItem.findMany({ select: { symbol: true } });
	const symbols = Array.from(new Set(rows.map((r) => r.symbol.trim().toUpperCase())));
	console.log(`Backfilling currency for ${symbols.length} symbols...`);
	let updated = 0;
	for (const symbol of symbols) {
		try {
			const { currency, status } = await fetchYahooDaily(symbol, {
				interval: '1d',
				period1: 1,
				period2: Math.floor(Date.now() / 1000)
			});
			if (status !== 'not-found' && currency) {
				const res = await db.watchlistItem.updateMany({ data: { currency }, where: { symbol } });
				updated += res.count;
				console.log(`  ${symbol} -> ${currency} (${res.count} rows)`);
			} else {
				console.warn(`  ${symbol}: no Yahoo data, left unchanged`);
			}
		} catch (e) {
			console.warn(`  ${symbol}: failed`, e instanceof Error ? e.message : e);
		}
		await sleep(2000);
	}
	console.log(`Done. Updated ${updated} watchlist rows.`);
}

main()
	.catch((e) => {
		console.error(e);
		process.exit(1);
	})
	.finally(() => db.$disconnect());
