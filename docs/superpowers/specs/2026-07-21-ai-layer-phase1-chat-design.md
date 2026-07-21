# AI Layer — Phase 1: Chat Assistant (design)

Streaming, tool-calling chat assistant with inline charts/tables, built as a thin
surface over the Phase 0 foundation. This is the first user-facing AI feature and the
"applyable" milestone for the Visma Severa application.

Phase 0 (merged to `main`, squash `7dbaa3f`) shipped the spine: the provider-agnostic
gateway, BYOK credential encryption, the typed user-scoped tool layer, the telemetry
ledger, Postgres-atomic quota, guardrails, and the release-blocking advice-boundary
evals. Phase 1 wires that spine to a real conversation.

## 1. Why

The organising insight from Phase 0 holds: a chatbot, an MCP server, and a scheduled
agent are the same set of typed, user-scoped operations wearing different clothes. Phase
1 is the **chat adapter** over the tool layer — no new authorization model, no second
place to leak another user's portfolio. Everything security-relevant already exists and
is tested; Phase 1 must not weaken it.

## 2. Scope

### In
- A global slide-over chat drawer, launched from the dashboard header, available on
  every dashboard page.
- Streaming responses with tool-calling over the seven Phase 0 read tools.
- **Inline artifacts (Approach A):** tool outputs render as real recharts charts and
  data tables, bound to the tool's actual typed output — never to model-restated numbers.
- **Explicit model picker:** platform (Azure) plus the user's enabled BYOK providers,
  chosen per conversation, re-validated server-side.
- **Persisted multi-conversation history:** list, resume, rename, delete — all
  ownership-scoped.
- Quota reservation/settlement for platform calls (BYOK bypasses quota, nothing else).
- EU AI Act Art. 50 disclosure, on by default, no off switch.

### Explicitly out (and why)
| Out | Why |
| --- | --- |
| MCP endpoint | Phase 2. Same tool layer, different adapter. |
| Write / mutation tools | Phase 3. `AppTool.mutates` exists but every Phase 1 tool is read-only. |
| Scheduled digest | Phase 4. |
| Generative-UI / model-driven artifacts (Approach B) | Rejected: the model would control presentation and could restate data into a render call. Approach A binds charts to the tool's real output — no hallucinated numbers, and cleaner against the advice boundary. |
| Per-page context-awareness of the drawer | Natural future win now that the drawer is global; not needed to ship. |
| LLM title generation, message edit/branch/regenerate/search/export | YAGNI for the MVP. |

## 3. Baseline (verified in-tree, not assumed)

- **Tool adapter exists:** `src/server/ai/tools/adapters/ai-sdk.ts` — `toAiSdkTools(defs, ctx)`
  maps `AppTool[]` → the AI SDK `ToolSet`, closing each tool over `ctx` (the model
  supplies only `input`; it cannot reach `userId`). Dot→underscore tool-name mapping lives
  only here.
- **Tool registry + authorization:** `buildToolset(ctx)` in `tools/registry.ts` is the
  single enforcement point (`requiredScope` + read-only-on-MCP). `ALL_TOOLS` is the seven
  read tools.
- **Model resolution:** `resolveModel(userId)` in `resolve-model.ts` picks the user's
  most-recent enabled BYOK credential, else `platformModel()`. A broken BYOK credential
  **throws** — it must never fall through to the platform card.
- **Quota:** `reserve(userId, ceilingNanoUsd, requestId)`, `settle(reservation, actualNanoUsd)`,
  `estimateRequestCeilingNanoUsd(resolvedModel, estInputTokens)`, `sweepOrphanedReservations()`.
- **Telemetry:** `registerAiTelemetryOnce()` / `createLedgerTelemetry(sink)` write `AiCall`
  rows; correlation is via `runWithAiContext(ctx, fn)` + the `aiContext` AsyncLocalStorage.
- **Guardrails:** `GUARDRAIL_STACK` is attached at the platform registry level and via
  `applyGuardrails()` for BYOK. `MAX_OUTPUT_TOKENS = 4096`, `MAX_STEPS = 8`.
- **Persistence tables:** `AiChat { id, userId, title?, createdAt, updatedAt }` and
  `AiMessage { id (the AI SDK message id), chatId, role, parts (Json), metadata?, createdAt }`
  already exist in `prisma/schema.prisma`. **No migration needed.**
- **Credential listing:** `api.aiCredentials.list` returns `AiCredentialView[]` (provider,
  defaultModelId, masked hint — no secrets), exactly what the picker needs.
- **Prompt:** `PORTFOLIO_ANALYST` (frozen, versioned, hashed) encodes the MiFID II advice
  boundary and the Art. 50 first-turn disclosure. Phase 1 reuses it unchanged.
