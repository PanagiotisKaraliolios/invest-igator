# Symbol Resolvability — Design

**Date:** 2026-07-07
**Status:** Approved (design)
**Scope:** Spec 1 of 2. Spec 2 (Currency Correctness) is tracked separately and is out of scope here.

## Background

A maintainer asked whether we should search for symbols on Yahoo (since we ingest
timeseries from Yahoo), worrying that a symbol from "a different provider" might not be
recognizable to Yahoo.

Investigation found the premise no longer holds: **symbol search already goes to Yahoo.**
`watchlist.search` (`src/server/api/routers/watchlist.ts:386`) calls
`https://query1.finance.yahoo.com/v1/finance/search` directly and returns Yahoo's own
`quote.symbol`, which is later passed verbatim to the Yahoo chart endpoint at ingest time.
The result is reshaped into `{ description, displaySymbol, symbol, type }` — Finnhub's old
response contract — and `FINNHUB_API_KEY`/`POLYGON_API_KEY` still exist in `env.js` but are
never used in `src/`. This is a Finnhub→Yahoo migration that kept the old output shape, which
is why it looks like a third-party provider. Only ALPHAVANTAGE remains live, used solely for
FX-rate ingest.

Because search and ingest are the same vendor sharing one symbology, a string-level mismatch
in the primary watchlist-add flow is structurally impossible. The real risk surface is
elsewhere, and that is what this spec addresses.

## Problems addressed

1. **Live bug — validation hits the wrong endpoint.** `isValidSymbolViaYahoo`
   (`src/server/api/routers/transactions.ts:14`) builds `${YAHOO_API_URL}/search`, which
   resolves to `.../v8/finance/search`. Verified live: that path returns **HTTP 500** (the
   real search path is `v1/finance/search`, which returns 200). The function therefore
   returns `false` for every symbol, so valid tickers are rejected as "Unknown symbol" when a
   transaction is created for a symbol not already on the user's watchlist.
2. **Search returns non-tradable results.** `watchlist.search` does not filter
   `isYahooFinance === true` or by `quoteType`, so Yahoo can return non-tradable entries
   (e.g. Crunchbase companies) that then silently fail ingest.
3. **Silent empty timeseries.** `fetchYahooDaily` (`src/server/jobs/yahoo-lib.ts`) returns
   empty arrays for an unknown symbol — it inspects `json.chart.result[0]` but ignores
   `json.chart.error` — and `watchlist.add` swallows ingest errors (fire-and-forget with an
   empty catch). A bad/mistyped symbol becomes a "tracked" row with a blank chart and no
   warning.
4. **CSV import does no existence check** at all; a well-formed but nonexistent ticker is
   persisted and silently fails ingest.
5. **`.env.example` foot-gun.** It ships `YAHOO_API_URL=.../v8/finance/chart`; because the
   code appends `/chart/{symbol}`, copying it verbatim produces a broken
   `/chart/chart/{SYMBOL}` URL and every fetch 404s.

## Decisions (locked with maintainer)

- **Asset scope / quoteType allowlist:** `EQUITY, ETF, MUTUALFUND, INDEX, CRYPTOCURRENCY`
  (plus `isYahooFinance === true`). Crypto is in scope; its currency handling lands in Spec 2.
- **Bad-symbol UX:** **block on add, fail loud.** A symbol that does not resolve to Yahoo
  price data is rejected with a clear error and is not persisted. This is strict: a
  brand-new listing Yahoo knows but has no daily bars for yet is also rejected (accepted
  trade-off; such cases are rare and the user can retry later).

## Design

### 1. New shared helper — `src/server/yahoo-search.ts`

A single module for all Yahoo *search* access (co-located with `src/server/fx.ts`,
`src/server/influx.ts`), separate from the *chart/ingest* concern in `yahoo-lib.ts`.

