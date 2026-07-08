# Currency Correctness Implementation Plan (Spec 2a)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Value every holding in its true currency for 10 supported currencies, fail loud (per-holding) on unconvertible ones, fix the `GBp`/pence 100× bug, and collapse 30+ duplicated currency lists to one `SUPPORTED_CURRENCIES` const.

**Architecture:** Replace the Postgres `Currency` enum with validated ISO-4217 **string** columns gated by one const in `src/lib/currency.ts`. Ingest stores a holding's true currency (any ISO code); `convertAmount` throws on a missing rate and portfolio valuation catches it per-holding to flag rather than crash. Historical FX is deferred to Spec 2b.

**Tech Stack:** Next.js 16, tRPC v11, Prisma 7 (Postgres), InfluxDB, Bun 1.3.14 (runtime + `bun test`), Biome 2, Alpha Vantage (FX), Yahoo (prices).

## Global Constraints

- Runtime/test tool: **Bun 1.3.14**. Unit tests use `bun test` (import from `bun:test`); files under `src/**/*.test.ts` are excluded from `tsc` (verified by `bun test src`). Do NOT add vitest/jest.
- Quality gates before a task's final commit: `bun test src` (all pass), `bun run typecheck` (exit 0), `bun run check` (biome clean). For tasks touching routers/jobs/schema also `bun run build` (exit 0). The build fetches Google Fonts via `next/font`; a first-attempt font/network failure is transient — re-run once.
- Biome style: **tabs, single quotes, sorted object keys**. Auto-format with `bunx @biomejs/biome check --write ./src` then verify `bun run check`.
- **Supported currencies (exact, ordered):** `['EUR', 'USD', 'GBP', 'HKD', 'CHF', 'RUB', 'JPY', 'CAD', 'AUD', 'SGD']` (10).
- Currency **representation:** ISO-4217 string columns; ONE `SUPPORTED_CURRENCIES` const gates zod + FX ingest + `getFxMatrix` seed + UI dropdowns. No Postgres `Currency` enum after this plan.
- `convertAmount` MUST throw `MissingFxRateError` on a missing rate (never silently return the amount). `from === to` short-circuits.
- Authoritative market currency = `WatchlistItem.currency` (→ latest tx currency → `'USD'`).
- Commit trailer on every commit: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`

## File structure

- `src/lib/currency.ts` — `SUPPORTED_CURRENCIES`, `type Currency`, `currencySchema`, `isSupportedCurrency`, `formatCurrency` (kept). Home of the shared const.
- `prisma/schema.prisma` + a new migration — `Currency` enum → String columns.
- `src/server/currency-normalize.ts` (new, env-free) — `normalizeYahooCurrency` (GBp/pence scaling).
- `src/server/yahoo-chart-parse.ts` — apply the scale to bars + dividend/capitalGain amounts.
- `src/server/jobs/yahoo-lib.ts` — delete `mapCurrencyString`; store normalized currency string.
- `src/server/fx.ts` — `MissingFxRateError`; const-driven matrix; throw on missing rate; widen key types to `string`.
- `src/server/jobs/ingest-fx.ts` — const-driven supported list.
- `src/server/api/routers/portfolio.ts` — per-holding fail-loud + reconcile performance to `WatchlistItem.currency`.
- `src/server/jobs/backfill-currency.ts` (new) — one-off re-derive of `WatchlistItem.currency`.
- ~30 duplication sites (Task 3 table).

---

### Task 1: `SUPPORTED_CURRENCIES` single source of truth

**Files:**
- Modify: `src/lib/currency.ts`
- Test: `src/lib/currency.test.ts`

**Interfaces:**
- Produces:
  - `const SUPPORTED_CURRENCIES = ['EUR','USD','GBP','HKD','CHF','RUB','JPY','CAD','AUD','SGD'] as const` (the new 10)
  - `const currencySchema` = `z.enum(SUPPORTED_CURRENCIES)`
  - `function isSupportedCurrency(x: string): x is (typeof SUPPORTED_CURRENCIES)[number]`
  - `function formatCurrency(n: number, currency: string, maximumFractionDigits?: number): string` (unchanged behavior; param widened to `string`)
- **Unchanged in this task (critical):** `supportedCurrencies` stays the 6-tuple and `type Currency` stays derived from it. Do NOT widen `type Currency` to the 10 here — `@prisma/generated` still exports a 6-member `Currency` enum, and widening `@/lib/currency`'s `Currency` to 10 while the Prisma one stays 6 makes `'JPY'` non-assignable at every interop point (≈13 typecheck errors). Task 2 flips `type Currency`/`supportedCurrencies` to the 10 in the SAME commit that drops the Prisma enum, so both change together and typecheck stays green.

- [ ] **Step 1: Write the failing test**

Create `src/lib/currency.test.ts`:

```ts
import { describe, expect, test } from 'bun:test';
import { currencySchema, isSupportedCurrency, SUPPORTED_CURRENCIES } from './currency';

