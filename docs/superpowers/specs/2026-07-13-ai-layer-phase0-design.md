# AI Layer — Phase 0: Foundation (design)

**Date:** 2026-07-13
**Status:** approved, ready for implementation planning
**Branch:** `feat/ai-layer-phase0`
**Companion:** [`2026-07-13-ai-layer-phase0-research-brief.md`](./2026-07-13-ai-layer-phase0-research-brief.md) — the verified API surface, with adversarial corrections. Every version number and export name in this spec comes from there.

---

## 1. Why

Invest-igator has no AI features. This document specifies the **foundation** they will all sit on.

The organising insight: **a chatbot, an MCP server, and a scheduled agent are the same thing wearing different clothes.** All three are just *a set of typed, user-scoped operations that a model may call*. Build that tool layer once, and each surface becomes a thin adapter over it. Build it three times, and you get three divergent authorization models and three places to leak another user's portfolio.

So Phase 0 ships **no AI feature** — no chat, no MCP endpoint, nothing that talks to a user. It ships the spine:

- a provider-agnostic LLM gateway (default Azure OpenAI, swappable to Anthropic/OpenAI/Google/any OpenAI-compatible endpoint);
- BYOK — users supply their own provider credentials, encrypted at rest;
- the typed, user-scoped **tool layer**;
- a per-call telemetry ledger (tokens, cost, latency, outcome);
- quota enforcement that survives multiple replicas;
- guardrails and an eval suite that gates merges.

It also ships the two UI surfaces those require, because a credential store nobody can populate and a ledger nobody can read are both useless:

- **BYOK settings** — add, validate, and delete provider credentials;
- **an admin observability view** — spend, latency, failure rate, tool-call frequency.

### Roadmap context

| Phase | What | Depends on |
|---|---|---|
| **0** | **Foundation (this spec)** | — |
| 1 | Chat assistant — streaming, tool-calling, inline charts/tables | 0 |
| 2 | MCP server — same tools, bearer-key auth | 0 |
| 3 | NL transaction entry + broker-statement extraction (adds *write* tools) | 0, 1 |
| 4 | Scheduled AI digest (Ofelia cron → email) | 0 |
| 5 | Predictive ML model (deliberately **not** an LLM) | — |
| 6 | News ingestion + RAG (pgvector) | 0, 5 |

Phases 0–2 are a coherent milestone on their own: *one tool layer, two surfaces, production-grade instrumentation*.

---

## 2. Scope

### In

Everything in §1's bullet list, plus the small enabling changes below.

### Explicitly out (and why)

| Not in Phase 0 | Why |
|---|---|
| Any chat UI | Phase 1. Phase 0 is exercised by tests and one dev-only route. |
| The MCP endpoint itself | Phase 2. Phase 0 ships the *adapter* and the auth prerequisite. |
| **Any tool that mutates data** | See §7. Every Phase 0 tool is read-only, on every surface. |
| Vector columns / embeddings | Phase 6 — but see §9.3, the Postgres image moves **now**. |
| Billing / payments | No Stripe in the app. `AiQuota.tier` is admin-set for now; real billing bolts on later without touching this layer. |
| Better Auth's `apiKey` plugin | The bespoke implementation works and the table is already the right shape. Adopting the plugin is a migration, not a config line, and it is orthogonal. |

---

## 3. Baseline (verified in-tree, not assumed)

| Fact | Value |
|---|---|
| Runtime | Bun 1.3 (`oven/bun:1.3-debian`) |
| Framework | Next.js 16.2 App Router, Turbopack, React Compiler on |
| API | tRPC v11 + superjson |
| ORM | Prisma 7.8, generator `prisma-client` → `prisma/generated`, adapter `@prisma/adapter-pg`. **Datasource URL lives in `prisma.config.ts`, not `schema.prisma`** (Prisma 7 forbids it there). |
| TS | strict + `noUncheckedIndexedAccess` + `verbatimModuleSyntax` |
| zod | `^4.4.3` — above the AI SDK's `^4.1.8` peer floor |
| UI | `@base-ui/react`, **zero Radix** |
| Postgres | `postgres:16-alpine` (musl) |
| Cron | Ofelia, `bun run src/server/jobs/*.ts` inside the app container |
| Auth | Better Auth (`openAPI, admin, magicLink, twoFactor, nextCookies`) |
| API keys | **Bespoke.** `bcrypt.hashSync(key, 12)`; lookup = `findMany({where:{start}})` on a 6-char prefix + a `bcrypt.compareSync` loop. Header `x-api-key`. |
| Portfolio | **No `Position` model.** Derived via `getCachedStructure()` / `getCachedFullSeries()` in `src/server/portfolio-compute.ts`. |
| Scopes | `PERMISSION_SCOPES` — account, admin, apiKeys, fx, goals, portfolio, transactions, watchlist × read/write/delete, stored as JSON on `ApiKey.permissions`. |
| CI | lint, typecheck, build, e2e, migration-check. **No unit-test job** — `bun test src` exists in `package.json` and is invoked by nothing. |
| `src/instrumentation.ts` | Does not exist. |

---

## 4. Pinned dependencies

The Vercel AI SDK is at **v7**, released 2026-06-25. This is two majors past most published examples; v5/v6 idioms compile as deprecated aliases or not at all. The research brief has the full rename table. The ones that bite:

