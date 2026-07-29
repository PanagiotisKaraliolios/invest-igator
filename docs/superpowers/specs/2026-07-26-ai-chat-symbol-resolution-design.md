# AI Chat — Symbol Resolution, On-Demand Fetch & Disambiguation Picker (Design)

**Date:** 2026-07-26
**Status:** Approved (design)
**Spec 2 of 3.** Depends on Spec 1 having shipped (prompt is at `version` 3); this spec bumps it to `version` 4.

## Problem

Two gaps in the chat's market-data path:

1. **Missing ticker → dead end.** `market.priceHistory` reads InfluxDB (`daily_bars`) and returns an **empty series** for any symbol not already ingested. A valid ticker the user simply hasn't tracked yields "No data to show" with no recourse.
2. **Ambiguity → dead end.** The model gets only `market.priceHistory` (raw symbol → Influx). It cannot resolve a name or an ambiguous root (`VUAA` → `VUAA.L` / `.DE` / `.MI` / `.AQ` / `.DU`) to a concrete ticker, so it reports "no data" instead of asking which listing.

## Existing building blocks (server-side, currently unused by the chat)

- `searchYahooSymbols(q) → { symbol, description, type, exchange }[]` (one row per exchange listing) — `src/server/yahoo-search.ts`.
- `symbolExistsOnYahoo(symbol) → 'yes' | 'no' | 'unreachable'` — same file.
- `ingestYahooSymbol(symbol, { userId? })` — single-symbol on-demand fetch + Influx write (`src/server/jobs/yahoo-lib.ts`), already reused fire-and-forget by `watchlist.add`.
- `symbolHasAnyData(symbol) → boolean` — "is this already in Influx?" predicate (`src/server/influx.ts`).

## Design

### Component 1 — New read-only AI tool `symbol.search`
- **File:** `src/server/ai/tools/symbol-search.ts`.
- **Input:** `{ query: string (1..64) }`.
- **Output:** `{ query: string, candidates: Array<{ symbol, name, exchange, type }> }`, capped at ~8, wrapping `searchYahooSymbols` (map `description → name`).
- **Scope:** `watchlist:read` (same as `market.priceHistory`; no new scope). **`mutates: false`.**
- Register in `src/server/ai/tools/registry.ts` `ALL_TOOLS`. Read-only ⇒ also available on the MCP surface (fine — public data, no tenancy).

### Component 2 — `market.priceHistory` auto-backfill
- In `src/server/ai/tools/market-price-history.ts` (delegating to `src/server/services/market.ts`): when the Influx query yields **zero points** for a well-formed symbol:
  1. `symbolHasAnyData(symbol)` → if already present, return as today (empty is genuine).
  2. else `symbolExistsOnYahoo(symbol)` → if `'yes'`: `await ingestYahooSymbol(symbol)`, then **re-query Influx once**.
  3. else (`'no'`/`'unreachable'`): return empty as today.
- Add an output field **`fetched: boolean`** (true when a backfill ran). Existing `try/catch` still degrades any failure to an empty series (a chat turn never dies).
- Bounded: single fetch attempt, existence-gated (no fetch for malformed/nonexistent symbols), and **durable** (writes to Influx, so later turns/users hit cache). Fits within the route's `maxDuration = 60`.

### Component 3 — Client picker artifact
- **File:** `src/app/(dashboard)/_components/chat/artifacts/symbol-picker.tsx`.
- Renders the existing `ToolCallChip` + a card of candidate rows as buttons: **`SYMBOL` · exchange · full name** (the "little explanation" per candidate).
- Registered in `artifacts/registry.ts` `ARTIFACT_RENDERERS` under the `symbol.search` tool name; renders the interactive card only when `part.state === 'output-available'` (same gate as other artifacts).

### Component 4 — Click → `sendMessage` wiring
- `chat-launcher.tsx` owns the `useChat` instance (has `sendMessage`). Thread a callback down: `chat-launcher → chat-drawer → message-thread → message → renderToolPart(toolName, part, onPick?)`.
- On candidate click, call `sendMessage("Use <symbol>")` — a normal user turn. The transport's `prepareSendMessagesRequest` is unchanged (sends the last message + `chatId` + selector).
- After a pick, the card marks itself resolved (local state keyed by the chosen symbol) to prevent double-submits.

### Component 5 — Prompt update (`portfolio-analyst.ts`, `version` 3 → 4)
- Add guidance (as *data/description*, respecting the advice boundary): when a ticker/name is ambiguous, or `market.priceHistory` returns empty with `fetched:false`, call **`symbol.search`**; the rendered picker collects the user's choice; only call `market.priceHistory` with a **concrete ticker**; known tickers auto-backfill so a first-time empty is not "unavailable."
- New golden hash entry `GOLDEN_HASHES[4]`, version expectation → 4 in the guard test.

## Data flow (disambiguation)

`"price of VUAA last week"` → model calls `symbol.search("VUAA")` → picker renders `VUAA.L` (London), `VUAA.DE` (XETRA), … → user clicks `VUAA.L` → `sendMessage("Use VUAA.L")` → model calls `market.priceHistory("VUAA.L")` → (auto-backfill if not yet in Influx) → `TimeSeries` chart.

## Error handling

- `symbol.search` Yahoo failure → `candidates: []`; model tells the user it couldn't search.
- `market.priceHistory` backfill/query failure → empty series (unchanged behavior).
- Zero candidates → model states the symbol wasn't found.

## Testing

- **Unit — `symbol.search`** (mock `searchYahooSymbols`): output shape, ~8 cap, empty result.
- **Unit — `market.priceHistory` auto-backfill** (mock `symbolHasAnyData` / `symbolExistsOnYahoo` / `ingestYahooSymbol` / price read): (a) present → no fetch; (b) absent + exists → fetch + re-query → points, `fetched:true`; (c) absent + not-exists → empty, no fetch; (d) fetch throws → empty, no crash.
- **Client** — picker helper (candidate → `"Use <symbol>"`), render states, resolved-after-pick.
- Telemetry-privacy build gate unaffected (no new *generation* calls; `symbol.search` is a tool).

## Risks

- **Latency** of a synchronous full-history ingest inside a chat turn. Mitigation: existence-gated, single attempt, cached after first fetch.
- **Picker UX** double-clicks. Mitigation: resolved-state lock.
- **Yahoo rate limits** — on-demand fetch is low volume vs. the paced batch cron.

## Cross-spec note

Consumes the Spec 1 prompt (`version` 3) and bumps to `version` 4. Independent of Spec 3.
