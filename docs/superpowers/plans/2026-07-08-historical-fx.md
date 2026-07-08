# Historical FX Implementation Plan (Spec 2b)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make portfolio FX conversion date-aware by sourcing all FX from Yahoo daily bars stored in InfluxDB, retiring Alpha Vantage and the Postgres `FxRate` table.

**Architecture:** FX becomes a daily time series in a dedicated `fx_rates` InfluxDB measurement (9 USD-leg series, `${C}USD=X` close = USD per 1 unit of C). Pure matrix/fill logic lives in `src/server/fx.ts` (unit-tested, no IO imports); a thin `src/server/fx-history.ts` wraps Influx reads/writes. `portfolio.performance` and `portfolio.structure` convert each valuation/transaction at its own date via a forward-filled per-date matrix map; the current-value site stays on the latest bar. The `FxRate` table and Alpha Vantage are removed.

**Tech Stack:** TypeScript, Bun (`bun:test`), Next.js, tRPC, Prisma (Postgres), InfluxDB v2 (`@influxdata/influxdb-client`), Zod, Biome.

## Global Constraints

- **Currency set:** always `SUPPORTED_CURRENCIES` / `type Currency` / `currencySchema` from `@/lib/currency` (10 codes). Never hardcode a currency list.
- **FX direction (invariant):** Yahoo `${C}USD=X` close = **USD per 1 unit of C**. Store it verbatim in `fx_rates`. In the matrix: `out[C].USD = rate`, `out.USD[C] = 1 / rate`. `convertAmount` already pivots cross rates through USD — never materialize cross rates.
- **Influx schema:** measurement `fx_rates`, tag `currency` (non-USD ISO code), field `rate` (float), timestamp = bar date at `T00:00:00Z`.
- **Full history:** fetch with `period1: 1, period2: Math.floor(Date.now() / 1000)`, `interval: '1d'`.
- **Forward-fill** across gaps/weekends/holidays. A date with no bar at or before it has no leg for that currency → `convertAmount` throws `MissingFxRateError`, which each call site catches to flag the holding `unconverted` / add to `unconvertedSymbols` (Spec 2a contract — never crash the query).
- **Module boundary:** pure functions (no `@/server/influx`, no `@/server/db` import) live in `fx.ts` so unit tests can import them without constructing the Influx client. All Influx IO lives in `fx-history.ts`.
- **Keep** the filename `src/server/jobs/ingest-fx.ts` and the `ingest:fx` package script.
- **Biome:** tabs, single quotes, **object keys sorted alphabetically**. Run `bun run check` before every commit.
- **Gates (every task):** `bun test src` (if the task adds/changes tested code), `bun run typecheck` (tsc --noEmit, exit 0), `bun run check` (clean), `bun run build` (next build — a first-attempt Google Fonts network error is a transient flake; re-run once).
- **Commit trailer** on every commit:
  ```
  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
  ```

---

### Task 1: Pure FX matrix + forward-fill + per-date assembly (`fx.ts`)

Add three pure, unit-tested helpers to `fx.ts`. This task is purely additive — the existing `getFxMatrix`/`convertAmount`/`MissingFxRateError` and the `db` import stay untouched (removed in Task 5).

**Files:**
- Modify: `src/server/fx.ts`
- Test: `src/server/fx.test.ts`

**Interfaces:**
- Consumes: `SUPPORTED_CURRENCIES` from `@/lib/currency`; existing `FxMatrix` type from `./fx`.
- Produces:
  - `buildFxMatrixFromUsdLegs(usdPerUnit: Map<string, number>): FxMatrix`
  - `forwardFill(raw: Map<string, number>, dateKeys: string[]): Map<string, number>`
  - `assembleFxByDate(rawByCurrency: Map<string, Map<string, number>>, dateKeys: string[]): Map<string, FxMatrix>`

- [ ] **Step 1: Write the failing tests**

Append to `src/server/fx.test.ts`:

