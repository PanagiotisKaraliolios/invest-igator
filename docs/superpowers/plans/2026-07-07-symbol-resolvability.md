# Symbol Resolvability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Guarantee a tracked symbol actually resolves to Yahoo price data, reject the ones that don't with a clear error, and fix the live symbol-validation bug — closing the "symbol Yahoo can't recognize" gap.

**Architecture:** Extract all Yahoo *search* access into one env-free helper module and all Yahoo *chart-response classification* into one env-free parser module; both are unit-tested with Bun's built-in runner. The tRPC routers and the ingest library are then rewired onto these helpers, and `watchlist.add` becomes await-and-validate (block on no data). Currency work is deferred to Spec 2.

**Tech Stack:** Next.js 16, tRPC v11, Prisma 7, InfluxDB, Bun 1.3.14 (runtime + `bun test`), Biome 2, Yahoo Finance public endpoints (`v1/finance/search`, `v8/finance/chart`).

## Global Constraints

- Runtime/test tool: **Bun 1.3.14**. Unit tests use `bun test` (import from `bun:test`). Do **not** add vitest/jest.
- Unit tests live beside their module as `*.test.ts` under `src/` and are run with `bun test src` (Playwright E2E lives in `tests/e2e` and must not be picked up).
- Quality gates (all must pass before a task's final commit): `bun run typecheck` (exit 0), `bun run check` (biome, exit 0), and — for tasks touching server routers or the ingest lib — `bun run build` (exit 0).
- Code style is Biome-enforced: **tabs**, **single quotes**, sorted object keys. Run `bunx @biomejs/biome check --write ./src` to auto-format, then `bun run check` to verify clean.
- Yahoo search endpoint is **`https://query1.finance.yahoo.com/v1/finance/search`** (v1, not v8). Yahoo chart endpoint stays `${YAHOO_API_URL}/chart/{symbol}`.
- Quote-type allowlist (locked decision): `EQUITY, ETF, MUTUALFUND, INDEX, CRYPTOCURRENCY`, plus `isYahooFinance === true` for the search *picker*.
- Bad-symbol UX (locked decision): **block on add, fail loud** — a symbol with no Yahoo price data is rejected and not persisted.
- Commit trailer on every commit:
  `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`

---

### Task 1: Yahoo search helper (`searchYahooSymbols`, `symbolExistsOnYahoo`) + tradable filter

**Files:**
- Create: `src/server/yahoo-search.ts`
- Test: `src/server/yahoo-search.test.ts`
- Modify: `package.json` (add `test:unit` script)

**Interfaces:**
- Produces:
  - `type YahooRawQuote = { symbol: string; shortname?: string; longname?: string; exchange?: string; exchDisp?: string; quoteType?: string; typeDisp?: string; isYahooFinance?: boolean }`
  - `type YahooSearchResult = { symbol: string; description: string; type: string; exchange: string }`
  - `const TRADABLE_QUOTE_TYPES` (readonly tuple)
  - `function filterTradableQuotes(quotes: YahooRawQuote[]): YahooSearchResult[]`
  - `async function fetchYahooSearchQuotes(q: string): Promise<YahooRawQuote[]>`
  - `async function searchYahooSymbols(q: string): Promise<YahooSearchResult[]>`
  - `async function symbolExistsOnYahoo(symbol: string): Promise<boolean>`

- [ ] **Step 1: Add the `test:unit` script**

In `package.json`, add to `scripts` (alongside the existing `test:e2e` scripts):

```json
"test:unit": "bun test src",
```

- [ ] **Step 2: Write the failing test**

Create `src/server/yahoo-search.test.ts`:

```ts
import { describe, expect, test } from 'bun:test';
import { fetchYahooSearchQuotes, filterTradableQuotes, symbolExistsOnYahoo } from './yahoo-search';

describe('filterTradableQuotes', () => {
	test('keeps tradable Yahoo quotes and drops the rest', () => {
		const out = filterTradableQuotes([
			{ symbol: 'AAPL', longname: 'Apple Inc.', quoteType: 'EQUITY', typeDisp: 'Equity', exchDisp: 'NASDAQ', isYahooFinance: true },
			{ symbol: 'BTC-USD', shortname: 'Bitcoin USD', quoteType: 'CRYPTOCURRENCY', typeDisp: 'Cryptocurrency', exchDisp: 'CCC', isYahooFinance: true },
			{ symbol: 'FAKECB', quoteType: 'EQUITY', typeDisp: 'Equity', isYahooFinance: false },
			{ symbol: 'BTC=F', quoteType: 'FUTURE', typeDisp: 'Futures', isYahooFinance: true }
		]);
		expect(out.map((q) => q.symbol)).toEqual(['AAPL', 'BTC-USD']);
		expect(out[0]).toEqual({ symbol: 'AAPL', description: 'Apple Inc.', type: 'Equity', exchange: 'NASDAQ' });
		expect(out[1]!.description).toBe('Bitcoin USD');
	});
});

describe('symbolExistsOnYahoo', () => {
	test('true on exact symbol match, false otherwise', async () => {
		const original = globalThis.fetch;
		globalThis.fetch = (async () =>
			new Response(JSON.stringify({ quotes: [{ symbol: 'AAPL', isYahooFinance: true }] }), { status: 200 })) as typeof fetch;
		try {
			expect(await symbolExistsOnYahoo('aapl')).toBe(true);
			expect(await symbolExistsOnYahoo('NOPE')).toBe(false);
		} finally {
			globalThis.fetch = original;
		}
	});

	test('fetchYahooSearchQuotes returns [] on non-ok response', async () => {
		const original = globalThis.fetch;
		globalThis.fetch = (async () => new Response('boom', { status: 500 })) as typeof fetch;
		try {
			expect(await fetchYahooSearchQuotes('AAPL')).toEqual([]);
		} finally {
			globalThis.fetch = original;
		}
	});
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `bun test src/server/yahoo-search.test.ts`
Expected: FAIL — cannot find module `./yahoo-search` (not created yet).

- [ ] **Step 4: Implement the helper**

Create `src/server/yahoo-search.ts`:

```ts
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
	const res = await fetch(url.toString(), {
		headers: {
			Accept: 'application/json, text/plain, */*',
			'User-Agent': 'Mozilla/5.0 (compatible; invest-igator/1.0)'
		}
	});
	if (!res.ok) return [];
	const data = (await res.json()) as { quotes?: YahooRawQuote[] };
	return Array.isArray(data.quotes) ? data.quotes : [];
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
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `bun test src/server/yahoo-search.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Typecheck**

Run: `bun run typecheck`
Expected: exit 0, no errors.

- [ ] **Step 7: Format + lint**

Run: `bunx @biomejs/biome check --write ./src && bun run check`
Expected: `bun run check` exits 0.

- [ ] **Step 8: Commit**

```bash
git add src/server/yahoo-search.ts src/server/yahoo-search.test.ts package.json
git commit -m "feat(yahoo): add env-free Yahoo search helper + tradable filter

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Chart-response classifier (`classifyChartResponse`)

**Files:**
- Create: `src/server/yahoo-chart-parse.ts`
- Test: `src/server/yahoo-chart-parse.test.ts`

**Interfaces:**
- Consumes: `type DailyBar` from `@/server/influx` (type-only import; runtime-safe).
- Produces:
  - `type ChartStatus = 'found' | 'empty' | 'not-found'`
  - `type DividendEvent = { date: string; amount: number }`
  - `type SplitEvent = { date: string; numerator: number; denominator: number; ratio: number }`
  - `type CapitalGainEvent = { date: string; amount: number }`
  - `interface YahooChartResponse` (moved out of `yahoo-lib.ts`)
  - `function toDateStringFromEpochSec(epochSec: number, gmtoffset?: number): string`
  - `function classifyChartResponse(json: YahooChartResponse): { status: ChartStatus; bars: DailyBar[]; dividends: DividendEvent[]; splits: SplitEvent[]; capitalGains: CapitalGainEvent[]; currency?: string }`

- [ ] **Step 1: Write the failing test**

Create `src/server/yahoo-chart-parse.test.ts`:

```ts
import { describe, expect, test } from 'bun:test';
import { classifyChartResponse } from './yahoo-chart-parse';

describe('classifyChartResponse', () => {
	test("not-found when Yahoo returns no result (chart.error set)", () => {
		const out = classifyChartResponse({ chart: { error: { code: 'Not Found' }, result: undefined } });
		expect(out.status).toBe('not-found');
		expect(out.bars).toEqual([]);
	});

	test('empty when result present but no usable bars', () => {
		const out = classifyChartResponse({
			chart: { result: [{ indicators: { quote: [{}] }, meta: { currency: 'USD', gmtoffset: 0 }, timestamp: [] }] }
		});
		expect(out.status).toBe('empty');
		expect(out.bars).toEqual([]);
		expect(out.currency).toBe('USD');
	});

	test('found with real bars', () => {
		const out = classifyChartResponse({
			chart: {
				result: [
					{
						indicators: { quote: [{ close: [10.5], high: [11], low: [9], open: [10], volume: [1000] }] },
						meta: { currency: 'GBp', gmtoffset: 0 },
						timestamp: [1704067200]
					}
				]
			}
		});
		expect(out.status).toBe('found');
		expect(out.bars).toHaveLength(1);
		expect(out.bars[0]!.close).toBe(10.5);
		expect(out.currency).toBe('GBp');
	});
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test src/server/yahoo-chart-parse.test.ts`
Expected: FAIL — cannot find module `./yahoo-chart-parse`.

- [ ] **Step 3: Implement the parser** (moves the parse logic verbatim out of `yahoo-lib.ts` and adds `status`)

Create `src/server/yahoo-chart-parse.ts`:

```ts
import type { DailyBar } from '@/server/influx';

export type ChartStatus = 'found' | 'empty' | 'not-found';
export type DividendEvent = { date: string; amount: number };
export type SplitEvent = { date: string; numerator: number; denominator: number; ratio: number };
export type CapitalGainEvent = { date: string; amount: number };

export interface YahooChartResponse {
	chart?: {
		result?: Array<{
			meta?: { currency: string; gmtoffset?: number };
			timestamp?: number[];
			events?: {
				dividends?: Record<string, { amount?: number; date?: number }>;
				splits?: Record<string, { date?: number; numerator?: number; denominator?: number; splitRatio?: number }>;
				capitalGains?: Record<string, { amount?: number; date?: number }>;
			};
			indicators?: {
				quote?: Array<{
					open?: Array<number | null>;
					high?: Array<number | null>;
					low?: Array<number | null>;
					close?: Array<number | null>;
					volume?: Array<number | null>;
				}>;
			};
		}>;
		error?: unknown;
	};
}

export function toDateStringFromEpochSec(epochSec: number, gmtoffset?: number): string {
	const offsetMs = (gmtoffset ?? 0) * 1000;
	const d = new Date(epochSec * 1000 + offsetMs);
	const y = d.getUTCFullYear();
	const m = String(d.getUTCMonth() + 1).padStart(2, '0');
	const day = String(d.getUTCDate()).padStart(2, '0');
	return `${y}-${m}-${day}`;
}

/**
 * Classify a Yahoo chart response and extract bars/events.
 * - not-found: Yahoo returned no result[0] (unknown symbol; chart.error is typically set)
 * - empty: result[0] present but zero usable bars (valid symbol, no data in range)
 * - found: at least one usable bar
 */
export function classifyChartResponse(json: YahooChartResponse): {
	status: ChartStatus;
	bars: DailyBar[];
	dividends: DividendEvent[];
	splits: SplitEvent[];
	capitalGains: CapitalGainEvent[];
	currency?: string;
} {
	const res = json.chart?.result?.[0];
	if (!res) {
		return { bars: [], capitalGains: [], dividends: [], splits: [], status: 'not-found' };
	}

	const currency = res.meta?.currency;
	const quote = res.indicators?.quote?.[0];
	const gmtoffset = res.meta?.gmtoffset;
	const bars: DailyBar[] = [];
	if (quote && res.timestamp) {
		const timestamps = res.timestamp ?? [];
		for (let i = 0; i < timestamps.length; i++) {
			const ts = timestamps[i]!;
			const o = quote.open?.[i] ?? null;
			const h = quote.high?.[i] ?? null;
			const l = quote.low?.[i] ?? null;
			const c = quote.close?.[i] ?? null;
			const v = quote.volume?.[i] ?? 0;
			if (o == null || h == null || l == null || c == null) continue;
			if ([o, h, l, c].some((n) => Number.isNaN(Number(n)))) continue;
			bars.push({
				close: Number(c),
				high: Number(h),
				low: Number(l),
				open: Number(o),
				time: toDateStringFromEpochSec(ts, gmtoffset ?? 0),
				volume: Math.max(0, Math.round(Number(v ?? 0)))
			});
		}
		bars.sort((a, b) => a.time.localeCompare(b.time));
	}

	const dividends: DividendEvent[] = [];
	const dividendsMap = res.events?.dividends ?? {};
	for (const key of Object.keys(dividendsMap)) {
		const ev = dividendsMap[key]!;
		const amount = Number(ev.amount ?? Number.NaN);
		const dateSec = ev.date ?? Number(key);
		if (!Number.isFinite(amount) || !Number.isFinite(dateSec)) continue;
		dividends.push({ amount, date: toDateStringFromEpochSec(dateSec, gmtoffset ?? 0) });
	}
	dividends.sort((a, b) => a.date.localeCompare(b.date));

	const splits: SplitEvent[] = [];
	const splitsMap = res.events?.splits ?? {};
	for (const key of Object.keys(splitsMap)) {
		const ev = splitsMap[key]!;
		const dateSec = ev.date ?? Number(key);
		const numerator = Number(ev.numerator ?? Number.NaN);
		const denominator = Number(ev.denominator ?? Number.NaN);
		const ratio = Number(
			Number.isFinite(ev.splitRatio as number)
				? (ev.splitRatio as number)
				: Number.isFinite(numerator) && Number.isFinite(denominator) && denominator !== 0
					? numerator / denominator
					: Number.NaN
		);
		if (
			!Number.isFinite(dateSec) ||
			!Number.isFinite(numerator) ||
			!Number.isFinite(denominator) ||
			!Number.isFinite(ratio)
		)
			continue;
		splits.push({ date: toDateStringFromEpochSec(dateSec, gmtoffset ?? 0), denominator, numerator, ratio });
	}
	splits.sort((a, b) => a.date.localeCompare(b.date));

	const capitalGains: CapitalGainEvent[] = [];
	const capMap = res.events?.capitalGains ?? {};
	for (const key of Object.keys(capMap)) {
		const ev = capMap[key]!;
		const amount = Number(ev.amount ?? Number.NaN);
		const dateSec = ev.date ?? Number(key);
		if (!Number.isFinite(amount) || !Number.isFinite(dateSec)) continue;
		capitalGains.push({ amount, date: toDateStringFromEpochSec(dateSec, gmtoffset ?? 0) });
	}
	capitalGains.sort((a, b) => a.date.localeCompare(b.date));

	return { bars, capitalGains, currency, dividends, splits, status: bars.length > 0 ? 'found' : 'empty' };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test src/server/yahoo-chart-parse.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Typecheck, format, commit**

```bash
bun run typecheck
bunx @biomejs/biome check --write ./src && bun run check
git add src/server/yahoo-chart-parse.ts src/server/yahoo-chart-parse.test.ts
git commit -m "feat(yahoo): env-free chart-response classifier with found/empty/not-found status

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```
Expected: typecheck exit 0, check exit 0.

---

### Task 3: Rewire `fetchYahooDaily` onto the parser + propagate status + fix `.env.example`

**Files:**
- Modify: `src/server/jobs/yahoo-lib.ts` (replace inline parse at ~28-54 type, ~60-71 helpers, ~73-200 fetch body; ~307-347 ingest return)
- Modify: `.env.example:26`

**Interfaces:**
- Consumes: `classifyChartResponse`, `YahooChartResponse`, `ChartStatus`, `DividendEvent`, `SplitEvent`, `CapitalGainEvent` from Task 2.
- Produces:
  - `fetchYahooDaily(...)` return type gains `status: ChartStatus`.
  - `ingestYahooSymbol(...)` return gains `status: ChartStatus`: `{ count: number; currency: Currency; skipped: boolean; status: ChartStatus }`.

- [ ] **Step 1: Remove the moved declarations from `yahoo-lib.ts`**

Delete these now-relocated blocks (they live in `yahoo-chart-parse.ts` after Task 2):
- the `interface YahooChartResponse { ... }` (currently lines 28-54)
- the `function toDateStringFromEpochSec(...) { ... }` (currently lines 60-67)
- the `type DividendEvent`, `type SplitEvent`, `type CapitalGainEvent` (currently lines 69-71)

- [ ] **Step 2: Add the import** near the top of `yahoo-lib.ts` (after the existing imports). It must include the event types, since Step 1 removed them from this file:

```ts
import {
	type CapitalGainEvent,
	type ChartStatus,
	classifyChartResponse,
	type DividendEvent,
	type SplitEvent,
	type YahooChartResponse
} from '@/server/yahoo-chart-parse';
```

- [ ] **Step 3: Replace the `fetchYahooDaily` body and return type**

Change its return type annotation (currently ends at line 88 `currency?: string;\n}`) to include `status`, and replace the parse body (currently lines 108-200) so it delegates to the classifier. The function becomes:

```ts
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
```

Note: `DividendEvent`, `SplitEvent`, `CapitalGainEvent` in the return type now come from the Task-2 import; keep the return-type property names identical so existing callers compile unchanged.

- [ ] **Step 4: Propagate `status` from `ingestYahooSymbol`**

In `ingestYahooSymbol` (currently ~307-347), destructure `status` and include it in the return:

```ts
	const { bars, dividends, splits, capitalGains, currency, status } = await fetchYahooDaily(symbol, {
		includePrePost: false,
		interval: '1d',
		period1: 1,
		period2: Math.floor(Date.now() / 1000)
	});
