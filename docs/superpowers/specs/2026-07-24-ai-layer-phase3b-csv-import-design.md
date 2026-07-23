# AI Layer Phase 3b-i — AI-assisted CSV statement import (design)

**Date:** 2026-07-24
**Status:** Design — awaiting review
**Phase:** 3b-i (of the AI Layer roadmap: 0 Foundation → 1 Chat → 2 MCP → 3a NL entry ✅ → **3b Statement import** → 4 Digest → 5 ML → 6 RAG)

## Context

3a shipped natural-language single-transaction entry through the chat assistant (a signed
confirmation-token seam so the model can *propose* a write that the user confirms). 3b is the
bulk sibling: import a broker's transaction statement. Users do not hand-key a year of trades —
they export a CSV (or download a PDF) from their broker and want it in the portfolio in one pass.

The hard part is not the write — it is that **every broker names its columns differently**
(`Trade Date` / `Datum` / `Settlement`; `Ticker` / `Instrument` / `ISIN`; `B/S` / `Action` /
`Transaction Type`). The app already has a CSV importer (`transactions.importCsv`) that works
only when the header uses our canonical names (via a small fixed alias map). 3b closes that gap
with an LLM that maps arbitrary broker headers onto our canonical schema.

## Scope & decomposition

3b is decomposed into two sub-projects that **share one downstream pipeline**:

- **3b-i (this spec): CSV import.** LLM maps arbitrary CSV columns → canonical schema → the
  existing import machinery validates, resolves symbols, flags duplicates, and writes.
- **3b-ii (later): PDF import.** Same review-and-commit pipeline; the *extractor* changes from
  "map CSV columns" to "read a PDF statement with a vision model". 3b-ii produces the same
  intermediate `CanonicalRow[]` and reuses everything from the preview core onward.

Everything from the intermediate `CanonicalRow[]` onward (validate → symbol-resolve → dedup →
review → write) is built here and reused unchanged by 3b-ii.

## Locked decisions (from brainstorming)

1. **Input order:** CSV first (3b-i), PDF later (3b-ii). ✅
2. **Surface:** a **dedicated import flow** — its own page/dialog, distinct from the existing
   raw-CSV import dialog. Upload → LLM extracts/maps → **editable review table** (duplicates and
   unresolved symbols flagged) → user clicks **Import** → session-authenticated bulk write. ✅
