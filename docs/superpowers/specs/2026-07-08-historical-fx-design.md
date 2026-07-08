# Historical FX — Design (Spec 2b)

**Date:** 2026-07-08
**Status:** Approved (design)
**Scope:** Spec 2b of the currency initiative. Unifies all FX on Yahoo, stores FX as a daily time series in InfluxDB, and makes portfolio valuation date-aware.
**Depends on:** Spec 2a (Currency Correctness), merged (`5a225ea`). Reuses its `SUPPORTED_CURRENCIES`, `MissingFxRateError` fail-loud contract, and `unconvertedSymbols`/`unconverted` flags.

## Background

invest-igator values a multi-currency portfolio. Spec 2a made *current* conversion correct, but FX is still a **single current snapshot applied to all of history**: `portfolio.performance` and `portfolio.structure` each call `getFxMatrix()` once (`portfolio.ts:205`, `:417`) and reuse that one matrix for every valuation date and every transaction. A EUR holding bought in 2019 is costed at *today's* EUR/USD, and its 2019 NAV point uses today's rate too — so historical NAV, TWR, and MWR for foreign holdings are wrong by the FX drift between then and now.

The current source (Alpha Vantage) also caps at ~25 requests/day, which is what left SGD with no rate locally (#70). It has no usable free historical endpoint.

**Six conversion sites exist; five must become date-aware, one stays current:**

| Site (`portfolio.ts`) | Converts | Correct rate date |
|---|---|---|
| `:241` `navOnDate` | position value on a date | **valuation date** (`dateIso`) |
| `:298` performance cash flow | a transaction's value | **transaction date** |
| `:302` performance fee | a transaction's fee | **transaction date** |
| `:436` structure cost basis value | a transaction's value | **transaction date** |
| `:440` structure cost basis fee | a transaction's fee | **transaction date** |
| `:501` structure current market value | today's market price | **current** (unchanged) |

## Decisions (locked with maintainer)

- **One source: Yahoo.** Source both current and historical FX from Yahoo daily bars. **Remove Alpha Vantage entirely** (the `ingest-fx.ts` AV logic and the `ALPHAVANTAGE_*` env vars).
- **One store: InfluxDB.** FX becomes a daily time series alongside prices. **Drop the Postgres `FxRate` table** (the current-spot cache); "current" is simply the latest bar.
- **Full history.** Backfill each pair's entire Yahoo history (`period1=1`, ~2003) so nearly all real transactions are covered.
- **Forward-fill** across weekends/holidays/gaps, exactly like `priceBySymbolDate`.
- **Keep Spec 2a fail-loud.** A transaction predating a pair's coverage yields `MissingFxRateError` → the holding is flagged `unconverted`/added to `unconvertedSymbols`, never a page crash.
- **`fx.matrix` tRPC stays current-only.** History is internal to valuation; no date parameter is exposed to clients.

## Design

### 1. Storage — `fx_rates` Influx measurement

Store only the **USD legs**: for each non-USD currency `C`, the Yahoo symbol `${C}USD=X` whose close is **USD per 1 unit of C** (e.g. `EURUSD=X` ≈ 1.08 ⇒ 1 EUR = 1.08 USD). Reciprocals and cross rates are derived in memory (§3), so only 9 series are stored.

- Measurement: `fx_rates` (dedicated — keeps FX pairs out of the `daily_bars` price scans).
- Tag: `currency` = the non-USD ISO code (`EUR`, `GBP`, …). Cleaner than the Yahoo pair symbol.
- Field: `rate` (float) = the Yahoo daily close (USD per 1 C).
- Timestamp: bar date at `00:00:00Z` (same convention as `buildPoint`, `influx.ts:56`).

FX-pair responses carry `meta.currency: 'USD'`, so `normalizeYahooCurrency` never scales them (no GBp risk).

### 2. Ingest — one Yahoo FX job (`src/server/jobs/ingest-fx.ts`, rewritten)

Replace the Alpha Vantage body of `ingest-fx.ts` (keeping the filename and the `ingest:fx` package script, so whatever currently invokes it — cron or manual — and the deploy runbook are unchanged). For each non-USD currency in `SUPPORTED_CURRENCIES`:

```ts
const { bars, status } = await fetchYahooDaily(`${c}USD=X`, {
  interval: '1d', period1: 1, period2: Math.floor(Date.now() / 1000)
});
// write { time, close } for each bar to fx_rates, tag currency = c
```

A full Yahoo history fetch is 9 calls (~18s with `sleep(2000)` pacing, mirroring `backfill-currency.ts`) and is **idempotent** — Influx overwrites by `measurement+tag+timestamp`. So the **same job is both the one-off backfill and the daily incremental refresh**; no delta logic, no per-day cursor.

Resilience: a per-currency Yahoo failure (`status === 'not-found'`, HTTP error, or empty bars) is logged and skipped — it leaves that currency's existing series intact and does not abort the other 8. No rate-limit classification is needed (Yahoo has no 25/day cap). `process.exitCode = 1` on an unexpected throw, with `db.$disconnect()` in `finally`.

A new FX write helper (in §4's module) mirrors `writeBars`: batched `Point('fx_rates').tag('currency', c).floatField('rate', close).timestamp(...)`, with the same retry/flush loop as `yahoo-lib.ts:58`.

### 3. Matrix math — pure, unit-testable (`src/server/fx.ts`)

`fx.ts` becomes pure currency math (drops its `db` import). Keep `FxMatrix`, `MissingFxRateError`, `convertAmount` unchanged, and add:

```ts
// usdPerUnit: Map<currency, USD-per-1-unit rate> (Yahoo ${C}USD=X close)
export function buildFxMatrixFromUsdLegs(usdPerUnit: Map<string, number>): FxMatrix {
  const out: FxMatrix = {};
  for (const c of SUPPORTED_CURRENCIES) { out[c] = { [c]: 1 }; }
  out.USD ??= { USD: 1 };
  for (const [c, rate] of usdPerUnit) {
    if (!(rate > 0)) continue;
    (out[c] ??= {})[c] = 1;
    out[c].USD = rate;         // C -> USD
    (out.USD ??= {})[c] = 1 / rate; // USD -> C
  }
  return out;
}
```

`convertAmount` already pivots through USD (`fx.ts:40`), so a matrix holding only identity + USD legs is sufficient for every pair (e.g. EUR→GBP = EUR→USD × USD→GBP). Cross rates never need to be materialized in storage.

### 4. Influx FX reads (`src/server/fx-history.ts`, new)

The IO layer (imports `influx`, builds matrices via §3):

- `getLatestFxBars(): Promise<{ legs: Map<string, number>; asOf: Date | null }>` — the most recent `rate` per `currency` from `fx_rates`, plus the newest timestamp seen (the "as-of" of the current matrix).
- `getFxMatrix(): Promise<FxMatrix>` — `buildFxMatrixFromUsdLegs((await getLatestFxBars()).legs)`. Same name/signature the current callers use, so `fx.matrix` tRPC and structure's current-value read need only change their import path.
- `buildFxByDate(fromIso: string, toIso: string): Promise<Map<string, FxMatrix>>` — one range query over `fx_rates` (seeded ~7 days before `fromIso`), forward-filled per currency across the inclusive `[from, to]` calendar, then one `FxMatrix` per date via §3. This is the exact shape of `priceBySymbolDate` (`portfolio.ts:137-201`): seed with the latest bar before `fromIso`, carry the last known rate forward over gaps. A date with no bar at or before it simply has no leg for that currency → `convertAmount` throws for that pair on that date (fail-loud).

### 5. Date-aware valuation (`portfolio.ts`)

**`portfolio.performance`:** replace the single `const fx = await getFxMatrix()` (`:205`) with `const fxByDate = await buildFxByDate(inceptionIso, toIso)` over the range it already computes (`:142`, `:144`). Then:
- `navOnDate(dateIso, …)` (`:233`) resolves `const fx = fxByDate.get(dateIso)` and converts each position at the **valuation date** (`:241`). A missing matrix/leg → `MissingFxRateError` → `unconvertedSymbols.add(sym)` (existing catch, `:243`).
- The per-transaction cash-flow (`:298`) and fee (`:302`) conversions use `fxByDate.get(txDayIso)` for each transaction's **own date** (the loop already has `day`, `:280`; transaction date via `t.date`).

**`portfolio.structure`:** replace the single `getFxMatrix()` (`:417`) with:
- `const fxByDate = await buildFxByDate(minTxIso, todayIso)` (min transaction date → today), used for cost-basis value (`:436`) and fee (`:440`) at each transaction's date.
- `const fxLatest = await getFxMatrix()` for the current market value (`:501`) — the one site that stays current.

All five rewritten sites keep their existing `try/catch (MissingFxRateError)` guards and per-holding `unconverted`/`costUnconverted` flagging; only the matrix they read changes.

### 6. Drop `FxRate` + repoints

- **Schema:** remove the `FxRate` model (`schema.prisma:171-180`) and add a migration that `DROP TABLE "FxRate"`. Existing rows are discarded — the data is reconstructed in Influx from Yahoo by the backfill.
- **`fx.matrix` tRPC** (`fx.ts` router): change the `getFxMatrix` import to `@/server/fx-history`. No behavior change (still current-only).
- **`financialData.getFxRates`** (`financial-data.ts:243`): stop reading `db.fxRate`. Synthesize the rows the admin panel expects from the current matrix — for each `(base, quote)` pair over `SUPPORTED_CURRENCIES` (respecting the `base`/`quote` filters), `rate = convertAmount(1, base, quote, matrix)` (skip pairs that throw), `fetchedAt = asOf` from `getLatestFxBars()`, `id = `${base}-${quote}``. `stats` (total/age/last-update) computed from `asOf`. The `FxRatesPanel` component (`fx-rates-panel.tsx`) is unchanged — it consumes `data.rates` (`{id, base, quote, rate, fetchedAt}`) and `data.stats` verbatim.
- **Env:** remove `ALPHAVANTAGE_API_KEY` and `ALPHAVANTAGE_API_URL` from `env.js` and `.env.example` (now dead).
- **Seed/mock:** if `prisma/mock.ts` seeds `FxRate`, remove that seed (verify during planning).

## Error handling

- **Forward-fill** covers weekends, holidays, and single-day gaps within a pair's coverage.
- **Pre-coverage** (a transaction before a pair's earliest Yahoo bar, e.g. pre-2003, or a currency Yahoo can't serve): `buildFxByDate` has no leg → `convertAmount` throws `MissingFxRateError` → the existing per-site catches flag the holding `unconverted` and add it to `unconvertedSymbols`. The returns-page banner and structure badge (Spec 2a) already surface this.
- **Ingest failure** for one currency leaves its existing `fx_rates` series intact and does not block the others.

## Testing

- **`buildFxMatrixFromUsdLegs`** (pure): identity diagonal; `out[C].USD` = leg and `out.USD[C]` = 1/leg; a `0`/negative leg is skipped; `convertAmount` cross via USD pivot (EUR→GBP) is correct; an absent currency throws `MissingFxRateError`.
- **Forward-fill** (extract the fill into a pure helper shared with the price path if practical, else test via `buildFxByDate` against a small in-memory row set): a weekend date inherits Friday's rate; a date before the first bar has no leg; a date after the last bar inherits the last.
- **`convertAmount`** date-awareness at the call sites is covered by the pure matrix + fill tests; the `portfolio` wiring is validated by typecheck + the existing E2E.
- **Ingest smoke** (guarded/manual, not in unit CI — hits Yahoo): `${C}USD=X` for the 9 currencies returns daily bars back to ~2003 and writes to `fx_rates`.

## Rollout

- **One migration** (drop `FxRate`) — regenerate with `prisma migrate dev` so the Migration Check CI passes; discards the AV-populated current-spot rows.
- **Deploy order:** `prisma migrate deploy` → deploy code → **run `bun run ingest:fx`** once to backfill `fx_rates` from Yahoo (~18s). Whatever runs `ingest:fx` on a schedule thereafter (cron or manual) keeps it fresh with the same command.
- **No price re-ingest needed** (unlike Spec 2a) — this changes only FX, not stored price bars.
- **Behavioral change:** historical NAV/TWR/MWR for foreign holdings become FX-accurate per date instead of using today's snapshot. Pre-2003 (or unservable) transactions surface as `unconverted` rather than silently mis-valued.

## Out of scope

- Exposing a date parameter on `fx.matrix` (history stays internal to valuation).
- Intraday FX (daily close is sufficient for daily NAV/TWR/MWR).
- Re-deriving `Transaction.priceCurrency` (untouched, per Spec 2a).
