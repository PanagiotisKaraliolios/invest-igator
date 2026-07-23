# AI Layer — Phase 3a: Natural-Language Transaction Entry (design)

The first **write** surface over the one tool layer. A user tells the chat *"I bought 10 Apple at 150
yesterday"*; the assistant resolves it, shows a **Confirm card**, and only a human click — re-authenticated
server-side — records the transaction. This is the fourth "applyable" milestone for the Visma Severa
application and its strongest interview parallel: NL entry ≈ their time entry. Phase 3 is deliberately
**decomposed** — 3a (this spec) builds the write-tool + confirmation foundation; **3b** (broker-statement
extraction) reuses it and adds document ingestion.

## 1. Why

Phases 0–2 shipped read-only tools on three surfaces. Phase 0 also pre-built the **write seam** and never
used it: `AppTool` carries `mutates`/`preview`/`requiredScope`, the `:write` half of `Scope` exists, and
`buildToolset` already blocks mutating tools on MCP. Phase 0 §9.4 pre-decided the mechanism: *a mutating
tool does not write — it validates + previews and returns a signed `PendingMutation`; the actual commit is
an ordinary authenticated tRPC mutation, stateless by design.* 3a makes that concrete for one operation:
**creating a transaction**. Because MCP is categorically read-only, the write surface is **chat only** (a
human is present), which is exactly why the confirmation is an interactive click, not an LLM-interpreted
"yes".

## 2. Scope

### In
- One write tool `transactions.create` (`mutates: true`, `requiredScope: 'transactions:write'`) — **side-effect-free**: resolves symbol/currency/date, previews, signs a token, writes nothing.
- The stateless confirmation seam: an HMAC-signed `PendingMutation` token (new `AI_MUTATION_SECRET`) + a session-authenticated tRPC commit mutation with expiry, cross-user, and single-use replay protection.
- The first **interactive** chat artifact: a read-only Confirm/Cancel card.
- Chat gains `transactions:write` (MCP unchanged, still read-only).
- A small enabling refactor: a shared `createTransaction()` service used by both the existing tRPC procedure and the new commit path.

### Explicitly out (and why)
| Out | Why |
| --- | --- |
| Update / delete via NL | Deferred. Each needs existing-row search + disambiguation + its own destructive-confirm flow (~3× the surface). Editing/removing still works through the existing manual UI. Add once the write foundation is proven. |
| Broker-statement extraction | Phase 3b. Reuses this confirmation seam + write path; adds file upload + PDF/vision ingestion + multi-row dedup. |
| Editable Confirm card | The token signs exact args; editing would require re-sign round-trips. Read-only card + "tell me to change it → new preview" keeps token integrity trivial. (User choice.) |
| Write tools on MCP / cron | MCP is read-only by design (`buildToolset` filter). Cron is Phase 4 (unattended digest, no human confirm). 3a is chat-only. |
| Multi-instance session state for confirmation | The seam is stateless (signed token + a single-use `jti` row); no server-side pending-mutation session. |

## 3. Baseline (verified in-tree, not assumed)

**Seam already built (unused):**
- `AppTool` (`src/server/ai/tools/types.ts:31-52`): `mutates: boolean` (all 7 tools hard-code `false`), `preview?: (input, ctx) => Promise<string>` ("Required when mutates is true"), `requiredScope: Scope`, `annotations.destructiveHint?`.
- `Scope` (`types.ts:19`) includes the `:write` half; only a synthetic test tool uses it today.
- `buildToolset` (`registry.ts:25-32`): filters by `ctx.scopes.has(t.requiredScope)` and drops `t.mutates` when `ctx.surface === 'mcp'`. Unchanged.
- `createToolCtx(session, surface, scopes?)` (`tool-ctx.ts`): chat calls it with no scope arg → `ALL_READ_SCOPES`. 3a passes an explicit chat set including `transactions:write`.