```

and change the final return to:

```ts
	return { count: bars.length, currency: mapCurrencyString(currency), skipped: false, status } as const;
```

- [ ] **Step 5: Fix the `.env.example` foot-gun**

In `.env.example` line 26, change:

```
YAHOO_API_URL=https://query2.finance.yahoo.com/v8/finance/chart
```

to:

```
YAHOO_API_URL=https://query1.finance.yahoo.com/v8/finance
```

- [ ] **Step 6: Verify — unit tests still green, typecheck, build**

Run: `bun test src` — Expected: all Task 1 + Task 2 tests PASS.
Run: `bun run typecheck` — Expected: exit 0.
Run: `bun run build` — Expected: exit 0 (compiles the modified server lib).

- [ ] **Step 7: Format + commit**

```bash
bunx @biomejs/biome check --write ./src && bun run check
git add src/server/jobs/yahoo-lib.ts .env.example
git commit -m "refactor(ingest): delegate chart parsing to classifier; expose fetch status; fix .env.example URL

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: `watchlist.search` on the helper + show exchange in the UI

**Files:**
- Modify: `src/server/api/routers/watchlist.ts:386-438` (the `search` procedure)
- Modify: `src/app/(dashboard)/watchlist/_components/search-assets.tsx`

**Interfaces:**
- Consumes: `searchYahooSymbols`, `type YahooSearchResult` from Task 1.
- Produces: `watchlist.search` returns `{ count: number; result: Array<{ symbol: string; displaySymbol: string; description: string; type: string; exchange: string }> }`.