describe('SUPPORTED_CURRENCIES', () => {
	test('has the 10 expected currencies in order', () => {
		expect(SUPPORTED_CURRENCIES).toEqual(['EUR', 'USD', 'GBP', 'HKD', 'CHF', 'RUB', 'JPY', 'CAD', 'AUD', 'SGD']);
	});

	test('isSupportedCurrency accepts supported, rejects others', () => {
		expect(isSupportedCurrency('JPY')).toBe(true);
		expect(isSupportedCurrency('USD')).toBe(true);
		expect(isSupportedCurrency('INR')).toBe(false);
		expect(isSupportedCurrency('gbp')).toBe(false); // case-sensitive by design (codes are stored uppercase)
	});

	test('currencySchema parses supported and rejects unsupported', () => {
		expect(currencySchema.parse('CAD')).toBe('CAD');
		expect(currencySchema.safeParse('INR').success).toBe(false);
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/lib/currency.test.ts`
Expected: FAIL — `SUPPORTED_CURRENCIES`/`currencySchema`/`isSupportedCurrency` not exported.

- [ ] **Step 3: Implement**

Replace the entire contents of `src/lib/currency.ts` with (note: `supportedCurrencies` and `type Currency` stay the **6** — only the new symbols are added; Task 2 flips them to the 10):

```ts
import { z } from 'zod';

/**
 * The 10 supported currencies. Task 2 makes this the source for `type Currency` and
 * `supportedCurrencies` once the Postgres Currency enum is dropped; kept separate here so this
 * task stays typecheck-green (widening `type Currency` to 10 while @prisma/generated stays 6 breaks interop).
 */
export const SUPPORTED_CURRENCIES = ['EUR', 'USD', 'GBP', 'HKD', 'CHF', 'RUB', 'JPY', 'CAD', 'AUD', 'SGD'] as const;

export const supportedCurrencies = ['EUR', 'USD', 'GBP', 'HKD', 'CHF', 'RUB'] as const;
export type Currency = (typeof supportedCurrencies)[number];

export const currencySchema = z.enum(SUPPORTED_CURRENCIES);

export function isSupportedCurrency(x: string): x is (typeof SUPPORTED_CURRENCIES)[number] {
	return (SUPPORTED_CURRENCIES as readonly string[]).includes(x);
}

export function formatCurrency(n: number, currency: string, maximumFractionDigits?: number): string {
	return new Intl.NumberFormat(undefined, {
		currency,
		maximumFractionDigits,
		style: 'currency'
	}).format(n);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/lib/currency.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Typecheck, format, commit**

```bash
bun run typecheck
bunx @biomejs/biome check --write ./src && bun run check
git add src/lib/currency.ts src/lib/currency.test.ts
git commit -m "feat(currency): SUPPORTED_CURRENCIES const + currencySchema + isSupportedCurrency

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```
Expected: typecheck exit 0 (the back-compat `supportedCurrencies` alias keeps existing importers compiling), biome clean.

---

### Task 2: Schema — `Currency` enum → String + repoint imports

**Files:**
- Modify: `prisma/schema.prisma` (enum at `:153-160`; columns at `:27,29,88,170,182,183,198`)
- Create: `prisma/migrations/20260708000000_currency_to_string/migration.sql`
- Modify: every server file importing `Currency` from `@prisma/generated`

**Interfaces:**
- Consumes: `type Currency` from `@/lib/currency` (Task 1).
- Produces: all Currency-typed Prisma columns are now `String @default("USD")` (feeCurrency `String?`); `@prisma/generated` no longer exports `Currency`.

- [ ] **Step 1: Edit the schema**

In `prisma/schema.prisma`: delete the `enum Currency { … }` block (`:153-160`). Change each column's type from `Currency` to `String`, preserving defaults/nullability:
- `Transaction.priceCurrency Currency @default(USD)` → `String @default("USD")`
- `Transaction.feeCurrency Currency?` → `String?`
- `User.currency Currency @default(USD)` → `String @default("USD")`
- `WatchlistItem.currency Currency @default(USD)` → `String @default("USD")`
- `FxRate.base Currency` → `String`
- `FxRate.quote Currency` → `String`
- `Goal.targetCurrency Currency @default(USD)` → `String @default("USD")`

- [ ] **Step 1b: Flip `type Currency`/`supportedCurrencies` to the 10 in `src/lib/currency.ts`**

Now that the Prisma `Currency` enum is being removed, make `@/lib/currency` the single source. In `src/lib/currency.ts`:
- Delete the separate 6-tuple `export const supportedCurrencies = ['EUR', …] as const;` and replace with `export const supportedCurrencies = SUPPORTED_CURRENCIES;`
- Change `export type Currency = (typeof supportedCurrencies)[number];` to `export type Currency = (typeof SUPPORTED_CURRENCIES)[number];`

(`type Currency` is now the 10-union; because the Prisma 6-enum disappears in the same commit, there is no 6-vs-10 interop mismatch.)

- [ ] **Step 2: Regenerate the Prisma client (no DB needed)**

Run: `bun prisma generate`
Expected: succeeds; `prisma/generated` no longer exports a `Currency` enum. (`typecheck` will now fail at every `import { Currency } from '@prisma/generated'` — fixed in Step 4.)

- [ ] **Step 3: Hand-write the migration SQL** (applied to Postgres at deploy; not required for typecheck/build)

Create `prisma/migrations/20260708000000_currency_to_string/migration.sql`:

```sql
-- Convert Currency enum columns to text, then drop the enum type.
ALTER TABLE "Transaction" ALTER COLUMN "priceCurrency" DROP DEFAULT;
ALTER TABLE "Transaction" ALTER COLUMN "priceCurrency" SET DATA TYPE TEXT USING "priceCurrency"::text;
ALTER TABLE "Transaction" ALTER COLUMN "priceCurrency" SET DEFAULT 'USD';
ALTER TABLE "Transaction" ALTER COLUMN "feeCurrency" SET DATA TYPE TEXT USING "feeCurrency"::text;

ALTER TABLE "User" ALTER COLUMN "currency" DROP DEFAULT;
ALTER TABLE "User" ALTER COLUMN "currency" SET DATA TYPE TEXT USING "currency"::text;
ALTER TABLE "User" ALTER COLUMN "currency" SET DEFAULT 'USD';

ALTER TABLE "WatchlistItem" ALTER COLUMN "currency" DROP DEFAULT;
ALTER TABLE "WatchlistItem" ALTER COLUMN "currency" SET DATA TYPE TEXT USING "currency"::text;
ALTER TABLE "WatchlistItem" ALTER COLUMN "currency" SET DEFAULT 'USD';

ALTER TABLE "FxRate" ALTER COLUMN "base" SET DATA TYPE TEXT USING "base"::text;
ALTER TABLE "FxRate" ALTER COLUMN "quote" SET DATA TYPE TEXT USING "quote"::text;

ALTER TABLE "Goal" ALTER COLUMN "targetCurrency" DROP DEFAULT;
ALTER TABLE "Goal" ALTER COLUMN "targetCurrency" SET DATA TYPE TEXT USING "targetCurrency"::text;
ALTER TABLE "Goal" ALTER COLUMN "targetCurrency" SET DEFAULT 'USD';

DROP TYPE "Currency";
```

(If a live dev Postgres is available, instead run `bun prisma migrate dev --name currency_to_string` and confirm the generated SQL matches the intent above. Table names are the Prisma model names as shown.)

- [ ] **Step 4: Repoint `Currency` imports**

Replace `import type { Currency } from '@prisma/generated'` (and any `import { Currency }`) with `import type { Currency } from '@/lib/currency'` in every file that has it. Find them:

Run: `grep -rln "from '@prisma/generated'" src | xargs grep -l "Currency"`
Known sites: `src/server/fx.ts:1`, `src/server/jobs/ingest-fx.ts:2`, `src/server/jobs/yahoo-lib.ts:1`, `src/server/api/routers/transactions.ts`, `src/server/api/routers/goals.ts`, `src/server/api/routers/portfolio.ts`, `src/server/api/routers/financial-data.ts`, `prisma/mock.ts`. In each, keep any other names imported from `@prisma/generated` (e.g. `import type { Prisma } from '@prisma/generated'`) on their original line; only move `Currency` to a `@/lib/currency` import.

Note: reads of DB currency values that may now hold an unsupported ISO code (e.g. `WatchlistItem.currency`, `Transaction.priceCurrency`) are typed `string` by the regenerated client — that is intended. Where existing code does `x.priceCurrency as Currency`, leave the cast for now (Task 7 handles the valuation types); it still compiles.

- [ ] **Step 5: Propagate the string type so typecheck stays green**

The String columns make `FxRate.base/quote` and `WatchlistItem.currency` read back as `string`, which breaks the two places that assume the `Currency` enum. Fix both now (Tasks 6/7 refine the behavior later):
- `src/server/fx.ts`: change `export type FxMatrix = Record<Currency, Record<Currency, number>>` → `Record<string, Record<string, number>>`; change `convertAmount(amount: number, from: Currency, to: Currency, m: FxMatrix)` → `from: string, to: string`. Keep the current silent `return … : amount` body (Task 6 turns it into a throw). Remove the now-unused `import type { Currency } from '@/lib/currency'` if nothing else in the file uses it. (`getFxMatrix`'s `out[r.base]`/`out[r.quote]` now type-check because keys are `string`.)
- `src/server/api/routers/portfolio.ts:438`: change `const symbolCurrencies = new Map<string, Currency>();` → `new Map<string, string>();` (its `.set(normalized, item.currency)` and the derived `marketCurrency` are now `string`, and `convertAmount` accepts `string`).

- [ ] **Step 6: Verify — typecheck + build**

Run: `bun run typecheck` — Expected: exit 0 (all `Currency` imports resolve from `@/lib/currency`; String columns type as `string`; the two propagations above clear the remaining errors).
Run: `bun test src` — Expected: all pass.
Run: `bun run build` — Expected: exit 0.
(If typecheck flags any *other* site where a DB-read currency value — now `string` — is assigned to a `Currency`-typed slot, add `as Currency` there; user-entered currencies are validated to the 10, and ingested ones are handled as `string` by Task 7.)

- [ ] **Step 7: Format + commit**

```bash
bunx @biomejs/biome check --write ./src && bun run check
git add prisma/schema.prisma prisma/generated prisma/migrations/20260708000000_currency_to_string src
git commit -m "feat(currency): store currency as ISO string; drop Postgres Currency enum

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Unify the 30+ duplicated currency sites

**Files:** the sites in the table below.

**Interfaces:**
- Consumes: `SUPPORTED_CURRENCIES`, `currencySchema`, `type Currency` from `@/lib/currency` (Task 1).

Mechanical replacement — no behavior change. For each site, import from `@/lib/currency` and replace the hardcoded literal:

- **Named const arrays** → delete the local array, import `SUPPORTED_CURRENCIES` (rename usages), or where a `Currency[]` typed local is used, `const supportedCurrencies = SUPPORTED_CURRENCIES`:
  - `src/server/api/routers/goals.ts:6`, `src/server/api/routers/transactions.ts:9`, `prisma/mock.ts:160`. **Leave `src/server/jobs/ingest-fx.ts:6` for Task 5 and `src/server/fx.ts:9` for Task 6** — don't touch those two here.
- **Inline `z.enum([...])`** → `currencySchema` (chain `.default('USD')`/`.optional()`/`.nullable()` unchanged):
  - `goals.ts:50,140`; `transactions.ts:106,109,608,611,837,841`; `portfolio.ts:85,360`; `financial-data.ts:246,247,448`; `currency.ts:49` (router `src/server/api/routers/currency.ts`); `edit-symbol-modal.tsx:22`; `goals-view.tsx:28`; `transaction-form.tsx:30,33`.
- **Hardcoded `<SelectItem>` literals** → `{SUPPORTED_CURRENCIES.map((c) => (<SelectItem key={c} value={c}>{c}</SelectItem>))}`:
  - `src/app/(dashboard)/admin/_components/edit-symbol-modal.tsx:143-148`
  - `src/app/(dashboard)/admin/_components/fx-rates-panel.tsx:96-101` and `:114-119`
- **Shadow type** `src/app/(dashboard)/admin/_components/fx-rates-panel.tsx:12` → delete `type Currency = …`; `import type { Currency } from '@/lib/currency'`.
- **Cookie guard** `src/hooks/use-currency.ts:32` → replace the 6-way OR with: `if (isSupportedCurrency(c)) return c as Currency;` (import `isSupportedCurrency`). Keep the `'USD'` fallback at `:34`.
- **OpenAPI enum** `src/app/api/docs/route.ts:306` → `const currencyEnum = SUPPORTED_CURRENCIES;` (import it).

- [ ] **Step 1: Apply all replacements above** (leave `ingest-fx.ts:6` and `fx.ts:9` for Tasks 5/6). Prefer replacing inline `z.enum([...])` with `currencySchema`.

- [ ] **Step 2: Confirm no stray 6-literal remains** (outside deliberate spots)

Run: `grep -rn "'EUR', 'USD', 'GBP', 'HKD', 'CHF', 'RUB'" src` — Expected: only `src/lib/currency.ts` is gone (now 10-element); remaining hits should be only `ingest-fx.ts`/`fx.ts` (handled in Tasks 5/6). Any other hit is a missed site — fix it.

- [ ] **Step 3: Verify — typecheck + build + tests**

Run: `bun run typecheck` (exit 0), `bun test src` (pass), `bun run build` (exit 0).

- [ ] **Step 4: Format + commit**

```bash
bunx @biomejs/biome check --write ./src && bun run check
git add src
git commit -m "refactor(currency): unify duplicated currency lists onto SUPPORTED_CURRENCIES/currencySchema

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Honest ISO normalization + `GBp` price scaling

**Files:**
- Create: `src/server/currency-normalize.ts`, `src/server/currency-normalize.test.ts`
- Modify: `src/server/yahoo-chart-parse.ts` (apply scale in `classifyChartResponse`), `src/server/yahoo-chart-parse.test.ts` (add a GBp case), `src/server/jobs/yahoo-lib.ts` (delete `mapCurrencyString`; store normalized currency)

**Interfaces:**
- Produces: `function normalizeYahooCurrency(raw?: string): { currency: string; scale: number }`
- `classifyChartResponse` now returns the NORMALIZED `currency` and scaled prices.
- `ingestYahooSymbol` stores `WatchlistItem.currency` = the (already normalized) currency string; returns `{ count, currency: string, skipped, status }`.

- [ ] **Step 1: Write the failing test** — create `src/server/currency-normalize.test.ts`:

```ts
import { describe, expect, test } from 'bun:test';
import { normalizeYahooCurrency } from './currency-normalize';

describe('normalizeYahooCurrency', () => {
	test('GBp / GBX -> GBP with 0.01 scale (pence to pounds)', () => {
		expect(normalizeYahooCurrency('GBp')).toEqual({ currency: 'GBP', scale: 0.01 });
		expect(normalizeYahooCurrency('GBX')).toEqual({ currency: 'GBP', scale: 0.01 });
		expect(normalizeYahooCurrency('gbx')).toEqual({ currency: 'GBP', scale: 0.01 });
	});
	test('ISO codes pass through uppercased, scale 1', () => {
		expect(normalizeYahooCurrency('JPY')).toEqual({ currency: 'JPY', scale: 1 });
		expect(normalizeYahooCurrency('usd')).toEqual({ currency: 'USD', scale: 1 });
	});
	test('empty -> USD, scale 1', () => {
		expect(normalizeYahooCurrency(undefined)).toEqual({ currency: 'USD', scale: 1 });
		expect(normalizeYahooCurrency('')).toEqual({ currency: 'USD', scale: 1 });
	});
});
```

- [ ] **Step 2: Run — verify fail**

Run: `bun test src/server/currency-normalize.test.ts` — Expected: FAIL (module missing).

- [ ] **Step 3: Implement** — create `src/server/currency-normalize.ts`:

```ts
/**
 * Normalize a Yahoo-reported currency to an ISO-4217 code + a price scale factor.
 * Yahoo quotes some UK instruments in pence ('GBp'/'GBX' = 1/100 GBP); we relabel to
 * 'GBP' and return scale 0.01 so callers convert pence prices to pounds. All other
 * codes pass through uppercased with scale 1. Empty input defaults to USD.
 */
export function normalizeYahooCurrency(raw?: string): { currency: string; scale: number } {
	if (!raw) return { currency: 'USD', scale: 1 };
	if (raw === 'GBp' || raw.toUpperCase() === 'GBX') return { currency: 'GBP', scale: 0.01 };
	return { currency: raw.toUpperCase(), scale: 1 };
}
```

- [ ] **Step 4: Run — verify pass**

Run: `bun test src/server/currency-normalize.test.ts` — Expected: PASS (3 tests).

- [ ] **Step 5: Apply the scale in `classifyChartResponse`**

In `src/server/yahoo-chart-parse.ts`: import `normalizeYahooCurrency` from `@/server/currency-normalize`. After `const res = json.chart?.result?.[0];` guard, replace `const currency = res.meta?.currency;` with:

```ts
	const { currency, scale } = normalizeYahooCurrency(res.meta?.currency);
```

Multiply the bar OHLC and the dividend/capitalGain amounts by `scale` (split ratios are unitless — unchanged). Concretely, in the bar push change `close/high/low/open` to multiply by `scale`:

```ts
			bars.push({
				close: Number(c) * scale,
				high: Number(h) * scale,
				low: Number(l) * scale,
				open: Number(o) * scale,
				time: toDateStringFromEpochSec(ts, gmtoffset ?? 0),
				volume: Math.max(0, Math.round(Number(v ?? 0)))
			});
```

In the dividends loop change `dividends.push({ amount, … })` to `amount: amount * scale`; in the capitalGains loop change `capitalGains.push({ amount, … })` to `amount: amount * scale`. Leave splits unchanged. The returned `currency` is now the normalized string.

- [ ] **Step 6: Update the existing test + add a GBp test in `src/server/yahoo-chart-parse.test.ts`**

The existing `found with real bars` test (`:20-36`) uses a `GBp` payload and asserts `out.bars[0].close === 10.5` / `out.currency === 'GBp'` — both change under normalization. **Change that test's `meta.currency` from `'GBp'` to `'USD'`** (so it exercises the found path with an unscaled, passthrough currency); its `close === 10.5` and `currency === 'USD'` assertions then hold. Then add a dedicated GBp test:

```ts
	test('GBp payload normalizes to GBP and scales prices + dividends by 1/100', () => {
		const out = classifyChartResponse({
			chart: {
				result: [
					{
						events: { dividends: { '1': { amount: 50, date: 1704067200 } } },
						indicators: { quote: [{ close: [2500], high: [2600], low: [2400], open: [2450], volume: [10] }] },
						meta: { currency: 'GBp', gmtoffset: 0 },
						timestamp: [1704067200]
					}
				]
			}
		});
		expect(out.currency).toBe('GBP');
		expect(out.bars[0]!.close).toBe(25);
		expect(out.dividends[0]!.amount).toBe(0.5);
	});
```

- [ ] **Step 7: Remove `mapCurrencyString`; store normalized currency**

In `src/server/jobs/yahoo-lib.ts`: delete the `mapCurrencyString` function (`:14-34`). In `ingestYahooSymbol`, the destructured `currency` from `fetchYahooDaily` is already the normalized string — use it directly:
- Replace `const mappedCurrency = mapCurrencyString(currency);` and its `updateMany` `data: { currency: mappedCurrency }` with `data: { currency }`.
- Change the final return from `currency: mapCurrencyString(currency)` to `currency: currency ?? 'USD'`.
- Remove the now-unused `Currency` import if nothing else in the file uses it (run typecheck to confirm).

- [ ] **Step 8: Verify + commit**

Run: `bun test src` (all pass incl. the new GBp test), `bun run typecheck` (exit 0), `bun run build` (exit 0), `bun run check` (clean).

```bash
git add src/server/currency-normalize.ts src/server/currency-normalize.test.ts src/server/yahoo-chart-parse.ts src/server/yahoo-chart-parse.test.ts src/server/jobs/yahoo-lib.ts
git commit -m "fix(currency): normalize Yahoo currency (GBp->GBP /100); store true ISO code

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: FX ingest driven by the const

**Files:**
- Modify: `src/server/jobs/ingest-fx.ts` (`:6`)

(The `getFxMatrix` seed at `fx.ts:9` is handled by Task 6, which rewrites `fx.ts` — don't touch `fx.ts` here.)

**Interfaces:**
- Consumes: `SUPPORTED_CURRENCIES` from `@/lib/currency`.

- [ ] **Step 1: `ingest-fx.ts`** — replace `const supported: Currency[] = ['EUR', …];` (`:6`) with an import + `const supported = SUPPORTED_CURRENCIES;`. `Currency` is already imported from `@/lib/currency` (Task 2); add `import { SUPPORTED_CURRENCIES } from '@/lib/currency'`. The `Currency` casts on `fetchRate`/`upsertRate` args still compile (`Currency` is the 10-union; `SUPPORTED_CURRENCIES` elements are `Currency`).

- [ ] **Step 2: Verify + commit**

Run: `bun run typecheck` (exit 0), `bun test src` (pass), `bun run build` (exit 0), `bun run check` (clean). (The FX ingest run itself is a deploy-time job — no live call here.)

```bash
bunx @biomejs/biome check --write ./src && bun run check
git add src/server/jobs/ingest-fx.ts
git commit -m "feat(fx): drive FX ingest from SUPPORTED_CURRENCIES (adds JPY/CAD/AUD/SGD)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Fail-loud `convertAmount` (`MissingFxRateError`)

**Files:**
- Modify: `src/server/fx.ts`
- Test: `src/server/fx.test.ts`

**Interfaces:**
- Produces:
  - `class MissingFxRateError extends Error { from: string; to: string }`
  - `type FxMatrix = Record<string, Record<string, number>>` (keys widened to string)
  - `function convertAmount(amount: number, from: string, to: string, m: FxMatrix): number` — throws `MissingFxRateError` on a missing rate.

- [ ] **Step 1: Write the failing test** — create `src/server/fx.test.ts`:

```ts
import { describe, expect, test } from 'bun:test';
import { convertAmount, type FxMatrix, MissingFxRateError } from './fx';

const m: FxMatrix = {
	USD: { USD: 1, EUR: 0.9 },
	EUR: { EUR: 1, USD: 1 / 0.9 }
};

describe('convertAmount', () => {
	test('identity when from === to', () => {
		expect(convertAmount(100, 'USD', 'USD', m)).toBe(100);
	});
	test('direct rate', () => {
		expect(convertAmount(100, 'USD', 'EUR', m)).toBeCloseTo(90);
	});
	test('throws MissingFxRateError when no rate exists', () => {
		expect(() => convertAmount(100, 'JPY', 'USD', m)).toThrow(MissingFxRateError);
	});
});
```

- [ ] **Step 2: Run — verify fail**

Run: `bun test src/server/fx.test.ts` — Expected: FAIL (`MissingFxRateError` not exported; current `convertAmount` returns unchanged instead of throwing).

- [ ] **Step 3: Implement** — replace the whole of `src/server/fx.ts` with:

```ts
import { db } from '@/server/db';
import { SUPPORTED_CURRENCIES } from '@/lib/currency';

export type FxMatrix = Record<string, Record<string, number>>;

export class MissingFxRateError extends Error {
	from: string;
	to: string;
	constructor(from: string, to: string) {
		super(`No FX rate to convert ${from} -> ${to}`);
		this.name = 'MissingFxRateError';
		this.from = from;
		this.to = to;
	}
}

export async function getFxMatrix(): Promise<FxMatrix> {
	const rows = await db.fxRate.findMany({});
	const out: FxMatrix = {};
	const currencies = SUPPORTED_CURRENCIES;
	for (const c of currencies) {
		out[c] = {};
		out[c][c] = 1;
	}
	for (const r of rows) {
		if (!out[r.base]) out[r.base] = {};
		out[r.base][r.quote] = r.rate;
		if (!out[r.quote]) out[r.quote] = {};
		if (r.rate !== 0) out[r.quote][r.base] = 1 / r.rate;
	}
	return out;
}

export function convertAmount(amount: number, from: string, to: string, m: FxMatrix): number {
	if (from === to) return amount;
	const direct = m[from]?.[to];
	if (typeof direct === 'number') return amount * direct;
	const via = m[from]?.USD && m.USD?.[to] ? amount * m[from].USD * m.USD[to] : undefined;
	if (typeof via === 'number') return via;
	throw new MissingFxRateError(from, to);
}
```

- [ ] **Step 4: Run — verify pass**

Run: `bun test src/server/fx.test.ts` — Expected: PASS (3 tests).

- [ ] **Step 5: Verify + commit** (Task 7 makes callers catch the throw; typecheck/build still pass here because signatures are compatible)

Run: `bun run typecheck` (exit 0), `bun test src` (pass), `bun run build` (exit 0), `bun run check` (clean).

```bash
git add src/server/fx.ts src/server/fx.test.ts
git commit -m "fix(fx): throw MissingFxRateError on missing rate (was silent pass-through)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: Portfolio valuation — per-holding fail-loud + reconcile market currency

**Files:**
- Modify: `src/server/api/routers/portfolio.ts` (structure market-value map `:450-464`; performance `navOnDate` `:207-231`)
- Modify: `src/app/(dashboard)/portfolio/structure/page.tsx` (holdings table row `:43-65`)

**Interfaces:**
- Consumes: `convertAmount`, `MissingFxRateError`, `getFxMatrix` (Task 6).
- Produces: `structure` holdings gain `unconverted?: boolean`; `performance` result gains `unconvertedSymbols: string[]`.

**Design:** a holding whose currency has no FX rate must not crash the query. Structure flags the row and excludes its value from totals; performance skips the symbol from NAV and reports it.

- [ ] **Step 1: Structure — guard the market-value conversion**

In `portfolio.ts`, the `items` map (`:450-464`) converts `price` via `convertAmount(price, marketCurrency, target, fx)`. Wrap it:

```ts
			.map((h) => {
				const price = latest[h.symbol] ?? 0;
				const marketCurrency =
					symbolCurrencies.get(h.symbol) ?? latestTxCurrencyBySymbol.get(h.symbol)?.currency ?? 'USD';
				let priceInTarget = price;
				let unconverted = false;
				try {
					priceInTarget = convertAmount(price, marketCurrency, target, fx);
				} catch (e) {
					if (e instanceof MissingFxRateError) {
						unconverted = true;
					} else {
						throw e;
					}
				}
				const currentValue = unconverted ? 0 : h.quantity * priceInTarget;
				return {
					avgCost: h.quantity > 0 ? h.totalCostInTarget / h.quantity : 0,
					price: unconverted ? price : priceInTarget,
					quantity: h.quantity,
					symbol: h.symbol,
					totalCost: h.totalCostInTarget,
					unconverted,
					value: currentValue
				};
```

Add `MissingFxRateError` to the existing `@/server/fx` import (the file already imports `convertAmount`/`getFxMatrix`). Downstream aggregates that sum `value` now exclude unconverted holdings (their value is 0); `unconverted` is surfaced per row for the UI badge. (`symbolCurrencies` is already `Map<string, string>` and `marketCurrency` is already `string` from Task 2 Step 5, so `convertAmount(price, marketCurrency, target, fx)` type-checks.)

- [ ] **Step 2: Performance/navOnDate — reconcile to WatchlistItem.currency + skip unconvertible**

The `performance` procedure currently never reads `WatchlistItem.currency`. Add a watchlist-currency fetch (mirroring structure) before the date loop, and rewrite `navOnDate` to prefer it and skip unconvertible symbols into a shared set:

```ts
			// Authoritative market currency per symbol (listing currency), fallback latest tx, then USD.
			const wlItems = await ctx.db.watchlistItem.findMany({
				select: { currency: true, symbol: true },
				where: { symbol: { in: Array.from(latestTxCurrencyBySymbol.keys()) }, userId }
			});
			const symbolCurrencies = new Map<string, string>();
			for (const it of wlItems) {
				const n = normalizeSymbol(it.symbol);
				if (isValidSymbol(n)) symbolCurrencies.set(n, it.currency);
			}
			const unconvertedSymbols = new Set<string>();

			function navOnDate(dateIso: string, qtyBySymbol: Map<string, number>): number {
				let total = 0;
				for (const [sym, qty] of qtyBySymbol) {
					const p = priceBySymbolDate.get(sym)?.get(dateIso);
					if (!p || qty <= 0) continue;
					const marketCurrency = symbolCurrencies.get(sym) ?? latestTxCurrencyBySymbol.get(sym)?.currency ?? 'USD';
					try {
						total += qty * convertAmount(p, marketCurrency, target, fx);
					} catch (e) {
						if (e instanceof MissingFxRateError) {
							unconvertedSymbols.add(sym);
						} else {
							throw e;
						}
					}
				}
				return total;
			}
```

Move the `latestTxCurrencyBySymbol` construction (`:220-231`) to BEFORE this block (it must exist before the `wlItems` query and `navOnDate` reference it). Then include `unconvertedSymbols: Array.from(unconvertedSymbols)` in the object the `performance` procedure returns.

- [ ] **Step 3: Render the `unconverted` badge in the holdings table**

In `src/app/(dashboard)/portfolio/structure/page.tsx`, add `unconverted?: boolean` to the inline row type (`:44-49`, after `weight: number;`), and add a badge in the symbol cell (`:52`). Replace `<td className='px-2 py-2'>{row.symbol}</td>` with:

```tsx
													<td className='px-2 py-2'>
														{row.symbol}
														{row.unconverted && (
															<span
																className='ml-2 rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] text-amber-600'
																title='No FX rate for this holding’s currency — excluded from totals'
															>
																unconverted
															</span>
														)}
													</td>
```

(The `unconverted` field flows automatically from `portfolio.structure`'s output type into `data.items`.)

- [ ] **Step 4: Verify — typecheck + build + tests**

Run: `bun run typecheck` (exit 0), `bun test src` (pass), `bun run build` (exit 0), `bun run check` (clean).

- [ ] **Step 5: Manual note (documented; needs DB + auth + FX rows)**

A holding whose `WatchlistItem.currency` is outside the 10 (e.g. `INR`) renders with the `unconverted` badge and contributes 0 to totals, instead of crashing the portfolio query or silently mis-valuing. Supported currencies value correctly once FX ingest has run. Structure and performance now agree on the market currency for a given symbol.

- [ ] **Step 6: Commit**

```bash
bunx @biomejs/biome check --write ./src && bun run check
git add src/server/api/routers/portfolio.ts "src/app/(dashboard)/portfolio/structure/page.tsx"
git commit -m "fix(portfolio): per-holding fail-loud conversion + reconcile market currency + unconverted badge

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: Currency backfill script

**Files:**
- Create: `src/server/jobs/backfill-currency.ts`
- Modify: `package.json` (add `currency:backfill` script)

**Interfaces:**
- Consumes: `fetchYahooDaily` (returns normalized `currency`) from `@/server/jobs/yahoo-lib`; `db`; `sleep`.

- [ ] **Step 1: Implement the script** — create `src/server/jobs/backfill-currency.ts`:

```ts
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
			const { currency, status } = await fetchYahooDaily(symbol, { interval: '1d', period1: 1, period2: Math.floor(Date.now() / 1000) });
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
```

- [ ] **Step 2: Add the package.json script**

In `package.json` `scripts`, add (alphabetical, near the other `ingest:*` scripts): `"currency:backfill": "bun run src/server/jobs/backfill-currency.ts",`

- [ ] **Step 3: Verify + commit** (script is a deploy-time job; typecheck/build validate it compiles)

Run: `bun run typecheck` (exit 0), `bun test src` (pass), `bun run build` (exit 0), `bun run check` (clean).

```bash
git add src/server/jobs/backfill-currency.ts package.json
git commit -m "feat(currency): one-off backfill script to re-derive WatchlistItem.currency

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 9: Full verification gate

**Files:** none (verification only)

- [ ] **Step 1: Run every gate**

```bash
bun test src
bun run typecheck
bun run check
bun run build
```
Expected: all pass.

- [ ] **Step 2: Confirm the unification is complete**

Run: `grep -rn "'EUR', 'USD', 'GBP', 'HKD', 'CHF', 'RUB'" src prisma` — Expected: no hits (the 6-literal is gone; `SUPPORTED_CURRENCIES` is the only source).
Run: `grep -rn "from '@prisma/generated'" src | grep Currency` — Expected: no hits (all repointed to `@/lib/currency`).
Run: `grep -rn "mapCurrencyString" src` — Expected: no hits (deleted).

- [ ] **Step 3: Manual QA checklist** (needs a running app + DB + FX ingest)

- Run `bun run ingest:fx` then `bun run currency:backfill` against a dev DB; confirm JPY/CAD/AUD/SGD FxRate rows exist and foreign `WatchlistItem.currency` values are corrected.
- A UK `.L` holding (`VUSA.L`) now values in GBP at 1/100 of the prior (pence) figure.
- A JPY holding (`7203.T`) values correctly (not ~150× USD).
- A holding in an unsupported currency shows an `unconverted` badge and doesn't crash the portfolio page.
- Currency dropdowns (transaction form, goals, admin edit-symbol, FX-rates panel, currency switch) list all 10.

- [ ] **Step 4: No code changes expected.** Fix any gate failure in the owning task's file and re-run before opening the PR.

---

## Deploy order (for the PR description / release)

migrate (`prisma migrate deploy`) → deploy code → `bun run ingest:fx` (fetch new-currency rates) → `bun run currency:backfill` (correct existing `WatchlistItem.currency` labels) → **`bun run ingest:yahoo` (full re-ingest — REQUIRED)**.

**Why the final re-ingest is required:** the `GBp`/pence ÷100 scaling happens at ingest time (`classifyChartResponse`). Price bars already in InfluxDB for UK `.L` holdings were written by the old code in **raw pence labelled GBP**, and `currency:backfill` only fixes the *label*, not the stored bars. Without a full `ingest:yahoo` re-run those holdings render **100× too high** in the current-value/structure view. Re-ingest is idempotent (overwrites by symbol+date, re-derives scale from raw Yahoo each run), so it is safe to run.

## Notes for the implementer

- **DB-optional migration:** `bun prisma generate` regenerates the client from the schema with no DB; the hand-written migration SQL applies at deploy. Typecheck/build validate against the regenerated client.
- **`Currency` (the 10-union) vs `string`:** user-entered currencies are validated to the 10 via `currencySchema`; ingested `WatchlistItem.currency` may hold any ISO code and is typed `string`. `convertAmount`/`getFxMatrix` use `string` keys; `formatCurrency` takes `string`.
- **Historical FX untouched** — `getFxMatrix` remains a single current snapshot applied across history (Spec 2b fixes that).