**Reusable [BUILT]:**
- Transaction writes live inline in `transactions.create` tRPC (`src/server/api/routers/transactions.ts:106-129`) with schema `createTransactionInput` (`transactions.schemas.ts:15`) and Yahoo symbol validation (`symbolExistsOnYahoo`). Symbol resolution: `searchYahooSymbols` / `symbolExistsOnYahoo` (`src/server/yahoo-search.ts`). `Transaction` model: `{ date, symbol, side(BUY|SELL), quantity, price, priceCurrency='USD', fee?, feeCurrency?, note? }` (`schema.prisma:13-35`).
- Phase 1 artifact registry (`src/app/(dashboard)/_components/chat/artifacts/registry.ts`): `ARTIFACT_RENDERERS` maps a canonical tool name → renderer; `renderArtifact` renders on `part.state === 'output-available'`. Rendering is output-only today (no interactive affordance).
- tRPC surface with `protectedProcedure` (session-authenticated); Phase 1 `ai-chat` router exists.

**Greenfield [built in 3a]:** the write tool; the token sign/verify helpers; the commit mutation; the interactive Confirm card; the `createTransaction()` service; the `AiMutationCommit` (jti) table; the `AI_MUTATION_SECRET` env var; the chat write-scope grant.

## 4. New dependency / env (no new libraries)
- **`AI_MUTATION_SECRET`** — `z.string().min(32)` server env (added to `env.js` schema + `runtimeEnv`), the HMAC key for confirmation tokens. **Dedicated**, not `AI_API_KEY_PEPPER` (different blast radius: key-lookup vs. write-authorization; rotating one must not affect the other). (User choice.) When unset, `transactions.create` fails closed (tool returns an "unavailable" status; commit rejects) — no writes possible.
- HMAC via `node:crypto` (`createHmac`/`timingSafeEqual`) — no new package. Symbol resolution reuses Yahoo. No new libs.

## 5. Architecture

```
Chat: "bought 10 Apple at 150 yesterday"
   │  model calls tool
   ▼
transactions.create.execute(input, ctx)          [mutates:true, scope transactions:write, WRITES NOTHING]
   │  1. resolveProposed(input, ctx): symbol→Yahoo canonical, currency inference, relative-date→ISO, validate
   │  2. preview string  ← formatProposed(proposed)   (AppTool.preview reuses this)
   │  3. token ← signMutation({ userId, tool, args: proposed, jti, exp: now+120s }, AI_MUTATION_SECRET)
   │  4. return { requiresConfirmation:true, preview, proposed, expiresAt, confirmationToken }
   ▼
chat renders artifact  → Confirm / Cancel  (read-only card)
   │  Confirm click (OUTSIDE the chat stream)
   ▼
tRPC ai.commitPendingTransaction({ token })      [protectedProcedure — session-authenticated]
   │  verify HMAC (timingSafeEqual) · exp not passed · token.userId === session.user.id · args parse
   │  $transaction: insert AiMutationCommit(jti)  [unique → single-use replay guard]  +  createTransaction(userId, args)
   ▼
{ id } → card flips to "✓ Recorded"
```

### 5.1 The write tool — `transactions.create`
`inputSchema` (`z.strictObject`, **no userId**): `{ symbol, side: 'BUY'|'SELL', quantity: >0, price: >0, date?: yyyy-mm-dd (default today, not future), priceCurrency?, fee?, feeCurrency?, note? }`. The model fills these from NL and resolves relative dates using the current date already in its context.
`execute` (side-effect-free): **resolve** — `symbolExistsOnYahoo(input.symbol)`; if `'no'`, `searchYahooSymbols(input.symbol)` and take the top tradable match; unresolvable → typed `{ requiresConfirmation:false, error }` the model relays. **Currency** — `input.priceCurrency` → else the security's listing currency → else `db.user.currency` (default USD). Build `proposed`, `preview = formatProposed(proposed)`, sign the token, return the `PendingMutation`. `mutates: true`; `preview` (the Phase-0-required field) = `async (input, ctx) => formatProposed(await resolveProposed(input, ctx))`. `annotations`: `readOnlyHint:false`, `destructiveHint:false` (create is additive), `idempotentHint:false`.
`outputSchema`: `z.discriminatedUnion` over `requiresConfirmation` — the confirm branch `{ requiresConfirmation:true, preview, proposed:{...}, expiresAt, confirmationToken }`, the error branch `{ requiresConfirmation:false, error }`.

