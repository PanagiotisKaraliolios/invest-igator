# Currency Correctness — Design (Spec 2a)

**Date:** 2026-07-08
**Status:** Approved (design)
**Scope:** Spec 2a of 2. Spec 2b (Historical FX) is a separate, sequential follow-up and is out of scope here.
**Depends on:** Spec 1 (Symbol Resolvability), merged (`ac88ca2`).

## Background

invest-igator ingests price bars from Yahoo and values a multi-currency portfolio. Two confirmed bugs corrupt foreign-holding valuations, and the currency set is copy-pasted across the codebase.

1. **Unknown currency → silent USD.** `mapCurrencyString` (`src/server/jobs/yahoo-lib.ts:14-34`) has a 6-case switch and `default: return 'USD'`. A JPY/CAD/AUD/… listing is silently relabeled USD.
2. **`GBp`/pence → `GBP` (100×).** `mapCurrencyString` uppercases first, so Yahoo's `GBp` (pence, 1/100 GBP) collapses to `GBP`; a pence-quoted price is valued 100× too high. Hits the seeded `.L` holdings (`VUSA.L`, etc.).
3. **Missing FX rate → pass-through.** `convertAmount` (`src/server/fx.ts:28`) returns the amount **unchanged** when no rate exists — a foreign amount is treated as already in the target currency. Combined with (1): e.g. `7203.T` (JPY ~2500) → labeled USD → `convertAmount(2500,'USD','USD')` = 2500, a ~150× overvaluation.
4. **Duplication.** The 6-currency set is hardcoded in **30+ sites** (6 named const arrays, 17 inline `z.enum([...])` literals across 9 files, 18 `<SelectItem>` literals in 2 admin panels, a 6-way cookie-guard OR-chain, the OpenAPI docs enum, and a shadow `type Currency`). Adding a currency today means editing all of them plus the DB enum.
5. **Two valuation paths disagree.** `portfolio.structure` uses `WatchlistItem.currency` (`portfolio.ts:453`); `portfolio.performance`/`navOnDate` uses the latest `Transaction.priceCurrency` (`portfolio.ts:213`). The same holding can be valued in two currencies across screens.

## Decisions (locked with maintainer)