- **Charts/tables:** `src/components/ui/chart.tsx` (recharts wrapper) and the existing
  data-table components are reusable for artifacts.

## 4. Pinned dependencies (new)

- **`@ai-sdk/react`** — `useChat` lives here in v7, not in `ai`. Not yet installed.
- **`streamdown@2.5.0`** — streaming-safe markdown. **Do NOT install `ai-elements`**: it
  declares 24 shadcn `registryDependencies` that already exist here as Base UI components;
  the CLI would offer to overwrite them with Radix versions and silently reintroduce Radix
  into a repo that has none.

**Standing rule (from the Phase 0 memory): the AI SDK is at v7 — verify every API name
against the shipped `.d.ts` before writing code.** Known v7 shapes this design depends on:
`convertToModelMessages` is **async**; `useChat` has **no** `input`/`handleInputChange`/
`handleSubmit`/`append`/`reload`; `streamText` takes `instructions` (not `system`);
`result.toUIMessageStreamResponse({ originalMessages, onFinish })`. The exact names for the
step-count stop condition, the transport class, and the tool-part discriminant on
`UIMessage.parts` MUST be confirmed against the `.d.ts` during implementation.

## 5. Architecture

```
Browser (drawer)                         Server
─────────────────                        ──────────────────────────────────────────
composer ──sendMessage({text})──▶  POST /api/ai/chat  (route.ts)
                                     │  auth (getServerSession) → 401
                                     │  zod: { chatId?, message, model: selector }
                                     │  validate selector vs user's own credentials
                                     ▼
                                   streamChatTurn()  (chat/gateway.ts)
                                     │  resolveModel(userId, selector)
                                     │  createToolCtx(session,'chat') → toAiSdkTools(...)
                                     │  reserve() if !byok
                                     │  runWithAiContext(CHAT, chat.turn, …)
                                     │    streamText({ model, instructions, messages, tools, stopWhen })
                                     │  onFinish: persist turn + settle()
                                     ▼
useChat  ◀──UIMessage stream──  result.toUIMessageStreamResponse()

tRPC ai-chat router: list / get / rename / delete   (history CRUD, ownership-scoped)
```

### 5.1 The gateway — `src/server/ai/chat/gateway.ts`

`streamChatTurn` is the one place the Phase 0 pieces compose into a live turn. Order:

1. **Resolve model** from the validated selector: `resolveModel(userId, selector)` →
   `{ model, byok, resolvedModel, modelId, providerId }`.
2. **Build tool context + toolset:** `createToolCtx(session, 'chat')` →
   `toAiSdkTools(buildToolset(ctx), ctx)`. Read tools only, all closed over `userId`.
3. **Reserve (platform only):** if `!byok`,
   `reserve(userId, estimateRequestCeilingNanoUsd(resolvedModel, estInputTokens), requestId)`.
   The ceiling must account for `MAX_STEPS * MAX_OUTPUT_TOKENS`, per the Phase 0 guardrail
   note. BYOK bypasses quota and nothing else.
4. **Correlation context:** wrap the stream in
   `runWithAiContext({ requestId, userId, surface:'CHAT', functionId:'chat.turn', chatId, byok, resolvedModel, reservationId }, …)`.
5. **Stream:** `streamText({ model, instructions: PORTFOLIO_ANALYST.text, messages: await convertToModelMessages(history), tools, stopWhen: stepCountIs(MAX_STEPS), abortSignal })` — `estInputTokens` for step 3 is estimated from the serialized loaded history; the exact `stopWhen` helper name is confirmed against the `.d.ts` (§4).
6. **Return** `result.toUIMessageStreamResponse({ originalMessages, onFinish })`.
7. **Settle:** in `onFinish`, price `result.totalUsage` and
   `settle(reservation, actualNanoUsd)`; on error/abort, settle best-effort in a `finally`.
   `sweepOrphanedReservations` is the crash backstop.

**Subtlety flagged for implementation:** the exact source of the settled `actualNanoUsd`
must reconcile with what the telemetry ledger records per provider call under the same
`requestId`. Confirm against `telemetry.ts` (`toUsageColumns`, the pricing module) that the
gateway settles the same total the ledger sums — do not double-count and do not leave the
reservation unsettled on the streaming path.

### 5.2 Route handler — `src/app/api/ai/chat/route.ts`

- `POST` only. Auth via `getServerSession()` → 401 if absent.
- Body (zod): `{ chatId?: string, message: UIMessage, model: ModelSelector }`.
  **Only the newest user message is accepted.** Prior turns are loaded server-side from
  `AiMessage`; the client's copy of history is never trusted as model input.
- **Selector validation:** `platform` allowed iff `platformModel()` is configured; a
  `byok` selector must name a provider the user has enabled (checked against their own
  rows). The client sends an identifier, never model config or a secret.