- [ ] **Step 1: Rewrite the `search` procedure**

Add the import at the top of `watchlist.ts`:

```ts
import { searchYahooSymbols } from '@/server/yahoo-search';
```

Replace the whole `search` procedure body (lines 386-438) with:

```ts
	search: withPermissions('watchlist', 'read')
		.input(z.object({ q: z.string().min(1) }))
		.query(async ({ input }) => {
			const results = await searchYahooSymbols(input.q);
			const data = {
				count: results.length,
				result: results.map((r) => ({
					description: r.description,
					displaySymbol: r.symbol,
					exchange: r.exchange,
					symbol: r.symbol,
					type: r.type
				}))
			};
			if (process.env.NODE_ENV !== 'production') {
				console.log('[watchlist.search] Yahoo Finance response', data);
			}
			return data;
		}),
```

- [ ] **Step 2: Show the exchange in the results list**

In `search-assets.tsx`, the `SearchResult` type is derived from `RouterOutputs` and now includes `exchange`. Update the result row (currently the `<div className='font-medium'>...</div>` block at lines 57-60) to render the exchange when present:

```tsx
											<div>
												<div className='flex items-center gap-2'>
													<span className='font-medium'>{r.displaySymbol || r.symbol}</span>
													{r.exchange && (
														<span className='rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground'>
															{r.exchange}
														</span>
													)}
												</div>
												<div className='text-xs text-muted-foreground'>{r.description}</div>
											</div>
```