- **Representation:** ISO-4217 **string** columns (drop the Postgres `Currency` enum), validated by one curated **`SUPPORTED_CURRENCIES`** const. Adding a currency becomes a one-line const edit + FX-ingest coverage.
- **Supported set:** `EUR, USD, GBP, HKD, CHF, RUB` **+ JPY, CAD, AUD, SGD** (10 total; ~18 Alpha Vantage USD-leg calls/day, within the free tier).
- **Crypto:** modeled by its **quote currency** — `BTC-USD`/`ETH-USD` are USD-quoted (Yahoo `meta.currency: 'USD'`), so they flow through the fiat machinery with `currency='USD'`. **No crypto members**; a crypto-denominated pair (rare) falls back like any unsupported code.
- **Authoritative market currency:** `WatchlistItem.currency` (the security's listing currency). `Transaction.priceCurrency` stays strictly the transaction's own denomination.
- **Fail-loud = per-holding flag, not a page crash.** `convertAmount` throws on a missing rate; valuation catches it per holding and flags the holding as unconverted.
- **Backfill:** a one-off script re-derives `WatchlistItem.currency`; user-entered `Transaction.priceCurrency` is left untouched.

## Design

### 1. `SUPPORTED_CURRENCIES` — single source of truth (`src/lib/currency.ts`)

```ts
export const SUPPORTED_CURRENCIES = ['EUR', 'USD', 'GBP', 'HKD', 'CHF', 'RUB', 'JPY', 'CAD', 'AUD', 'SGD'] as const;
export type Currency = (typeof SUPPORTED_CURRENCIES)[number];
export const currencySchema = z.enum(SUPPORTED_CURRENCIES); // typed as non-empty tuple so z.enum accepts it
export function isSupportedCurrency(x: string): x is Currency { /* SUPPORTED_CURRENCIES.includes */ }
```

Replace **every** duplicated site (full inventory below) with imports of this const / `currencySchema` / `type Currency`:
- **6 named const arrays** → re-export or import `SUPPORTED_CURRENCIES`: `src/lib/currency.ts:1`, `goals.ts:6`, `transactions.ts:9`, `ingest-fx.ts:6`, `prisma/mock.ts:160`, `fx.ts:9`.
- **17 inline `z.enum([...])`** → `currencySchema` (with `.default('USD')`/`.optional()`/`.nullable()` as-is): `goals.ts:50,140`; `transactions.ts:106,109,608,611,837,841`; `portfolio.ts:85,360`; `financial-data.ts:246,247,448`; `currency.ts:49`; `edit-symbol-modal.tsx:22`; `goals-view.tsx:28`; `transaction-form.tsx:30,33`.
- **18 `<SelectItem>` literals** → `.map(SUPPORTED_CURRENCIES)`: `edit-symbol-modal.tsx:143-148`, `fx-rates-panel.tsx:96-101,114-119`.
- **Shadow type** `fx-rates-panel.tsx:12` → import shared `Currency`.
- **Cookie guard** `use-currency.ts:32` → `(SUPPORTED_CURRENCIES as readonly string[]).includes(c)` (matches `portfolio/page.tsx:11`).
- **OpenAPI enum** `app/api/docs/route.ts:306` → derive from `SUPPORTED_CURRENCIES`.

### 2. Schema: `Currency` enum → String (`prisma/schema.prisma` + migration)

Convert the 7 Currency-typed columns to `String @default("USD")` and drop the enum type:
- `Transaction.priceCurrency` (`:27`), `Transaction.feeCurrency` (`:29`, nullable), `User.currency` (`:88`), `WatchlistItem.currency` (`:170`), `FxRate.base`/`FxRate.quote` (`:181-182`, unique `[base,quote]`), `Goal.targetCurrency` (`:198`).
- Migration: `ALTER TABLE … ALTER COLUMN … TYPE text USING "col"::text` for each, then `DROP TYPE "Currency"`. Existing enum values convert losslessly to their 3-letter strings.
- `@prisma/generated` no longer exports `Currency`. Repoint every `import { Currency } from '@prisma/generated'` (server: `fx.ts`, `ingest-fx.ts`, `transactions.ts`, `goals.ts`, `portfolio.ts`, `financial-data.ts`, `yahoo-lib.ts`, …) to `import type { Currency } from '@/lib/currency'`. `type Currency` is now the union of the 10 supported codes; ingested columns may hold any ISO string, so server code that reads a raw DB currency value treats it as `string` (widen where a value can be an unsupported code — see §5).

### 3. Honest currency normalization + `GBp` price scaling

The pence fix is a **price transform**, so it lives where bars are built. Add an env-free helper (in `src/server/yahoo-chart-parse.ts` or a sibling):

```ts
export function normalizeYahooCurrency(raw?: string): { currency: string; scale: number } {
	if (!raw) return { currency: 'USD', scale: 1 };
	if (raw === 'GBp' || raw === 'GBX' || raw.toUpperCase() === 'GBX') return { currency: 'GBP', scale: 0.01 };
	return { currency: raw.toUpperCase(), scale: 1 };
}
```

`classifyChartResponse` (`yahoo-chart-parse.ts`) applies it: normalize `meta.currency`, and multiply every **bar OHLC** and every **dividend/capitalGain amount** by `scale` (split ratios are unitless — not scaled). Its returned `currency` is the normalized code. **`mapCurrencyString` is deleted**; `ingestYahooSymbol` writes `WatchlistItem.currency` = the normalized currency verbatim (any ISO code, no USD default). Same uppercased ISO string is the value everywhere downstream.

### 4. FX ingest + matrix driven by the const (`ingest-fx.ts`, `fx.ts`)

- `ingest-fx.ts` fetches USD-pivot pairs for every currency in `SUPPORTED_CURRENCIES` (10 → USD↔c for 9 non-USD = 18 calls), then triangulates cross rates. Alpha Vantage covers all 10.
- `getFxMatrix` seeds its identity diagonal from `SUPPORTED_CURRENCIES` (not a hardcoded 6).

### 5. Fail-loud conversion, per-holding (`fx.ts` + `portfolio.ts`)

- `convertAmount` throws a `MissingFxRateError` (new, exported from `fx.ts`) when neither a direct rate nor a USD-pivot path exists — replacing the silent `return amount` at `fx.ts:28`. `from === to` still short-circuits. Its `from` parameter widens to `string` (a holding's ingested currency may be an unsupported ISO code); `to` stays a validated `Currency` (the user's display currency). `getFxMatrix`'s `FxMatrix` type widens its keys to `string` accordingly.
- **Both** `portfolio.structure` and `portfolio.performance`/`navOnDate` resolve a holding's market currency as `WatchlistItem.currency ?? latestTxCurrency ?? 'USD'`, and wrap each holding's `convertAmount` in try/catch. On `MissingFxRateError`, the holding is included with an `unconverted: true` flag (and its raw amount/currency surfaced) rather than crashing the query. The UI renders a warning badge for flagged holdings. Cost-basis conversion (`Transaction.priceCurrency`, restricted to the 10 by zod) is likewise guarded.

### 6. Backfill script (`src/server/jobs/backfill-currency.ts`)

A one-off `bun run` job (package.json script, e.g. `currency:backfill`): for each distinct `WatchlistItem.symbol`, re-fetch Yahoo chart meta, derive the normalized currency via `normalizeYahooCurrency`, and `updateMany` `WatchlistItem.currency`. Idempotent; paced like `ingest-fx`. Does **not** touch `Transaction.priceCurrency`. Run once after deploy.

## Error handling

- User-entered currencies (transaction/goal/user-display) are restricted to `SUPPORTED_CURRENCIES` by `currencySchema` (`BAD_REQUEST` on violation).
- Ingested `WatchlistItem.currency` may be any ISO code; valuation flags unconvertible holdings (`unconverted: true`) instead of throwing to the caller or silently mis-valuing.
- `MissingFxRateError` carries `{ from, to }` for logging/UX.

## Testing

- `SUPPORTED_CURRENCIES` / `currencySchema` unit tests (accepts the 10, rejects others).
- `normalizeYahooCurrency`: `GBp`/`GBX` → `{GBP, 0.01}`; `JPY` → `{JPY, 1}`; empty → `{USD, 1}`; passthrough uppercases.
- `classifyChartResponse`: a `GBp` payload yields GBP currency and ÷100 bar prices + ÷100 dividend amounts; split ratios unchanged.
- `convertAmount`: throws `MissingFxRateError` on a missing rate; converts via direct + USD-pivot; `from===to` identity.
- Portfolio valuation: a holding in an unsupported currency is flagged `unconverted` and does not throw out of the procedure; supported currencies value correctly; structure and performance agree on the market currency for the same symbol.

## Out of scope → Spec 2b (Historical FX)

Date-keyed `FxRate` storage, historical FX ingest, and history-aware `getFxMatrix`/`navOnDate` conversion. Spec 2a keeps today's single current-snapshot FX (already the current behavior) — so historical NAV/TWR/MWR for foreign holdings stays approximate until 2b.

## Rollout notes

- **One schema migration** (enum → text, drop type). One-way (can't re-add the enum easily), but additive and lossless for existing rows.
- Deploy order: migrate → deploy code (new mapper + fail-loud) → run FX ingest for the new currencies → run the currency backfill.
- Behavioral change: foreign holdings that were silently mis-valued now value correctly (or show an "unconverted" badge if outside the 10). This is the intended fix.
