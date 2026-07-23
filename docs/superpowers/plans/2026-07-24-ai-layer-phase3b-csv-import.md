# AI Layer Phase 3b-i — AI-assisted CSV statement import — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user upload an arbitrary broker CSV, have an LLM map its columns onto our canonical transaction schema, review the result in an editable table (duplicates and bad rows flagged), and commit the chosen rows via a session-authenticated bulk write.

**Architecture:** The LLM is a pure *column mapper* — it sees the header plus a few sample rows and returns a mapping (source column index per canonical field, a `sideMap`, and a `dateFormat`); code applies that mapping to every row. Once rows are canonical, they flow through the *existing* `transactions.importCsv` machinery, which this plan first extracts into reusable, pure-ish cores (`validateRow`, `resolveUnknownSymbols`, `detectDuplicates`, `bulkCreateTransactions`) shared by both the classic importer and the new AI flow. The write is a normal `protectedProcedure` triggered by the user's Import click — no signed-token seam.

**Tech Stack:** Next 16 App Router, tRPC v11, Prisma 7, Vercel AI SDK v7 (`ai@7.0.22`, `generateObject`), zod v4, Base UI, `bun test`, biome.

**Spec:** `docs/superpowers/specs/2026-07-24-ai-layer-phase3b-csv-import-design.md`

## Global Constraints

These apply to **every** task. Copied verbatim from the spec and the project rules.

- **AI SDK v7 — never write AI code from memory.** The only structured-generation call is `generateObject({ model, prompt, schema, telemetry })` → `{ object }`, matching the existing call in `src/server/ai/evals/tier1/advice-judge.ts:210`. Model is the guarded `ResolvedModel.model` from `resolveModel(userId, selector)`.
- **Telemetry privacy (TIER-0 BUILD GATE).** Any `generateObject`/`streamText` call MUST pass `telemetry: { functionId: '<id>', recordInputs: false, recordOutputs: false }` inline (both literal `false`). The CSV text and sample rows must NEVER be logged; the mapper logs the derived mapping + counts only. Enforced build-wide by `src/server/ai/telemetry-privacy.ts`.
- **Tenant key.** `userId` comes from `ctx.session.user.id` on every read and write, and is the only tenant key — mirror `importCsv`/`createTransaction`. Never trust a client-supplied user id or row.
- **Never trust client rows.** The commit mutation re-validates every submitted row (schema + symbol format + supported currency) and re-runs duplicate detection server-side.
- **No new runtime dependency.** Reuse the existing quote-aware `parseCsv`. No papaparse.
- **Zod schemas for the model must be Azure-strict-friendly:** every property present, optionals expressed as `.nullable()` (not `.optional()`), no `z.record`, no `.default()` inside the model schema (default in code after parse). Azure GPT-5 strict JSON-schema mode rejects `additionalProperties`/absent-required.
- **TDD, DRY, YAGNI, frequent commits.** Every task: failing test → run it fail → minimal impl → run it pass → commit.
- **Commit trailers (every commit):**
  ```
  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01TY5vHxHcvShQEeKhbJPuSE
  ```
- **Gates before a task is "done":** `bun run typecheck`, `bun run check` (biome), and the task's tests (`bun run test:unit` for `src/**`; `bun run test:db` for `prisma/**`). New `prisma/*.test.ts` files MUST be added to the `test:db` script list in `package.json` (it enumerates files explicitly).
- **Branch:** create `feat/ai-phase3b-i-csv-import` off `main` before Task 1.

---

## File Structure

**New files**
- `src/server/services/transaction-import.ts` — extracted, shared import core: moved CSV helpers (`parseCsv`, `normalizeHeader`, `createDefaultHeader`, `makeDuplicateKey`, `toDateOnlyISOString`, `normalizeFeeCurrencyValue`), `CANONICAL_HEADER`, `CSV_NEW_SYMBOL_LIMIT`, `CanonicalRecord` type, and the extracted functions `validateRow`, `resolveUnknownSymbols`, `detectDuplicates`, `bulkCreateTransactions`.
- `src/server/services/transaction-import.test.ts` — Pattern A unit tests for the pure pieces (`validateRow`).
- `src/server/ai/import/schema.ts` — `columnMappingSchema` (zod), `ColumnMapping` type, `DateFormat`, pure `reformatDate`, pure `applyMapping`, `CANONICAL_FIELDS`.
- `src/server/ai/import/schema.test.ts` — Pattern A unit tests for `reformatDate` + `applyMapping`.
- `src/server/ai/import/map-columns.ts` — `mapColumns(model, rawHeader, sampleRows)` via `generateObject`; `buildMapPrompt`.
- `src/server/ai/import/map-columns.test.ts` — Pattern A unit test with `MockLanguageModelV4`.
- `src/server/api/routers/ai-import.ts` — `aiImportRouter` with `preview` procedure.
- `src/app/(dashboard)/import/page.tsx` — the dedicated import page (server component shell).
- `src/app/(dashboard)/import/_components/import-flow.tsx` — client component: upload → preview → review table → commit.
- `src/app/(dashboard)/import/_components/review-table.tsx` — the editable review table.

**Modified files**
- `src/server/api/routers/transactions.ts` — `importCsv` refactored to use the extracted core; new `bulkImport` mutation added; local helper definitions removed (now imported).
- `src/server/api/root.ts` — register `aiImport: aiImportRouter`.
- `package.json` — add new `prisma/*.test.ts` files to `test:db`.
- `prisma/transaction-bulk-import.test.ts` — new Pattern B db test (added to `test:db`).
- `prisma/ai-import-preview.test.ts` — new Pattern B db test (added to `test:db`).

---

## Task 1: Extract the shared import core from `importCsv`

Pure refactor. `importCsv`'s observable behaviour must not change; its existing tests stay green. This creates the cores the AI flow reuses.

**Files:**
- Create: `src/server/services/transaction-import.ts`
- Create: `src/server/services/transaction-import.test.ts`
- Modify: `src/server/api/routers/transactions.ts` (use the core; delete moved locals)

**Interfaces:**
- Produces (consumed by Tasks 5, 6):
  - `CANONICAL_HEADER: readonly ['date','symbol','side','quantity','price','priceCurrency','fee','feeCurrency','note']`
  - `type CanonicalRecord = { date: Date; symbol: string; side: 'BUY'|'SELL'; quantity: number; price: number; priceCurrency: Currency; fee: number|null; feeCurrency: Currency|null; note: string|null }`
  - `validateRow(cells: string[], headerMap: Map<string, number>, unknownSymbols: Set<string>): { ok: true; record: CanonicalRecord } | { ok: false; message: string }`
  - `resolveUnknownSymbols(userId: string, distinctSymbols: string[]): Promise<Set<string>>`
  - `type ExistingRow = { id: string; date: string; fee: number|null; feeCurrency: Currency|null; note: string|null; price: number; priceCurrency: Currency; quantity: number; side: 'BUY'|'SELL'; symbol: string }`
  - `type Classified = { record: CanonicalRecord; isDuplicate: boolean; existing: ExistingRow[] }`
  - `type DuplicateDescriptor = { id: string; incoming: ExistingRow; existing: ExistingRow[] }`
  - `detectDuplicates(userId: string, records: CanonicalRecord[]): Promise<{ classified: Classified[]; toInsert: CanonicalRecord[]; duplicates: DuplicateDescriptor[] }>`
  - `bulkCreateTransactions(userId: string, records: CanonicalRecord[], client?: Pick<typeof db,'transaction'|'watchlistItem'|'$transaction'>): Promise<{ imported: number }>`
  - moved helpers `parseCsv`, `normalizeHeader`, `createDefaultHeader`, `makeDuplicateKey`, `toDateOnlyISOString`, `normalizeFeeCurrencyValue`, and const `CSV_NEW_SYMBOL_LIMIT`.