### 5.2 The confirmation token
Compact hand-rolled signed envelope (no JWT dep): `base64url(payloadJSON) + "." + base64url(HMAC-SHA256(AI_MUTATION_SECRET, base64url(payloadJSON)))`. Payload: `{ v:1, userId, tool:'transactions.create', args: proposed, jti: randomUUID(), iat, exp: iat+120 }`. `signMutation`/`verifyMutation` helpers live in a dedicated module; verify compares with `timingSafeEqual` and returns the typed payload or a reason (`INVALID` | `EXPIRED`). `expiresAt` is also surfaced in the tool output (non-secret) so the card can show "expired" without decoding — the **server remains authoritative** on expiry.

### 5.3 The commit mutation — `ai.commitPendingTransaction`
`protectedProcedure`, input `{ token: string }`. Steps: `verifyMutation(token)` → reject `EXPIRED`/`INVALID`; assert `payload.userId === ctx.session.user.id` (a token is non-transferable across users); parse `payload.args` against `createTransactionInput` (defense in depth). Then one `db.$transaction`: **insert `AiMutationCommit { jti }`** (unique PK → a replayed/double-clicked token throws `P2002` → mapped to `REPLAYED`, whole tx rolls back, no double write) **then** `createTransaction(userId, args)`. Returns `{ id }`. Never trusts a `userId` from the client; the write is scoped to the session user.

### 5.4 The Confirm card (first interactive artifact)
A new renderer keyed on `transactions.create` in the artifact registry, rendering `proposed` as a labeled card (symbol + resolved description, side, quantity, price, currency, date, fee/note if present) with **Confirm / Cancel**. **Read-only.** Confirm → `useMutation(api.ai.commitPendingTransaction)` with `{ token }`. Local states: `pending` → `committing` → `recorded ✓` (shows the created id) / `cancelled` / `expired` (client computes from `expiresAt`; server re-checks) / `error` (surfaces the mapped reason). To change anything, the user tells the model → a fresh tool call → new card. The registry's existing `output-available` gate and the `fromAiSdkToolName` dot/underscore handling (Phase 1 gotcha) apply.

### 5.5 Scope grant
A `CHAT_SCOPES` set = `ALL_READ_SCOPES ∪ { 'transactions:write' }`; the chat gateway passes it to `createToolCtx(session, 'chat', CHAT_SCOPES)`. The model can now *call* `transactions.create` (which only previews+signs). MCP passes its own read-only key scopes (unchanged); `buildToolset` still drops mutating tools on MCP regardless.

### 5.6 Shared `createTransaction()` refactor
Extract the write body of the `transactions.create` tRPC procedure into `createTransaction(userId, input: CreateTransactionInput): Promise<{ id }>` in `services/transactions.ts` (today read-only). Both the tRPC procedure and the commit mutation call it, so symbol validation + insert live in exactly one place. A pure targeted refactor — no behavior change to the existing procedure (covered by its existing tests).

## 6. Security invariants (tested, not asserted)
1. `transactions.create.execute` performs **no** DB write (only reads for resolution) — a test asserts zero writes on the tool path.
2. `userId` comes only from the session (commit) or the signed token, **never** from model input or the request body; a token whose `userId` ≠ the session user is rejected.
3. The token is tamper-evident (any payload edit fails `timingSafeEqual`), time-bounded (120s, server-authoritative), and **single-use** (`jti` PK → exactly-once even under double-click/replay/multi-instance).
4. The model can never cause a write: `execute` only previews+signs; the write requires a human click that hits a separately session-authenticated mutation.
5. The commit reuses the existing Yahoo-validated `createTransaction` path (no second, weaker write path).
6. `AI_MUTATION_SECRET` unset ⇒ the tool is unavailable and commit fails closed (no writes).

## 7. Regulatory note
Recording a transaction the user **states they made** is not a personal recommendation on an instrument — it is data entry, outside MiFID II's advice perimeter. The `transactions.create` tool is purely transactional and must never emit normative instrument-specific language. The advice-boundary eval remains the gate for the chat's *advisory* output and is unaffected by adding a create tool (verified by re-running `eval:advice`).

