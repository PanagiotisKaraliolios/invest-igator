#!/usr/bin/env bun
import { env } from '@/env';
import type { Currency } from '@/lib/currency';
import { SUPPORTED_CURRENCIES } from '@/lib/currency';
import { db } from '@/server/db';

const supported = SUPPORTED_CURRENCIES;
const PIVOT: Currency = 'USD';

/**
 * Skip re-fetching a USD leg whose stored rate is younger than this. A daily cron still refreshes
 * everything, but a re-run within the day costs ~0 API calls and only fills in missing/stale legs —
 * so a rate-limited run no longer re-spends the whole Alpha Vantage free-tier budget on healthy rates.
 */
const FRESH_MS = 20 * 60 * 60 * 1000;
const PACING_MS = 1500;

type FetchResult = { rate: number } | { limited: true } | { error: string } | { missing: true };

/**
 * Fetch one FX rate from Alpha Vantage. Alpha Vantage returns HTTP 200 with a `Note`/`Information`
 * field for both the daily rate limit AND permanent failures (invalid/missing apikey, premium-only
 * endpoints). We classify those apart: a genuine rate limit is retryable (`limited`), but a config
 * error must surface loudly (`error`) rather than being mislabeled as "retry tomorrow" and silently
 * serving stale rates forever.
 */
async function fetchRate(base: Currency, quote: Currency): Promise<FetchResult> {
	if (base === quote) return { rate: 1 };
	try {
		const url = new URL(env.ALPHAVANTAGE_API_URL.replace(/\/$/, ''));
		url.searchParams.set('function', 'CURRENCY_EXCHANGE_RATE');
		url.searchParams.set('from_currency', base);
		url.searchParams.set('to_currency', quote);
		url.searchParams.set('apikey', env.ALPHAVANTAGE_API_KEY);
		const res = await fetch(url.toString());
		if (res.status === 429) return { limited: true };
		if (!res.ok) return { missing: true };
		const data = (await res.json()) as Record<string, unknown>;
		const message =
			typeof data.Note === 'string'
				? data.Note
				: typeof data.Information === 'string'
					? data.Information
					: undefined;
		if (message) {
			return /rate limit|per day|call frequency/i.test(message) ? { limited: true } : { error: message };
		}
		const quoteObj = data['Realtime Currency Exchange Rate'] as Record<string, unknown> | undefined;
		const rate = Number(quoteObj?.['5. Exchange Rate']);
		return Number.isFinite(rate) && rate > 0 ? { rate } : { missing: true };
	} catch {
		return { missing: true };
	}
}

async function upsertRate(base: Currency, quote: Currency, rate: number, fetchedAt: Date) {
	await db.fxRate.upsert({
		create: { base, fetchedAt, quote, rate },
		update: { fetchedAt, rate },
		where: { base_quote: { base, quote } }
	});
}

async function main() {
	const now = Date.now();

	// Only USD legs are fetched; the reverse and all cross rates are derived (getFxMatrix/convertAmount
	// also derive them at query time). Load existing USD legs to decide what's fresh and to seed
	// derivation for legs we skip this run.
	const existing = await db.fxRate.findMany({
		select: { fetchedAt: true, quote: true, rate: true },
		where: { base: PIVOT }
	});
	const priorUsdLeg = new Map(existing.map((r) => [r.quote, r]));

	// USD->c rate (+ its source freshness) for every currency we can serve after this run.
	const usdLeg = new Map<string, { rate: number; fetchedAt: Date }>();
	let fetched = 0;
	let skippedFresh = 0;
	let limited = 0;
	let errored = 0;
	let missing = 0;
	const errorMessages: string[] = [];
	let rateLimitHit = false;

	for (const c of supported) {
		if (c === PIVOT) continue;
		const prior = priorUsdLeg.get(c);
		const keepPrior = () => {
			if (prior) usdLeg.set(c, { fetchedAt: prior.fetchedAt, rate: prior.rate });
		};

		if (prior && now - prior.fetchedAt.getTime() < FRESH_MS) {
			usdLeg.set(c, { fetchedAt: prior.fetchedAt, rate: prior.rate });
			skippedFresh++;
		} else if (rateLimitHit) {
			// Daily quota already exhausted this run — don't waste more calls; retry next run.
			limited++;
			keepPrior();
		} else {
			const result = await fetchRate(PIVOT, c);
			if ('rate' in result) {
				await upsertRate(PIVOT, c, result.rate, new Date());
				usdLeg.set(c, { fetchedAt: new Date(), rate: result.rate });
				fetched++;
			} else if ('limited' in result) {
				limited++;
				rateLimitHit = true;
				keepPrior();
			} else if ('error' in result) {
				errored++;
				errorMessages.push(result.error);
				keepPrior();
			} else {
				missing++;
				keepPrior();
			}
			await new Promise((r) => setTimeout(r, PACING_MS));
		}

		// Keep the reciprocal in lockstep with USD->c (overwrites any stale/independent c->USD row),
		// so USD<->c conversion is deterministic regardless of DB row order in getFxMatrix.
		const leg = usdLeg.get(c);
		if (leg) await upsertRate(c, PIVOT, 1 / leg.rate, leg.fetchedAt);
	}

	// Derive + store cross rates from the USD legs so the admin FX table stays populated.
	// b->q = (USD->q) / (USD->b); fetchedAt = the older of the two source legs (honest freshness).
	for (const b of supported)
		for (const q of supported) {
			if (b === q || b === PIVOT || q === PIVOT) continue;
			const legB = usdLeg.get(b);
			const legQ = usdLeg.get(q);
			if (legB && legQ) {
				const fetchedAt = legB.fetchedAt < legQ.fetchedAt ? legB.fetchedAt : legQ.fetchedAt;
				await upsertRate(b, q, legQ.rate / legB.rate, fetchedAt);
			}
		}

	console.log(
		`FX ingest done — fetched ${fetched}, skipped-fresh ${skippedFresh}, rate-limited ${limited}, errors ${errored}, missing ${missing}.`
	);
	if (limited > 0) {
		console.warn(
			`${limited} rate(s) hit the Alpha Vantage daily rate limit; they will be retried on the next run (limit resets daily).`
		);
	}
	if (errored > 0) {
		console.error(
			`Alpha Vantage returned non-rate-limit error(s) (check ALPHAVANTAGE_API_KEY / plan): ${[...new Set(errorMessages)].join(' | ')}`
		);
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