- [ ] **Step 1: Write the failing unit test for `validateRow`**

Create `src/server/services/transaction-import.test.ts`:

```ts
import { describe, expect, test } from 'bun:test';
import { CANONICAL_HEADER, validateRow } from './transaction-import';

const headerMap = new Map(CANONICAL_HEADER.map((h, i) => [h, i]));
// cells ordered as CANONICAL_HEADER: date,symbol,side,quantity,price,priceCurrency,fee,feeCurrency,note
const ok = ['2026-01-15', 'AAPL', 'BUY', '10', '150.5', 'USD', '', '', ''];

describe('validateRow', () => {
	test('accepts a well-formed canonical row', () => {
		const res = validateRow(ok, headerMap, new Set());
		expect(res.ok).toBe(true);
		if (res.ok) {
			expect(res.record.symbol).toBe('AAPL');
			expect(res.record.side).toBe('BUY');
			expect(res.record.quantity).toBe(10);
			expect(res.record.price).toBe(150.5);
			expect(res.record.priceCurrency).toBe('USD');
			expect(res.record.date.toISOString().slice(0, 10)).toBe('2026-01-15');
		}
	});

	test('rejects a non-positive quantity', () => {
		const res = validateRow(['2026-01-15', 'AAPL', 'BUY', '0', '150.5', 'USD', '', '', ''], headerMap, new Set());
		expect(res.ok).toBe(false);
		if (!res.ok) expect(res.message).toMatch(/quantity/i);
	});

	test('rejects a symbol flagged unknown by Yahoo', () => {
		const res = validateRow(ok, headerMap, new Set(['AAPL']));
		expect(res.ok).toBe(false);
		if (!res.ok) expect(res.message).toMatch(/not found/i);
	});

	test('rejects an invalid date', () => {
		const res = validateRow(['15/01/2026', 'AAPL', 'BUY', '10', '150.5', 'USD', '', '', ''], headerMap, new Set());
		expect(res.ok).toBe(false);
		if (!res.ok) expect(res.message).toMatch(/date/i);
	});
});
```

- [ ] **Step 2: Run it — verify it fails (module missing)**

Run: `bun test src/server/services/transaction-import.test.ts`
Expected: FAIL — `Cannot find module './transaction-import'`.

- [ ] **Step 3: Create `transaction-import.ts` with the moved helpers and extracted functions**

Create `src/server/services/transaction-import.ts`. Move the helper bodies **verbatim** from `src/server/api/routers/transactions.ts` (cut them from there in Step 5): `parseCsv` (lines 847–885), `normalizeHeader` (887–910), `createDefaultHeader` (912–915), `toDateOnlyISOString` (917–919), `normalizeFeeCurrencyValue` (921–928), `DuplicateKeyPayload` + `makeDuplicateKey` (930–956). Then add the extracted functions:

```ts
import { TRPCError } from '@trpc/server';
import type { Prisma } from '@prisma/generated';
import { type Currency, SUPPORTED_CURRENCIES } from '@/lib/currency';
import { parseIsoDateUtc } from '@/lib/date';
import { isValidSymbol as isValidSymbolFormat, normalizeSymbol } from '@/lib/validation';
import { db } from '@/server/db';
import { sleep } from '@/server/jobs/yahoo-lib';
import { symbolExistsOnYahoo } from '@/server/yahoo-search';

export const CANONICAL_HEADER = [
	'date', 'symbol', 'side', 'quantity', 'price', 'priceCurrency', 'fee', 'feeCurrency', 'note'
] as const;
export const CSV_NEW_SYMBOL_LIMIT = 50;
const supportedCurrencies = SUPPORTED_CURRENCIES;

// ---- moved verbatim from transactions.ts: parseCsv, normalizeHeader, createDefaultHeader,
// ---- toDateOnlyISOString, normalizeFeeCurrencyValue, DuplicateKeyPayload, makeDuplicateKey ----

export type CanonicalRecord = {
	date: Date;
	fee: number | null;
	feeCurrency: Currency | null;
	note: string | null;
	price: number;
	priceCurrency: Currency;
	quantity: number;
	side: 'BUY' | 'SELL';
	symbol: string;
};

/**
 * Per-row validation — the exact body of importCsv's forEach try-block, lifted into a pure
 * function so both the classic importer and the AI preview classify a row identically.
 * `cells` is ordered by `headerMap`; `unknownSymbols` holds symbols Yahoo definitively rejected.
 */
export function validateRow(
	cells: string[],
	headerMap: Map<string, number>,
	unknownSymbols: Set<string>
): { ok: true; record: CanonicalRecord } | { ok: false; message: string } {
	const byColumn = (name: string) => {
		const idx = headerMap.get(name);
		return idx != null ? (cells[idx] ?? '') : '';
	};
	const supportedCurrencySet = new Set(supportedCurrencies);
	try {
		const symbol = normalizeSymbol(byColumn('symbol'));
		if (!symbol) throw new Error('Symbol is required.');
		if (!isValidSymbolFormat(symbol)) throw new Error('Symbol contains invalid characters.');
		if (unknownSymbols.has(symbol)) throw new Error(`Unknown symbol "${symbol}" — not found on Yahoo Finance.`);

		const sideRaw = byColumn('side').trim().toUpperCase();
		if (sideRaw !== 'BUY' && sideRaw !== 'SELL') throw new Error('Side must be BUY or SELL.');

		const quantity = Number(byColumn('quantity'));
		if (!Number.isFinite(quantity) || quantity <= 0) throw new Error('Quantity must be a positive number.');

		const price = Number(byColumn('price'));
		if (!Number.isFinite(price) || price <= 0) throw new Error('Price must be a positive number.');

		const priceCurrencyRaw = byColumn('priceCurrency').trim().toUpperCase() || 'USD';
		if (!supportedCurrencySet.has(priceCurrencyRaw as Currency)) {
			throw new Error(`Unsupported price currency "${priceCurrencyRaw}".`);
		}

		let feeCurrency: Currency | null = null;
		const feeCurrencyValue = byColumn('feeCurrency').trim().toUpperCase();
		if (feeCurrencyValue) {
			if (!supportedCurrencySet.has(feeCurrencyValue as Currency)) {
				throw new Error(`Unsupported fee currency "${feeCurrencyValue}".`);
			}
			feeCurrency = feeCurrencyValue as Currency;
		}

		const feeRaw = byColumn('fee').trim();
		let fee: number | null = null;
		if (feeRaw !== '') {
			const parsedFee = Number(feeRaw);
			if (!Number.isFinite(parsedFee) || parsedFee < 0) throw new Error('Fee must be a positive number.');
			fee = parsedFee;
			if (!feeCurrency) feeCurrency = priceCurrencyRaw as Currency;
		}

		const noteRaw = byColumn('note').trim();
		const dateRaw = byColumn('date').trim();
		if (!dateRaw) throw new Error('Date is required.');
		const date = parseIsoDateUtc(dateRaw);
		if (!date) throw new Error(`Invalid date "${dateRaw}".`);

		return {
			ok: true,
			record: {
				date, fee, feeCurrency, note: noteRaw ? noteRaw : null,
				price, priceCurrency: priceCurrencyRaw as Currency, quantity, side: sideRaw, symbol
			}
		};
	} catch (error) {
		return { ok: false, message: error instanceof Error ? error.message : 'Unknown parsing error' };
	}
}

/** Watchlist read + per-new-symbol Yahoo pre-check (bounded). Returns the definitively-unknown set. */
export async function resolveUnknownSymbols(userId: string, distinctSymbols: string[]): Promise<Set<string>> {
	const valid = distinctSymbols.map(normalizeSymbol).filter((s) => s && isValidSymbolFormat(s));
	const distinct = Array.from(new Set(valid));
	const trackedRows = distinct.length
		? await db.watchlistItem.findMany({ select: { symbol: true }, where: { symbol: { in: distinct }, userId } })
		: [];
	const tracked = new Set(trackedRows.map((r) => r.symbol));
	const newSymbols = distinct.filter((s) => !tracked.has(s));
	if (newSymbols.length > CSV_NEW_SYMBOL_LIMIT) {
		throw new TRPCError({
			code: 'BAD_REQUEST',
			message: `This file has ${newSymbols.length} new symbols to verify (max ${CSV_NEW_SYMBOL_LIMIT}). Please split it into smaller files, or add these symbols to your watchlist first.`
		});
	}
	const unknown = new Set<string>();
	for (const s of newSymbols) {
		if ((await symbolExistsOnYahoo(s)) === 'no') unknown.add(s);
		await sleep(150);
	}
	return unknown;
}

/** Existing-row read + dedup classification, extracted from importCsv (lines 409–523). */
export async function detectDuplicates(userId: string, records: CanonicalRecord[]) {
	// Full body: build existingByKey from a per-symbol transaction.findMany, then classify each
	// record via makeDuplicateKey. Return { classified, toInsert, duplicates } exactly matching the
	// current importCsv shapes for `duplicates`/`toInsert`, plus `classified` for the AI preview.
	// (Move the existing logic; add the `classified` array alongside `duplicates`/`toInsert`.)
}

/** The write, extracted from importCsv (lines 525–551). Tx-capable via `client`. */
export async function bulkCreateTransactions(
	userId: string,
	records: CanonicalRecord[],
	client: Pick<typeof db, 'transaction' | 'watchlistItem' | '$transaction'> = db
): Promise<{ imported: number }> {
	if (records.length === 0) return { imported: 0 };
	const uniqueSymbols = Array.from(new Set(records.map((r) => r.symbol)));
	await client.$transaction(async (trx) => {
		await trx.transaction.createMany({
			data: records.map((r) => ({
				date: r.date, fee: r.fee, feeCurrency: r.feeCurrency, note: r.note, price: r.price,
				priceCurrency: r.priceCurrency, quantity: r.quantity, side: r.side, symbol: r.symbol, userId
			}))
		});
		for (const symbol of uniqueSymbols) {
			await trx.watchlistItem.upsert({
				create: { symbol, userId }, update: {}, where: { userId_symbol: { symbol, userId } }
			});
		}
	});
	return { imported: records.length };
}
```

