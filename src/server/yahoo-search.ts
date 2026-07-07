export type YahooRawQuote = {
	symbol: string;
	shortname?: string;
	longname?: string;
	exchange?: string;
	exchDisp?: string;
	quoteType?: string;
	typeDisp?: string;
	isYahooFinance?: boolean;
};

export type YahooSearchResult = {
	symbol: string;
	description: string;
	type: string;
	exchange: string;
};

export const TRADABLE_QUOTE_TYPES = ['EQUITY', 'ETF', 'MUTUALFUND', 'INDEX', 'CRYPTOCURRENCY'] as const;

const YAHOO_SEARCH_URL = 'https://query1.finance.yahoo.com/v1/finance/search';

/**
 * Keep only tradable, Yahoo-native quotes and normalize them for the picker.
 * Drops non-tradable entries (isYahooFinance !== true) and quote types outside the allowlist.
 */
export function filterTradableQuotes(quotes: YahooRawQuote[]): YahooSearchResult[] {
	const allow = TRADABLE_QUOTE_TYPES as readonly string[];
	return quotes
		.filter((q) => q.isYahooFinance === true && !!q.quoteType && allow.includes(q.quoteType))
		.map((q) => ({
			description: q.longname || q.shortname || q.symbol,
			exchange: q.exchDisp || q.exchange || '',
			symbol: q.symbol,
			type: q.typeDisp || q.quoteType || ''
		}));
}

/**
 * Fetch raw Yahoo search quotes for a query. Returns [] on any HTTP/parse failure.
 * Env-free: the search endpoint is fixed and unauthenticated.
 */
export async function fetchYahooSearchQuotes(q: string): Promise<YahooRawQuote[]> {
	const url = new URL(YAHOO_SEARCH_URL);
	url.searchParams.set('q', q);
	url.searchParams.set('lang', 'en-US');
	url.searchParams.set('region', 'US');
	url.searchParams.set('newsCount', '0');
	url.searchParams.set('enableLogoUrl', 'false');
	try {
		const res = await fetch(url.toString(), {
			headers: {
				Accept: 'application/json, text/plain, */*',
				'User-Agent': 'Mozilla/5.0 (compatible; invest-igator/1.0)'
			}
		});
		if (!res.ok) return [];
		const data = (await res.json()) as { quotes?: YahooRawQuote[] };
		return Array.isArray(data.quotes) ? data.quotes : [];
	} catch {
		return [];
	}
}

/** Tradable, normalized search results for the symbol picker. */
export async function searchYahooSymbols(q: string): Promise<YahooSearchResult[]> {
	return filterTradableQuotes(await fetchYahooSearchQuotes(q));
}

/**
 * Existence check used to validate user-typed symbols (transaction create, CSV import).
 * Lenient by design: matches the exact symbol against ALL returned quotes so a real ticker
 * is never falsely rejected. Replaces the buggy isValidSymbolViaYahoo (v8/finance/search 500).
 */
export async function symbolExistsOnYahoo(symbol: string): Promise<boolean> {
	const up = symbol.trim().toUpperCase();
	if (!up) return false;
	const quotes = await fetchYahooSearchQuotes(up);
	return quotes.some((q) => (q.symbol || '').toUpperCase() === up);
}
