#!/usr/bin/env bun
import type { Currency } from '@prisma/generated';
import { env } from '@/env';
import { db } from '@/server/db';

const supported: Currency[] = ['EUR', 'USD', 'GBP', 'HKD', 'CHF', 'RUB'];

async function fetchRate(base: Currency, quote: Currency): Promise<number | null> {
	if (base === quote) return 1;
	// Prefer Alpha Vantage FX_DAILY compact latest or CURRENCY_EXCHANGE_RATE endpoint
	const apiKey = env.ALPHAVANTAGE_API_KEY;
	try {
		const url = new URL(env.ALPHAVANTAGE_API_URL.replace(/\/$/, ''));
		url.searchParams.set('function', 'CURRENCY_EXCHANGE_RATE');
		url.searchParams.set('from_currency', base);
		url.searchParams.set('to_currency', quote);
		url.searchParams.set('apikey', apiKey);
		const res = await fetch(url.toString());
		if (!res.ok) return null;
		const data = await res.json();
		const raw = data?.['Realtime Currency Exchange Rate']?.['5. Exchange Rate'];
		const rate = Number(raw);
		return Number.isFinite(rate) && rate > 0 ? rate : null;
	} catch {
		return null;
	}
}

async function upsertRate(base: Currency, quote: Currency, rate: number) {
	await db.fxRate.upsert({
		create: { base, quote, rate },
		update: { fetchedAt: new Date(), rate },
		where: { base_quote: { base, quote } as any }
	});
}

async function main() {
	const pairs: Array<[Currency, Currency]> = [];
	for (const b of supported) for (const q of supported) if (b !== q) pairs.push([b, q]);
	// To stay within free-tier limits, fetch against a pivot (USD) then triangulate
	const pivot: Currency = 'USD';
	const toFetch = new Set<string>();
	for (const c of supported)
		if (c !== pivot) {
			toFetch.add(`${pivot}->${c}`);
			toFetch.add(`${c}->${pivot}`);
		}
	const fetched: Record<string, number> = {};

	for (const key of toFetch) {
		const [base, quote] = key.split('->') as [Currency, Currency];
		const r = await fetchRate(base, quote);
		if (r) {
			fetched[key] = r;
			await upsertRate(base, quote, r);
		}
		// polite delay to avoid throttling
		await new Promise((r) => setTimeout(r, 1500));
	}

	// Derive cross rates and write them too for convenience
	for (const b of supported)
		for (const q of supported) {
			if (b === q) continue;
			const key = `${b}->${q}`;
			if (fetched[key]) continue;
			const b2p = fetched[`${b}->${pivot}`];
			const p2q = fetched[`${pivot}->${q}`];
			if (b2p && p2q) {
				const rate = b2p * p2q;
				await upsertRate(b, q, rate);
			}
		}
	console.log('FX ingest done');
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