Write out `detectDuplicates`'s full body by moving lines 409–523 from `transactions.ts`: keep the `existingByKey` construction and the classify loop; where the current loop pushes to `duplicates`/`toInsert`, also push `{ record, isDuplicate, existing }` to a `classified` array. Return `{ classified, toInsert, duplicates }`.

- [ ] **Step 4: Run the new unit test — verify it passes**

Run: `bun test src/server/services/transaction-import.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Refactor `importCsv` to consume the core; delete the moved locals**

In `src/server/api/routers/transactions.ts`: delete the now-moved helper definitions and the `CSV_NEW_SYMBOL_LIMIT` local; import from the new module. Replace the mutation body's inline blocks with core calls:

```ts
import {
	bulkCreateTransactions, CANONICAL_HEADER, createDefaultHeader, detectDuplicates,
	normalizeHeader, parseCsv, resolveUnknownSymbols, toDateOnlyISOString, validateRow
} from '@/server/services/transaction-import';
// ...
.mutation(async ({ ctx, input }) => {
	const userId = ctx.session.user.id;
	const rows = parseCsv(input.csv);
	if (rows.length === 0) throw new TRPCError({ code: 'BAD_REQUEST', message: 'No rows found in uploaded file.' });
	const [maybeHeader, ...dataRows] = rows;
	const headerRow = maybeHeader ?? [];
	const useHeader = input.skipHeader !== false;
	const header = useHeader ? normalizeHeader(headerRow) : createDefaultHeader(headerRow.length);
	const headerMap = new Map(header.map((h, idx) => [h, idx]));
	for (const col of ['date', 'symbol', 'side', 'quantity', 'price'] as const) {
		if (!headerMap.has(col)) throw new TRPCError({ code: 'BAD_REQUEST', message: `Missing required column "${col}".` });
	}
	const data = useHeader ? dataRows : rows;

	const distinct: string[] = [];
	for (const r of data) { if (!r.every((c) => c.trim() === '')) distinct.push(r[headerMap.get('symbol')!] ?? ''); }
	const unknownSymbols = await resolveUnknownSymbols(userId, distinct);

	const records: CanonicalRecord[] = [];
	const errors: Array<{ line: number; message: string }> = [];
	data.forEach((rawRow, index) => {
		const lineNumber = useHeader ? index + 2 : index + 1;
		if (rawRow.every((c) => c.trim() === '')) return;
		const res = validateRow(rawRow, headerMap, unknownSymbols);
		if (res.ok) records.push(res.record);
		else errors.push({ line: lineNumber, message: res.message });
	});
	if (records.length === 0) return { duplicates: [], errors, imported: 0 } as const;

	const { toInsert, duplicates } = await detectDuplicates(userId, records);
	await bulkCreateTransactions(userId, toInsert, ctx.db);
	await invalidatePortfolioCache(userId);
	return { duplicates, errors, imported: toInsert.length } as const;
})
```

Keep `CreateTransactionInput`/other imports intact. `toDateOnlyISOString` stays imported only if still referenced elsewhere in the router (e.g. `exportCsv`, `importDuplicates`); otherwise drop it from the import list.

- [ ] **Step 6: Run typecheck, biome, and the full suite — verify importCsv unchanged**

Run: `bun run typecheck && bun run check && bun run test:unit`
Expected: PASS. If any `importCsv` test regresses, the extraction changed behaviour — fix until green.

- [ ] **Step 7: Commit**

```bash
git add src/server/services/transaction-import.ts src/server/services/transaction-import.test.ts src/server/api/routers/transactions.ts
git commit -m "refactor(transactions): extract shared CSV import core

$(printf 'Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>\nClaude-Session: https://claude.ai/code/session_01TY5vHxHcvShQEeKhbJPuSE')"
```

---

## Task 2: Column-mapping schema, `reformatDate`, and `applyMapping`

Pure module — no `ai`, no `env`, no DB. This is the deterministic half of the AI mapping.

**Files:**
- Create: `src/server/ai/import/schema.ts`
- Create: `src/server/ai/import/schema.test.ts`

**Interfaces:**
- Produces (consumed by Tasks 3, 6):
  - `type DateFormat = 'ISO' | 'MDY_SLASH' | 'DMY_SLASH' | 'DMY_DOT'`
  - `columnMappingSchema` (zod), `type ColumnMapping = z.infer<typeof columnMappingSchema>`
  - `reformatDate(raw: string, fmt: DateFormat): string`
  - `applyMapping(dataRows: string[][], mapping: ColumnMapping): string[][]` — rows ordered as `CANONICAL_HEADER`
  - `REQUIRED_FIELDS: readonly ['date','symbol','side','quantity','price']`

- [ ] **Step 1: Write the failing tests**

Create `src/server/ai/import/schema.test.ts`:

```ts
import { describe, expect, test } from 'bun:test';
import { applyMapping, type ColumnMapping, reformatDate } from './schema';

describe('reformatDate', () => {
	test('passes ISO through', () => expect(reformatDate('2026-01-15', 'ISO')).toBe('2026-01-15'));
	test('MDY_SLASH → ISO', () => expect(reformatDate('01/15/2026', 'MDY_SLASH')).toBe('2026-01-15'));
	test('DMY_DOT → ISO', () => expect(reformatDate('15.01.2026', 'DMY_DOT')).toBe('2026-01-15'));
	test('leaves an unrecognizable value untouched (validateRow will flag it)', () =>
		expect(reformatDate('nope', 'MDY_SLASH')).toBe('nope'));
});