- `parameters:` → **`inputSchema:`** on `tool()`
- `system:` → **`instructions:`**
- `maxSteps` → gone; use **`stopWhen: isStepCount(n)`**
- `experimental_telemetry` → **`telemetry`** (type `TelemetryOptions`)
- `convertToModelMessages` is now **`async`** — every online example has it synchronous, and without `await` the route handler does not compile
- `useChat` has **no** `input` / `handleInputChange` / `handleSubmit` / `append` / `reload`
- `result.usage` now means **all steps** (bill on this); `result.finalStep.usage` is the final step only

```
ai                        7.0.22
@ai-sdk/azure             4.0.11
@ai-sdk/openai            4.0.11
@ai-sdk/anthropic         4.0.12
@ai-sdk/google            4.0.12
@ai-sdk/openai-compatible 3.0.7
@ai-sdk/provider-utils    5.0.7
@modelcontextprotocol/sdk 1.29.0     # Phase 2. >= 1.26.0 — earlier has a known vuln.
```

**`@ai-sdk/react` is on its own major (`4.0.23`) and hard-pins `ai@7.0.22`.** There is no `@ai-sdk/react@7`.

**Do not install `ai-elements`.** It declares 24 shadcn `registryDependencies`, all of which already exist here as Base UI components — the CLI would offer to overwrite them with Radix versions and silently reintroduce Radix into a repo that has none. Take `streamdown@2.5.0` only, and hand-roll the chat components on Base UI in Phase 1.

---

## 5. Architecture

```
src/server/ai/
  registry.ts          platform provider registry + guardrail middleware
  resolve-model.ts     per-request model resolution: BYOK ?? platform
  context.ts           AsyncLocalStorage<AiCallContext>   ← the correlation spine
  crypto.ts            AES-256-GCM seal/open + the Secret branded type
  telemetry.ts         the Telemetry integration (ledger writer)
  quota.ts             reserve / settle, Postgres-atomic
  pricing/
    models.snapshot.json   vendored from models.dev, git-versioned
    price.ts               (provider, model, usage) -> nanoUSD
  prompts/
    portfolio-analyst.ts   frozen, versioned, hashed
  tools/
    types.ts           AppTool<I,O> descriptor          ← THE Phase 0 interface
    registry.ts        ALL_TOOLS + buildToolset(ctx)
    portfolio.ts  transactions.ts  watchlist.ts  goals.ts  fx.ts
    adapters/
      ai-sdk.ts        AppTool[] -> ToolSet             (chat, Phase 1)
      mcp.ts           AppTool[] -> server.registerTool (MCP, Phase 2)
                       (cron calls def.execute(input, ctx) directly — no adapter)
  evals/
    tool-choice.eval.test.ts
    injection.eval.test.ts
    advice-boundary.eval.test.ts
src/instrumentation.ts   NEW — registers telemetry exactly once
```

### 5.1 Gateway and BYOK resolution

One platform registry at module scope. **The guardrail middleware is attached at registry level** — that is the choke point every platform call passes through. BYOK providers are constructed per-request and wrapped with *the same middleware object*, so there is exactly one guardrail implementation, not two.

```ts
export const registry = createProviderRegistry(
  { azure: createAzure({ resourceName: env.AZURE_OPENAI_RESOURCE_NAME,
                         apiKey: env.AZURE_OPENAI_API_KEY }) },
  { languageModelMiddleware: [guardrails] },
);
```

`resolveModel(userId)` looks for an enabled `AiProviderCredential`; if one exists it decrypts the secret, builds a provider instance with `createAzure` / `createOpenAI` / `createAnthropic` / `createGoogle` / `createOpenAICompatible`, and wraps it with `wrapLanguageModel({ model, middleware: [guardrails] })`. Otherwise it returns the platform model.

Per-request provider construction is effectively free — there is no vendor SDK object and no socket pool; all HTTP goes through the global undici pool. *Never pass a custom `fetch` that builds a new Agent per instance.*

**BYOK bypasses platform quota — and nothing else.** Same guardrails, same tool authorization. Keep the quota check in a separate code path from the guardrail and authz checks so that a BYOK short-circuit cannot accidentally skip both.

#### Azure specifics that will otherwise cost a day