3. **The LLM never writes.** It is a pure *extractor/mapper*. The write is a normal
   session-authenticated mutation triggered by the user's Import click — **no signed-token seam**
   (3a's HMAC seam existed because the *model* initiated that write; here the *user* does).
4. **Mapping, not row extraction.** The model sees only the header + a small sample of rows and
   returns a **column mapping**; we apply the mapping to every row in code. Deterministic, cheap,
   and scales to large files (the model never sees the whole file). Chosen over dumping the entire
   CSV to the model (costly, token-bounded, non-deterministic).
5. **CSV parser:** reuse the existing quote-aware `parseCsv`; **no new dependency.**
   *(This reverses the tentative "add papaparse" lean from brainstorming: on inspection `parseCsv`
   already handles quoted fields, escaped quotes, and CRLF, and it is the shared entry point for
   the whole import path. A new parser dep is not justified for 3b-i. Delimiter sniffing —
   e.g. `;` for European brokers — is noted as a small optional extension, not built now.)*
6. **Always review.** Even a high-confidence mapping shows the review table; a financial write is
   never auto-committed from a model's output.

## Non-goals (3b-i)

- No PDF, no OCR, no vision model (that is 3b-ii).
- No new persisted storage of the uploaded file — the CSV is parsed in memory and discarded.
  (3b-ii may need object storage to hand a PDF to a vision model; decided there.)
- No change to the existing `transactions.importCsv` / `importDuplicates` dialog — the AI import
  is a separate surface. The two share *code* (the preview/commit cores), not UI.
- No automation/scheduling, no multi-file batch, no broker-account linking.

## Key insight — reuse the existing import machinery

`transactions.importCsv` already does, in order: `parseCsv` → `normalizeHeader` (fixed alias map)
→ per-row validation → distinct-symbol Yahoo pre-check (bounded by `CSV_NEW_SYMBOL_LIMIT`) →
duplicate detection via `makeDuplicateKey` against existing rows → `createMany` inside a
`$transaction` with watchlist `upsert` → `invalidatePortfolioCache`.

3b-i's *only* new server responsibility is producing a **canonical header** for statements whose
columns the fixed alias map does not recognize. So the plan **extracts the reusable core** of
`importCsv` into two shared functions and drives them from both the classic mutation and the AI
flow:

- `previewImport(userId, dataRows, canonicalHeader, db)` → `{ records, errors, duplicates }`
  (parse/validate/symbol-check/dedup, **no write**).
- `bulkCreateTransactions(userId, records, client=db)` → `{ imported }`
  (the `createMany`-in-`$transaction` + watchlist upsert; **the write**, tx-capable, mirroring
  3a's `createTransaction`).

The classic `importCsv` mutation becomes: `parseCsv` → `normalizeHeader` → `previewImport` →
`bulkCreateTransactions(non-duplicates)` — behaviour unchanged, now sharing the cores. The AI
flow reuses the same two functions with an LLM-derived header.

## Architecture

```
┌─────────────────────────── Dedicated import UI (/import) ───────────────────────────┐
│ 1. Upload CSV  ──file text──▶  2. Preview (server)          3. Editable review table │
│                                                              (status chips, edit,    │
│                                                               include checkboxes)     │
│                                                                     │ Import selected │
└─────────────────────────────────────────────────────────────────────┼───────────────┘
                                                                       ▼
   aiImport.preview (tRPC, protected)                 transactions.bulkImport (tRPC, protected)
      parseCsv(csv)                                       zod-validate submitted rows
      → sample = header + N rows                          → previewImport (re-validate + re-dedup)
      → mapColumns(header, sample, model)  ── LLM ──▶      → bulkCreateTransactions(non-dups)
      → applyMapping → canonical header                   → invalidatePortfolioCache
      → previewImport(rows, header)                       → { imported, skipped }
      → { mapping, rows[], errors[], stats }
```

### Components

**A. CSV parse & sampling** — reuse `parseCsv`. Split header row from data rows. Build the model
sample as the header + the first `SAMPLE_ROWS` (proposed: 8) data rows. Never send the whole file.

**B. Column mapper** — new `src/server/ai/import/map-columns.ts`.
- `mapColumns(rawHeader: string[], sampleRows: string[][], model: ResolvedModel): Promise<ColumnMapping>`
- Uses the AI SDK's **structured object generation** against a zod schema (exact v7 API verified
  in the plan, not written from memory), through the guarded model from `resolveModel`.
- `ColumnMapping` maps each canonical field to a source **column index** (or null):
  `{ date, symbol, side, quantity, price, priceCurrency?, fee?, feeCurrency?, note? }`, plus small
  declared normalizations the mapper is allowed to state: a `sideMap` (e.g. `{ "B": "BUY",
  "S": "SELL" }`) and a `dateFormat` hint. **The model returns a mapping description; code applies
  it.** The model never returns transaction rows.
- Deterministic fallback: fields the model leaves null but that `normalizeHeader`'s alias map can
  resolve are filled from the alias map. If a required field (`date/symbol/side/quantity/price`)
  is still unmapped, preview returns a structured "could not map column X" error (no throw that
  kills the request).

**C. Apply mapping** — `applyMapping(dataRows, mapping)` rewrites each raw row into a canonical
row array ordered as our canonical header, applying `sideMap`/`dateFormat` where declared. Output
feeds `previewImport` **exactly** as a canonical CSV's data rows would — same validation path.

**D. Preview core** — `previewImport` (extracted from `importCsv`). Returns per-row `records`,
per-line `errors`, and `duplicates` (via `makeDuplicateKey` against the user's existing rows).
No write. Reused verbatim by 3b-ii.

**E. Commit core** — `bulkCreateTransactions` (extracted write). `createMany` + watchlist upsert
inside one `$transaction`; caller invalidates cache. Tx-capable `client` param like
`createTransaction`.

**F. tRPC — preview** — `aiImport.preview` in a new `src/server/api/routers/ai-import.ts`
(kept out of the transactions router so that router does not import AI infra; mirrors `ai-chat.ts`).
`protectedProcedure`, input `{ csv: string; model?: ModelSelector }`. Resolves the model with the
existing `resolveModel(userId, selector)` (platform or BYOK, reusing the chat model picker's
`ModelSelector`). Output: `{ mapping, rows: ReviewRow[], errors, stats }` where each `ReviewRow`
carries the canonical values + a `status` of `ok | duplicate | needs-fix` + (for duplicates) the
matching existing rows.

**G. tRPC — commit** — `transactions.bulkImport` in the transactions router (a pure transactions
concern, no AI). `protectedProcedure`, input `{ rows: CanonicalRowInput[] }`. **Re-validates every
row server-side** (schema + symbol format + supported currency — never trust client rows) and
**re-runs dedup** so a stale review table cannot double-insert; writes non-duplicates via
`bulkCreateTransactions`; returns `{ imported, skipped, errors }`. Yahoo *existence* is a
preview-time UX guard, not a hard commit gate (consistent with `importCsv`, which lets an
"unreachable Yahoo" symbol through rather than reject a valid trade on a transient blip).

**H. Review-table UI** — new dedicated route `src/app/(dashboard)/import/` (page + components).
Upload control (client reads file text) → calls `aiImport.preview` → renders an **editable table**:
one row per mapped record, an include checkbox (duplicates/needs-fix start unchecked; ok rows
checked), a status chip, and editable cells for `symbol/side/quantity/price/priceCurrency/date/
fee/feeCurrency/note`. A header strip shows the detected mapping and any unmappable-column errors.
"Import N selected" calls `transactions.bulkImport` with the checked, valid rows → success toast
with counts → link to `/transactions`. Base UI controls, controlled from first render (per the
Base-UI controlled/uncontrolled rule).

## Data model

**No schema change.** Reuses the `Transaction` table and 3a's write semantics. (3a's
`AiMutationCommit` jti table is not involved — there is no signed token here.)

## Security & privacy

- **Data flow to the model:** only the header + `SAMPLE_ROWS` sample rows leave the process, and
  they go to the same platform-Azure/BYOK model the chat already uses. This is the user's own
  financial data and is consistent with the established chat data-flow posture. **Telemetry/logs
  must never record the CSV text or sample rows** — the mapper logs the *derived mapping* and
  counts only, never the sample content. (Enforced in code review; called out as a plan step.)
- **Tenant isolation:** both procedures are `protectedProcedure`; `userId` comes from the session
  and is the only tenant key on every read (existing-row dedup query) and write, exactly as
  `importCsv`/`createTransaction` already enforce.
- **The write is user-initiated and re-validated.** No model output reaches the DB without passing
  server-side schema/format/dedup checks on the exact rows the user submitted.
- **Bounds:** the `CSV_NEW_SYMBOL_LIMIT` distinct-new-symbol cap and per-row validation from
  `importCsv` apply unchanged, capping Yahoo fan-out and rejecting malformed rows.
- **Not advice.** The feature transcribes a statement; it makes no recommendations.

## Error handling

- **Empty / unparseable CSV** → `previewImport` path returns a `BAD_REQUEST`-style structured
  error (as `importCsv` does today for empty input).
- **Unmappable required column** → preview returns `{ errors: [{ field, message }] }` and an empty
  `rows`; the UI shows "we couldn't identify the <date> column — check the file or map it manually"
  rather than failing the request.
- **Model error / timeout / bad structured output** → caught, surfaced as a single retryable
  preview error ("couldn't read this statement, try again"); the request never dies silently
  (same graceful-degradation posture as the `market.priceHistory` chat fix).
- **Per-row validation errors** → surfaced per line in the review table (bad date, non-positive
  quantity/price, unsupported currency, unknown symbol) — the row is shown as `needs-fix` and
  excluded until corrected, matching `importCsv`'s per-line `errors`.
- **Duplicates** → shown as `duplicate`, unchecked by default; the user opts in per row.
- **Commit race / re-import** → `bulkImport` re-runs dedup, so re-submitting a reviewed set cannot
  double-insert rows already written.

## Testing strategy

- **Unit (Pattern A, hermetic, `src/**`):** `map-columns.test.ts` with a `MockLanguageModelV4`
  returning a fixed mapping — asserts `applyMapping` produces the right canonical rows for a
  representative broker header (renamed columns, `B/S` side codes, `Trade Date`), and that a
  missing required column yields a structured error. `applyMapping` pure-function tests for
  `sideMap`/`dateFormat`.
- **DB (Pattern B, real Postgres, `prisma/*.test.ts`):** `previewImport` (records/errors/dedup
  against seeded existing rows) and `bulkCreateTransactions` (writes non-dups, upserts watchlist,
  is tenant-scoped) — including that the refactor leaves `importCsv`'s observable behaviour
  unchanged (regression over its existing tests).
- **tRPC:** `aiImport.preview` end-to-end with a mocked model (maps → previews → returns
  ReviewRows) and `transactions.bulkImport` (re-validates, writes, re-dedups, rejects a
  cross-user/ malformed row).
- **Component:** the review table renders statuses, toggles include, edits a cell, and calls
  `bulkImport` with only the checked valid rows.
- **Gates:** `bun run typecheck`, `bun run check` (biome), `bun run test:unit`, `bun run test:db`.

## What 3b-ii inherits (built here, reused there)

`CanonicalRow[]` as the hand-off type, `previewImport`, `bulkCreateTransactions`,
`transactions.bulkImport`, and the review-table UI. 3b-ii adds only a PDF→`CanonicalRow[]`
extractor (vision model + object storage) behind the same review-and-commit flow.

## Open questions (non-blocking; default chosen)

- **Sample size** `SAMPLE_ROWS` — default 8; tune in the plan if a mapper misreads sparse columns.
- **Delimiter sniffing** (`;`/`\t`) — deferred; add a one-line sniff to `parseCsv` only if a real
  broker export needs it.
- **Inline-edit breadth** — 3b-i makes the core cells editable; a richer per-cell validation UX
  can follow if users need it.