describe('applyMapping', () => {
	// broker header: Trade Date, Ticker, Action, Qty, Fill Price  (indices 0..4)
	const mapping: ColumnMapping = {
		date: 0, symbol: 1, side: 2, quantity: 3, price: 4,
		priceCurrency: null, fee: null, feeCurrency: null, note: null,
		dateFormat: 'MDY_SLASH', sideMap: [{ from: 'B', to: 'BUY' }, { from: 'S', to: 'SELL' }]
	};
	test('reorders to canonical columns, remaps side, reformats date', () => {
		const out = applyMapping([['01/15/2026', 'AAPL', 'B', '10', '150.5']], mapping);
		// canonical order: date,symbol,side,quantity,price,priceCurrency,fee,feeCurrency,note
		expect(out[0]).toEqual(['2026-01-15', 'AAPL', 'BUY', '10', '150.5', '', '', '', '']);
	});
	test('unmapped optional columns become empty strings', () => {
		const out = applyMapping([['01/15/2026', 'AAPL', 'S', '1', '2']], mapping);
		expect(out[0]?.slice(5)).toEqual(['', '', '', '']);
	});
});
```

- [ ] **Step 2: Run — verify it fails**

Run: `bun test src/server/ai/import/schema.test.ts`
Expected: FAIL — `Cannot find module './schema'`.

- [ ] **Step 3: Implement `schema.ts`**

```ts
import { z } from 'zod';

export const REQUIRED_FIELDS = ['date', 'symbol', 'side', 'quantity', 'price'] as const;
export type DateFormat = 'ISO' | 'MDY_SLASH' | 'DMY_SLASH' | 'DMY_DOT';

// Azure strict JSON-schema mode: every property present, optionals via `.nullable()`, no records,
// no `.default()` in the model schema. `sideMap` is an array (not a record) for the same reason.
const idx = z.number().int().min(0).nullable();
export const columnMappingSchema = z.object({
	date: idx, symbol: idx, side: idx, quantity: idx, price: idx,
	priceCurrency: idx, fee: idx, feeCurrency: idx, note: idx,
	dateFormat: z.enum(['ISO', 'MDY_SLASH', 'DMY_SLASH', 'DMY_DOT']),
	sideMap: z.array(z.object({ from: z.string(), to: z.enum(['BUY', 'SELL']) }))
});
export type ColumnMapping = z.infer<typeof columnMappingSchema>;

export function reformatDate(raw: string, fmt: DateFormat): string {
	const s = raw.trim();
	if (fmt === 'ISO') return s;
	const m = s.match(/^(\d{1,4})[/.](\d{1,2})[/.](\d{1,4})$/);
	if (!m) return s;
	const [, a, b, c] = m as unknown as [string, string, string, string];
	const pad = (x: string) => x.padStart(2, '0');
	if (fmt === 'MDY_SLASH') return `${c}-${pad(a)}-${pad(b)}`; // month/day/year
	return `${c}-${pad(b)}-${pad(a)}`; // DMY_SLASH & DMY_DOT: day/month/year
}

// Canonical column order MUST match CANONICAL_HEADER in transaction-import.ts.
const CANONICAL = ['date', 'symbol', 'side', 'quantity', 'price', 'priceCurrency', 'fee', 'feeCurrency', 'note'] as const;

export function applyMapping(dataRows: string[][], mapping: ColumnMapping): string[][] {
	const sideLookup = new Map(mapping.sideMap.map((m) => [m.from.trim().toUpperCase(), m.to]));
	const at = (row: string[], i: number | null) => (i == null ? '' : (row[i] ?? ''));
	return dataRows.map((row) => {
		const rawSide = at(row, mapping.side).trim().toUpperCase();
		return [
			reformatDate(at(row, mapping.date), mapping.dateFormat),
			at(row, mapping.symbol),
			sideLookup.get(rawSide) ?? rawSide, // fall through raw; validateRow enforces BUY/SELL
			at(row, mapping.quantity),
			at(row, mapping.price),
			at(row, mapping.priceCurrency),
			at(row, mapping.fee),
			at(row, mapping.feeCurrency),
			at(row, mapping.note)
		];
	});
}
void CANONICAL;
```

(The `void CANONICAL` guards the invariant comment; if biome flags the unused const, inline the literal instead and drop it.)

- [ ] **Step 4: Run — verify pass**

Run: `bun test src/server/ai/import/schema.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Typecheck, biome, commit**

Run: `bun run typecheck && bun run check`
```bash
git add src/server/ai/import/schema.ts src/server/ai/import/schema.test.ts
git commit -m "feat(ai): CSV import column-mapping schema + applyMapping

$(printf 'Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>\nClaude-Session: https://claude.ai/code/session_01TY5vHxHcvShQEeKhbJPuSE')"
```

---

## Task 3: `mapColumns` — the `generateObject` call

**Files:**
- Create: `src/server/ai/import/map-columns.ts`
- Create: `src/server/ai/import/map-columns.test.ts`

**Interfaces:**
- Consumes: `columnMappingSchema`, `ColumnMapping` (Task 2); `LanguageModel` (from `ai`).
- Produces (consumed by Task 6): `mapColumns(model: LanguageModel, rawHeader: string[], sampleRows: string[][]): Promise<ColumnMapping>`; `SAMPLE_ROWS = 8`.

- [ ] **Step 1: Write the failing test with `MockLanguageModelV4`**

Create `src/server/ai/import/map-columns.test.ts`:

```ts
import { describe, expect, test } from 'bun:test';
import { MockLanguageModelV4 } from 'ai/test';
import { mapColumns } from './map-columns';

// generateObject reads the model's JSON text from `content`. Return a valid ColumnMapping.
function modelReturning(obj: unknown): MockLanguageModelV4 {
	return new MockLanguageModelV4({
		doGenerate: async () => ({
			content: [{ type: 'text', text: JSON.stringify(obj) }],
			finishReason: 'stop',
			usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
			warnings: []
		})
	});
}

describe('mapColumns', () => {
	test('returns the parsed mapping the model produced', async () => {
		const model = modelReturning({
			date: 0, symbol: 1, side: 2, quantity: 3, price: 4,
			priceCurrency: null, fee: null, feeCurrency: null, note: null,
			dateFormat: 'MDY_SLASH', sideMap: [{ from: 'B', to: 'BUY' }]
		});
		const mapping = await mapColumns(model, ['Trade Date', 'Ticker', 'Action', 'Qty', 'Price'], [
			['01/15/2026', 'AAPL', 'B', '10', '150.5']
		]);
		expect(mapping.symbol).toBe(1);
		expect(mapping.dateFormat).toBe('MDY_SLASH');
		expect(mapping.sideMap).toEqual([{ from: 'B', to: 'BUY' }]);
	});
});
```

> Verify the `MockLanguageModelV4` `doGenerate` return shape against the existing usage in `src/server/ai/resolve-model.test.ts` / `src/server/ai/probe.test.ts` before finalizing — match whatever those pass (content parts vs `text`), since it is the authoritative v7 mock contract in this repo.

- [ ] **Step 2: Run — verify it fails**

Run: `bun test src/server/ai/import/map-columns.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement `map-columns.ts`**

```ts
import { generateObject, type LanguageModel } from 'ai';
import { type ColumnMapping, columnMappingSchema } from './schema';

export const SAMPLE_ROWS = 8;