- On a new `chatId`, create the `AiChat` (title from the first user message, truncated).
- Returns the gateway's streaming `Response`. Set `export const maxDuration` to cover a
  multi-step reasoning turn.

### 5.3 `resolveModel(userId, selector?)` — additive extension

```
type ModelSelector =
  | { kind: 'platform' }
  | { kind: 'byok'; provider: 'AZURE'|'OPENAI'|'ANTHROPIC'|'GOOGLE'|'OPENAI_COMPATIBLE' };
```

- `selector === undefined` → today's behavior (most-recent enabled BYOK else platform).
  Preserves back-compat for the eval harness and any existing caller.
- `{ kind:'platform' }` → `platformModel()`.
- `{ kind:'byok', provider }` → that specific enabled credential for this user; a
  missing/broken one **throws** (never a silent fall-through to the platform card).

### 5.4 `createToolCtx(session, surface)` — closes the flagged gap

Returns `{ userId: session.user.id, scopes: ALL_READ_SCOPES, surface, currency }`.
`currency` is resolved the same way the dashboard resolves the active currency. Phase 1
grants every `*:read` scope. Because every caller uses this factory rather than a literal,
nothing can hand-write `{ userId: someOtherId }` — the Phase 0 concern (`ToolCtx` was a
bare type) is closed.

### 5.5 Persistence — `src/server/ai/chat/persistence.ts`

- **Save turn** in `onFinish`: upsert the user and assistant message(s) into `AiMessage`
  (whole `parts` array as JSON, keyed by the AI SDK message id), bump `AiChat.updatedAt`.
- **Load history**: each turn loads prior `AiMessage` rows for `{ chatId, userId }`,
  ordered by `createdAt`, to rebuild the model input.
- All reads/writes scoped to `{ chatId, userId }`.

### 5.6 History CRUD — `src/server/api/routers/ai-chat.ts`

`protectedProcedure` router: `list` (id/title/updatedAt), `get` (messages for one chat),
`rename`, `delete`. Every operation re-checks ownership `{ id, userId }`; a user can never
touch another's chat. Registered on the app router.

### 5.7 Frontend — `src/app/(dashboard)/_components/chat/`

- **Launcher + drawer:** `chat-launcher.tsx` mounts in the dashboard header (beside
  `CurrencySwitch`/`ThemeSwitch`); `chat-drawer.tsx` is a right-side slide-over, wide by
  default (`clamp(420px, 40vw, 760px)`) with an optional drag-to-resize edge handle.
  Proper dialog semantics (focus trap, Esc, aria), light/dark aware.
- **`useChat` client:** keyed by `chatId`; transport posts to `/api/ai/chat` sending only
  `{ chatId, message: lastMessage, model: selector }`. The **composer owns its input via
  `useState`** (v7 `useChat` has none) and calls `sendMessage({ text })`. Existing chats
  hydrate initial messages from `api.aiChat.get`.