```ts
import {
	assembleFxByDate,
	buildFxMatrixFromUsdLegs,
	convertAmount,
	forwardFill
} from './fx';

describe('buildFxMatrixFromUsdLegs', () => {
	test('identity diagonal for every supported currency', () => {
		const m = buildFxMatrixFromUsdLegs(new Map());
		expect(m.USD?.USD).toBe(1);
		expect(m.EUR?.EUR).toBe(1);
		expect(m.JPY?.JPY).toBe(1);
	});
	test('sets C->USD to the leg and USD->C to its reciprocal', () => {
		const m = buildFxMatrixFromUsdLegs(new Map([['EUR', 1.08]]));
		expect(m.EUR?.USD).toBeCloseTo(1.08);
		expect(m.USD?.EUR).toBeCloseTo(1 / 1.08);
	});
	test('skips non-positive legs', () => {
		const m = buildFxMatrixFromUsdLegs(new Map([['EUR', 0]]));
		expect(m.EUR?.USD).toBeUndefined();
	});
	test('convertAmount crosses two legs via USD pivot', () => {
		const m = buildFxMatrixFromUsdLegs(new Map([['EUR', 1.08], ['GBP', 1.27]]));
		// 100 EUR -> USD -> GBP
		expect(convertAmount(100, 'EUR', 'GBP', m)).toBeCloseTo((100 * 1.08) / 1.27);
	});
	test('convertAmount throws for a currency with no leg', () => {
		const m = buildFxMatrixFromUsdLegs(new Map([['EUR', 1.08]]));
		expect(() => convertAmount(100, 'CAD', 'EUR', m)).toThrow();
	});
});

describe('forwardFill', () => {
	const keys = ['2020-01-01', '2020-01-02', '2020-01-03', '2020-01-04'];
	test('carries the last known value across gaps', () => {
		const filled = forwardFill(new Map([['2020-01-02', 1.1]]), keys);
		expect(filled.get('2020-01-02')).toBe(1.1);
		expect(filled.get('2020-01-03')).toBe(1.1);
		expect(filled.get('2020-01-04')).toBe(1.1);
	});
	test('seeds from the latest value strictly before the first key', () => {
		const filled = forwardFill(new Map([['2019-12-31', 1.05], ['2020-01-03', 1.2]]), keys);
		expect(filled.get('2020-01-01')).toBe(1.05);
		expect(filled.get('2020-01-03')).toBe(1.2);
	});
	test('leaves early keys unset when there is no seed', () => {
		const filled = forwardFill(new Map([['2020-01-03', 1.2]]), keys);
		expect(filled.has('2020-01-01')).toBe(false);
		expect(filled.get('2020-01-03')).toBe(1.2);
	});
});

describe('assembleFxByDate', () => {
	const keys = ['2020-01-01', '2020-01-02'];
	test('builds one forward-filled matrix per date', () => {
		const raw = new Map([['EUR', new Map([['2020-01-01', 1.1]])]]);
		const byDate = assembleFxByDate(raw, keys);
		expect(byDate.get('2020-01-01')?.EUR?.USD).toBeCloseTo(1.1);
		// 2020-01-02 has no EUR bar but forward-fills from 01-01
		expect(byDate.get('2020-01-02')?.EUR?.USD).toBeCloseTo(1.1);
	});
	test('a date with no leg for a currency omits that leg (convertAmount throws)', () => {
		const raw = new Map([['EUR', new Map([['2020-01-02', 1.1]])]]);
		const byDate = assembleFxByDate(raw, keys);
		expect(() => convertAmount(1, 'EUR', 'USD', byDate.get('2020-01-01')!)).toThrow();
	});
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test src/server/fx.test.ts`
Expected: FAIL — `buildFxMatrixFromUsdLegs`, `forwardFill`, `assembleFxByDate` are not exported.

- [ ] **Step 3: Implement the three helpers**

Add to `src/server/fx.ts` (after the existing `convertAmount`; keep imports — add nothing that imports `@/server/influx` or `@/server/db`):