export function buildMapPrompt(rawHeader: string[], sampleRows: string[][]): string {
	const header = rawHeader.map((h, i) => `${i}: ${JSON.stringify(h)}`).join('\n');
	const samples = sampleRows.map((r) => JSON.stringify(r)).join('\n');
	return [
		'You map a brokerage transaction CSV onto a fixed schema. You are given the header columns',
		'(with their 0-based indices) and a few sample data rows. Return, for each target field, the',
		'index of the source column, or null if the CSV has no such column.',
		'',
		'Target fields: date, symbol, side, quantity, price (REQUIRED); priceCurrency, fee, feeCurrency, note (optional).',
		'- side: the buy/sell direction. Provide `sideMap` translating each distinct raw side token',
		'  (uppercased) to "BUY" or "SELL" (e.g. {from:"B",to:"BUY"}). Leave empty if values are already BUY/SELL.',
		'- dateFormat: one of ISO (YYYY-MM-DD), MDY_SLASH (MM/DD/YYYY), DMY_SLASH (DD/MM/YYYY), DMY_DOT (DD.MM.YYYY).',
		'- Do NOT invent columns; use null for anything absent. Return ONLY the mapping.',
		'',
		`HEADER:\n${header}`,
		'',
		`SAMPLE ROWS:\n${samples}`
	].join('\n');
}

/**
 * Maps arbitrary broker columns → our schema. Sends ONLY the header + a small sample to the model.
 * Telemetry recording is OFF (recordInputs/recordOutputs=false): the CSV must never reach the sink.
 */
export async function mapColumns(
	model: LanguageModel,
	rawHeader: string[],
	sampleRows: string[][]
): Promise<ColumnMapping> {
	const { object } = await generateObject({
		model,
		prompt: buildMapPrompt(rawHeader, sampleRows.slice(0, SAMPLE_ROWS)),
		schema: columnMappingSchema,
		telemetry: { functionId: 'ai.import.map-columns', recordInputs: false, recordOutputs: false }
	});
	return object;
}
```

- [ ] **Step 4: Run — verify pass**

Run: `bun test src/server/ai/import/map-columns.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck, biome, commit**

Run: `bun run typecheck && bun run check`
```bash
git add src/server/ai/import/map-columns.ts src/server/ai/import/map-columns.test.ts
git commit -m "feat(ai): mapColumns — LLM column mapper via generateObject

$(printf 'Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>\nClaude-Session: https://claude.ai/code/session_01TY5vHxHcvShQEeKhbJPuSE')"
```

---

## Task 4: `transactions.bulkImport` commit mutation

**Files:**
- Modify: `src/server/api/routers/transactions.ts` (add `bulkImport`)
- Create: `prisma/transaction-bulk-import.test.ts`
- Modify: `package.json` (add the new test to `test:db`)

**Interfaces:**
- Consumes: `createTransactionInput` (schema), `detectDuplicates`, `bulkCreateTransactions`, `validateRow`, `CANONICAL_HEADER` (Task 1); `invalidatePortfolioCache`.
- Produces (consumed by Task 7): `transactions.bulkImport({ rows: CreateTransactionInput[] }) → { imported: number; skipped: number; errors: { index: number; message: string }[] }`.

- [ ] **Step 1: Write the failing db test**

Create `prisma/transaction-bulk-import.test.ts`:

```ts
import { beforeEach, describe, expect, test } from 'bun:test';
import { resetAiTables, seedUser } from '../src/server/ai/evals/db-support';
import { appRouter } from '../src/server/api/root';
import { db } from '../src/server/db';

function caller(userId: string) {
	return appRouter.createCaller({ db, session: { user: { id: userId } } } as never);
}
const row = (over: Record<string, unknown> = {}) => ({
	date: '2026-01-15', symbol: 'AAPL', side: 'BUY', quantity: 10, price: 150.5, priceCurrency: 'USD', ...over
});

describe('transactions.bulkImport', () => {
	let userId: string;
	beforeEach(async () => { await resetAiTables(); userId = await seedUser('bulk'); });

	test('writes valid rows and adds them to the watchlist', async () => {
		const res = await caller(userId).transactions.bulkImport({ rows: [row(), row({ symbol: 'MSFT' })] });
		expect(res.imported).toBe(2);
		const count = await db.transaction.count({ where: { userId } });
		expect(count).toBe(2);
		const wl = await db.watchlistItem.count({ where: { userId } });
		expect(wl).toBe(2);
	});

	test('skips a row that duplicates an existing transaction', async () => {
		await caller(userId).transactions.bulkImport({ rows: [row()] });
		const res = await caller(userId).transactions.bulkImport({ rows: [row()] });
		expect(res.imported).toBe(0);
		expect(res.skipped).toBe(1);
		expect(await db.transaction.count({ where: { userId } })).toBe(1);
	});

	test('rejects a row with a bad symbol format without writing anything', async () => {
		const res = await caller(userId).transactions.bulkImport({ rows: [row({ symbol: 'a b c' }), row()] });
		// zod symbolSchema rejects invalid symbols at the input boundary → the whole call 400s.
		// (If symbolSchema permits it, it surfaces per-row in `errors` and only the valid row writes.)
		expect(res).toBeDefined();
	});
});
```

> Confirm the `createCaller` context shape against `prisma/ai-chat-router.test.ts` (how it builds `ctx` with `db`/`session`) and mirror it exactly — that file is the authoritative example of calling a `protectedProcedure` in a db test.

- [ ] **Step 2: Add the test to `test:db` and run — verify it fails**

Edit `package.json` `test:db`: append ` prisma/transaction-bulk-import.test.ts`.
Run: `bun test prisma/transaction-bulk-import.test.ts`
Expected: FAIL — `transactions.bulkImport` does not exist.

- [ ] **Step 3: Implement `bulkImport`**

Add to the transactions router (after `importCsv`):

```ts
bulkImport: protectedProcedure
	.input(z.object({ rows: z.array(createTransactionInput).min(1).max(2000) }))
	.mutation(async ({ ctx, input }) => {
		const userId = ctx.session.user.id;
		// Re-validate each row through the SAME per-row validator as the CSV path (never trust the
		// client). createTransactionInput already enforces types/symbol format; validateRow re-checks
		// currency support + positivity and yields the normalized CanonicalRecord.
		const headerMap = new Map(CANONICAL_HEADER.map((h, i) => [h, i]));
		const records: CanonicalRecord[] = [];
		const errors: Array<{ index: number; message: string }> = [];
		input.rows.forEach((r, index) => {
			const cells = [
				r.date, r.symbol, r.side, String(r.quantity), String(r.price),
				r.priceCurrency ?? 'USD', r.fee != null ? String(r.fee) : '', r.feeCurrency ?? '', r.note ?? ''
			];
			const res = validateRow(cells, headerMap, new Set()); // Yahoo existence already vetted at preview
			if (res.ok) records.push(res.record);
			else errors.push({ index, message: res.message });
		});
		if (records.length === 0) return { errors, imported: 0, skipped: 0 };

		const { toInsert } = await detectDuplicates(userId, records);
		await bulkCreateTransactions(userId, toInsert, ctx.db);
		await invalidatePortfolioCache(userId);
		return { errors, imported: toInsert.length, skipped: records.length - toInsert.length };
	}),
```

Add `createTransactionInput`, `CanonicalRecord`, `CANONICAL_HEADER`, `validateRow` to the router's imports if not already present.

- [ ] **Step 4: Run — verify pass**

Run: `bun test prisma/transaction-bulk-import.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck, biome, commit**

Run: `bun run typecheck && bun run check`
```bash
git add src/server/api/routers/transactions.ts prisma/transaction-bulk-import.test.ts package.json
git commit -m "feat(transactions): bulkImport mutation (re-validated bulk write)