- [ ] **Step 3: Verify — typecheck + build**

Run: `bun run typecheck` — Expected: exit 0 (the `add.mutate` call in this file does not pass `exchange`, which is fine — `add` does not accept it).
Run: `bun run build` — Expected: exit 0.

- [ ] **Step 4: Format + commit**

```bash
bunx @biomejs/biome check --write ./src && bun run check
git add src/server/api/routers/watchlist.ts "src/app/(dashboard)/watchlist/_components/search-assets.tsx"
git commit -m "feat(watchlist): search via shared Yahoo helper (tradable filter) + show exchange

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Fix the live validation bug (`isValidSymbolViaYahoo` → `symbolExistsOnYahoo`)

**Files:**
- Modify: `src/server/api/routers/transactions.ts` (remove `isValidSymbolViaYahoo` at lines 10-37; update call sites at 151 and 853)

**Interfaces:**
- Consumes: `symbolExistsOnYahoo` from Task 1.

- [ ] **Step 1: Replace the broken helper with the import**

Delete the entire `isValidSymbolViaYahoo` function (the JSDoc block + function, lines 10-37). `env` is used **only** inside that function (line 16, `${env.YAHOO_API_URL}/search`), so also delete the now-unused `import { env } from '@/env';` (line 4). Add the new import at the top of `transactions.ts`:

```ts
import { symbolExistsOnYahoo } from '@/server/yahoo-search';
```

- [ ] **Step 2: Update both call sites**

Line ~151 (in `create`): change `const ok = await isValidSymbolViaYahoo(symbol);` to:

```ts
					const ok = await symbolExistsOnYahoo(symbol);