- **Message rendering:** iterate `parts` — `text` → `streamdown`; `tool-<name>` at
  `output-available` → artifact registry lookup, render chart/table from `part.output`
  (the tool's real typed data) plus a collapsible tool-call chip; `reasoning` →
  collapsed/omitted for MVP; unknown tool → chip + compact default.
- **Artifact registry** (`artifacts/index.ts`, tool name → renderer, typed against each
  tool's `outputSchema`):
  | Tool | Renderer |
  | --- | --- |
  | `portfolio.structure` | pie allocation (reuses `chart.tsx`) |
  | `portfolio.performance` | area/line time series |
  | `market.priceHistory` | line chart |
  | `transactions.search` | data table |
  | `watchlist.list` | table / compact list |
  | `goals.list` | table / progress |
  | `fx.rates` | inline table |
  ~3 chart renderers + one parameterized table renderer.
- **Model picker:** options = platform (if configured) + enabled BYOK providers from
  `api.aiCredentials.list`; default platform; selection sent per turn, re-validated
  server-side; active model shown as a badge.
- **History rail:** `api.aiChat.list`; click to resume, new-chat, inline rename, delete
  with confirm, empty state.
- **Composer:** auto-grow textarea, Enter to send / Shift+Enter newline, send + stop
  (`stop()`), disabled while a turn is in flight.
- **Disclosure:** persistent, non-dismissible "AI assistant — informational only, not
  financial advice," reinforcing the prompt-forced first-turn disclosure.

### 5.8 Error handling — no silent failures

Distinct route error codes map to specific UI copy:
- **No platform model and no BYOK** → picker prompts "add a key in Settings → AI"; send
  disabled.
- **Quota exceeded** (`reserve` throws) → "You've hit your usage limit."
- **BYOK key rejected** (`resolveModel` throws) → "Your <provider> key was rejected —
  check Settings → AI." Never falls back to the platform card.
- **Provider/network error mid-stream** → inline error bubble + retry; partial text kept.
- **Abort** (`stop()`) → clean halt; partial assistant message preserved.

## 6. Regulatory constraints (unchanged from Phase 0, restated)

- **MiFID II advice boundary** is enforced by the frozen `PORTFOLIO_ANALYST` prompt and
  the tier-1 advice-boundary eval (a release blocker). Phase 1 changes neither. Inline
  charts are descriptive data visualisation of the user's own data — they do not chain
  instrument-specific output to normative output.
- **EU AI Act Art. 50** disclosure is on by default with no off switch: the prompt forces
  the first-turn "I am an AI, not a financial adviser," and the UI carries a persistent
  disclosure line. The prompt module remains a pure, env-free string+hash (a unit test
  fails the build if a disabling flag appears in it).

## 7. Testing

- **Unit (hermetic, bun):**
  - `resolveModel` selector — platform, byok-provider, invalid/absent throws, no-selector
    back-compat.
  - `createToolCtx` — userId from session only; scopes correct; not forgeable.
  - Gateway with `MockLanguageModelV4` — `reserve`→`settle` on platform, skipped on BYOK;
    `runWithAiContext` populated; tools wired; persistence called on finish.
  - Route — 401 unauth; selector validation rejects a provider the user lacks; body zod
    validation; last-message-only contract.
  - Persistence — ownership scoping (cannot load another user's chat); parts JSON
    round-trip.
  - Artifact registry — every mapped tool resolves to its renderer; typed against
    `outputSchema`.
- **Component:** text→streamdown; tool part→correct artifact; no-renderer fallback;
  composer send/stop; picker options from a mocked list.
- **E2E (existing Playwright):** one happy path — open drawer, send, see streamed reply +
  tool chip, with a deterministic stub model in the test env.
- **Evals (unchanged):** tier-1 advice-boundary / injection / tool-choice keep gating —
  chat reuses the exact prompt + model stack they validate.

## 8. Decisions

- **Approach A (deterministic renderers), not B (generative UI).** Charts bind to the
  tool's real output → no hallucinated numbers, type-safe, no new model surface, cleaner
  against the advice boundary.
- **Global slide-over, not a dedicated page.** User preference; the drawer opens wide so
  artifacts still have room. A dedicated page / deep link is an additive future option.
- **Explicit model picker, not auto-resolve.** User preference; matches the BYOK "freedom"
  value prop. Cost: the selector rides each request and must be re-validated server-side.
- **Send only the last message; server is authoritative for history.** More secure
  (no injected conversation) and cheaper. Server loads prior turns from the DB.
- **History CRUD via tRPC; the token stream via a raw route handler.** tRPC does not stream
  token-by-token; the split is the standard v7 pattern.

## 9. Risks

- **AI SDK v7 API drift.** Mitigated by verifying names against the shipped `.d.ts` before
  coding (standing rule) and by `MockLanguageModelV4` unit tests.
- **Quota settle ↔ telemetry double-count / leak.** The subtlest coupling (§5.1). Covered
  by a gateway unit test asserting exactly-once settlement with the priced total.
- **Reasoning-model latency in E2E.** Mitigated by a deterministic stub model in the test
  env; live model behavior stays covered by the tier-1 evals, not E2E.
- **Drawer width vs. chart legibility.** Mitigated by a wide default + responsive/compact
  artifacts.

## 10. Build order (for the plan)

1. `resolveModel(userId, selector?)` extension + tests.
2. `createToolCtx(session, surface)` + tests.
3. `chat/persistence.ts` (+ `ai-chat` tRPC router) + ownership tests.
4. `chat/gateway.ts` + `MockLanguageModelV4` tests (the settle/telemetry reconciliation).
5. `api/ai/chat/route.ts` + auth/selector/body tests.
6. Add deps; `useChat` client + composer + message thread (text via streamdown).
7. Artifact registry + renderers (charts, table) + component tests.
8. Model picker + history rail + disclosure + error states.
9. Launcher/drawer wiring into the dashboard header.
10. One happy-path E2E; final review; keep tier-1 evals green.

## 11. Done when

- The drawer opens on any dashboard page; a user can hold a streamed, tool-calling
  conversation grounded in their own data.
- Tool outputs render as inline charts/tables bound to real tool data.
- The model picker offers platform + the user's BYOK providers, re-validated server-side.
- Conversations persist and can be listed/resumed/renamed/deleted, ownership-scoped.
- Platform calls reserve/settle quota; BYOK bypasses quota only.
- The Art. 50 disclosure shows and cannot be disabled; the tier-1 advice-boundary eval
  still passes.
- `typecheck` + `biome` clean; unit + component + one E2E green.

Related: `2026-07-13-ai-layer-phase0-design.md`, `2026-07-13-ai-layer-phase0-research-brief.md`.
