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

/** Fetch raw Yahoo search quotes, distinguishing "reached Yahoo" (ok:true) from "couldn't reach it" (ok:false). */
export async function fetchYahooSearchResult(q: string): Promise<{ ok: boolean; quotes: YahooRawQuote[] }> {
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
		if (!res.ok) return { ok: false, quotes: [] };
		const data = (await res.json()) as { quotes?: YahooRawQuote[] };
		return { ok: true, quotes: Array.isArray(data.quotes) ? data.quotes : [] };
	} catch {
		return { ok: false, quotes: [] };
	}
}

/** Raw Yahoo search quotes (picker path). Returns [] on any HTTP/parse/network failure. */
export async function fetchYahooSearchQuotes(q: string): Promise<YahooRawQuote[]> {
	return (await fetchYahooSearchResult(q)).quotes;
}

/** Tradable, normalized search results for the symbol picker. */
export async function searchYahooSymbols(q: string): Promise<YahooSearchResult[]> {
	return filterTradableQuotes(await fetchYahooSearchQuotes(q));
}

export type SymbolExistence = 'yes' | 'no' | 'unreachable';

/**
 * Existence check for user-typed symbols (transaction create/update, CSV import, watchlist add).
 * Tri-state so a transient Yahoo failure is NOT mistaken for "does not exist":
 * - 'yes'         — a returned quote's symbol exactly matches (case-insensitive)
 * - 'no'          — Yahoo was reached but returned no matching symbol
 * - 'unreachable' — Yahoo could not be reached / returned a non-ok response
 * Lenient match against ALL returned quotes (not the tradable-filtered list) so a real ticker is never falsely rejected.
 */
export async function symbolExistsOnYahoo(symbol: string): Promise<SymbolExistence> {
	const up = symbol.trim().toUpperCase();
	if (!up) return 'no';
	const { ok, quotes } = await fetchYahooSearchResult(up);
	if (!ok) return 'unreachable';
	return quotes.some((q) => (q.symbol || '').toUpperCase() === up) ? 'yes' : 'no';
}