- `azure('my-deployment')` — **the deployment name is the model id.**
- `apiVersion` defaults to the literal string `'v1'`. Do not pass a date. (The shipped JSDoc says `'preview'`; it's stale, the code wins.)
- The SDK builds `baseURL ?? https://{resourceName}.openai.azure.com/openai` and **appends `/v1{path}` itself.** A user who pastes an endpoint ending in `/v1` gets `/v1/v1/responses` → 404, which will look like a broken key. Normalise and validate at save time.
- `apiKey` **XOR** `tokenProvider` — passing both throws at construction.
- **All GPT-5.x models are reasoning models and return 400 on `temperature`, `top_p`, `presence_penalty`, `frequency_penalty`, `seed`, and `max_tokens`.** The guardrail middleware strips these unconditionally. Always pass `reasoning_effort` explicitly.
- Content-filter rejections return HTTP 400 — **and you are still billed.**

**Default model: `gpt-5.4-mini`** ($0.75 / $4.50 per 1M in/out). Escalation to `gpt-5.4` sits behind a tier flag. Avoid `gpt-5.5` — it has **0 TPM below quota tier 5**. Avoid `gpt-5.6-*` — preview, unpriced. Azure OpenAI is self-serve; there is no longer an access application form.

### 5.2 Credential encryption

AES-256-GCM via `node:crypto`, keyring-in-env, with a `kid` column and **AAD binding the ciphertext to `(userId, provider)`**.

```ts
const aad = (userId: string, provider: string) =>
  Buffer.from(`${userId}|${provider}|v1`, 'utf8');
```

That AAD is the point: a row copied to another tenant **fails to decrypt** rather than silently working.

Rules, each of which is a real failure mode:

1. **`iv` is a fresh `randomBytes(12)` every encryption.** Never derived from `userId`, never a counter. GCM nonce reuse under one key leaks plaintext XOR and enables forgery.
2. **`authTag` is persisted in its own column.** Forget `getAuthTag()`/`setAuthTag()` and the row is permanently undecryptable. `setAuthTag` must be called *before* `final()`.
3. **`kid` from day one.** Without it, key rotation means downtime or a guess-and-retry decrypt loop. Retired keys stay in the keyring as decrypt-only until backfill completes.
4. **Only the secret is encrypted.** `resourceName` / `baseURL` / `deployment` / `apiVersion` are *configuration*, not secrets — plaintext columns, because we need them for validation and to render the UI.
5. **The keyring loads lazily.** A module-eval throw breaks `next build` when the env var is absent.

Decrypted keys are wrapped in a branded `Secret` class whose `toString`, `toJSON`, and `inspect` all return `[redacted]`, making accidental serialisation into a log or an error body structurally impossible.

**Validate on save with a live 1-token probe** and set `lastVerifiedAt`. Azure's multi-field config makes silent misconfiguration the *default* failure mode; catching it at save time rather than mid-conversation is worth one request.

> **This is why Better Auth's `ApiKey` model cannot be reused for BYOK.** It stores a one-way bcrypt hash — verification only. BYOK requires *reversible* decryption at call time. They are opposite primitives. New table, no exceptions.

### 5.3 Prisma schema

```prisma
enum AiProvider      { AZURE OPENAI ANTHROPIC GOOGLE OPENAI_COMPATIBLE }
enum AiSurface       { CHAT MCP CRON EVAL }
enum AiCallKind      { LANGUAGE_MODEL EMBEDDING }
enum AiBilledTo      { PLATFORM USER }
enum AiPricingStatus { PRICED UNKNOWN_MODEL }
enum AiCallOutcome   { OK ERROR ABORTED CONTENT_FILTERED }

/// BYOK. Only the secret is encrypted; endpoint/deployment/version are config.
model AiProviderCredential {
  id             String     @id @default(cuid())
  userId         String
  user           User       @relation(fields: [userId], references: [id], onDelete: Cascade)
  provider       AiProvider

  kid            String   // which master key sealed this row (rotation)
  iv             Bytes    // 12 bytes, unique per encryption
  ciphertext     Bytes
  authTag        Bytes    // 16 bytes. Lose this and the row is undecryptable.

  resourceName   String?  // Azure: XOR baseURL
  baseURL        String?
  apiVersion     String?  // null => SDK default 'v1'. Never store a date.
  deployment     String?  // AZURE ONLY: the string passed as the SDK "model id"
  defaultModelId String   // the REAL model ('gpt-5.4-mini'). This is what we price on.

  label          String?
  enabled        Boolean   @default(true)
  lastVerifiedAt DateTime?
  lastUsedAt     DateTime?
  createdAt      DateTime  @default(now())
  updatedAt      DateTime  @updatedAt

  @@unique([userId, provider])
  @@index([userId])
}

/// Append-only ledger. One row per PROVIDER CALL, not per turn.
model AiCall {
  id            String   @id @default(cuid())
  createdAt     DateTime @default(now())

  userId        String?  // SetNull on delete: keeps aggregate spend, drops the PII linkage
  user          User?    @relation(fields: [userId], references: [id], onDelete: SetNull)
  surface       AiSurface
  functionId    String   // 'chat.turn' | 'mcp.tool' | 'cron.digest' | 'eval.<name>'
  requestId     String   // correlates every call + tool in one turn (from AsyncLocalStorage)
  chatId        String?

  kind          AiCallKind @default(LANGUAGE_MODEL)
  provider      String     // as reported by the SDK
  modelId       String     // as reported by the SDK. For AZURE this is the DEPLOYMENT NAME.
  resolvedModel String     // the real model. NEVER price on modelId for Azure.
  callId        String?
  responseId    String?

  inputTokens      Int?
  outputTokens     Int?   // nullable: embeddings have no output count
  totalTokens      Int?
  noCacheTokens    Int?
  cacheReadTokens  Int?   // ~10x cheaper — must be priced separately
  cacheWriteTokens Int?
  textTokens       Int?
  reasoningTokens  Int?

  billedTo        AiBilledTo
  pricingStatus   AiPricingStatus @default(PRICED)
  costNanoUsd     BigInt?         // 1e-9 USD. null iff UNKNOWN_MODEL. NEVER default to 0.
  priceSnapshotId String          // hash of models.snapshot.json -> reproducible re-pricing

  latencyMs     Int?
  finishReason  String?
  outcome       AiCallOutcome
  errorCode     String?
  errorMessage  String?  // SANITISED. Never JSON.stringify(err) — providers echo the auth header.

  systemPromptId      String?
  systemPromptVersion Int?
  systemPromptHash    String?

  @@index([userId, createdAt])
  @@index([requestId])
  @@index([createdAt])
  @@index([billedTo, createdAt])
}

/// Correlated by requestId, NOT by AiCall.id — tools execute BETWEEN model calls.
model AiToolCall {
  id           String   @id @default(cuid())
  createdAt    DateTime @default(now())
  requestId    String
  userId       String?
  surface      AiSurface
  toolName     String
  toolCallId   String
  ok           Boolean
  durationMs   Int?
  inputHash    String?  // sha256 of canonicalised input — queryable without storing positions
  errorMessage String?
  @@index([requestId])
  @@index([userId, createdAt])
  @@index([toolName, createdAt])
}

/// Multi-instance safe. NEVER hold quota state in process memory — we run N replicas.
model AiQuota {
  userId          String   @id
  user            User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  tier            String   @default("free")
  periodStart     DateTime
  limitNanoUsd    BigInt
  spentNanoUsd    BigInt   @default(0)  // settled
  reservedNanoUsd BigInt   @default(0)  // in-flight ceilings
  updatedAt       DateTime @updatedAt
}

model AiQuotaReservation {
  id             String    @id @default(cuid())
  userId         String
  requestId      String
  ceilingNanoUsd BigInt
  createdAt      DateTime  @default(now())
  settledAt      DateTime?
  @@index([userId, settledAt])
  @@index([createdAt])  // sweeper for reservations orphaned by a crash
}

model AiChat {
  id        String      @id @default(cuid())
  userId    String
  user      User        @relation(fields: [userId], references: [id], onDelete: Cascade)
  title     String?
  createdAt DateTime    @default(now())
  updatedAt DateTime    @updatedAt
  messages  AiMessage[]
  @@index([userId, updatedAt])
}

model AiMessage {
  id        String   @id     // the AI SDK message id
  chatId    String
  chat      AiChat   @relation(fields: [chatId], references: [id], onDelete: Cascade)
  role      String
  parts     Json     // the whole UIMessage.parts array
  metadata  Json?
  createdAt DateTime @default(now())
  @@index([chatId, createdAt])
}
```

**Plus one change to the existing `ApiKey`, which unblocks Phase 2:**

```prisma
model ApiKey {
  // ... existing fields ...
  keyHmac String? @unique  // HMAC-SHA256(key, AI_API_KEY_PEPPER). Deterministic -> O(1) lookup.
}
```

Today's verification path fetches every key sharing a 6-character prefix and runs `bcrypt.compareSync` (cost 12 — roughly 100–300ms of *synchronous* CPU) over each candidate, on the request thread. That is acceptable on a cold settings page and a trivial CPU-exhaustion DoS on a hot MCP endpoint. An API key is a 64-hex-character high-entropy secret, not a password, so bcrypt buys nothing a peppered HMAC doesn't. Add `keyHmac`, backfill lazily on the next successful verify, compare with `timingSafeEqual`, and drop the bcrypt column in a later release.

### 5.4 The tool layer — the most important interface in Phase 0

One descriptor, three adapters, and **`userId` is never a tool input.**

```ts
export type Scope =
  `${'portfolio'|'transactions'|'watchlist'|'goals'|'fx'}:${'read'|'write'}`;

export interface ToolCtx {
  readonly userId: string;              // from the session. NEVER from model input.
  readonly scopes: ReadonlySet<Scope>;
  readonly surface: 'chat' | 'mcp' | 'cron' | 'eval';
  readonly currency: string;
  readonly db: PrismaClient;
  readonly abortSignal?: AbortSignal;
}

export interface AppTool<I extends z.ZodType = z.ZodType,
                         O extends z.ZodType = z.ZodType> {
  name: string;                 // 'portfolio.structure'
  description: string;
  inputSchema: I;               // MUST be .strict(); MUST NOT contain userId
  outputSchema: O;              // -> MCP structuredContent; -> typed part.output in chat
  requiredScope: Scope;

  mutates: boolean;             // Phase 0: always false. The field exists NOW so Phase 3 is additive.
  preview?: (input: z.infer<I>, ctx: ToolCtx) => Promise<string>;  // required when mutates

  annotations: {                // MCP hints. NOT authorization.
    title: string; readOnlyHint: boolean; destructiveHint?: boolean;
    idempotentHint?: boolean; openWorldHint: boolean;
  };

  execute: (input: z.infer<I>, ctx: ToolCtx) => Promise<z.infer<O>>;
}

export function buildToolset(ctx: ToolCtx): AppTool[] {
  return ALL_TOOLS.filter((t) => {
    if (!ctx.scopes.has(t.requiredScope)) return false;
    if (t.mutates && ctx.surface === 'mcp') return false;  // Phase 0: MCP is read-only, full stop
    return true;
  });
}
```

**The hard rules. These *are* the security model:**

- `userId` is **never** a field in any `inputSchema`. It only ever comes from `ctx`. The model cannot name another user's ID because there is no argument to put it in.
- Every input schema is `z.strictObject(...)`. Unknown keys are rejected, not passed through.
- **The model never authors SQL, Flux, or a Prisma `where`.** A tool taking `filter: z.record(z.any())` and spreading it into Prisma is an instant cross-tenant read (`{ userId: { not: ctx.userId } }`).
- Tools call the **existing** service functions — `getCachedStructure`, `getCachedFullSeries`, and the transaction/watchlist/goal services extracted per §5.5. No new data-access paths.

**Why our own descriptor rather than the AI SDK's `tool()` as the canonical form:** MCP needs `annotations` + `outputSchema` + JSON Schema; cron needs to call `execute` with no LLM involved at all; and the SDK's `contextSchema`/`toolsContext` is a chat-only mechanism that would force a different `execute` signature per surface. One descriptor plus three thin adapters gives **one authorization point**, one place to add a tool, and insulation from both the AI SDK's rename churn and the MCP transport rewrite landing on 2026-07-28.

**`outputSchema` is mandatory, not optional.** MCP's `structuredContent` needs it, the chat's typed `part.output` needs it, and the eval harness needs it. Retro-fitting output schemas onto a dozen tools later is a day of tedium.

**MCP annotations are UX, not authorization.** The spec says clients *"MUST consider tool annotations to be untrusted."* `readOnlyHint: true` on everything is a courtesy to the client; the enforcement is `requiredScope` + `buildToolset`, because anyone can point `curl` at the endpoint with a valid token.

#### Phase 0 tool set (all read-only)

| Tool | Scope | Backed by |
|---|---|---|
| `portfolio.structure` | `portfolio:read` | `getCachedStructure` |
| `portfolio.performance` | `portfolio:read` | `getCachedFullSeries` |
| `transactions.search` | `transactions:read` | extracted service (§5.5) |
| `watchlist.list` | `watchlist:read` | extracted service |
| `market.priceHistory` | `watchlist:read` | `src/server/influx.ts` |
| `goals.list` | `goals:read` | extracted service |
| `fx.rates` | `fx:read` | `src/server/fx.ts` |

`market.priceHistory` is scoped `watchlist:read` rather than getting a scope of its own: it serves market data the user can already reach through the watchlist, and inventing a `market` scope would fork the `PERMISSION_SCOPES` vocabulary for no authorization benefit.

**Two distinct scope vocabularies — do not conflate them:**

- **`Scope`** (`portfolio:read`, `transactions:read`, …) is a *resource* permission. It answers *"may this caller read this data?"* It is what `AppTool.requiredScope` declares and what `buildToolset` filters on. It reuses the existing `PERMISSION_SCOPES` values verbatim, so MCP bearer auth and tRPC authorization share one vocabulary.
- **`ai`** is a *capability* permission, added to `PERMISSION_SCOPES` for `ApiKey.permissions` only. It answers *"may this key spend platform LLM quota?"* It is **not** an `AppTool.requiredScope` and never appears in the `Scope` type — a key can hold every read scope and still be barred from costing you money.

### 5.5 Targeted service extraction

`portfolio.ts` is already a thin 113-line router delegating to `portfolio-compute.ts`. `transactions.ts` (1,028 lines) and `watchlist.ts` (430) are not — their logic lives inline in the procedures, where a tool cannot reach it.

**Extract only what the tool layer needs**, into `src/server/services/*`, and have the routers call the same functions:

- `services/transactions.ts` → `listTransactions(userId, filters)`
- `services/watchlist.ts` → `listWatchlist(userId)`
- `services/goals.ts` → `listGoals(userId)`

Every service takes `userId` as its first argument. The routers get thinner as a side effect. This is not a licence to refactor all 1,028 lines — only the paths the AI layer actually touches.

### 5.6 Telemetry

**`AsyncLocalStorage` is the correlation spine.** The middleware sees a provider call and does not know which user it belongs to; whether the SDK's `includeRuntimeContext` surfaces `userId` on `onLanguageModelCallEnd` is unverified. ALS is independent of SDK internals and behaves identically across chat, MCP, and cron.

The ledger is an `ai` v7 `Telemetry` integration, registered exactly once in `src/instrumentation.ts` (guarded by a `globalThis` symbol — `registerTelemetry` pushes onto a global array, and double registration means double-written rows).

Three things the API will not forgive:

- **`onError` is load-bearing.** `onLanguageModelCallEnd` fires **only on success**. Without an `onError` hook, every failed provider call is invisible — including Azure content-filter 400s, **which you are billed for**. `CONTENT_FILTERED` is a first-class outcome.
- **For Azure, `e.modelId` is the deployment name.** Price on `resolvedModel` from ALS, never on `modelId`, or every Azure cost silently matches nothing in the catalogue.
- **`onToolExecutionEnd`: discriminate on `e.toolOutput.type`.** The SDK's own JSDoc says to check `event.success`. There is no such field. Following the inline docs produces code that does not compile.

**Privacy — mandatory, and *not* the default.** v7 telemetry is opt-**out**, and `recordInputs` / `recordOutputs` **default to `true`**. Register the ledger naively and every prompt — which contains the user's positions and transactions — is written to the sink. Every call site must pass:

```ts
telemetry: { functionId: 'chat.turn', recordInputs: false, recordOutputs: false }
```

A Tier-0 test fails the build if any call site omits it. Full message bodies are opt-in per user, TTL'd, and stored separately.

**Cost.** The SDK never computes money — it gives you provider, model, and token buckets. We vendor a `models.dev` snapshot (MIT, includes Azure, commits daily; **USD per *million* tokens** — LiteLLM's JSON is per *token*, and mixing them is a 1e6 error). `AiCall.priceSnapshotId` records which snapshot priced each row, so re-pricing history is reproducible. No `ModelPrice` table: prices are a build-time constant, and a table buys a migration, a seeding job, and a hot-path read for nothing. A weekly CI job re-fetches the catalogue and opens a PR on diff.

`costNanoUsd` is a `BigInt` because `gpt-5.4-nano` input is $0.20/1M = 0.2 **micro**-USD per token — micro-USD integers truncate to zero and silently under-bill. superjson already serialises BigInt in this repo.

### 5.7 Quota

Reserve-then-reconcile, atomic in Postgres. The app runs multiple replicas, so **an in-memory counter is a bypass, not an optimisation.**

```sql
UPDATE "AiQuota" SET "reservedNanoUsd" = "reservedNanoUsd" + $ceiling
 WHERE "userId" = $userId
   AND "spentNanoUsd" + "reservedNanoUsd" + $ceiling <= "limitNanoUsd"
RETURNING *
```

Zero rows returned ⇒ 429. On completion, `settle()` adds the actual cost to `spentNanoUsd` and releases the ceiling from `reservedNanoUsd`.

- **Reserve the ceiling, not a guess:** `estimatedInputTokens + maxOutputTokens`. The classic failure is "reserve 1K output tokens, model returns 8K." `maxOutputTokens` is *forced* by the guardrail middleware, so the ceiling is never unbounded.
- Multi-step tool loops multiply this. Cap steps (`stopWhen: isStepCount(8)`), total turn tokens, and per-user concurrency.
- **BYOK skips reserve/settle entirely** but still writes an `AiCall` row with `billedTo: USER` and a notional cost — BYOK users get a spend view too.
- A cron sweeper releases reservations older than 10 minutes, orphaned by a crashed process.

### 5.8 Guardrails

There is **no general fix for prompt injection**. The current best primary source (Beurer-Kellner et al., arXiv 2506.08837) puts it plainly: *once an agent has ingested untrusted input, it must be constrained so that it is impossible for that input to trigger any consequential action.* The mitigation is architectural capability minimisation, not prompt hardening.

**Layer 1 — capability minimisation. This is the real control.** Phase 0's entire tool surface is read-only and closed over `ctx.userId`. **There is no consequential action for an injection to trigger.** This one decision removes the whole class.

**Layer 2 — middleware.** Attached to the registry (and to BYOK models via `wrapLanguageModel` — the same object). Forces `maxOutputTokens`; strips the params Azure's reasoning models reject; scrubs outputs.

**Layer 3 — untrusted content handling.** The attack surface is not what people expect. **Symbol names** (Yahoo search results land in context verbatim) and **`Transaction.note`** free text are attacker-influenceable long before any news article is. Deliver them as **structured tool results**, never interpolated into the system prompt. Do **not** use a `<untrusted_data>…</untrusted_data>` text fence — `JSON.stringify` leaves `<`, `/`, `>` literal, so a payload containing the closing delimiter escapes it. Strip control, zero-width, and bidi characters (OWASP LLM01: *"injections do not need to be human-visible"*); hard-cap length.

**Layer 4 — disclosure and the advice boundary.**
- **EU AI Act Art. 50(1) applies from 2026-08-02.** Any AI system interacting directly with a person must disclose that it is an AI. A persistent, visible "AI assistant" label on the chat surface and in the MCP server description satisfies it.
- **MiFID II: "investment advice" means a *personal recommendation*.** ESMA's supervisory briefing (ESMA35-43-3861) is explicit that recommendations can be implicit or indirect. *"Your NVDA position is 31% of your portfolio"* is safe factual reporting. *"You're overweight tech — trim NVDA"* is a personal recommendation. The system prompt refuses the latter; the boundary is **eval-tested** (Tier 1).

### 5.9 Evals and CI

**Runner: `bun test`.** Not evalite — its `main` hasn't moved since 2025-11-10 and v1 has been stuck in beta since February; do not gate a deploy on it. Not promptfoo either, for now — its trajectory assertions key off legacy OpenTelemetry span attributes we would otherwise have no reason to emit.

| Tier | What | When | Cost | Gates a merge? |
|---|---|---|---|---|
| **0 — hermetic** | `MockLanguageModelV4` + `simulateReadableStream` from `ai/test`. Asserts: guardrails strip rejected params and force `maxOutputTokens`; telemetry writes exactly one `AiCall` per model call **and one on `onError`**; quota reserve→settle arithmetic; `Secret` cannot be serialised; **tool authorization — user B's `ToolCtx` returns only B's data**; every `inputSchema` is strict and free of `userId`; emitted JSON Schema satisfies Azure's structured-output subset; no call site omits `recordInputs: false`. | every PR | $0 | ✅ **yes** |
| **1 — golden set** | ~20 tool-selection cases. Tools declared **without `execute`** make `generateText` halt with `finishReason: 'tool-calls'` and populate `result.toolCalls` — the hermetic tool-selection primitive. Assert tool name + args subset, and that `dynamicToolCalls.filter(c => c.invalid)` is empty (hallucinated tool names are directly detectable). Plus negative cases ("who are you?" → zero tool calls), the **injection suite**, and the **advice-boundary suite**. | nightly, pre-release | ~$0.05/run | ⚠️ alerts only |
| **2 — LLM-as-judge** | **Binary pass/fail** against an explicit rubric — never a 1–5 scale, which clusters on 3–4 and drifts. Judge pinned to a dated snapshot. Reason-before-label. | nightly | ~$0.20/run | ❌ directional |

**The eval suite cannot use `temperature: 0` + `seed`.** Every eval example on the internet does; all Azure GPT-5.x models **400 on both**. Determinism comes from asserting on *tool selection* (robust) rather than prose, pinning `reasoning_effort`, and best-of-3 for any case that proves flaky. This is precisely why the merge gate is Tier-0 only.

**CI change:** add a `unit` job (`bun test src`) to the `all-checks` fan-in. It picks up the new Tier-0 evals **and** the five existing test files that have never gated a merge.

---

## 6. Environment

```sh
# Platform provider (Azure OpenAI)
AZURE_OPENAI_RESOURCE_NAME=      # NOT the full URL
AZURE_OPENAI_API_KEY=
AZURE_OPENAI_CHAT_DEPLOYMENT=    # the deployment name — this is the SDK "model id"
AZURE_OPENAI_CHAT_MODEL=         # the real model, e.g. gpt-5.4-mini — this is what we PRICE on

# BYOK credential encryption
AI_CRED_KEYS=                    # {"k1":"<base64 32 bytes>"}  — openssl rand -base64 32
AI_CRED_ACTIVE_KID=k1

# API key verification (Phase 2 prerequisite)
AI_API_KEY_PEPPER=
```

Each needs an entry in **both** the `server` schema and the `runtimeEnv` block of `src/env.js`, plus `.env.example`.

---

## 7. Decisions

| # | Decision | Rationale |
|---|---|---|
| 1 | `ai@7`, not v6 | v7's `Telemetry` interface makes the Postgres ledger a supported extension point rather than a middleware hack. |
| 2 | Chat over a **Route Handler**, not tRPC | `DefaultChatTransport` expects a raw SSE `Response` carrying `UIMessageChunk` frames; tRPC owns its envelope and this repo layers superjson on top. A procedure physically cannot emit those bytes. |
| 3 | Generative UI via **tool parts + a client-side switch**, not `@ai-sdk/rsc` | We stream tool JSON and render ordinary Recharts client components keyed on `part.type`. The RSC path fights the MCP tool-reuse goal. |
| 4 | **Do not run the AI Elements CLI**; take `streamdown` only | Its 24 shadcn `registryDependencies` all exist here as Base UI components — the CLI would overwrite them with Radix. |
| 5 | **Our own `AppTool` descriptor**, not the SDK's `tool()` | One authorization point across chat/MCP/cron; insulation from SDK renames and the MCP transport rewrite. |
| 6 | MCP: raw `@modelcontextprotocol/sdk`, not `mcp-handler` | `mcp-handler` peer-pins the SDK to the exact string `"1.26.0"` **and hard-depends on `redis`** — which we deliberately removed in #78. |
| 7 | MCP auth: **bearer API key**, OAuth deferred | Claude Code and Cursor work with a plain bearer key today. **Do not serve `/.well-known/oauth-protected-resource`** — it makes both clients abandon configured headers and force OAuth. |
| 8 | `keyHmac` + `timingSafeEqual` on `ApiKey` | The bcrypt-compare loop is a CPU-exhaustion DoS on a hot endpoint, and bcrypt buys nothing for a high-entropy secret. |
| 9 | **Read-only on every surface in Phase 0** | Deletes the destructive-confirmation-over-untrusted-client problem entirely — which is exactly what the MCP spec is rewriting in 15 days. Phase 3 adds writes additively. |
| 10 | `bun test` for evals | Already present; evalite is stalled; promptfoo needs legacy OTel spans. |
| 11 | Vendored `models.dev` snapshot, no `ModelPrice` table | Prices are a build-time constant. `llm-cost` is dead (2024); `tokenlens` is stale. |
| 12 | `costNanoUsd BigInt` | Micro-USD truncates `gpt-5.4-nano` pricing to zero. |
| 13 | `AsyncLocalStorage`, not `runtimeContext` | Middleware doesn't know the user; ALS is SDK-independent and identical across all three surfaces. |
| 14 | **Swap Postgres to `pgvector/pgvector:0.8.5-pg16` now** | See §9.3. Pin ≥0.8.5 — CVE-2026-3172 in <0.8.2, HNSW vacuum corruption in <0.8.4. |
| 15 | Default `gpt-5.4-mini` | `gpt-5.5` has 0 TPM below tier 5; `gpt-5.6-*` is preview and unpriced. |

---

## 8. Risks

**R1 — `ai@7` on Bun 1.3 + Next 16 Turbopack + React Compiler is untested.** ESM-only, `engines: node >=22`. Bun claims Node compatibility and the repo is already `"type": "module"`, but nobody has run this combination.
→ **This is task one.** A one-day spike (`generateText` against Azure from a Route Handler, under `next dev --turbo` *and* in the Docker image) gates everything else. If it fails, the dependency plan changes.

**R2 — Telemetry defaults exfiltrate user portfolios on day one.** Opt-out, and `recordInputs`/`recordOutputs` default to `true`.
→ Explicit `recordInputs: false, recordOutputs: false`, enforced by a Tier-0 test.

**R3 — Silent under-billing, four independent ways.** `result.usage` flipped meaning in v7 (a copied v6 snippet under-bills every multi-step turn); every token leaf is `number | undefined`, so naive arithmetic yields 0; `cacheReadTokens` is ~10× cheaper and needs separate pricing; and for Azure, `modelId` is the deployment name.
→ `resolvedModel` column; `pricingStatus: UNKNOWN_MODEL` with `costNanoUsd: null` (**never 0**) plus an alert; Tier-0 tests for all four.

**R4 — Failed calls are invisible and still billed.**
→ `onError` alongside `onLanguageModelCallEnd`; `CONTENT_FILTERED` as a first-class outcome.

**R5 — The MCP spec changes in 15 days.** 2026-07-28 removes the `initialize` handshake and session IDs and replaces elicitation. The TS SDK has not shipped support.
→ Keep the transport a thin seam behind the `AppTool` adapter; ship MCP behind a feature flag. Phase 0's read-only decision means we depend on **none** of the changing surfaces.

**R6 — Injection arrives via a symbol name or a transaction note**, not a news article.
→ Read-only tools (layer 1) + structured tool results, not text fences + control-character stripping + a Tier-1 injection suite.

**R7 — Eval determinism is impossible the way everyone writes it.** Azure GPT-5.x 400 on `temperature` *and* `seed`.
→ Assert on tool selection; pin `reasoning_effort`; keep the merge gate hermetic.

**R8 — Secrets leak through error objects, not logs.** Provider SDK errors embed the request config, including the auth header. `JSON.stringify(err)` into telemetry leaks a BYOK key.
→ The `Secret` branded type; explicit field-picking in `safeErrorMessage`; a Tier-0 test asserting `Secret` cannot be serialised.

**R9 — The Postgres image swap corrupts text indexes** (musl → glibc collation change on a live PGDATA).
→ Do it now, while the data is small. `REINDEX DATABASE` immediately after. Do not bundle a PG major bump into the same change.

**R10 — Multi-instance quota bypass.**
→ The atomic conditional `UPDATE`. Plus the orphan-reservation sweeper.

---

## 9. Decisions that are expensive to reverse

### 9.1 The BYOK credential shape

Reversing it means re-encrypting every row, which requires the old key to still exist. `kid`, `authTag`, a fresh random `iv`, the `(userId, provider)` AAD, and **multi-field provider config** must all be right on day one. **A single `apiKey TEXT` column cannot model Azure** and would have to be blown up later.

### 9.2 The telemetry table

`resolvedModel` separate from `modelId` (without both, every Azure cost figure is retroactively unrecoverable). `costNanoUsd BigInt?` + `pricingStatus` (a `0` fallback on an unknown model means the platform silently eats the bill). `billedTo` (retro-fitting it means *guessing* which historical rows were BYOK). `requestId` on both tables (tools execute *between* model calls, so a foreign key to `AiCall.id` cannot work). `outputTokens` nullable (embeddings have no output count — a `NOT NULL` here blocks Phase 6).

### 9.3 The Postgres image

**Swap to `pgvector/pgvector:0.8.5-pg16` in Phase 0, `CREATE EXTENSION vector`, `REINDEX DATABASE`, and add no vector columns.** pgvector ships **no alpine image**. Doing the swap later, on a populated database, changes the libc collation provider from musl to glibc and **silently corrupts btree indexes on text columns**. Ten minutes now; a data-integrity incident in Phase 6.

Two Phase-6 decisions this forces, pre-committed here:
- **Embeddings are always platform-funded and platform-keyed. BYOK is chat-only.** If BYOK users supplied embedding credentials, different users would produce different models and dimensions, and a shared corpus could not have one fixed-width column.
- **Dimension is 1536.** `text-embedding-3-large` at its native 3072 **cannot be HNSW-indexed** (2,000-dim ceiling).

### 9.4 The tool interface

`userId` never in an `inputSchema`. `mutates` / `preview` / `requiredScope` / `annotations` present in the type from day one even though Phase 0 sets `mutates: false` everywhere — adding them later means touching every tool. `outputSchema` mandatory.

**The confirmation seam is designed but not built.** When Phase 3 adds writes, a mutating tool returns `PendingMutation { confirmationToken, preview, requiresConfirmation }` — an HMAC over `{userId, tool, argsHash, jti, exp: 120s}` — and the actual write happens in an ordinary authenticated tRPC mutation. **Stateless by design**, because the MCP protocol is going stateless and MCP clients cannot be trusted to render a confirmation dialog.

---

## 10. Build order

0. **Spike: `ai@7` on Bun 1.3 + Next 16 + Turbopack + Docker.** `generateText` against Azure from a Route Handler. **Gates everything.**
1. Azure resource + `gpt-5.4-mini` deployment; env plumbing through `src/env.js` and `.env.example`.
2. Postgres image swap + `CREATE EXTENSION vector` + `REINDEX`. No vector columns.
3. `crypto.ts` (seal/open, `Secret`) + Tier-0 tests. **Smoke-test `setAAD`/`getAuthTag` under Bun** — a silent AAD no-op would void the tenant binding.
4. Prisma schema + migration.
5. `registry.ts`, `resolve-model.ts`, guardrail middleware.
6. `context.ts` (ALS), `telemetry.ts`, `pricing/`, `instrumentation.ts`.
7. `quota.ts` + the reservation sweeper job.
8. Service extraction (§5.5).
9. `tools/` — descriptor, registry, the seven read-only tools, the AI-SDK adapter.
10. Eval harness; add the `unit` job to CI.
11. BYOK settings UI + the save-time validation probe.
12. Admin dashboard: spend, latency, failures, tool-call frequency.

---

## 11. Done when

- The spike passes in both `next dev --turbo` and the production Docker image.
- A platform-key call and a BYOK call both succeed, both write exactly one `AiCall` row, and the BYOK row is `billedTo: USER` with no quota consumed.
- A user at their quota limit gets a 429 **from a second replica**, not just the one that reserved.
- A failed call and a content-filtered call both land in the ledger.
- A `Secret` cannot be coerced into a log line, a JSON body, or an error message.
- Tier-0 evals gate the merge, and CI runs the five previously-ungated unit test files.
- **User B's `ToolCtx` cannot read user A's data — asserted by a test, not by inspection.**