```

Line ~853 (in the symbol-change path): change `const ok = await isValidSymbolViaYahoo(nextSymbol);` to:

```ts
					const ok = await symbolExistsOnYahoo(nextSymbol);
```

- [ ] **Step 3: Verify — typecheck + build**

Run: `bun run typecheck` — Expected: exit 0.
Run: `bun run build` — Expected: exit 0.

- [ ] **Step 4: Format + commit**

```bash
bunx @biomejs/biome check --write ./src && bun run check
git add src/server/api/routers/transactions.ts
git commit -m "fix(transactions): validate symbols via v1 Yahoo search (was v8 -> HTTP 500)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Block-on-add in `watchlist.add`

**Files:**
- Modify: `src/server/api/routers/watchlist.ts:50-87` (the `add` mutation)

**Interfaces:**
- Consumes: `ingestYahooSymbol` (already imported; now returns `status` and `count` from Task 3).

**Approach (spec implementation-note option b — create-first, roll back on failure):** await the ingest instead of fire-and-forget; if the symbol has no Yahoo data (or verification fails) and this call created the row, delete it and throw. Pre-existing rows are never deleted. This preserves today's currency-setting behavior (the row exists while `ingestYahooSymbol` runs).

- [ ] **Step 1: Confirm `TRPCError` is imported**