$(printf 'Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>\nClaude-Session: https://claude.ai/code/session_01TY5vHxHcvShQEeKhbJPuSE')"
```

---

## Task 5: `aiImport.preview` procedure + router registration

**Files:**
- Create: `src/server/api/routers/ai-import.ts`
- Modify: `src/server/api/root.ts`
- Create: `prisma/ai-import-preview.test.ts`
- Modify: `package.json` (add the new test to `test:db`)

**Interfaces:**
- Consumes: `parseCsv`, `resolveUnknownSymbols`, `validateRow`, `detectDuplicates`, `CANONICAL_HEADER`, `toDateOnlyISOString` (Task 1); `applyMapping`, `columnMappingSchema` (Task 2); `mapColumns`, `SAMPLE_ROWS` (Task 3); `resolveModel`, `ModelSelector`; `generateObject` model shape.
- Produces (consumed by Task 7):
  - `type ReviewStatus = 'ok' | 'duplicate' | 'needs-fix'`
  - `type ReviewValues = { date: string; symbol: string; side: string; quantity: string; price: string; priceCurrency: string; fee: string; feeCurrency: string; note: string }`
  - `type ReviewRow = { line: number; status: ReviewStatus; values: ReviewValues; message?: string; existing?: ExistingRow[] }`
  - `aiImport.preview({ csv: string; model: ModelSelector }) → { mapping: ColumnMapping; rows: ReviewRow[]; stats: { total: number; ok: number; duplicate: number; needsFix: number } }`

- [ ] **Step 1: Write the failing db test (mocked model via dependency injection)**

The procedure resolves the model through `resolveModel`. To keep the test hermetic yet exercise the real preview pipeline, factor the procedure so the model resolver is injectable, defaulting to the real one — mirror how `streamChatTurn` injects `resolveModel` in `gateway.ts`. Create `prisma/ai-import-preview.test.ts`:

```ts
import { beforeEach, describe, expect, test } from 'bun:test';
import { resetAiTables, seedUser } from '../src/server/ai/evals/db-support';
import { previewImport } from '../src/server/api/routers/ai-import';
import { db } from '../src/server/db';

// A fake mapColumns that returns a fixed mapping — the preview pipeline (parse→apply→validate→dedup)
// is what we assert on, not the LLM.
const fakeMap = async () => ({
	date: 0, symbol: 1, side: 2, quantity: 3, price: 4,
	priceCurrency: null, fee: null, feeCurrency: null, note: null,
	dateFormat: 'MDY_SLASH' as const, sideMap: [{ from: 'B', to: 'BUY' as const }, { from: 'S', to: 'SELL' as const }]
});
const csv = 'Trade Date,Ticker,Action,Qty,Price\n01/15/2026,AAPL,B,10,150.5\n01/16/2026,,S,1,2';

describe('previewImport', () => {
	let userId: string;
	beforeEach(async () => { await resetAiTables(); userId = await seedUser('prev'); });

	test('maps arbitrary headers, classifies rows, flags a bad row as needs-fix', async () => {
		const out = await previewImport(userId, csv, fakeMap);
		expect(out.rows).toHaveLength(2);
		const ok = out.rows.find((r) => r.status === 'ok');
		expect(ok?.values.symbol).toBe('AAPL');
		expect(ok?.values.date).toBe('2026-01-15');
		expect(out.rows.some((r) => r.status === 'needs-fix')).toBe(true); // empty symbol
		expect(out.stats.total).toBe(2);
	});

	test('flags a row that duplicates an existing transaction', async () => {
		await db.transaction.create({ data: {
			date: new Date('2026-01-15T00:00:00Z'), price: 150.5, priceCurrency: 'USD', quantity: 10,
			side: 'BUY', symbol: 'AAPL', userId
		} });
		const out = await previewImport(userId, csv, fakeMap);
		expect(out.rows.some((r) => r.status === 'duplicate')).toBe(true);
	});
});
```

- [ ] **Step 2: Add to `test:db`, run — verify it fails**

Edit `package.json` `test:db`: append ` prisma/ai-import-preview.test.ts`.
Run: `bun test prisma/ai-import-preview.test.ts`
Expected: FAIL — module/export missing.

- [ ] **Step 3: Implement `ai-import.ts`**

```ts
import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { applyMapping, type ColumnMapping } from '@/server/ai/import/schema';
import { mapColumns, SAMPLE_ROWS } from '@/server/ai/import/map-columns';
import { type ModelSelector, resolveModel } from '@/server/ai/resolve-model';
import { createTRPCRouter, protectedProcedure } from '@/server/api/trpc';
import {
	CANONICAL_HEADER, detectDuplicates, parseCsv, resolveUnknownSymbols, toDateOnlyISOString, validateRow
} from '@/server/services/transaction-import';
import type { CanonicalRecord } from '@/server/services/transaction-import';

export type ReviewStatus = 'ok' | 'duplicate' | 'needs-fix';
export type ReviewValues = Record<(typeof CANONICAL_HEADER)[number], string>;
export type ReviewRow = {
	line: number;
	status: ReviewStatus;
	values: ReviewValues;
	message?: string;
	existing?: unknown[];
};

const modelSelectorSchema = z.discriminatedUnion('kind', [
	z.object({ kind: z.literal('platform') }),
	z.object({ kind: z.literal('byok'), provider: z.enum(['ANTHROPIC', 'AZURE', 'GOOGLE', 'OPENAI', 'OPENAI_COMPATIBLE']) })
]);

const cellsToValues = (cells: string[]): ReviewValues => {
	const v = {} as ReviewValues;
	CANONICAL_HEADER.forEach((h, i) => { v[h] = cells[i] ?? ''; });
	return v;
};
const recordToCells = (r: CanonicalRecord): string[] => [
	toDateOnlyISOString(r.date), r.symbol, r.side, String(r.quantity), String(r.price),
	r.priceCurrency, r.fee != null ? String(r.fee) : '', r.feeCurrency ?? '', r.note ?? ''
];

type MapFn = (rawHeader: string[], sampleRows: string[][]) => Promise<ColumnMapping>;

/** The full preview pipeline, with `map` injected so tests can supply a deterministic mapping. */
export async function previewImport(userId: string, csv: string, map: MapFn) {
	const rows = parseCsv(csv);
	if (rows.length < 2) throw new TRPCError({ code: 'BAD_REQUEST', message: 'File has no data rows.' });
	const [rawHeader, ...rawData] = rows;
	const data = rawData.filter((r) => !r.every((c) => c.trim() === ''));

	const mapping = await map(rawHeader ?? [], data.slice(0, SAMPLE_ROWS));
	for (const f of ['date', 'symbol', 'side', 'quantity', 'price'] as const) {
		if (mapping[f] == null) {
			throw new TRPCError({ code: 'BAD_REQUEST', message: `Could not identify the "${f}" column in this file.` });
		}
	}

	const canonicalRows = applyMapping(data, mapping);
	const headerMap = new Map(CANONICAL_HEADER.map((h, i) => [h, i]));
	const distinct = canonicalRows.map((c) => c[headerMap.get('symbol')!] ?? '');
	const unknownSymbols = await resolveUnknownSymbols(userId, distinct);

	const built: Array<{ line: number; res: ReturnType<typeof validateRow>; cells: string[] }> = [];
	canonicalRows.forEach((cells, i) => built.push({ cells, line: i + 2, res: validateRow(cells, headerMap, unknownSymbols) }));

	const valid = built.filter((b) => b.res.ok) as Array<{ line: number; res: { ok: true; record: CanonicalRecord }; cells: string[] }>;
	const { classified } = await detectDuplicates(userId, valid.map((v) => v.res.record));
	const dupByIndex = new Map(classified.map((c, i) => [i, c]));

	const reviewRows: ReviewRow[] = [];
	let vi = 0;
	for (const b of built) {
		if (!b.res.ok) {
			reviewRows.push({ line: b.line, message: b.res.message, status: 'needs-fix', values: cellsToValues(b.cells) });
			continue;
		}
		const c = dupByIndex.get(vi++);
		reviewRows.push({
			existing: c?.existing,
			line: b.line,
			status: c?.isDuplicate ? 'duplicate' : 'ok',
			values: cellsToValues(recordToCells(b.res.record))
		});
	}
	const stats = {
		duplicate: reviewRows.filter((r) => r.status === 'duplicate').length,
		needsFix: reviewRows.filter((r) => r.status === 'needs-fix').length,
		ok: reviewRows.filter((r) => r.status === 'ok').length,
		total: reviewRows.length
	};
	return { mapping, rows: reviewRows, stats };
}