```ts
/**
 * Build an FxMatrix from USD legs. `usdPerUnit` maps a non-USD currency to its Yahoo
 * `${C}USD=X` close (USD per 1 unit of C). Identity diagonal is seeded for every supported
 * currency; only USD legs + reciprocals are stored — convertAmount derives cross rates via USD.
 */
export function buildFxMatrixFromUsdLegs(usdPerUnit: Map<string, number>): FxMatrix {
	const out: FxMatrix = {};
	for (const c of SUPPORTED_CURRENCIES) out[c] = { [c]: 1 };
	out.USD ??= { USD: 1 };
	for (const [c, rate] of usdPerUnit) {
		if (!(rate > 0)) continue;
		(out[c] ??= {})[c] = 1;
		out[c].USD = rate;
		out.USD[c] = 1 / rate;
	}
	return out;
}

/**
 * Forward-fill a single currency's rate series across an ordered list of ISO date keys,
 * seeded by the latest value strictly before the first key. Mirrors the price carry-forward in
 * portfolio.performance. Dates with no known value (no seed yet) are omitted from the result.
 */
export function forwardFill(raw: Map<string, number>, dateKeys: string[]): Map<string, number> {
	const first = dateKeys[0];
	let seed: number | undefined;
	if (first !== undefined) {
		for (const [iso, v] of Array.from(raw.entries()).sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
			if (iso < first) seed = v;
		}
	}
	const out = new Map<string, number>();
	let last = seed;
	for (const iso of dateKeys) {
		const v = raw.get(iso);
		if (v != null && Number.isFinite(v)) last = v;
		if (last != null && Number.isFinite(last)) out.set(iso, last);
	}
	return out;
}

/**
 * Assemble a per-date FxMatrix map: forward-fill each currency's series across `dateKeys`, then
 * build one matrix per date from the currencies that have a known rate on that date.
 */
export function assembleFxByDate(
	rawByCurrency: Map<string, Map<string, number>>,
	dateKeys: string[]
): Map<string, FxMatrix> {
	const filledByCurrency = new Map<string, Map<string, number>>();
	for (const [c, raw] of rawByCurrency) filledByCurrency.set(c, forwardFill(raw, dateKeys));
	const out = new Map<string, FxMatrix>();
	for (const iso of dateKeys) {
		const legs = new Map<string, number>();
		for (const [c, filled] of filledByCurrency) {
			const r = filled.get(iso);
			if (r != null && Number.isFinite(r)) legs.set(c, r);
		}
		out.set(iso, buildFxMatrixFromUsdLegs(legs));
	}
	return out;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test src/server/fx.test.ts`
Expected: PASS (all existing + new tests).

- [ ] **Step 5: Gates + commit**

Run: `bun run check && bun run typecheck`
Expected: clean, exit 0.

```bash
git add src/server/fx.ts src/server/fx.test.ts
git commit -m "feat(fx): pure USD-leg matrix + forward-fill + per-date assembly

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Influx FX store & readers (`fx-history.ts`)

Thin IO wrapper over the pure helpers: write bars to `fx_rates`, read the latest matrix, and build a forward-filled per-date matrix map. Not unit-tested (Influx IO) — the pure logic is already covered by Task 1; verified by typecheck + build.

**Files:**
- Create: `src/server/fx-history.ts`

**Interfaces:**
- Consumes: `assembleFxByDate`, `buildFxMatrixFromUsdLegs`, `type FxMatrix` from `@/server/fx`; `fluxStringLiteral`, `influxQueryApi`, `influxWriteApi`, `Point` from `@/server/influx`; `env` from `@/env`.
- Produces:
  - `writeFxRates(currency: string, bars: { close: number; time: string }[]): Promise<void>`
  - `getLatestFxBars(): Promise<{ asOf: Date | null; legs: Map<string, number> }>`
  - `getFxMatrix(): Promise<FxMatrix>`
  - `buildFxByDate(fromIso: string, toIso: string): Promise<Map<string, FxMatrix>>`

- [ ] **Step 1: Create the module**

Create `src/server/fx-history.ts`:

```ts
import { env } from '@/env';
import { assembleFxByDate, buildFxMatrixFromUsdLegs, type FxMatrix } from '@/server/fx';
import { fluxStringLiteral, influxQueryApi, influxWriteApi, Point } from '@/server/influx';

const FX_MEASUREMENT = 'fx_rates';

function sleep(ms: number) {
	return new Promise((res) => setTimeout(res, ms));
}

