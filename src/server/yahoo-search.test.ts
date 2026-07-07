import { describe, expect, test } from 'bun:test';
import { fetchYahooSearchQuotes, filterTradableQuotes, symbolExistsOnYahoo } from './yahoo-search';

describe('filterTradableQuotes', () => {
	test('keeps tradable Yahoo quotes and drops the rest', () => {
		const out = filterTradableQuotes([
			{
				exchDisp: 'NASDAQ',
				isYahooFinance: true,
				longname: 'Apple Inc.',
				quoteType: 'EQUITY',
				symbol: 'AAPL',
				typeDisp: 'Equity'
			},
			{
				exchDisp: 'CCC',
				isYahooFinance: true,
				quoteType: 'CRYPTOCURRENCY',
				shortname: 'Bitcoin USD',
				symbol: 'BTC-USD',
				typeDisp: 'Cryptocurrency'
			},
			{ isYahooFinance: false, quoteType: 'EQUITY', symbol: 'FAKECB', typeDisp: 'Equity' },
			{ isYahooFinance: true, quoteType: 'FUTURE', symbol: 'BTC=F', typeDisp: 'Futures' }
		]);
		expect(out.map((q) => q.symbol)).toEqual(['AAPL', 'BTC-USD']);
		expect(out[0]).toEqual({ description: 'Apple Inc.', exchange: 'NASDAQ', symbol: 'AAPL', type: 'Equity' });
		expect(out[1]!.description).toBe('Bitcoin USD');
	});
});

describe('symbolExistsOnYahoo (tri-state)', () => {
	const withFetch = async (fetchImpl: typeof fetch, run: () => Promise<void>) => {
		const original = globalThis.fetch;
		globalThis.fetch = fetchImpl;
		try {
			await run();
		} finally {
			globalThis.fetch = original;
		}
	};

	test("'yes' on exact match, 'no' when reached with no match", async () => {
		await withFetch(
			(async () =>
				new Response(JSON.stringify({ quotes: [{ isYahooFinance: true, symbol: 'AAPL' }] }), {
					status: 200
				})) as typeof fetch,
			async () => {
				expect(await symbolExistsOnYahoo('aapl')).toBe('yes');
				expect(await symbolExistsOnYahoo('NOPE')).toBe('no');
			}
		);
	});

	test("'unreachable' when fetch throws", async () => {
		await withFetch(
			(async () => {
				throw new Error('network down');
			}) as typeof fetch,
			async () => {
				expect(await symbolExistsOnYahoo('AAPL')).toBe('unreachable');
			}
		);
	});

	test("'unreachable' on non-ok response", async () => {
		await withFetch((async () => new Response('boom', { status: 500 })) as typeof fetch, async () => {
			expect(await symbolExistsOnYahoo('AAPL')).toBe('unreachable');
		});
	});
});

describe('fetchYahooSearchQuotes', () => {
	test('fetchYahooSearchQuotes returns [] on non-ok response', async () => {
		const original = globalThis.fetch;
		globalThis.fetch = (async () => new Response('boom', { status: 500 })) as typeof fetch;
		try {
			expect(await fetchYahooSearchQuotes('AAPL')).toEqual([]);
		} finally {
			globalThis.fetch = original;
		}
	});

	test('fetchYahooSearchQuotes returns [] when fetch throws', async () => {
		const original = globalThis.fetch;
		globalThis.fetch = (async () => {
			throw new Error('network down');
		}) as typeof fetch;
		try {
			expect(await fetchYahooSearchQuotes('AAPL')).toEqual([]);
		} finally {
			globalThis.fetch = original;
		}
	});
});