## 8. Testing
- **Unit (hermetic, `src/**`, mock `@/server/db` + Yahoo):** the tool resolves symbol/currency/relative-date correctly, formats the preview, signs a verifiable token, and **writes nothing**; unresolvable symbol → error branch; `sign/verify` round-trips and rejects tampered/expired tokens; `formatProposed` output.
- **Real-Postgres (`prisma/**`, `test:db`):** `commitPendingTransaction` writes via `createTransaction` and returns the id; **expired**, **tampered**, **replayed-`jti`** (double commit), and **cross-user** tokens are each rejected with no row written; `createTransaction` service parity with the existing tRPC procedure (same validation, same row).
- **Interaction:** a Confirm-card test — renders `proposed`, Confirm calls the commit mutation and reaches `recorded`, Cancel dismisses, expired state shown past `expiresAt`.
- **Eval:** `eval:advice` still green (entry is not advice).
- **Gates:** `typecheck` + `biome` clean; `test:unit` + `test:db` green.

## 9. Decisions
- **Decompose Phase 3; build 3a (NL entry) first** — smaller specs, tighter reviews, a complete demoable feature; 3b reuses this foundation. (User choice.)
- **Interactive Confirm card** — a human clicks a button bound to an exact signed payload; the LLM never triggers the write. (User choice.)
- **Create only** — smallest secure first write surface; update/delete deferred. (User choice.)
- **Dedicated `AI_MUTATION_SECRET`** — separate blast radius from `AI_API_KEY_PEPPER`. (User choice.)
- **Read-only Confirm card** — preserves signed-token integrity; changes go through a fresh preview. (User choice.)
- **Stateless signed token + single-use `jti`** — carried from the Phase 0 §9.4 pre-decision; `jti` row is the minimal state that buys exactly-once.

## 10. Risks
- **Symbol/currency resolution ambiguity** ("Apple" vs "AAPL", multi-listing) — mitigated by resolving to the top tradable Yahoo match and surfacing the resolved symbol + description in the card for the human to verify before commit; unresolvable → the model asks.
- **Token replay / double-write** — the `jti` unique PK inside the write transaction makes commit exactly-once; the 120s TTL bounds the window.
- **Scope creep of write** — chat gaining `transactions:write` only enables the *preview* tool; the actual write is gated by the human click + a session-authed, token-validated mutation. MCP is untouched.
- **Model over-reach into advice** — the create tool is transactional-only; the advice eval stays the gate. Re-run it.
- **AppTool.preview vs execute duplication** — both delegate to one `resolveProposed` helper (DRY); only `execute` runs at chat runtime.

## 11. Build order (for the plan)
1. `AI_MUTATION_SECRET` env wiring + `AiMutationCommit` (jti) Prisma model/migration.
2. `signMutation`/`verifyMutation` token helpers + unit tests (round-trip, tamper, expiry).
3. `createTransaction()` service extraction + parity tests; repoint the existing tRPC procedure.
4. The `transactions.create` write tool (`resolveProposed`, `formatProposed`, side-effect-free `execute`, `preview`) + unit tests (resolution, no-write, token, error branch).
5. `ai.commitPendingTransaction` tRPC mutation + real-Postgres tests (write; expired/tampered/replayed/cross-user rejected).
6. Chat `transactions:write` scope grant (`CHAT_SCOPES`) + gateway wiring + test.
7. The interactive Confirm card renderer + registry wiring + interaction test.
8. `eval:advice` re-run; docs touch-up (how NL entry works).

## 12. Done when
- In chat, "I bought 10 Apple at 150 yesterday" yields a Confirm card with the resolved transaction; **Confirm** records exactly one transaction for the caller and shows ✓; **Cancel** writes nothing.
- No write happens without a human click; a tampered/expired/replayed/cross-user token is rejected; `userId` never comes from the client; the tool itself writes nothing.
- MCP remains read-only; the advice eval stays green; `typecheck`/`biome`/`test:unit`/`test:db` all green.

Related: `2026-07-13-ai-layer-phase0-design.md` (§9.4 the confirmation seam), `2026-07-21-ai-layer-phase1-chat-design.md` (artifact registry), `2026-07-21-ai-layer-phase2-mcp-design.md` (the read-only MCP surface).