`TRPCError` is already imported at `watchlist.ts:1` (`import { TRPCError } from '@trpc/server';`) — no change needed. `ingestYahooSymbol` and `normalizeSymbol` are also already imported and in use.

- [ ] **Step 2: Replace the `add` mutation body** (lines 59-86, the `.mutation(async ({ ctx, input }) => { ... })`)

```ts
		.mutation(async ({ ctx, input }) => {
			const userId = ctx.session.user.id;
			const symbol = normalizeSymbol(input.symbol);
			const data = { ...input, symbol };
			let created = false;
			let result: any;
			try {
				result = await ctx.db.watchlistItem.create({
					data: { userId, ...data }
				});
				created = true;
			} catch (e) {
				// upsert-like behavior for unique(userId,symbol)
				await ctx.db.watchlistItem.update({
					data: { ...data },
					where: { userId_symbol: { symbol, userId } }
				});
				result = { alreadyExists: true } as const;
			}

			// Validate the symbol actually has Yahoo price data; block (and roll back a
			// freshly-created row) if not. Pre-existing rows are left untouched.
			let ingest: Awaited<ReturnType<typeof ingestYahooSymbol>> | undefined;
			let verifyFailed = false;
			try {
				ingest = await ingestYahooSymbol(symbol, { userId });
			} catch {
				verifyFailed = true;
			}
			const noData = verifyFailed || !ingest || ingest.status === 'not-found' || ingest.count === 0;
			if (created && noData) {
				await ctx.db.watchlistItem.delete({ where: { userId_symbol: { symbol, userId } } }).catch(() => {});
				throw new TRPCError({
					code: 'BAD_REQUEST',
					message: verifyFailed
						? `Couldn't reach Yahoo to verify ${symbol}. Please try again.`
						: `Yahoo has no price data for ${symbol}.`
				});
			}

			return result ?? { alreadyExists: !created };
		}),
