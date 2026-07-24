# AI-assisted CSV statement import

Upload a broker's transaction CSV — whatever headers it happens to use — and the assistant maps
its columns onto your portfolio's schema. You review every mapped row before anything is saved.

> Export "Trade Date, Instrument, B/S, Qty, Price, Fees" from your broker, upload it on
> `/import`, and the assistant maps `Trade Date → date`, `Instrument → symbol`, `B/S → side`
> (translating `B`/`S` to `BUY`/`SELL`), etc. You get an editable table — duplicates and
> unmappable rows flagged — and click **Import N selected** only when you're happy with it.

## How it works

1. **Upload.** The dedicated `/import` page reads the CSV in the browser and sends its text to
   `aiImport.preview` (a normal session-authenticated tRPC mutation).
2. **Map, don't extract.** The server never hands the model your whole statement. It sends only
   the header row plus the first 8 sample data rows (`SAMPLE_ROWS` in
   `src/server/ai/import/map-columns.ts`) and asks the model for a **column mapping** — which
   source column index holds `date`, `symbol`, `side`, `quantity`, `price`, and the optional
   fields, plus small declared normalizations (a `side` code table like `B → BUY`, and a date
   format hint). **The model returns a mapping description, never transaction rows** — code
   applies that mapping to every row of the file itself, so the pipeline is deterministic and
   scales to files far larger than what the model ever sees.
3. **Validate & classify.** The mapped rows are run through the same row validator, symbol check,
   and duplicate detector the classic CSV importer (`transactions.importCsv`) uses — both share
   one extracted core (`src/server/services/transaction-import.ts`). Each row comes back tagged
   `ok`, `duplicate`, or `needs-fix` (with the conflicting existing row(s) attached for
   duplicates).
4. **Review.** The `/import` page renders an editable table: one row per mapped record, an
   "include" checkbox (`ok` rows start checked; `duplicate`/`needs-fix` start unchecked), a status
   chip, and editable cells. Nothing is written yet.
5. **Commit.** Clicking **Import N selected** calls `transactions.bulkImport` — a normal
   session-authenticated mutation triggered by *your* click. It **re-validates every row and
   re-runs duplicate detection from scratch** (never trusts what the browser sends back), then
   writes the survivors and upserts your watchlist.

## The model never writes

This is the key difference from 3a's natural-language entry (`ai-transaction-entry.md`), which
used a signed confirmation token because *the assistant itself* proposed a specific write that
your Confirm click then authorized. Here there is no such token, because there is no proposed
write for the model to sign off on: the model's only output is a **column mapping**, an
extractor artifact, not a transaction. The actual database write is an ordinary
`transactions.bulkImport` call your Import click makes directly — the same trust boundary as
any other authenticated mutation in the app, re-validated server-side exactly like the classic
CSV importer.

## What reaches the model

Only the CSV's header row and the first 8 data rows — never the full file, and the full CSV
text is never logged. `mapColumns` calls the AI SDK with
`telemetry: { recordInputs: false, recordOutputs: false }`, so even the sample rows never reach
the observability sink; only the derived mapping and row counts are logged. This uses the same
platform-Azure/BYOK model your chat assistant already uses, and the same privacy posture: it's
your own data, going to the provider you've configured, for the purpose of import.

## Requirements

- A usable model must be configured: either the platform model (Azure OpenAI, configured via
  `AZURE_OPENAI_API_KEY` / `AZURE_OPENAI_RESOURCE_NAME` / `AZURE_OPENAI_CHAT_DEPLOYMENT`) or at
  least one of your own BYOK provider credentials (`aiCredentials`). The `/import` page's model
  picker only offers the platform option when Azure is fully configured, matching the chat
  launcher's derivation; without either, `aiImport.preview` fails closed with
  `PRECONDITION_FAILED` ("No usable model for import. Configure a provider.").

## Error handling

- **Unmappable required column** (`date`/`symbol`/`side`/`quantity`/`price`) — preview fails with
  a message naming the missing field rather than silently dropping rows.
- **Model failure or bad structured output** — caught and surfaced as a single retryable
  "couldn't read this statement, try again" error; the request never dies silently.
- **Per-row problems** (bad date, non-positive quantity/price, unsupported currency, unknown
  symbol) — the row is shown as `needs-fix` in the review table and excluded from the commit
  payload until corrected.
- **Duplicates** — shown as `duplicate`, unchecked by default; you opt in per row.
- **Re-import / stale review table** — `transactions.bulkImport` re-runs duplicate detection at
  commit time, so re-submitting an already-reviewed set (or an edited one) cannot double-insert
  rows that already exist.

## Shared machinery with the classic CSV importer

`transactions.importCsv` (the existing raw-CSV dialog, unchanged) and the AI flow both funnel
through the same extracted core:

- `parseCsv` — the existing quote-aware CSV parser (no new dependency was added for this).
- `validateRow` / `resolveUnknownSymbols` / `detectDuplicates` — per-row validation, bounded
  Yahoo symbol checks, and dedup classification.
- `bulkCreateTransactions` — the transactional `createMany` + watchlist upsert write.

The AI flow's only new responsibility is producing a canonical header for statements whose
column names the classic importer's fixed alias map doesn't recognize (`map-columns.ts` +
`applyMapping` in `src/server/ai/import/schema.ts`).

## Extension point: 3b-ii (PDF statements)

The pipeline hands off at a `CanonicalRecord[]` boundary (`src/server/services/
transaction-import.ts`). Everything from that point onward — validation, symbol resolution,
duplicate detection, the review table, and the commit — is reused unchanged. A future PDF import
(3b-ii) only needs to swap the *extractor*: instead of "map CSV columns with a text model", it
reads a PDF statement with a vision model and produces the same `CanonicalRecord[]`, landing in
the identical review-and-commit flow.

## Not investment advice

The feature transcribes a statement you already have; it makes no recommendations about what to
buy or sell.