function isoKey(d: Date): string {
	return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Write one currency's USD-leg daily closes to the fx_rates measurement (idempotent by timestamp). */
export async function writeFxRates(currency: string, bars: { close: number; time: string }[]): Promise<void> {
	if (bars.length === 0) return;
	const BATCH = 1000;
	for (let i = 0; i < bars.length; i += BATCH) {
		const points = bars.slice(i, i + BATCH).map((bar) =>
			new Point(FX_MEASUREMENT)
				.tag('currency', currency)
				.floatField('rate', bar.close)
				.timestamp(new Date(`${bar.time}T00:00:00Z`))
		);
		let attempt = 1;
		const maxAttempts = 5;
		while (true) {
			try {
				influxWriteApi.writePoints(points);
				await influxWriteApi.flush();
				break;
			} catch (err) {
				if (attempt >= maxAttempts) throw err;
				await sleep(Math.min(30_000, 2_000 * attempt));
				attempt += 1;
			}
		}
	}
}

/** Latest USD-per-unit rate per currency, plus the newest bar timestamp seen (matrix as-of date). */
export async function getLatestFxBars(): Promise<{ asOf: Date | null; legs: Map<string, number> }> {
	const flux = `from(bucket: ${fluxStringLiteral(env.INFLUXDB_BUCKET)})
	|> range(start: -50y)
	|> filter(fn: (r) => r._measurement == ${fluxStringLiteral(FX_MEASUREMENT)} and r._field == ${fluxStringLiteral('rate')})
	|> group(columns: ["currency"])
	|> last()`;
	const rows = await influxQueryApi.collectRows<{ currency: string; _value: number | string; _time: string }>(flux);
	const legs = new Map<string, number>();
	let asOf: Date | null = null;
	for (const r of rows) {
		const v = typeof r._value === 'number' ? r._value : Number(r._value);
		if (!Number.isFinite(v)) continue;
		legs.set(String(r.currency), v);
		const t = new Date(r._time);
		if (!asOf || t > asOf) asOf = t;
	}
	return { asOf, legs };
}

/** Current FX matrix from the latest bar per currency. */
export async function getFxMatrix(): Promise<FxMatrix> {
	const { legs } = await getLatestFxBars();
	return buildFxMatrixFromUsdLegs(legs);
}

/**
 * Forward-filled per-date FxMatrix map over the inclusive [fromIso, toIso] calendar. Seeds each
 * currency from the latest bar in a 7-day window before fromIso, then carries forward across gaps.
 */
export async function buildFxByDate(fromIso: string, toIso: string): Promise<Map<string, FxMatrix>> {
	// Parse as LOCAL midnight (no 'Z') so isoKey() round-trips the inputs and the produced date keys
	// match the local-formatted day keys portfolio.performance uses for fxByDate.get(dateIso) lookups.
	const fromDate = new Date(`${fromIso}T00:00:00`);
	const toDate = new Date(`${toIso}T00:00:00`);
	if (Number.isNaN(fromDate.getTime()) || Number.isNaN(toDate.getTime()) || fromDate > toDate) {
		return new Map();
	}
	const seedStart = new Date(fromDate);
	seedStart.setDate(seedStart.getDate() - 7);
	const stop = new Date(toDate);
	stop.setDate(stop.getDate() + 1);

	const flux = `from(bucket: ${fluxStringLiteral(env.INFLUXDB_BUCKET)})
	|> range(start: ${seedStart.toISOString()}, stop: ${stop.toISOString()})
	|> filter(fn: (r) => r._measurement == ${fluxStringLiteral(FX_MEASUREMENT)} and r._field == ${fluxStringLiteral('rate')})
	|> group(columns: ["currency"])`;
	const rows = await influxQueryApi.collectRows<{ currency: string; _value: number | string; _time: string }>(flux);

	const rawByCurrency = new Map<string, Map<string, number>>();
	for (const r of rows) {
		const v = typeof r._value === 'number' ? r._value : Number(r._value);
		if (!Number.isFinite(v)) continue;
		const c = String(r.currency);
		const day = String(r._time).slice(0, 10);
		if (!rawByCurrency.has(c)) rawByCurrency.set(c, new Map());
		rawByCurrency.get(c)!.set(day, v);
	}

	const dateKeys: string[] = [];
	for (let d = new Date(fromDate); d <= toDate; d.setDate(d.getDate() + 1)) dateKeys.push(isoKey(d));

	return assembleFxByDate(rawByCurrency, dateKeys);
}
```

- [ ] **Step 2: Gates**

Run: `bun run check && bun run typecheck && bun run build`
Expected: clean; tsc exit 0; build succeeds (re-run once if the first attempt hits the Google Fonts network flake).

- [ ] **Step 3: Commit**

```bash
git add src/server/fx-history.ts
git commit -m "feat(fx): influx fx_rates store + latest/history matrix readers

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Yahoo FX ingest job (rewrite `ingest-fx.ts`)

Replace the Alpha Vantage body with a Yahoo full-history fetch per currency. Idempotent — this single job is both the one-off backfill and the daily refresh. Keeps the filename and `ingest:fx` script.

**Files:**
- Modify (full rewrite): `src/server/jobs/ingest-fx.ts`

**Interfaces:**
- Consumes: `SUPPORTED_CURRENCIES` from `@/lib/currency`; `fetchYahooDaily`, `sleep` from `@/server/jobs/yahoo-lib`; `writeFxRates` from `@/server/fx-history`; `db` from `@/server/db`.

- [ ] **Step 1: Replace the file contents**

Overwrite `src/server/jobs/ingest-fx.ts`:

```ts
#!/usr/bin/env bun
import { SUPPORTED_CURRENCIES } from '@/lib/currency';
import { db } from '@/server/db';
import { writeFxRates } from '@/server/fx-history';
import { fetchYahooDaily, sleep } from '@/server/jobs/yahoo-lib';

const PACING_MS = 2000;

/**
 * Source FX from Yahoo daily bars into the InfluxDB `fx_rates` measurement. For each non-USD
 * currency C we fetch the `${C}USD=X` pair (close = USD per 1 unit of C) over its full history and
 * store it. Idempotent (Influx overwrites by measurement+tag+timestamp), so this same job serves
 * both the one-off backfill and the daily refresh. Run: `bun run ingest:fx`.
 */
async function main() {
	const period2 = Math.floor(Date.now() / 1000);
	let written = 0;
	let failed = 0;
	const failures: string[] = [];

	for (const currency of SUPPORTED_CURRENCIES) {
		if (currency === 'USD') continue;
		const pair = `${currency}USD=X`;
		try {
			const { bars, status } = await fetchYahooDaily(pair, { interval: '1d', period1: 1, period2 });
			if (status === 'not-found' || bars.length === 0) {
				failed++;
				failures.push(`${currency} (${status}, ${bars.length} bars)`);
			} else {
				await writeFxRates(currency, bars);
				written++;
				console.log(`  ${currency}: ${bars.length} bars (${bars[0]?.time} … ${bars[bars.length - 1]?.time})`);
			}
		} catch (e) {
			failed++;
			failures.push(`${currency}: ${e instanceof Error ? e.message : String(e)}`);
		}
		await sleep(PACING_MS);
	}

	console.log(`FX ingest done — currencies written ${written}, failed ${failed}.`);
	if (failed > 0) {
		console.warn(`FX ingest failures (existing series left intact): ${failures.join(' | ')}`);
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
```

- [ ] **Step 2: Gates**

Run: `bun run check && bun run typecheck`
Expected: clean; tsc exit 0.

Note: `bun run build` will still succeed; `env.ALPHAVANTAGE_*` is now unused here but still declared in `env.js` (removed in Task 6), so no env error.

- [ ] **Step 3: Commit**

```bash
git add src/server/jobs/ingest-fx.ts
git commit -m "feat(fx): source FX from Yahoo daily bars (replace Alpha Vantage)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Date-aware valuation (`portfolio.ts`)

Convert each valuation/transaction at its own date. `performance` uses one `buildFxByDate` map over its inception→to range; `structure` uses a `buildFxByDate` map over min-transaction-date→today for cost basis, and the latest matrix for current value.

**Files:**
- Modify: `src/server/api/routers/portfolio.ts`

**Interfaces:**
- Consumes: `buildFxByDate`, `getFxMatrix` from `@/server/fx-history`; `convertAmount`, `type FxMatrix`, `MissingFxRateError` from `@/server/fx`.

- [ ] **Step 1: Repoint the FX import**

In `src/server/api/routers/portfolio.ts`, change the FX import (currently `import { convertAmount, getFxMatrix, MissingFxRateError } from '@/server/fx';`) to split sources:

```ts
import { convertAmount, type FxMatrix, MissingFxRateError } from '@/server/fx';
import { buildFxByDate, getFxMatrix } from '@/server/fx-history';
```

(Place both in the file's existing import ordering so `bun run check` stays clean.)

- [ ] **Step 2: performance — build the per-date map instead of one snapshot**

Replace the single-snapshot line (currently around `portfolio.ts:204-205`):

```ts
// Get FX for conversion to target currency (current snapshot)
const fx = await getFxMatrix();
```

with a per-date map over the range already computed (`inceptionDate` … `toDate`). Reuse the procedure's
hoisted `toIso` helper (declared at `:254`, a hoisted function declaration — callable here; the repo's
Biome config has no `noUseBeforeDefine` rule) so the keys match the `day` keys used for lookups:

```ts
// Per-date FX (forward-filled) so each valuation/transaction converts at its own date.
const fxByDate = await buildFxByDate(toIso(inceptionDate), toIso(toDate));
```

(`inceptionDate` is non-null here — the early return at the current `:126-135` handles the null case.)

- [ ] **Step 3: performance — navOnDate converts at the valuation date**

In `navOnDate(dateIso, qtyBySymbol)`, resolve the date's matrix and use it. Replace the conversion body (currently `:236-249`) so the `convertAmount` call reads `fx` for `dateIso`:

```ts
function navOnDate(dateIso: string, qtyBySymbol: Map<string, number>): number {
	let total = 0;
	const fx: FxMatrix = fxByDate.get(dateIso) ?? {};
	for (const [sym, qty] of qtyBySymbol) {
		const p = priceBySymbolDate.get(sym)?.get(dateIso);
		if (!p || qty <= 0) continue;
		const marketCurrency =
			symbolCurrencies.get(sym) ?? latestTxCurrencyBySymbol.get(sym)?.currency ?? 'USD';
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

- [ ] **Step 4: performance — cash flow + fee convert at the transaction date**

In the daily loop, the transactions in `dayTx` all fall on `day`, so `day` is their transaction date. Replace the `convertAmount` calls (currently `:298` and `:302`) to read the day's matrix. Update the `try` block:

```ts
try {
	const txFx: FxMatrix = fxByDate.get(day) ?? {};
	const valueInTarget = convertAmount(transactionValue, transactionCurrency, target, txFx);
	let feeInTarget = 0;
	if (t.fee) {
		const feeCurrency = (t.feeCurrency as string) ?? transactionCurrency;
		feeInTarget = convertAmount(t.fee, feeCurrency, target, txFx);
	}
	const flowForTx = sign === 1 ? valueInTarget + feeInTarget : -(valueInTarget - feeInTarget);
	flow += flowForTx;
} catch (e) {
	if (e instanceof MissingFxRateError) unconvertedSymbols.add(up);
	else throw e;
}
```

- [ ] **Step 5: structure — build the cost-basis map + latest matrix**

In `portfolio.structure`, replace the single `const fx = await getFxMatrix();` (currently `:417`) with a per-transaction-date map plus the latest matrix. Insert after `txs` is fetched (the `txs` array is in scope):

```ts
// Cost basis converts at each transaction's date; current market value converts at the latest rate.
const structToIso = (d: Date) =>
	`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const todayIso = structToIso(new Date());
let minTxDate: Date | null = null;
for (const t of txs) {
	if (t.date && (!minTxDate || t.date < minTxDate)) minTxDate = t.date;
}
const fxByDate = await buildFxByDate(minTxDate ? structToIso(minTxDate) : todayIso, todayIso);
const fxLatest = await getFxMatrix();
```

- [ ] **Step 6: structure — cost basis uses the transaction-date matrix**

In the cost-basis accumulation loop, replace the `convertAmount` calls (currently `:436` and `:440`). A dated transaction uses its day's matrix; a null-date transaction falls back to the latest matrix (preserving prior behavior). Update the `try` block:

```ts
try {
	const txFx: FxMatrix = t.date ? (fxByDate.get(structToIso(new Date(t.date))) ?? {}) : fxLatest;
	const valueInTarget = convertAmount(transactionValue, transactionCurrency, target, txFx);
	let feeInTarget = 0;
	if (t.fee) {
		const feeCurrency = (t.feeCurrency as string) ?? transactionCurrency;
		feeInTarget = convertAmount(t.fee, feeCurrency, target, txFx);
	}
	costAdjustment = sign === 1 ? valueInTarget + feeInTarget : -(valueInTarget - feeInTarget);
} catch (e) {
	if (e instanceof MissingFxRateError) costUnconverted.add(up);
	else throw e;
}
```

- [ ] **Step 7: structure — current market value uses the latest matrix**

In the holdings `.map` that computes `priceInTarget` (currently `:501`), change the matrix argument from `fx` to `fxLatest`:

```ts
priceInTarget = convertAmount(price, marketCurrency, target, fxLatest);
```

- [ ] **Step 8: Gates**

Run: `bun run check && bun run typecheck && bun run build`
Expected: clean; tsc exit 0; build succeeds (re-run once on a Google Fonts flake). Confirm no remaining reference to the removed single `fx` variable in either procedure (`grep -n "convertAmount(" src/server/api/routers/portfolio.ts` — every call must pass `fxByDate.get(...)`, `txFx`, or `fxLatest`).

- [ ] **Step 9: Commit**

```bash
git add src/server/api/routers/portfolio.ts
git commit -m "feat(portfolio): date-aware FX conversion for NAV/TWR/MWR and cost basis

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Repoint FX readers off Postgres; strip old `getFxMatrix`

Move the `fx.matrix` tRPC and admin `getFxRates` onto the Yahoo/Influx matrix, then delete the db-backed `getFxMatrix` and drop `fx.ts`'s `db` import. After this task, no code reads `db.fxRate`.

**Files:**
- Modify: `src/server/fx.ts`
- Modify: `src/server/api/routers/fx.ts`
- Modify: `src/server/api/routers/financial-data.ts`

**Interfaces:**
- Consumes: `getFxMatrix`, `getLatestFxBars` from `@/server/fx-history`; `buildFxMatrixFromUsdLegs`, `convertAmount` from `@/server/fx`; `SUPPORTED_CURRENCIES` from `@/lib/currency`.

- [ ] **Step 1: Repoint the `fx.matrix` router import**

In `src/server/api/routers/fx.ts`, change the import from `@/server/fx` to `@/server/fx-history`:

```ts
import { getFxMatrix } from '@/server/fx-history';
```

No other change — `matrix` still returns the current matrix.

- [ ] **Step 2: Rewrite `financialData.getFxRates` to synthesize from the current matrix**

In `src/server/api/routers/financial-data.ts`, replace the `db.fxRate.findMany` block and the `stats` derivation (currently `:257-277`) with synthesized rows from the current Yahoo/Influx matrix. Keep the input schema, the audit-log block, and the return shape (`{ rates, stats }`) unchanged.

Add imports (with the file's existing sort order):

```ts
import { SUPPORTED_CURRENCIES } from '@/lib/currency';
import { buildFxMatrixFromUsdLegs, convertAmount } from '@/server/fx';
import { getLatestFxBars } from '@/server/fx-history';
```

Replace the rates+stats computation (keep `const { base, quote } = input;` above it):

```ts
const { asOf, legs } = await getLatestFxBars();
const matrix = buildFxMatrixFromUsdLegs(legs);
const fetchedAt = asOf ?? new Date(0);

const rates: { base: string; fetchedAt: Date; id: string; quote: string; rate: number }[] = [];
for (const b of SUPPORTED_CURRENCIES) {
	if (base && b !== base) continue;
	for (const q of SUPPORTED_CURRENCIES) {
		if (b === q) continue;
		if (quote && q !== quote) continue;
		try {
			rates.push({ base: b, fetchedAt, id: `${b}-${q}`, quote: q, rate: convertAmount(1, b, q, matrix) });
		} catch {
			// No path for this pair at the current rate — omit it.
		}
	}
}

const now = new Date();
const stats = {
	averageAgeHours: asOf ? (now.getTime() - asOf.getTime()) / (1000 * 60 * 60) : 0,
	oldestUpdate: asOf,
	recentUpdate: asOf,
	totalRates: rates.length
};
```

The existing `return { rates: rates.map(...), stats }` maps each row to `{ base, fetchedAt, id, quote, rate }` — already the shape produced above, so it stays as-is.

- [ ] **Step 3: Delete the db-backed `getFxMatrix` and drop the `db` import from `fx.ts`**

In `src/server/fx.ts`, remove the `import { db } from '@/server/db';` line and delete the entire `getFxMatrix` function (currently `:17-34`). Keep `MissingFxRateError`, `convertAmount`, and the Task 1 helpers. The `SUPPORTED_CURRENCIES` import stays (used by `buildFxMatrixFromUsdLegs`).

- [ ] **Step 4: Verify no `db.fxRate` reads remain**

Run: `grep -rn "db.fxRate\|getFxMatrix" src/`
Expected: `getFxMatrix` appears only as the export in `fx-history.ts` and its importers (`portfolio.ts`, `fx.ts` router); **zero** `db.fxRate` occurrences.

- [ ] **Step 5: Gates + commit**

Run: `bun test src && bun run check && bun run typecheck && bun run build`
Expected: all pass (fx unit tests still green; build re-run once on a fonts flake).

```bash
git add src/server/fx.ts src/server/api/routers/fx.ts src/server/api/routers/financial-data.ts
git commit -m "refactor(fx): serve current matrix + admin rates from Yahoo/Influx

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Drop `FxRate` table + remove Alpha Vantage config

Remove the now-unused model, generate the drop migration, and delete the dead Alpha Vantage env vars.

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/<timestamp>_drop_fx_rate_table/migration.sql` (generated)
- Modify: `src/env.js`
- Modify: `.env.example`

- [ ] **Step 1: Remove the model**

In `prisma/schema.prisma`, delete the `FxRate` model (currently `:170-180`, including the `// Store latest FX rates…` comment on `:170`).

- [ ] **Step 2: Generate the migration + client**

Run: `bunx prisma migrate dev --name drop_fx_rate_table`
Expected: creates `prisma/migrations/<ts>_drop_fx_rate_table/migration.sql` containing `DROP TABLE "FxRate";` (or `"public"."FxRate"`), applies it locally, and regenerates the client. Confirm the SQL is a table drop only.

If the generated client lands in `prisma/generated/`, ensure it regenerated (run `bunx prisma generate` if needed) so `FxRate` no longer appears in `prisma/generated/`.

- [ ] **Step 3: Remove Alpha Vantage from `env.js`**

In `src/env.js`, delete:
- `runtimeEnv`: the `ALPHAVANTAGE_API_KEY` and `ALPHAVANTAGE_API_URL` lines (`:31-32`).
- `server`: the `ALPHAVANTAGE_API_KEY` and `ALPHAVANTAGE_API_URL` schema lines (`:68-69`).

- [ ] **Step 4: Remove Alpha Vantage from `.env.example`**

In `.env.example`, delete the `ALPHAVANTAGE_API_KEY=` line (`:13`) and the `ALPHAVANTAGE_API_URL=…` line (`:29`).

- [ ] **Step 5: Verify no Alpha Vantage / FxRate references remain**

Run: `grep -rni "alphavantage\|fxRate\|FxRate" src/ prisma/schema.prisma .env.example`
Expected: no matches in `src/`, `prisma/schema.prisma`, or `.env.example` (matches may remain only in `prisma/generated/` if not yet regenerated — rerun `bunx prisma generate` until clean, and in `docs/`).

- [ ] **Step 6: Gates + commit**

Run: `bun test src && bun run check && bun run typecheck && bun run build`
Expected: all pass; build succeeds without an `ALPHAVANTAGE_*` env error (re-run once on a fonts flake).

```bash
git add prisma/schema.prisma prisma/migrations src/env.js .env.example prisma/generated
git commit -m "feat(fx): drop FxRate table and Alpha Vantage config

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Deploy Runbook (post-merge)

1. `bunx prisma migrate deploy` — drops the `FxRate` table.
2. Deploy the app.
3. `bun run ingest:fx` — backfills `fx_rates` from Yahoo full history (~18s, 9 currencies).
4. No price re-ingest needed (this changes only FX, not stored price bars).
5. Whatever schedules `ingest:fx` (cron/manual) keeps FX fresh with the same command.

## Self-Review

- **Spec coverage:** Storage (`fx_rates`, Task 2) · Yahoo ingest full-history (Task 3) · pure matrix math + direction invariant (Task 1) · Influx readers `getFxMatrix`/`buildFxByDate` seed+forward-fill (Task 2) · 5 date-aware sites + current-value site (Task 4) · drop `FxRate` + repoint `fx.matrix`/`getFxRates` + remove AV env (Tasks 5–6) · forward-fill + fail-loud preserved (Tasks 1 & 4) · rollout runbook. All spec sections mapped.
- **Type consistency:** `getFxMatrix(): Promise<FxMatrix>` and `buildFxByDate(from, to): Promise<Map<string, FxMatrix>>` are defined in Task 2 and consumed with those exact signatures in Tasks 4–5. `buildFxMatrixFromUsdLegs(Map<string, number>)`, `forwardFill`, `assembleFxByDate` defined in Task 1, consumed in Task 2/5. `writeFxRates(currency, bars)` defined Task 2, consumed Task 3. Synthesized `getFxRates` row shape `{ base, fetchedAt, id, quote, rate }` matches the existing `.map` and the `FxRatesPanel` consumer.
- **Build-green ordering:** each task compiles independently — new modules are additive (Tasks 1–3), call sites flip to them (Task 4), old readers repoint (Task 5), and only then is the table/model removed (Task 6) after `grep` confirms zero `db.fxRate` reads.
- **No placeholders:** every code step shows complete code; every command has an expected result.