- `searchYahooSymbols(q: string, opts?): Promise<YahooSearchResult[]>`
  - Fetches `https://query1.finance.yahoo.com/v1/finance/search` with the existing
    browser-like `User-Agent`.
  - Filters `quotes[]` to `isYahooFinance === true` and the quoteType allowlist above.
  - Returns normalized objects: `{ symbol, description, type, exchange }` where
    `description = longname || shortname`, `type = typeDisp`, `exchange = exchDisp`.
  - Throws on a non-ok HTTP response (same contract as today's `watchlist.search`).
- `symbolExistsOnYahoo(symbol: string): Promise<boolean>`
  - Thin wrapper over `searchYahooSymbols` that returns whether any returned quote's symbol
    matches the (uppercased) input. Replaces the buggy `isValidSymbolViaYahoo`.

### 2. `watchlist.search` → rewritten on the helper

`src/server/api/routers/watchlist.ts:386`. Same input (`{ q }`). Result shape gains
`exchange`: `{ count, result: Array<{ symbol, displaySymbol, description, type, exchange }> }`
(`displaySymbol` continues to mirror `symbol` for back-compat). The dev-only `console.log`
is preserved.

`SearchAssets` (`src/app/(dashboard)/watchlist/_components/search-assets.tsx`) renders
`exchange` (e.g. as a muted suffix or badge on each row) so users can disambiguate
multi-listing hits like `VOD` vs `VOD.L` vs `VODI.DE`. **No schema column is added** —
`exchange` is display-only in Spec 1.

### 3. `isValidSymbolViaYahoo` → reimplemented; CSV import gains the check

`src/server/api/routers/transactions.ts`. Delete the hand-rolled fetch and call
`symbolExistsOnYahoo`. This fixes the `v8/finance/search` → HTTP 500 bug. The CSV import path
(which currently only format-validates) calls the same check so free-typed symbols cannot be
persisted without a Yahoo match. (Keep the existing "already on the user's watchlist ⇒ skip
the check" short-circuit so re-imports of known symbols stay cheap.)

### 4. `fetchYahooDaily` → discriminated result

`src/server/jobs/yahoo-lib.ts`. Add a `status` to the return value:

- `'found'` — `chart.result[0]` present with ≥1 usable bar.
- `'empty'` — `chart.result[0]` present but no usable bars in range (valid symbol, no data).
- `'not-found'` — `chart.result[0]` falsy / `chart.error` present (unknown symbol).

`fetchYahooDaily` also reads `json.chart.error` to distinguish `not-found` from `empty`.
The returned `{ bars, dividends, splits, capitalGains }` shape is preserved and gains
`status`, so existing callers keep working unchanged. `ingestYahooSymbol` propagates `status`
in its result.

### 5. `watchlist.add` → await-and-validate (block on add)

`src/server/api/routers/watchlist.ts:50`. Restructured from create-then-fire-and-forget to
**validate against the real ingest before persisting**. The block signal is the actual
ingest fetch (full history, `range=max` as today) — deliberately *not* a short window, so an
illiquid symbol with real history is not false-blocked; only a symbol Yahoo genuinely does
not recognize (`not-found`), or one with zero bars across all history (`empty`), is rejected.

1. Normalize the symbol.
2. `await ingestYahooSymbol(symbol, { userId })`, which now returns the discriminated
   `status` from `fetchYahooDaily` and the ingested bar count.
3. If `status === 'not-found'` or the ingest wrote **zero bars** → throw
   `TRPCError({ code: 'BAD_REQUEST', message: 'Yahoo has no price data for <symbol>.' })`
   and **do not leave a persisted row** (see note below).
4. Otherwise persist the `WatchlistItem` (existing create-or-update on `userId_symbol`) and
   return as today.

This makes `add` synchronous on one Yahoo chart call (a few hundred ms–seconds for full
history). That is acceptable for a deliberate click, and it has a UX bonus: the chart is
populated the moment the row appears (today there is an async gap). The `+` button already
shows a pending state (`disabled={add.isPending}`).

**Implementation note for the plan:** `ingestYahooSymbol` currently sets
`WatchlistItem.currency` via `updateMany` *after* the row exists, so ordering matters. Two
clean options: (a) refactor `ingestYahooSymbol` to separate *fetch/validate* from
*persist-and-write*, so `add` can validate first and only then create the row and write bars;
or (b) keep create-first, then on a `not-found`/zero-bar result delete the just-created row
(only when `add` created it, not when it pre-existed) before throwing. The plan picks one;
(a) is preferred.

`SearchAssets` already has an `onError` toast (`toast.error(err.message)`), so the rejection
surfaces to the user with no additional frontend change. The transaction form's add path
surfaces its existing "Unknown symbol" error, now correct because the underlying check is
fixed.

### 6. Config fix

`.env.example`: set `YAHOO_API_URL=https://query1.finance.yahoo.com/v8/finance` (no trailing
`/chart`), matching what the code appends.

## Error handling

- Unresolvable symbols → `TRPCError` `BAD_REQUEST` with a clear message, surfaced via the
  existing `onError` toasts on both the watchlist and transaction add paths.
- Yahoo search HTTP failure → thrown, same as today (the query surfaces the error state).

## Testing

- `searchYahooSymbols`: filters out `isYahooFinance === false` entries and quoteTypes outside
  the allowlist; maps `exchDisp`/`typeDisp`/`longname||shortname` correctly. (Mock the fetch.)
- `symbolExistsOnYahoo`: true for a matching quote, false when none match.
- `fetchYahooDaily` status: `not-found` when `chart.error` is set / result is null; `empty`
  when result present but bars empty; `found` with real bars.
- `watchlist.add`: rejects a `not-found`/`empty` symbol with `BAD_REQUEST` and persists
  nothing; persists + triggers ingest on `found`.

## Out of scope → Spec 2 (Currency Correctness)

Currency representation (ISO-4217 string + curated `SUPPORTED_CURRENCIES` const), FX-ingest
expansion, `GBp`/pence normalization, fail-loud `convertAmount`, unifying the ~20 duplicated
currency lists, and reconciling the structure-vs-performance market-currency rule. Crypto
currency handling also lands there.

## Rollout notes

- No database migration in Spec 1.
- Behavioral change: adding a symbol with no Yahoo price data now fails instead of silently
  creating a blank row. This is the intended fix, not a regression.