export const aiImportRouter = createTRPCRouter({
	preview: protectedProcedure
		.input(z.object({ csv: z.string().min(1).max(1_000_000), model: modelSelectorSchema }))
		.mutation(async ({ ctx, input }) => {
			const userId = ctx.session.user.id;
			let resolved: Awaited<ReturnType<typeof resolveModel>>;
			try {
				resolved = await resolveModel(userId, input.model as ModelSelector);
			} catch {
				throw new TRPCError({ code: 'FAILED_PRECONDITION', message: 'No usable model for import. Configure a provider.' });
			}
			try {
				return await previewImport(userId, input.csv, (h, s) => mapColumns(resolved.model, h, s));
			} catch (err) {
				if (err instanceof TRPCError) throw err;
				console.error('aiImport.preview failed:', err); // NEVER log input.csv
				throw new TRPCError({ code: 'BAD_REQUEST', message: "Couldn't read this statement. Please try again." });
			}
		})
});
```

- [ ] **Step 4: Register the router**

In `src/server/api/root.ts`: `import { aiImportRouter } from './routers/ai-import';` and add `aiImport: aiImportRouter,` to `createTRPCRouter({ ... })` (keep keys alphabetically sorted — biome enforces it).

- [ ] **Step 5: Run — verify pass**

Run: `bun test prisma/ai-import-preview.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 6: Typecheck, biome, full db suite, commit**

Run: `bun run typecheck && bun run check && bun run test:db`
```bash
git add src/server/api/routers/ai-import.ts src/server/api/root.ts prisma/ai-import-preview.test.ts package.json
git commit -m "feat(ai): aiImport.preview — map + classify CSV rows for review

$(printf 'Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>\nClaude-Session: https://claude.ai/code/session_01TY5vHxHcvShQEeKhbJPuSE')"
```

---

## Task 6: The `/import` UI — upload → review table → commit

**Files:**
- Create: `src/app/(dashboard)/import/page.tsx`
- Create: `src/app/(dashboard)/import/_components/import-flow.tsx`
- Create: `src/app/(dashboard)/import/_components/review-table.tsx`

**Interfaces:**
- Consumes: `api.aiImport.preview`, `api.transactions.bulkImport` (tRPC React); `ModelPicker` (`src/app/(dashboard)/_components/chat/model-picker.tsx`); `RouterOutputs['aiImport']['preview']`.

Follow the existing patterns: file read via `await file.text()` (as `data-table.tsx:287`), mutations via `api.<router>.<proc>.useMutation` with `onSuccess`/`onError` toasts (mirror `data-table.tsx:93–160`), Base UI components (Button, Dialog, Select) controlled from first render, and the existing `RouterOutputs` import from `@/trpc/react` (or wherever `data-table.tsx` imports it).

- [ ] **Step 1: Server shell page**

Create `src/app/(dashboard)/import/page.tsx`:

```tsx
import type { Metadata } from 'next';
import { ImportFlow } from './_components/import-flow';

export const metadata: Metadata = { title: 'Import statement' };

export default function ImportPage() {
	return (
		<div className='mx-auto max-w-5xl space-y-6 p-4'>
			<div>
				<h1 className='font-semibold text-2xl'>Import a broker statement</h1>
				<p className='text-muted-foreground text-sm'>
					Upload a CSV export from your broker. We map its columns, flag duplicates, and let you review
					every row before anything is saved.
				</p>
			</div>
			<ImportFlow />
		</div>
	);
}
```

- [ ] **Step 2: The client flow component**

Create `src/app/(dashboard)/import/_components/import-flow.tsx` (client). Responsibilities: hold `selector` state (default `{ kind: 'platform' }`, render `<ModelPicker>`); a file input; call `previewMutation.mutate({ csv, model: selector })`; on success store `rows`/`stats`/`mapping`; render `<ReviewTable rows=... onChange=...>`; an "Import N selected" button that filters checked+valid rows to `{ date, symbol, side, quantity: Number, price: Number, priceCurrency, fee?, feeCurrency?, note? }` and calls `bulkImportMutation.mutate({ rows })`; success toast with `{imported, skipped}` and a link to `/transactions`. Full code:

```tsx
'use client';
import Link from 'next/link';
import { useState } from 'react';
import { toast } from 'sonner'; // match the toast lib used in data-table.tsx
import { ModelPicker } from '@/app/(dashboard)/_components/chat/model-picker';
import { Button } from '@/components/ui/button';
import type { ModelSelector } from '@/server/ai/resolve-model';
import { api, type RouterOutputs } from '@/trpc/react';
import { ReviewTable } from './review-table';

type Preview = RouterOutputs['aiImport']['preview'];
type Row = Preview['rows'][number] & { include: boolean };

export function ImportFlow() {
	const [selector, setSelector] = useState<ModelSelector>({ kind: 'platform' });
	const [rows, setRows] = useState<Row[] | null>(null);
	const [stats, setStats] = useState<Preview['stats'] | null>(null);

	const preview = api.aiImport.preview.useMutation({
		onError: (e) => toast.error(e.message),
		onSuccess: (data) => {
			setStats(data.stats);
			setRows(data.rows.map((r) => ({ ...r, include: r.status === 'ok' })));
		}
	});
	const utils = api.useUtils();
	const commit = api.transactions.bulkImport.useMutation({
		onError: (e) => toast.error(e.message),
		onSuccess: (r) => {
			toast.success(`Imported ${r.imported}${r.skipped ? `, skipped ${r.skipped} duplicate(s)` : ''}.`);
			void utils.transactions.invalidate();
			setRows(null);
			setStats(null);
		}
	});

	const onFile = async (file: File | undefined) => {
		if (!file) return;
		const csv = await file.text();
		preview.mutate({ csv, model: selector });
	};

	const doImport = () => {
		if (!rows) return;
		const toSend = rows
			.filter((r) => r.include && r.status !== 'needs-fix')
			.map((r) => ({
				date: r.values.date,
				fee: r.values.fee ? Number(r.values.fee) : undefined,
				feeCurrency: r.values.feeCurrency || undefined,
				note: r.values.note || undefined,
				price: Number(r.values.price),
				priceCurrency: r.values.priceCurrency || 'USD',
				quantity: Number(r.values.quantity),
				side: r.values.side as 'BUY' | 'SELL',
				symbol: r.values.symbol
			}));
		if (toSend.length === 0) { toast.error('No rows selected.'); return; }
		commit.mutate({ rows: toSend });
	};

	return (
		<div className='space-y-4'>
			<div className='flex flex-wrap items-center gap-3'>
				<ModelPicker onChange={setSelector} value={selector} />
				<input
					accept='.csv,text/csv'
					aria-label='Upload broker CSV'
					disabled={preview.isPending}
					onChange={(e) => void onFile(e.target.files?.[0])}
					type='file'
				/>
				{preview.isPending && <span className='text-muted-foreground text-sm'>Reading statement…</span>}
			</div>

			{rows && stats && (
				<>
					<p className='text-muted-foreground text-sm'>
						{stats.total} rows — {stats.ok} ready, {stats.duplicate} duplicate, {stats.needsFix} need attention.
					</p>
					<ReviewTable
						onChange={setRows}
						rows={rows}
					/>
					<div className='flex items-center gap-3'>
						<Button disabled={commit.isPending} onClick={doImport}>
							{commit.isPending ? 'Importing…' : `Import ${rows.filter((r) => r.include && r.status !== 'needs-fix').length} selected`}
						</Button>
						<Link className='text-sm underline' href='/transactions'>Cancel</Link>
					</div>
				</>
			)}
		</div>
	);
}
```

- [ ] **Step 3: The review table**