```

- [ ] **Step 3: Verify — typecheck + build**

Run: `bun run typecheck` — Expected: exit 0.
Run: `bun run build` — Expected: exit 0.

- [ ] **Step 4: Manual smoke (documented — no unit harness for tRPC + DB + auth)**

After `bun run dev`, on the Watchlist page: add a real symbol (e.g. `AAPL`) → succeeds and populates a chart; try adding a bogus symbol (e.g. `ZZZZZZ`) → error toast "Yahoo has no price data for ZZZZZZ." and no row appears. (The `onError` toast already exists in `search-assets.tsx`.)

- [ ] **Step 5: Format + commit**

```bash
bunx @biomejs/biome check --write ./src && bun run check
git add src/server/api/routers/watchlist.ts
git commit -m "feat(watchlist): block add when Yahoo has no price data (fail loud, roll back)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: CSV import existence check

**Files:**
- Modify: `src/server/api/routers/transactions.ts` (the `importCsv` procedure, ~291-420)

**Interfaces:**
- Consumes: `symbolExistsOnYahoo` (imported in Task 5), `sleep` from `@/server/jobs/yahoo-lib` (for gentle pacing).

**Approach:** deduplicate symbols first, skip ones already on the user's watchlist, validate the remainder against Yahoo once each, then reject offending rows through the existing per-line `errors[]` mechanism (preserves line numbers, dedupes network calls).

- [ ] **Step 1: Add the pacing import**

At the top of `transactions.ts`, add:

```ts
import { sleep } from '@/server/jobs/yahoo-lib';
```

- [ ] **Step 2: Build the `unknownSymbols` set before the row loop**

Immediately after the required-columns check (the `for (const col of requiredColumns)` block ends ~line 333, right before `const supportedCurrencySet = ...` at line 335), insert:

```ts
			// Pre-validate distinct, format-valid, not-yet-tracked symbols against Yahoo once each.
			const cellOf = (row: string[], name: string) => {
				const idx = headerMap.get(name);
				return idx != null ? (row[idx] ?? '') : '';
			};
			const distinctSymbols = new Set<string>();
			for (const rawRow of data) {
				if (rawRow.every((cell) => cell.trim() === '')) continue;
				const s = normalizeSymbol(cellOf(rawRow, 'symbol'));
				if (s && isValidSymbolFormat(s)) distinctSymbols.add(s);
			}
			const trackedRows = distinctSymbols.size
				? await ctx.db.watchlistItem.findMany({
						select: { symbol: true },
						where: { symbol: { in: Array.from(distinctSymbols) }, userId: ctx.session.user.id }
					})
				: [];
			const tracked = new Set(trackedRows.map((r) => r.symbol));
			const unknownSymbols = new Set<string>();
			for (const s of distinctSymbols) {
				if (tracked.has(s)) continue;
				if (!(await symbolExistsOnYahoo(s))) unknownSymbols.add(s);
				await sleep(150);
			}
```

- [ ] **Step 3: Reject unknown symbols inside the existing row loop**

In the `data.forEach` try block, right after the existing format check (currently lines 348-350, the `if (!isValidSymbolFormat(symbol)) { throw ... }`), add:

```ts
						if (unknownSymbols.has(symbol)) {
							throw new Error(`Unknown symbol "${symbol}" — not found on Yahoo Finance.`);
						}
```

This routes into the existing `catch` that pushes `{ line, message }` into `errors`, so offending rows are reported per-line and excluded from `records`.

- [ ] **Step 4: Verify — typecheck + build**

Run: `bun run typecheck` — Expected: exit 0.
Run: `bun run build` — Expected: exit 0.

- [ ] **Step 5: Format + commit**

```bash
bunx @biomejs/biome check --write ./src && bun run check
git add src/server/api/routers/transactions.ts
git commit -m "feat(transactions): reject CSV rows whose symbol is unknown to Yahoo

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: Full verification gate

**Files:** none (verification only)

- [ ] **Step 1: Run every gate**

```bash
bun test src
bun run typecheck
bun run check
bun run build
```
Expected: all pass (unit tests green, typecheck exit 0, biome clean, build exit 0).

- [ ] **Step 2: Manual QA checklist** (Base UI / DB / network runtime deltas CI can't catch)

- Watchlist search: results show an exchange chip; only tradable types (no Crunchbase entries); multi-listing tickers (`VOD`, `VOD.L`, `VODI.DE`) are distinguishable.
- Add a good symbol → chart populates; add a bogus symbol → error toast, no row.
- Transaction form: adding a transaction for a brand-new (not-yet-watchlisted) valid symbol no longer errors "Unknown symbol" (the v8→v1 fix).
- CSV import: a file containing a nonsense symbol reports that row under `errors` and imports the rest.

- [ ] **Step 3: No code changes expected.** If any gate fails, fix in the owning task's file and re-run before opening the PR.

---

## Notes for the implementer

- **Why pure modules:** `yahoo-lib.ts` imports `env`/`db`/`influx` at module load, so it cannot be unit-tested without a full env. The search filter and chart classifier are therefore isolated in env-free files (`yahoo-search.ts`, `yahoo-chart-parse.ts`) so `bun test` can exercise them directly.
- **`symbolExistsOnYahoo` is deliberately lenient** (matches the raw symbol, not the tradable-filtered list) so it never re-introduces the false-rejection bug it replaces. The strict `isYahooFinance` + quoteType filter applies only to the *picker* (`searchYahooSymbols`).
- **Block-on-add is strict:** a symbol Yahoo knows but has zero bars for is rejected. This is the locked decision; if QA shows legitimate brand-new listings being blocked, loosen `noData` to block only on `status === 'not-found'` (a one-line change in Task 6).
- **Currency is untouched here.** `mapCurrencyString` (incl. the `GBp`/pence 100× bug) and all valuation/FX work belong to Spec 2.