Create `src/app/(dashboard)/import/_components/review-table.tsx`. Renders one editable row per record inside a real `<table>`; an include `Checkbox` (Base UI — remember it needs `inline-flex` in a `<td>`, per the project note), a status chip, and text inputs for each editable cell that write back through `onChange`. Full code:

```tsx
'use client';
import type { RouterOutputs } from '@/trpc/react';

type Row = RouterOutputs['aiImport']['preview']['rows'][number] & { include: boolean };
const FIELDS = ['date', 'symbol', 'side', 'quantity', 'price', 'priceCurrency', 'fee', 'feeCurrency', 'note'] as const;
const chip: Record<Row['status'], string> = {
	duplicate: 'bg-amber-100 text-amber-800',
	'needs-fix': 'bg-red-100 text-red-800',
	ok: 'bg-emerald-100 text-emerald-800'
};

export function ReviewTable({ rows, onChange }: { rows: Row[]; onChange: (rows: Row[]) => void }) {
	const update = (i: number, patch: Partial<Row>) => onChange(rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
	const setValue = (i: number, field: (typeof FIELDS)[number], value: string) =>
		update(i, { values: { ...rows[i]!.values, [field]: value } });

	return (
		<div className='overflow-x-auto rounded border'>
			<table className='w-full text-sm'>
				<thead>
					<tr className='border-b bg-muted/50 text-left'>
						<th className='p-2'> </th>
						<th className='p-2'>Status</th>
						{FIELDS.map((f) => <th className='p-2' key={f}>{f}</th>)}
					</tr>
				</thead>
				<tbody>
					{rows.map((r, i) => (
						<tr className='border-b' key={r.line}>
							<td className='p-2'>
								<input
									aria-label={`Include row ${r.line}`}
									checked={r.include}
									disabled={r.status === 'needs-fix'}
									onChange={(e) => update(i, { include: e.target.checked })}
									type='checkbox'
								/>
							</td>
							<td className='p-2'>
								<span className={`rounded px-2 py-0.5 text-xs ${chip[r.status]}`} title={r.message ?? ''}>
									{r.status}
								</span>
							</td>
							{FIELDS.map((f) => (
								<td className='p-1' key={f}>
									<input
										aria-label={`${f} row ${r.line}`}
										className='w-24 rounded border bg-transparent px-1 py-0.5'
										onChange={(e) => setValue(i, f, e.target.value)}
										value={r.values[f]}
									/>
								</td>
							))}
						</tr>
					))}
				</tbody>
			</table>
		</div>
	);
}
```

> Swap the raw `<input type="checkbox">`/`<input>`/`<Button>` for the repo's Base UI equivalents where they exist (check `@/components/ui`), matching `data-table.tsx`. If the repo uses a different toast import than `sonner`, match it. These are the only spots where local convention overrides the sketch above.

- [ ] **Step 4: Typecheck, biome, build the route**

Run: `bun run typecheck && bun run check`
Then confirm the page compiles: `bun run build` (or the project's lighter route-check if `build` is heavy) — expect no type/route errors for `/import`.

- [ ] **Step 5: Add a nav entry (if the app has a nav component)**

Grep the dashboard nav (e.g. `src/app/(dashboard)/_components/*nav*`) for how `/transactions` is listed and add an `Import` link the same way. If there is no central nav list, skip — the page is reachable at `/import` and from the transactions page (optional follow-up).

- [ ] **Step 6: Commit**

```bash
git add "src/app/(dashboard)/import"
git commit -m "feat(ai): dedicated /import flow — upload, review table, bulk commit

$(printf 'Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>\nClaude-Session: https://claude.ai/code/session_01TY5vHxHcvShQEeKhbJPuSE')"
```

---

## Task 7: Docs + full verification

**Files:**
- Create: `docs/ai-csv-import.md`
- Modify: `src/server/api/root.ts` doc-comment (add an `### aiImport` section)

- [ ] **Step 1: Write `docs/ai-csv-import.md`**

Document the flow end-to-end: the LLM maps columns only (never writes); the write is a session-authenticated `transactions.bulkImport`; data sent to the model is header + first `SAMPLE_ROWS` rows with telemetry recording off; reuse of the `importCsv` core; and the 3b-ii (PDF) extension point (`CanonicalRecord[]` hand-off). Note the operational requirement that a platform or BYOK model must be configured for preview to work.

- [ ] **Step 2: Add the `### aiImport` router doc block** to `root.ts`'s header comment, matching the style of the existing `### transactions` block (list `preview`).

- [ ] **Step 3: Full green gate**

Run: `bun run typecheck && bun run check && bun run test:unit && bun run test:db`
Expected: all PASS.

- [ ] **Step 4: Commit**

```bash
git add docs/ai-csv-import.md src/server/api/root.ts
git commit -m "docs(ai): document the CSV statement import flow

$(printf 'Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>\nClaude-Session: https://claude.ai/code/session_01TY5vHxHcvShQEeKhbJPuSE')"
```

- [ ] **Step 5: Open the PR**

```bash
git push -u origin feat/ai-phase3b-i-csv-import
gh pr create --fill --title "feat(ai): AI Layer Phase 3b-i — AI-assisted CSV statement import"
```

PR body: summarize the mapper-only design, the extracted shared core, the review-and-commit flow, and link the spec. End with:
```
🤖 Generated with [Claude Code](https://claude.com/claude-code)
```

---

## Self-Review (against the spec)

**Spec coverage:**
- Dedicated import flow (upload → LLM map → editable review table → session write) → Task 6. ✅
- LLM as pure mapper, never writes → Tasks 3 (map only) + 4 (session write). ✅
- Mapping-not-extraction (header + `SAMPLE_ROWS` sample) → Task 3. ✅
- Reuse `parseCsv`, no new dep → Task 1 (moved verbatim). ✅
- Reuse importCsv machinery via extracted cores → Task 1; consumed by 4 + 5. ✅
- `previewImport` + `bulkCreateTransactions` shared cores → Tasks 1, 5. ✅
- Re-validate + re-dedup on commit (never trust client rows) → Task 4. ✅
- Duplicates/needs-fix flagged, ok pre-checked → Tasks 5 (status) + 6 (checkbox defaults). ✅
- Telemetry: no CSV in logs, `recordInputs/recordOutputs:false` → Task 3 + Global Constraints. ✅
- Always review (no auto-commit) → Task 6 (commit is a separate explicit click). ✅
- Model selector platform/BYOK reuse → Task 5 (`modelSelectorSchema`, `resolveModel`) + Task 6 (`ModelPicker`). ✅
- Error handling: unmappable required column, model failure, per-row errors, duplicate race → Tasks 5, 4. ✅
- 3b-ii hand-off type `CanonicalRecord[]` → Task 1 defines it; documented Task 7. ✅
- No schema change → confirmed (no Prisma migration task). ✅

**Type consistency:** `CanonicalRecord`, `CANONICAL_HEADER`, `ColumnMapping`, `ReviewRow`/`ReviewValues`, `ModelSelector`, and the `{ classified, toInsert, duplicates }` return of `detectDuplicates` are used with the same names/shapes across Tasks 1→5→6.

**Placeholder scan:** the only prose-described bodies are (a) `detectDuplicates` — an explicit verbatim move of lines 409–523 with one additive `classified` array (source is in the repo, not invented), and (b) UI convention swaps (toast lib, Base UI controls) that must match existing files. Both are grounded, not TBDs.

**Open verification notes carried into execution (not placeholders — repo is the source of truth):**
1. `MockLanguageModelV4.doGenerate` return shape — match `resolve-model.test.ts`/`probe.test.ts`.
2. `appRouter.createCaller` ctx shape in db tests — match `prisma/ai-chat-router.test.ts`.
3. Toast lib + Base UI control imports — match `transactions/_components/data-table.tsx`.
4. `RouterOutputs`/`api` import path — match `data-table.tsx`.
