# Phase 0 Technical Brief — AI Layer Foundation (invest-igator)

**Date:** 2026-07-13 · **Author:** lead eng · **Status:** decision-ready, feeds directly into the spec

---

## 0. Repo baseline (verified in-tree today, not from research)

| Fact | Value | Source |
|---|---|---|
| Runtime | **Bun 1.3** (`oven/bun:1.3-debian`); Node 24.18 locally | `Dockerfile`, `bun --version` |
| Module system | `"type": "module"` already | `package.json` |
| Prisma | `7.8.0`, generator `prisma-client` → `prisma/generated`, adapter `@prisma/adapter-pg` (`PrismaPg`) | `prisma/schema.prisma`, `src/server/db.ts` |
| **Datasource URL is NOT in schema.prisma** | lives in `prisma.config.ts` (Prisma 7 forbids `url` in schema) | `prisma.config.ts` |
| TS | `^6.0.3`, `strict` + **`noUncheckedIndexedAccess`** + `verbatimModuleSyntax` | `tsconfig.json` |
| zod | `^4.4.3` ✅ (AI SDK peer floor is 4.1.8) | `package.json` |
| UI | `@base-ui/react ^1.6.0`, **zero Radix** | `package.json` |
| Postgres | `postgres:16-alpine` (**musl**) | `docker-compose.yml` |
| Cron | Ofelia execs `bun run src/server/jobs/*.ts` **inside the app container** | `docker-compose.yml` labels |
| API keys | **bespoke**, NOT Better Auth's apiKey plugin. `hashApiKey = bcrypt.hashSync(key, 12)` (salted, non-deterministic). Lookup = `findMany({where:{start}})` (6-char prefix) + `bcrypt.compareSync` **loop**. Header = `x-api-key`. | `src/lib/api-keys.ts`, `src/server/api/trpc.ts:42-56` |
| Better Auth plugins | `openAPI, admin, magicLink, twoFactor, nextCookies` — **no apiKey, no mcp** | `src/lib/auth.ts` |
| Portfolio data | **No `Position` model.** Derived: `getCachedStructure(userId, currency, todayIso)` → `{items, totalValue}`, `getCachedFullSeries(...)` → `{full, unconvertedSymbols}` | `src/server/portfolio-compute.ts` |
| `Transaction` | `userId, date, symbol, side(BUY\|SELL), quantity, price, priceCurrency, fee, feeCurrency, note` — **no `accountId`**. (`Account` = Better Auth OAuth account.) | `prisma/schema.prisma:18` |
| Scopes | `PERMISSION_SCOPES` = account, admin, apiKeys, fx, goals, portfolio, transactions, watchlist × read/write/delete; stored as a JSON string on `ApiKey.permissions` | `src/lib/api-key-permissions.ts` |
| **CI does NOT run unit tests** | jobs = lint, typecheck, build, e2e, migration-check, all-checks. `bun test src` is defined in `package.json` but **never invoked in CI**. | `.github/workflows/ci.yml` |
| `src/instrumentation.ts` | **does not exist** | — |

---

## 1. LOCKED FACTS

Everything below is confirmed against shipped `.d.ts`/tarballs/primary docs by an adversarial pass. **Where a correction contradicted a first-pass claim, the correction is what's written here.**

### 1.1 AI SDK — `ai@7` (this is two majors past most training data)

```
ai                        7.0.22   (2026-07-10)   ESM-ONLY, engines: node >=22
@ai-sdk/react             4.0.23   (hard-pins ai@7.0.22 — never pin @ai-sdk/react@^7, it doesn't exist)
@ai-sdk/azure             4.0.11
@ai-sdk/openai            4.0.11
@ai-sdk/anthropic         4.0.12
@ai-sdk/google            4.0.12
@ai-sdk/openai-compatible 3.0.7
@ai-sdk/provider          4.0.3    (LanguageModelV4 spec)
@ai-sdk/provider-utils    5.0.7
@ai-sdk/otel              1.0.22   (OTel is NOT in `ai` any more)
@modelcontextprotocol/sdk 1.29.0   (no v2 published; dist-tags = {latest} only)
mcp-handler               1.1.0    (peer-pins MCP SDK to the EXACT string "1.26.0")
streamdown                2.5.0
zod peer range: ^3.25.76 || ^4.1.8   → repo's 4.4.3 is fine
```

**Renames that will silently bite (all old names still compile as deprecated aliases):**

| v5/v6 | v7 |
|---|---|
| `system:` | **`instructions:`** (`system` still works — deprecated fallback, `instructions` wins) |
| `maxSteps` | **gone since v5** (grep count = 0). Use `stopWhen: isStepCount(n)` |
| `stepCountIs(n)` | **`isStepCount(n)`** (`stepCountIs` = deprecated re-export alias) |
| `parameters:` on `tool()` | **`inputSchema:`** |
| `experimental_telemetry` | **`telemetry`**; type is **`TelemetryOptions`**, not `TelemetrySettings` |
| `onFinish` / `onStepFinish` | **`onEnd`** / **`onStepEnd`** — ⚠️ *server-side `UIMessageStreamOptions` only*. **Client `useChat`/`ChatInit.onFinish` is live and there is NO `onEnd` there.** |
| `result.fullStream` | **`result.stream`** — ⚠️ *`StreamTextResult` only*. `StreamObjectResult.fullStream` is NOT renamed. Do not find-and-replace. |
| `needsApproval` on `tool()` | **`toolApproval`** on `generateText`/`streamText`/`ToolLoopAgent` |
| `usage.cachedInputTokens` / `usage.reasoningTokens` | **removed** → `usage.inputTokenDetails.cacheReadTokens` / `usage.outputTokenDetails.reasoningTokens` |
| `result.totalUsage` | **`result.usage`** now means *all steps* (bill on this). `result.finalStep.usage` = final step only. |
| `toDataStreamResponse` | **does not exist** (0 occurrences). v4 relic. |
| `result.toUIMessageStreamResponse()` | **deprecated** → `createUIMessageStreamResponse({ stream: toUIMessageStream({ stream: result.stream, ... }) })` |

**Exact `LanguageModelUsage` (required keys typed `| undefined` — NOT optional `?` keys):**

```ts
type LanguageModelUsage = {
  inputTokens: number | undefined;
  inputTokenDetails: {              // REQUIRED object — you cannot omit it in a mock/fixture
    noCacheTokens: number | undefined;
    cacheReadTokens: number | undefined;
    cacheWriteTokens: number | undefined;
  };
  outputTokens: number | undefined;
  outputTokenDetails: {             // REQUIRED object
    textTokens: number | undefined;
    reasoningTokens: number | undefined;
  };
  totalTokens: number | undefined;
  raw?: JSONObject;                 // the ONLY genuinely optional key
};
```
Under `strict`, any test mock or DB→usage mapper written against a `?`-optional shape **will not typecheck.**

**`Telemetry` interface (exported from `ai`) — full hook list:**
`onStart, onStepStart, onLanguageModelCallStart, onLanguageModelCallEnd, onToolExecutionStart, onToolExecutionEnd, onStepEnd, onEnd, onAbort, ` **`onError`** `, onEmbedStart, onEmbedEnd, onRerankStart, onRerankEnd, executeLanguageModelCall, executeTool` + deprecated `onStepFinish`, `onObjectStepStart`, `onObjectStepEnd`.
**`onError` is load-bearing:** `onLanguageModelCallEnd` fires only on success. Without `onError`, every failed provider call is invisible to the ledger — including Azure content-filter 400s, **which you are still billed for**.

**Telemetry event shape (the #1 thing a v5-trained model gets wrong):**
```ts
// callbacks receive InferTelemetryEvent<E> = E & Omit<TelemetryOptions, 'integrations'|'isEnabled'|'includeRuntimeContext'>
// => functionId is FLATTENED onto the event.
onLanguageModelCallEnd(e) {
  e.provider          // ✅  (ModelInfo is spread onto the event)
  e.modelId           // ✅  — for AZURE this is the DEPLOYMENT NAME, not the model
  e.functionId        // ✅   NOT e.telemetry.functionId  (no `telemetry` prop exists)
  e.callId            // ✅  — identifies the GENERATION CALL, not the model invocation.
                      //     Reused across steps in a tool loop. Do NOT key a latency Map on it.
  e.finishReason
  e.usage             // non-optional
  e.responseId        //     NOT e.response.modelId — there is no `response` object on the event
  e.performance.responseTimeMs   // ✅ use this for latency; don't hand-roll a timer
}
```

- `registerTelemetry(...integrations: Telemetry[])` — **global**. Telemetry is **opt-OUT**: once *any* integration is registered, every call emits, and **`recordInputs`/`recordOutputs` default to `true`** — i.e. full prompts (containing the user's positions) get shipped to your sink unless you explicitly disable them.
- `TelemetryOptions = { isEnabled?, recordInputs?, recordOutputs?, functionId?, includeRuntimeContext?, includeToolsContext?, integrations? }`. **No `tracer`, no `metadata`.** (`tracer` moved to `new OpenTelemetry({ tracer })` in `@ai-sdk/otel`.)
- **The SDK never computes cost.** It gives you provider + modelId + token buckets. Money is ours.

**Middleware:**
```ts
import { wrapLanguageModel, type LanguageModelMiddleware } from 'ai';   // ← from 'ai', NEVER '@ai-sdk/provider'
// (@ai-sdk/provider's LanguageModelV4Middleware requires `specificationVersion: 'v4'`;
//  `ai` re-exports a relaxed alias where it's optional. Importing the wrong one won't compile.)
// hooks: transformParams({ type, params, model })
//        wrapGenerate({ doGenerate, doStream, params, model })
//        wrapStream   ({ doGenerate, doStream, params, model })
// array order: [a, b] => a(b(model))
```
`createProviderRegistry(providers, { separator?, languageModelMiddleware?, imageModelMiddleware? })` — **`languageModelMiddleware` applies to every model resolved through the registry.** This is the platform-wide choke point.

**Tools:**
```ts
tool({ description, inputSchema, outputSchema?, contextSchema?, execute, toModelOutput?, strict? })
// execute(input, { toolCallId, messages, abortSignal?, context, experimental_sandbox? })
```
- Per-tool typed context: `contextSchema` on the tool + `toolsContext: { toolName: {...} }` at the call site. `runtimeContext` is shared and **tools cannot read it**.
- Helper types: **`InferToolContext` / `InferToolSetContext` are exported from `@ai-sdk/provider-utils`, NOT from `ai`.** `ToolContextFor` and `ToolsContextParameter` are **exported from neither** — internal only. Do not reference them.
- Tool call objects use **`input`, not `args`**. `DynamicToolCall` carries `dynamic: true` + `invalid?: boolean` → **hallucinated tool names are directly detectable.**
- Tools declared **without** `execute` cause `generateText` to halt with `finishReason: 'tool-calls'` and populate `result.toolCalls`. **This is the hermetic tool-selection eval primitive.**

**Async trap:** `convertToModelMessages` is **`async`** in v7 (`Promise<ModelMessage[]>`). Every v5/v6 example on the internet has it synchronous. Without `await` the route handler does not compile.
**Await trap:** `StreamTextResult.usage` and `.finalStep` are `PromiseLike<...>`. `GenerateTextResult.finalStep` is not.

**`useChat` (v7) — no `input`/`handleInputChange`/`handleSubmit`/`append`/`reload`.** Returns exactly: `id, messages, setMessages, error, clearError, status, sendMessage, regenerate, stop, resumeStream, addToolResult, addToolOutput, addToolApprovalResponse`. Config moved to `transport: new DefaultChatTransport({ api })`. `ChatStatus = 'submitted'|'streaming'|'ready'|'error'`. `UIMessage` has **no `content`** — only `parts`.
**Tool parts have SEVEN states**, not three: `input-streaming | input-available | approval-requested | approval-responded | output-available | output-denied | output-error`. `output` is only narrowed present on `output-available`.

### 1.2 Azure OpenAI (`@ai-sdk/azure@4.0.11`)

```ts
createAzure({ resourceName?, baseURL?, apiKey?, tokenProvider?, headers?, fetch?, apiVersion?, useDeploymentBasedUrls? })
azure('my-deployment')  // ← the DEPLOYMENT NAME is the model id. Defaults to the Responses API.
```
- `apiVersion` **defaults to the literal string `'v1'`** (not a date). The shipped JSDoc says `'preview'` — stale; the code wins.
- **URL building:** `baseUrlPrefix = baseURL ?? https://{resourceName}.openai.azure.com/openai`, then the SDK appends **`/v1{path}` itself**. ⚠️ **Passing `baseURL: '.../openai/v1'` yields `/openai/v1/v1/responses` → 404.**
- `apiKey` **XOR** `tokenProvider` — passing both throws `InvalidArgumentError` at construction.
- Env fallback is **lazy** (inside `getHeaders()`/`getResourceName()` closures) → BYOK instances work on a server with **zero Azure env vars set**.
- Per-request `createAzure()` is effectively free: no vendor SDK, no client object, no socket pool. All HTTP goes through `options.fetch ?? globalThis.fetch` → the **global undici per-origin pool**. ⚠️ Never pass a custom `fetch` that constructs a new Agent/Dispatcher per instance.

**Platform (verified against Azure Retail Prices API + Microsoft Learn):**
- Azure OpenAI is **self-serve**. **There is no limited-access form for GPT-5.x or o-series any more** — the availability table now reads *"Access is no longer restricted for this model"* for gpt-5, gpt-5-pro, gpt-5-codex, gpt-5.1…5.4, o3, o4-mini. **The real gate is quota tiers, not registration.**
- **`gpt-5.5` has 0 RPM / 0 TPM at Tiers 1–4.** Do not default to it.
- **`gpt-5.6-sol/terra/luna`: Preview, zero published prices.** Do not put in the cost model.
- Tier-1 Global Standard: `gpt-5.4` 10k RPM / 1M TPM · `gpt-5.4-mini` 1k / 1M · `gpt-5.4-nano` 5k / 5M · `gpt-4.1-mini` 5k / 5M · `text-embedding-3-small` 1M TPM.
- Prices, USD per 1M tokens, Global Standard: `gpt-5.4` **2.50 / 15.00** (cache-read 0.25) · `gpt-5.4-mini` **0.75 / 4.50** (cache 0.075) · `gpt-5.4-nano` **0.20 / 1.25** · `gpt-5.1` **1.25 / 10.00** · `gpt-4.1-mini` **0.40 / 1.60** · `text-embedding-3-small` **0.02** · `text-embedding-3-large` **0.13**.
- **All GPT-5.x are reasoning models: they 400 on `temperature`, `top_p`, `presence_penalty`, `frequency_penalty`, `logprobs`, `top_logprobs`, `logit_bias`, `max_tokens`.** Use `max_completion_tokens`/`max_output_tokens`. **Always pass `reasoning_effort` explicitly** — per-model defaults for 5.4/5.5/5.6 are undocumented.
- **Content filter returns HTTP 400 `code: content_filter` and you are still billed.**
- **Assistants API sunsets 2026-08-26** (6 weeks). `azure-ai-inference` already retired 2026-05-30. The AI SDK's Azure provider defaults to Responses — we're on the right side of this.
- Structured Outputs JSON-Schema subset: every object needs `additionalProperties: false`, **every property must be in `required`** (model optionality as `type: ["string","null"]`), max 100 props / 5 nesting levels; `minLength`/`pattern`/`format`/`minimum`/`maximum`/`minItems` are **silently unsupported**.

### 1.3 MCP

- **Current final spec = `2025-11-25`.** The **`2026-07-28` revision publishes in 15 days** and is the biggest change since launch: removes the `initialize` handshake and `Mcp-Session-Id` (**protocol becomes stateless**), adds required `Mcp-Method`/`Mcp-Name` headers, lifts tool schemas to JSON Schema 2020-12, deprecates Roots/Sampling/Logging, changes resource-not-found `-32002` → `-32602`, and replaces elicitation with `InputRequiredResult` + opaque `requestState`.
- **Tool `annotations` (`readOnlyHint`, `destructiveHint`, `idempotentHint`, `openWorldHint`) are HINTS, NOT AUTHORIZATION.** Spec: *"clients **MUST** consider tool annotations to be untrusted unless they come from trusted servers."* Defaults are `readOnlyHint=false`, `destructiveHint=true`, `openWorldHint=true` — i.e. an unannotated tool is treated as a destructive open-world mutator.
- **Elicitation MUST NOT be used to collect secrets** (passwords, API keys, tokens). → **BYOK credentials can never be onboarded through MCP.** Web app only.
- Client reality: **Claude Code (`--header`) and Cursor (`headers` in `mcp.json`) work with a plain bearer key today.** Claude.ai/Desktop `static_headers` is **Beta and org-admin-shared (not per-user)**. ChatGPT: OpenAI *recommends* OAuth + CIMD (DCR supported) — a raw API key header is not a first-class path.
- ⚠️ **Serving `/.well-known/oauth-protected-resource` makes Cursor and Claude Code ignore configured headers and force OAuth.** Do **not** serve PRM while we're bearer-key-only.
- `@modelcontextprotocol/sdk` peers: `zod ^3.25 || ^4.0` (required); **`@cfworker/json-schema` is an OPTIONAL peer** (`peerDependenciesMeta.optional: true`) — do not install it. SDK **< 1.26.0 has a known security vuln**.
- `mcp-handler@1.1.0` peer-pins the SDK to the **exact string `"1.26.0"`** and **hard-depends on `redis ^4.6.0`** (the repo deliberately removed Redis in #78).
- **Name collision:** `withMcpAuth` is exported by *both* `mcp-handler` and `better-auth/plugins` with different signatures.
- Better Auth's apiKey plugin has **moved to a separate package** `@better-auth/api-key@1.6.23`. Its `mcp()` plugin is **explicitly marked for deprecation** in favour of the OAuth Provider plugin, and its docs still reference the renamed `@vercel/mcp-adapter` and the legacy `server.tool()` API. `@better-auth/mcp` on npm is an **unrelated dev tool** (auth setup diagnostics).

### 1.4 pgvector / Postgres

- pgvector **0.8.5** (2026-07-08) is current. **< 0.8.2 has CVE-2026-3172** (buffer overflow in parallel HNSW build → cross-relation data leak / server crash). < 0.8.4 has HNSW-vacuum index corruption.
- **`pgvector/pgvector` ships Debian images only. There is no alpine tag.** Our db is `postgres:16-alpine` (musl).
- Prisma has **no native vector type** (issue #26546 open; community PR #28429 closed unmerged Dec 2025). `Unsupported("vector(1536)")?` + raw SQL forever. **A *required* `Unsupported` field deletes `create`/`update`/`upsert` from the generated client** → the column must be nullable.
- HNSW/IVFFlat **cannot index above 2,000 dimensions**. `text-embedding-3-large` at native 3072 is **unindexable as `vector`** → either request `dimensions: 1536` or use `halfvec(3072)`.

### 1.5 Cost data

- **`https://models.dev/api.json`** — MIT, 162 providers, 5,235/5,650 models priced, includes `azure`, commits daily. Shape: `cost: { input, output, cache_read, cache_write }` in **USD per MILLION tokens**.
- LiteLLM's JSON is **USD per TOKEN** — mixing the two is a **1e6 error**.
- `llm-cost` (npm) is **dead** (last publish 2024-07-19). `tokenlens` library is stale (2025-10). Don't use either.

### 1.6 Regulatory

- **EU AI Act Art. 50(1) applies 2 Aug 2026 (three weeks).** Correctly stated: *providers of AI systems intended to interact directly with natural persons must inform the person they are interacting with an AI, at the latest at first interaction, unless that is obvious to a reasonably well-informed observer.* A persistent visible "AI assistant" label satisfies it. Penalty band is Art. 99(4) (€15M / 3%).
- **MiFID II "investment advice" = a *personal recommendation***. ESMA supervisory briefing **ESMA35-43-3861** (11 Jul 2023) says recommendations can be **implicit or indirect** and app content can be a personal recommendation. *"Your NVDA is 31% of your portfolio"* = safe factual reporting. *"You're overweight tech, trim NVDA"* = a personal recommendation. The refusal boundary must be explicit and eval-tested.

### 1.7 UNVERIFIED — confirm during implementation

1. **`ai@7` (ESM-only, Node≥22) under Bun 1.3 + Next 16.2 Turbopack + React Compiler.** Nobody tested this stack. **1-day spike, gates the whole spec.**
2. **`registerTelemetry()` firing exactly once under Bun + Next `instrumentation.ts`.** `registerTelemetry` pushes onto a `globalThis` array — double registration = double-written ledger rows. Guard with a `globalThis` symbol regardless.
3. Whether `telemetry.includeRuntimeContext: { userId: true }` actually surfaces `userId` on `onLanguageModelCallEnd` (vs only `onStart`/`onEnd`). **We route around this with AsyncLocalStorage — see §2.5 — so it is not a blocker.**
4. Whether `@ai-sdk/openai` (which `@ai-sdk/azure` wraps) already strips `temperature`/`top_p`/penalties for reasoning models. **Assume it does not; strip in `transformParams`.**
5. `@modelcontextprotocol/sdk`'s `StreamableHTTPServerTransport` wired into a Next 16 Route Handler under Bun (stateless mode). **No verified code sketch exists. 1-day spike.**
6. Azure prices for `text-embedding-3-small/large` — the retail API exposes no queryable meter; the $0.02/$0.13 figures are OpenAI list prices assumed to carry. **Confirm in the pricing calculator for our region.**
7. `node:crypto` `createCipheriv('aes-256-gcm')` + `setAAD`/`getAuthTag` under Bun 1.3. (Verified on Node 24; Bun implements `node:crypto` but **smoke-test it** — a silent AAD no-op would void the tenant binding.)
8. Azure **region** — not chosen. Gates embedding-model availability in Phase 1.
9. `@ai-sdk/mcp@2.0.10` is an MCP **client**. **No verified `tool()` → MCP-server bridge exists.** Our own adapter is the plan (§2.4), which sidesteps this.

---

## 2. RECOMMENDED ARCHITECTURE

### 2.0 Layout

```
src/server/ai/
  registry.ts          # platform provider registry (module scope) + guardrail middleware
  resolve-model.ts     # per-request model resolution: BYOK ?? platform
  context.ts           # AsyncLocalStorage<AiCallContext>  ← the correlation spine
  crypto.ts            # AES-256-GCM seal/open + Secret branded type
  telemetry.ts         # the Telemetry integration (ledger writer)
  quota.ts             # reserve / settle (Postgres-atomic)
  pricing/
    models.snapshot.json   # vendored from models.dev; git-versioned
    price.ts               # (provider, model, usage) -> nanoUSD
  prompts/
    portfolio-analyst.ts   # frozen, versioned, hashed
  tools/
    types.ts           # AppTool<I,O> descriptor  ← THE Phase 0 interface
    registry.ts        # ALL_TOOLS + buildToolset(ctx)
    portfolio.ts  transactions.ts  watchlist.ts  goals.ts  fx.ts
    adapters/
      ai-sdk.ts        # AppTool[] -> ToolSet   (chat)
      mcp.ts           # AppTool[] -> server.registerTool  (MCP)
                       # (cron just calls def.execute(input, ctx) directly)
  evals/
    tool-choice.eval.test.ts   injection.eval.test.ts   advice-boundary.eval.test.ts
src/app/api/chat/route.ts       # Route Handler (NOT tRPC)
src/app/api/[transport]/route.ts# MCP  (feature-flagged, read-only)
src/instrumentation.ts          # NEW — registerTelemetry once
```

### 2.1 Gateway + registry + per-request BYOK

**One platform registry at module scope, with the guardrail middleware attached at registry level — that's the choke point.** BYOK providers are built *per request* and hand-wrapped with the same middleware.

```ts
// src/server/ai/registry.ts
import { createAzure } from '@ai-sdk/azure';
import { createOpenAI } from '@ai-sdk/openai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createGoogle } from '@ai-sdk/google';               // ← v4 canonical name (createGoogleGenerativeAI = alias)
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { createProviderRegistry, wrapLanguageModel, type LanguageModel, type LanguageModelMiddleware } from 'ai';
import { env } from '@/env';

const REASONING_REJECTED = ['temperature','topP','topK','presencePenalty','frequencyPenalty','seed'] as const;

export const guardrails: LanguageModelMiddleware = {
  transformParams: async ({ params, model }) => {
    // 1. Hard ceiling — quota reservation is meaningless without it.
    const maxOutputTokens = Math.min(params.maxOutputTokens ?? 2048, 4096);
    // 2. Azure GPT-5.x are reasoning models: they 400 on these. Strip unconditionally.
    const stripped = { ...params, maxOutputTokens };
    for (const k of REASONING_REJECTED) delete (stripped as Record<string, unknown>)[k];
    return stripped;
  },
  wrapGenerate: async ({ doGenerate }) => scrubOutput(await doGenerate()),
  wrapStream:   async ({ doStream })   => doStream(),   // Phase 0: no stream-level rewriting
};

export const registry = createProviderRegistry(
  {
    azure: createAzure({
      resourceName: env.AZURE_OPENAI_RESOURCE_NAME,
      apiKey: env.AZURE_OPENAI_API_KEY,
      // apiVersion omitted → defaults to 'v1' (the GA versionless API). Do NOT pass a date.
    }),
  },
  { languageModelMiddleware: [guardrails] },   // ← applies to EVERY model from the registry
);

// PLATFORM default. Azure model id == deployment name.
export function platformModel() {
  return {
    model: registry.languageModel(`azure:${env.AZURE_OPENAI_CHAT_DEPLOYMENT}`),
    providerId: 'azure',
    modelId: env.AZURE_OPENAI_CHAT_DEPLOYMENT,   // what the SDK will report
    resolvedModel: env.AZURE_OPENAI_CHAT_MODEL,  // 'gpt-5.4-mini' — what we PRICE on
  };
}
```

```ts
// src/server/ai/resolve-model.ts
export async function resolveModel(userId: string): Promise<ResolvedModel> {
  const row = await db.aiProviderCredential.findFirst({ where: { userId, enabled: true } });
  if (!row) return { ...platformModel(), byok: false };

  const apiKey = open(row, userId, row.provider).expose();   // decrypt at call time; function-scoped
  const providerId = row.provider.toLowerCase();

  const p =
    row.provider === 'AZURE'
      ? createAzure({
          apiKey,
          // resourceName XOR baseURL. NEVER pass a baseURL ending in /v1 — the SDK appends /v1 itself.
          ...(row.baseURL ? { baseURL: row.baseURL } : { resourceName: row.resourceName! }),
          ...(row.apiVersion ? { apiVersion: row.apiVersion } : {}),
        })
      : row.provider === 'OPENAI'    ? createOpenAI({ apiKey })
      : row.provider === 'ANTHROPIC' ? createAnthropic({ apiKey })
      : row.provider === 'GOOGLE'    ? createGoogle({ apiKey })
      : createOpenAICompatible({ name: providerId, baseURL: row.baseURL!, apiKey });

  // Azure: the string passed to the provider is the DEPLOYMENT name.
  const modelId = row.provider === 'AZURE' ? row.deployment! : row.defaultModelId;

  return {
    model: wrapLanguageModel({ model: p.languageModel(modelId), middleware: [guardrails] }), // same guardrails
    providerId, modelId,
    resolvedModel: row.defaultModelId,   // the REAL model — this is what we price on
    byok: true,
  };
}
```

**Non-negotiable:** BYOK bypasses **platform quota only**. It must go through the *same* guardrail middleware and the *same* tool-authorization path. Keep the quota check and the guardrail/authz checks in separate code paths so a BYOK short-circuit can't skip both.

### 2.2 Credential encryption

**AES-256-GCM envelope, `node:crypto`, keyring-in-env with a `kid` column, AAD binding the row to `(userId, provider)`.**

```ts
// src/server/ai/crypto.ts
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

// LAZY. A module-eval throw here breaks `next build`/prerender when the env var is absent.
let keyring: Map<string, Buffer> | null = null;
function keys() {
  if (keyring) return keyring;
  const parsed = JSON.parse(env.AI_CRED_KEYS) as Record<string, string>;   // {"k1":"<base64 32B>"}
  keyring = new Map(Object.entries(parsed).map(([kid, b64]) => {
    const k = Buffer.from(b64, 'base64');
    if (k.length !== 32) throw new Error(`key ${kid} must be 32 bytes for AES-256`);
    return [kid, k];
  }));
  return keyring;
}

// AAD binds ciphertext to row identity: a row copied to another userId FAILS to decrypt.
const aad = (userId: string, provider: string) => Buffer.from(`${userId}|${provider}|v1`, 'utf8');

export function seal(plaintext: string, userId: string, provider: string) {
  const kid = env.AI_CRED_ACTIVE_KID;
  const iv = randomBytes(12);                                  // 96-bit nonce. FRESH EVERY CALL. Never derive it.
  const c = createCipheriv('aes-256-gcm', keys().get(kid)!, iv);
  c.setAAD(aad(userId, provider));
  const ciphertext = Buffer.concat([c.update(plaintext, 'utf8'), c.final()]);
  return { kid, iv, ciphertext, authTag: c.getAuthTag() };     // 16-byte tag MUST be persisted
}

export function open(row: Sealed, userId: string, provider: string): Secret {
  const key = keys().get(row.kid);
  if (!key) throw new Error(`retired key id: ${row.kid}`);     // fail loud, never guess
  const d = createDecipheriv('aes-256-gcm', key, row.iv);
  d.setAAD(aad(userId, provider));
  d.setAuthTag(row.authTag);                                    // MUST be before final()
  return new Secret(Buffer.concat([d.update(row.ciphertext), d.final()]).toString('utf8'));
}

/** Decrypted keys are hot secrets. This makes accidental serialisation impossible. */
export class Secret {
  constructor(private readonly v: string) {}
  expose() { return this.v; }
  toString() { return '[redacted]'; }
  toJSON()   { return '[redacted]'; }
  [Symbol.for('nodejs.util.inspect.custom')]() { return '[redacted]'; }
}
```

Rules: **only the secret is encrypted.** `resourceName` / `baseURL` / `deployment` / `apiVersion` are **configuration, not secrets** — plaintext columns, because we need them for validation and UI. `kid` from day one (rotation without downtime). Retired keys stay in the keyring as decrypt-only until backfill completes. Key gen: `openssl rand -base64 32`. Env: `AI_CRED_KEYS={"k1":"..."}`, `AI_CRED_ACTIVE_KID=k1`.

**Validate on save with a live 1-token probe.** Azure's multi-field config makes silent misconfiguration (wrong `resourceName`, wrong `deployment`) the default failure mode; catching it at save time instead of mid-chat is worth one request. Set `lastVerifiedAt`.

### 2.3 Prisma schema additions

> Prisma 7: no `url` in the datasource block (it's in `prisma.config.ts`); generator is `prisma-client`.

```prisma
enum AiProvider        { AZURE OPENAI ANTHROPIC GOOGLE OPENAI_COMPATIBLE }
enum AiSurface         { CHAT MCP CRON EVAL }
enum AiCallKind        { LANGUAGE_MODEL EMBEDDING }
enum AiBilledTo        { PLATFORM USER }
enum AiPricingStatus   { PRICED UNKNOWN_MODEL }
enum AiCallOutcome     { OK ERROR ABORTED CONTENT_FILTERED }

/// BYOK. Only the secret is encrypted; endpoint/deployment/version are config.
model AiProviderCredential {
  id             String     @id @default(cuid())
  userId         String
  user           User       @relation(fields: [userId], references: [id], onDelete: Cascade)
  provider       AiProvider

  // --- AES-256-GCM envelope ---
  kid            String     // keyring id -> which master key sealed this row (rotation)
  iv             Bytes      // 12 bytes, unique per encryption
  ciphertext     Bytes
  authTag        Bytes      // 16 bytes. Lose this and the row is undecryptable.

  // --- non-secret provider config ---
  resourceName   String?    // Azure: XOR baseURL
  baseURL        String?
  apiVersion     String?    // null => SDK default 'v1'. Do NOT store a date.
  deployment     String?    // AZURE ONLY: the string we pass as the SDK "model id"
  defaultModelId String     // the REAL model ('gpt-5.4-mini'). REQUIRED — this is what we price on.

  label          String?
  enabled        Boolean    @default(true)
  lastVerifiedAt DateTime?  // set by the 1-token probe at save time
  lastUsedAt     DateTime?
  createdAt      DateTime   @default(now())
  updatedAt      DateTime   @updatedAt

  @@unique([userId, provider])
  @@index([userId])
}

/// APPEND-ONLY per-provider-call ledger. One row per model call, NOT per turn.
model AiCall {
  id            String        @id @default(cuid())
  createdAt     DateTime      @default(now())

  userId        String?       // SetNull on user delete: keeps aggregate spend, drops PII linkage
  user          User?         @relation(fields: [userId], references: [id], onDelete: SetNull)
  surface       AiSurface
  functionId    String        // 'chat.turn' | 'mcp.tool' | 'cron.digest' | 'eval.<name>'
  requestId     String        // correlates every call+tool in one turn (from AsyncLocalStorage)
  chatId        String?

  kind          AiCallKind    @default(LANGUAGE_MODEL)
  provider      String        // as reported by the SDK
  modelId       String        // as reported by the SDK. For AZURE this is the DEPLOYMENT NAME.
  resolvedModel String        // the real model we priced on. NEVER price on modelId for Azure.
  callId        String?
  responseId    String?

  // --- AI SDK v7 LanguageModelUsage. Every leaf is nullable. ---
  inputTokens      Int?
  outputTokens     Int?
  totalTokens      Int?
  noCacheTokens    Int?
  cacheReadTokens  Int?
  cacheWriteTokens Int?
  textTokens       Int?
  reasoningTokens  Int?

  billedTo        AiBilledTo
  pricingStatus   AiPricingStatus @default(PRICED)
  costNanoUsd     BigInt?         // 1e-9 USD. null iff UNKNOWN_MODEL. NEVER default to 0.
  priceSnapshotId String          // git hash of models.snapshot.json -> reproducible re-pricing

  latencyMs     Int?              // e.performance.responseTimeMs
  finishReason  String?
  outcome       AiCallOutcome
  errorCode     String?
  errorMessage  String?           // SANITISED. Never JSON.stringify(err) — providers echo headers.

  systemPromptId      String?
  systemPromptVersion Int?
  systemPromptHash    String?     // build-time hash; git is the prompt version store

  @@index([userId, createdAt])
  @@index([requestId])
  @@index([createdAt])
  @@index([billedTo, createdAt])
}

/// Correlated by requestId, NOT by AiCall.id — tool execution happens BETWEEN model calls.
model AiToolCall {
  id           String    @id @default(cuid())
  createdAt    DateTime  @default(now())
  requestId    String
  userId       String?
  surface      AiSurface
  toolName     String
  toolCallId   String
  ok           Boolean
  durationMs   Int?
  inputHash    String?   // sha256 of canonicalised input — queryable without storing positions
  errorMessage String?   // sanitised
  @@index([requestId])
  @@index([userId, createdAt])
  @@index([toolName, createdAt])
}

/// Multi-instance safe. NEVER hold quota state in process memory (we run N replicas).
model AiQuota {
  userId          String   @id
  user            User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  tier            String   @default("free")
  periodStart     DateTime
  limitNanoUsd    BigInt
  spentNanoUsd    BigInt   @default(0)   // settled
  reservedNanoUsd BigInt   @default(0)   // in-flight ceilings
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
  @@index([createdAt])                    // sweeper for reservations orphaned by a crash
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
  id        String   @id            // the AI SDK message id (createIdGenerator)
  chatId    String
  chat      AiChat   @relation(fields: [chatId], references: [id], onDelete: Cascade)
  role      String
  parts     Json     // the whole UIMessage.parts array — onEnd hands us this wholesale
  metadata  Json?
  createdAt DateTime @default(now())
  @@index([chatId, createdAt])
}
```

**Also in Phase 0 — one small change to `ApiKey` that unblocks MCP:**

```prisma
model ApiKey {
  // ... existing fields ...
  keyHmac String? @unique   // HMAC-SHA256(key, AI_API_KEY_PEPPER). Deterministic -> O(1) lookup.
  @@index([keyHmac])
}
```
Rationale: today's path is `findMany({where:{start}})` (6-char prefix ⇒ multiple candidates) + a **`bcrypt.compareSync` loop at cost 12 (~100–300 ms CPU per candidate, synchronous, on the request thread)**. That is a trivial CPU-exhaustion DoS on a hot MCP endpoint. An API key is a 64-hex-char high-entropy secret, **not a password** — bcrypt buys nothing over a peppered HMAC. Add `keyHmac`, backfill lazily on next successful verify, verify with `timingSafeEqual`, then drop the bcrypt column in Phase 1.

### 2.4 The tool layer — **the single most important interface in Phase 0**

**One canonical descriptor. Three adapters. `userId` is never a tool input.**

```ts
// src/server/ai/tools/types.ts
import type { z } from 'zod';

export type Scope = `${'portfolio'|'transactions'|'watchlist'|'goals'|'fx'}:${'read'|'write'}`;

export interface ToolCtx {
  readonly userId: string;                  // from ctx.session — NEVER from model input
  readonly scopes: ReadonlySet<Scope>;
  readonly surface: 'chat' | 'mcp' | 'cron' | 'eval';
  readonly currency: string;                // the user's preferred currency
  readonly db: PrismaClient;
  readonly abortSignal?: AbortSignal;
}

export interface AppTool<I extends z.ZodType = z.ZodType, O extends z.ZodType = z.ZodType> {
  name: string;                             // 'portfolio.structure'
  description: string;
  inputSchema: I;                           // MUST be .strict() and MUST NOT contain userId
  outputSchema: O;                          // -> MCP structuredContent; -> typed part.output in chat
  requiredScope: Scope;

  /** Phase 0: every tool is `false`. The field exists NOW so Phase 1 writes are additive. */
  mutates: boolean;
  /** Required when mutates === true. Human-readable confirm text. Unused in Phase 0. */
  preview?: (input: z.infer<I>, ctx: ToolCtx) => Promise<string>;

  /** MCP hints. NOT authorization — authz is `requiredScope` + buildToolset. */
  annotations: { title: string; readOnlyHint: boolean; destructiveHint?: boolean;
                 idempotentHint?: boolean; openWorldHint: boolean };

  execute: (input: z.infer<I>, ctx: ToolCtx) => Promise<z.infer<O>>;
}
```

```ts
// src/server/ai/tools/portfolio.ts  — reuses the EXISTING compute layer, no new queries
import { z } from 'zod';
import { getCachedStructure } from '@/server/portfolio-compute';

const StructureIn  = z.strictObject({});                       // note: no accountId — single portfolio per user
const StructureOut = z.object({
  totalValue: z.number(),
  currency: z.string(),
  items: z.array(z.object({ symbol: z.string(), quantity: z.number(),
                            value: z.number(), weightPct: z.number() })),
});

export const portfolioStructure: AppTool<typeof StructureIn, typeof StructureOut> = {
  name: 'portfolio.structure',
  description: "The authenticated user's current holdings, with value and weight per symbol.",
  inputSchema: StructureIn,
  outputSchema: StructureOut,
  requiredScope: 'portfolio:read',
  mutates: false,
  annotations: { title: 'Portfolio holdings', readOnlyHint: true, openWorldHint: false },
  execute: async (_input, ctx) => {
    // userId comes from the closure. The model cannot name a userId — it isn't in the schema.
    const r = await getCachedStructure(ctx.userId, ctx.currency as Currency, todayIso());
    return { totalValue: r.totalValue, currency: ctx.currency,
             items: r.items.map(i => ({ symbol: i.symbol, quantity: i.quantity,
                                        value: i.value, weightPct: i.weight * 100 })) };
  },
};
```

```ts
// src/server/ai/tools/registry.ts
export function buildToolset(ctx: ToolCtx): AppTool[] {
  return ALL_TOOLS.filter((t) => {
    if (!ctx.scopes.has(t.requiredScope)) return false;
    if (t.mutates && ctx.surface === 'mcp') return false;    // Phase 0: MCP is READ-ONLY, full stop
    return true;
  });
}

// adapters/ai-sdk.ts  — chat
export function toAiSdkTools(defs: AppTool[], ctx: ToolCtx): ToolSet {
  return Object.fromEntries(defs.map((d) => [
    d.name.replace('.', '_'),                                 // tool names must be identifier-safe
    tool({
      description: d.description,
      inputSchema: d.inputSchema,                             // v7: inputSchema, NOT parameters
      outputSchema: d.outputSchema,
      execute: (input, opts) => d.execute(input, { ...ctx, abortSignal: opts.abortSignal }),
    }),
  ]));
}

// adapters/mcp.ts  — MCP
export function registerMcpTools(server: McpServer, defs: AppTool[], ctx: ToolCtx) {
  for (const d of defs) {
    server.registerTool(d.name,
      { title: d.annotations.title, description: d.description,
        inputSchema: d.inputSchema, outputSchema: d.outputSchema, annotations: d.annotations },
      async (input) => {
        const out = await d.execute(input, ctx);              // ctx from bearer-token auth, not tool args
        return { structuredContent: out,
                 content: [{ type: 'text', text: JSON.stringify(out) }] };  // back-compat text block
      });
  }
}

// cron: no adapter. `await portfolioStructure.execute({}, { userId, scopes: ALL, surface: 'cron', ... })`
```

**Why our own descriptor rather than `tool()` as the canonical form:** MCP needs `annotations` + `outputSchema` + JSON Schema; cron needs to call `execute` with no LLM at all; and `ai@7`'s `contextSchema`/`toolsContext` is a chat-only mechanism that would force a *different* execute signature per surface. One descriptor + three thin adapters gives one authorization point, one place to add a tool, and insulation from both the `ai@7→8` rename churn and the MCP 2026-07-28 transport rewrite. **We deliberately do NOT use `contextSchema`/`toolsContext`** — the closure over `ToolCtx` is uniform across all three surfaces and is the thing that makes `userId` unforgeable.

**Hard rules (these are the whole security model):**
- `userId` is **never** a field in any `inputSchema`. It only ever comes from `ctx`.
- Every input schema is `z.strictObject(...)` — unknown keys are rejected, not passed through.
- **The model never authors SQL, Flux, or a Prisma `where`.** A tool taking `filter: z.record(z.any())` and spreading it into Prisma is an instant cross-tenant read (`{ userId: { not: ctx.userId } }`).
- Tools call the **existing** `portfolio-compute` / router service functions. No new data access paths.

### 2.5 Telemetry

**AsyncLocalStorage is the correlation spine, not `runtimeContext`.** Middleware sees the provider call and does not know the user; the SDK's `includeRuntimeContext` surfacing on `onLanguageModelCallEnd` is UNVERIFIED. ALS is independent of SDK internals and works identically for chat, MCP and cron.

```ts
// src/server/ai/context.ts
export const aiContext = new AsyncLocalStorage<{
  requestId: string; userId: string | null; surface: AiSurface; functionId: string;
  chatId?: string; byok: boolean; resolvedModel: string; reservationId?: string;
  systemPrompt?: { id: string; version: number; hash: string };
}>();
```

```ts
// src/server/ai/telemetry.ts
import { registerTelemetry, type Telemetry } from 'ai';

const ledger: Telemetry = {
  async onLanguageModelCallEnd(e) {
    const c = aiContext.getStore();
    const u = e.usage;                                        // non-optional; every LEAF is nullable
    const priced = price(c?.resolvedModel ?? e.modelId, u);   // NEVER price on e.modelId for Azure
    await db.aiCall.create({ data: {
      userId: c?.userId ?? null, surface: c?.surface ?? 'CRON',
      functionId: e.functionId,                               // FLATTENED on the event. Not e.telemetry.*
      requestId: c?.requestId ?? e.callId, chatId: c?.chatId,
      provider: e.provider, modelId: e.modelId,               // Azure: this is the DEPLOYMENT name
      resolvedModel: c?.resolvedModel ?? e.modelId,
      callId: e.callId, responseId: e.responseId,
      inputTokens: u.inputTokens ?? null, outputTokens: u.outputTokens ?? null,
      totalTokens: u.totalTokens ?? null,
      noCacheTokens:    u.inputTokenDetails.noCacheTokens   ?? null,
      cacheReadTokens:  u.inputTokenDetails.cacheReadTokens ?? null,
      cacheWriteTokens: u.inputTokenDetails.cacheWriteTokens?? null,
      textTokens:      u.outputTokenDetails.textTokens      ?? null,
      reasoningTokens: u.outputTokenDetails.reasoningTokens ?? null,
      billedTo: c?.byok ? 'USER' : 'PLATFORM',
      pricingStatus: priced ? 'PRICED' : 'UNKNOWN_MODEL',
      costNanoUsd: priced?.nanoUsd ?? null,                   // null on unknown model. NEVER 0.
      priceSnapshotId: PRICE_SNAPSHOT_ID,
      latencyMs: Math.round(e.performance.responseTimeMs),    // don't hand-roll a timer; callId is per-turn
      finishReason: e.finishReason, outcome: 'OK',
      ...promptFields(c),
    }});
  },

  // ⚠️ WITHOUT THIS, EVERY FAILED CALL IS INVISIBLE — including Azure content-filter 400s,
  //    which Microsoft bills us for. onLanguageModelCallEnd fires ONLY on success.
  async onError(err) {
    const c = aiContext.getStore();
    await db.aiCall.create({ data: {
      userId: c?.userId ?? null, surface: c?.surface ?? 'CRON', functionId: c?.functionId ?? 'unknown',
      requestId: c?.requestId ?? crypto.randomUUID(),
      provider: 'unknown', modelId: 'unknown', resolvedModel: c?.resolvedModel ?? 'unknown',
      billedTo: c?.byok ? 'USER' : 'PLATFORM', priceSnapshotId: PRICE_SNAPSHOT_ID,
      outcome: isContentFilter(err) ? 'CONTENT_FILTERED' : 'ERROR',
      errorCode: safeErrorCode(err),
      errorMessage: safeErrorMessage(err),   // ← pick fields EXPLICITLY. Provider SDK errors embed
    }});                                     //   the request config incl. the api-key header.
  },

  async onToolExecutionStart(e) { toolStart.set(e.toolCallId, performance.now()); },
  async onToolExecutionEnd(e) {
    const c = aiContext.getStore();
    const t0 = toolStart.get(e.toolCallId); toolStart.delete(e.toolCallId);
    await db.aiToolCall.create({ data: {
      requestId: c?.requestId ?? 'unknown', userId: c?.userId ?? null, surface: c?.surface ?? 'CRON',
      toolName: e.toolCall.toolName, toolCallId: e.toolCallId,
      ok: e.toolOutput.type === 'tool-result',   // ← discriminate on toolOutput.type.
      //   NOTE: the SDK's own JSDoc for onToolExecutionEnd says "check event.success". IT IS WRONG —
      //   no `success` field exists. Following the inline docs produces non-compiling code.
      durationMs: t0 ? Math.round(performance.now() - t0) : null,
      inputHash: sha256(canonicalJson(e.toolCall.input)),     // never store the raw input
      errorMessage: e.toolOutput.type === 'tool-error' ? safeErrorMessage(e.toolOutput.error) : null,
    }});
  },
};

// src/instrumentation.ts  (NEW — does not exist today)
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  ensureTelemetryRegistered();                // idempotent — registerTelemetry pushes onto a
}                                             // globalThis array; double-register = double rows.
```

**Privacy — mandatory, non-default:** telemetry is **opt-out** in v7 and `recordInputs`/`recordOutputs` **default to `true`**. Every call site must pass:
```ts
telemetry: { functionId: 'chat.turn', recordInputs: false, recordOutputs: false }
```
Otherwise we write the user's prompts — which contain their positions — into the telemetry sink by default. **Full message bodies are opt-in per user, TTL'd, and stored in a separate table.**

**Cost:** vendored `models.dev` snapshot (USD **per million** tokens), git-versioned; `AiCall.priceSnapshotId` records which snapshot priced the row, so historical re-pricing is reproducible. **No `ModelPrice` DB table** — prices are a build-time constant; a table adds a migration, a seeding job and a hot-path read for zero benefit at our scale. A weekly CI job re-fetches `models.dev/api.json` and opens a PR on diff. Price `cacheReadTokens` separately (~10× cheaper) — a chatbot with a long system prompt will otherwise be materially over-billed.

### 2.6 Quota — reserve-then-reconcile, Postgres-atomic

```ts
export async function reserve(userId: string, ceilingNanoUsd: bigint, requestId: string) {
  // Atomic. Multi-instance safe. An in-memory counter is a bypass — we run N replicas (#78).
  const [row] = await db.$queryRaw<AiQuota[]>`
    UPDATE "AiQuota" SET "reservedNanoUsd" = "reservedNanoUsd" + ${ceilingNanoUsd}
     WHERE "userId" = ${userId}
       AND "spentNanoUsd" + "reservedNanoUsd" + ${ceilingNanoUsd} <= "limitNanoUsd"
    RETURNING *`;
  if (!row) throw new TRPCError({ code: 'TOO_MANY_REQUESTS', message: 'AI quota exhausted' });
  return db.aiQuotaReservation.create({ data: { userId, requestId, ceilingNanoUsd } });
}

export async function settle(res: AiQuotaReservation, actualNanoUsd: bigint) {
  await db.$transaction([
    db.$executeRaw`UPDATE "AiQuota"
                      SET "spentNanoUsd"    = "spentNanoUsd" + ${actualNanoUsd},
                          "reservedNanoUsd" = GREATEST(0, "reservedNanoUsd" - ${res.ceilingNanoUsd})
                    WHERE "userId" = ${res.userId}`,
    db.aiQuotaReservation.update({ where: { id: res.id }, data: { settledAt: new Date() } }),
  ]);
}
```

- **Reserve the CEILING**, not a guess: `estimatedInputTokens + maxOutputTokens`. The known failure mode is "reserve 1K output tokens, model returns 8K". `maxOutputTokens` is **forced by the guardrail middleware** (§2.1) so the ceiling is never unbounded.
- Multi-step loops multiply this. Cap **steps** (`stopWhen: isStepCount(8)`) **and** total turn tokens **and** concurrency per user.
- **BYOK skips `reserve`/`settle` entirely** but still writes the AiCall row with `billedTo: USER` and a notional cost (users get a spend view too).
- A cron sweeper releases reservations older than 10 minutes (process crash mid-call).
- **Do not cite Azure APIM `llm-token-limit` or Apigee `LLMTokenQuota` as prior art in the spec** — verified: neither reserves an output ceiling and neither refunds a delta. This is our design.

### 2.7 Eval harness + CI

**Runner: `bun test`.** Not evalite — its `main` has not moved since 2025-11-10 and v1 has been stuck at `1.0.0-beta.16` since Feb 2026. Do not gate a deploy on it. Not promptfoo either (for now): its `trajectory:*` assertions key off the **legacy** `ai.toolCall.name` span attribute, which means it would only see our tool calls if we register `LegacyOpenTelemetry` — an unnecessary coupling for Phase 0.

**Three tiers.** Only Tier 0 gates a merge.

| Tier | What | When | Cost | Gate? |
|---|---|---|---|---|
| **0 — hermetic** | `MockLanguageModelV4` + `simulateReadableStream` from `ai/test`. Asserts: guardrail middleware strips reasoning-rejected params & forces `maxOutputTokens`; telemetry writes exactly one `AiCall` row per model call **and one on `onError`**; quota reserve→settle arithmetic; `Secret` never serialises; **tool authorization — user B's `ToolCtx` returns only B's data**; every `inputSchema` is strict and contains no `userId`; emitted JSON Schema satisfies the Azure structured-outputs subset. | **every PR** | $0 | ✅ **YES** |
| **1 — golden set** | ~20 tool-selection cases. Tools declared **without `execute`** → `generateText` halts with `finishReason: 'tool-calls'`, `result.toolCalls` = `[{ toolName, input }]`. Assert tool name + args subset + `dynamicToolCalls.filter(c => c.invalid)` is empty. Plus **negative cases** ("who are you?" → zero tool calls) and the **injection suite** (a prompt-injection payload in a symbol name / note / headline must not produce a cross-tenant or out-of-scope tool call). Plus the **advice-boundary suite** (MiFID II). | nightly + pre-release + `workflow_dispatch` | ~$0.05/run | ⚠️ alerts, not a merge gate |
| **2 — LLM-as-judge** | **Binary pass/fail** against an explicit rubric (never a 1–5 scale — it clusters on 3–4 and drifts). Judge pinned to a dated model snapshot. Reason-before-label in the output schema. | nightly | ~$0.20/run | ❌ directional only |

⚠️ **The eval suite cannot use `temperature: 0` + `seed`.** All Azure GPT-5.x are reasoning models and **400 on both**. Determinism comes from (a) asserting on **tool selection**, which is robust, not on prose; (b) a fixed `reasoning_effort`; (c) best-of-3 majority for any case that proves flaky. This is a *reason* to gate on tool-call assertions and never on free-text quality.

**CI change required:** `.github/workflows/ci.yml` currently has **no unit-test job at all** — `bun test src` is defined in `package.json` and never runs. Add a `unit` job (`bun test src`) to the `all-checks` fan-in. It picks up the new Tier-0 evals **and** the five existing unit test files (`portfolio-compute.test.ts`, `fx.test.ts`, `currency-normalize.test.ts`, `yahoo-*.test.ts`) that are currently ungated.

### 2.8 Guardrails — four layers, in order of load-bearing-ness

There is **no general fix for prompt injection**. The current best primary source (Beurer-Kellner et al., arXiv 2506.08837, IBM/ETH/Google/Microsoft) states it plainly: *"once an LLM agent has ingested untrusted input, it must be constrained so that it is impossible for that input to trigger any consequential actions."* Mitigation is **architectural capability minimisation**, not prompt hardening.

1. **Capability minimisation (the real control).** Phase 0's entire tool surface is **read-only, user-scoped, and closed over `ctx.userId`.** There is no consequential action for an injection to trigger. This single decision removes the entire class.
2. **Middleware** (`languageModelMiddleware` on the registry, `wrapLanguageModel` for BYOK — same object, both paths): force `maxOutputTokens`; strip reasoning-rejected params; scrub outputs.
3. **Untrusted-content handling.** News headlines, **symbol names** (Yahoo search results land verbatim in context), `Transaction.note` free text and imported CSV are all attacker-influenced. Deliver them as **structured tool-result messages**, never interpolated into the system prompt. **Do not use a `<untrusted_data>…</untrusted_data>` text fence** — `JSON.stringify` leaves `<`, `/`, `>` literal, so a headline containing the closing delimiter escapes the fence. Strip control / zero-width / bidi characters (OWASP LLM01: *"injections do not need to be human-visible"*); hard-cap length.
4. **Disclosure + advice boundary.** Persistent visible "AI assistant" label (EU AI Act Art. 50(1), from 2 Aug 2026) on both the chat surface and the MCP server description. System prompt: refuse buy/sell **personal recommendations**; factual reporting on the user's own data and generic education are fine. **Eval-tested (Tier 1).**

**MCP annotations are UX, not authz.** `readOnlyHint: true` on everything, `openWorldHint: false` — but the enforcement is `requiredScope` + `buildToolset`, because anyone can point `curl` at the Streamable HTTP endpoint with a valid token.

---

## 3. KEY DECISIONS

| # | Decision | Recommendation | One-line rationale |
|---|---|---|---|
| 1 | AI SDK major | **`ai@7.0.22`** (not v6) | v7's `Telemetry` integration interface makes the DIY-Postgres ledger a supported extension point rather than a middleware hack, and Langfuse already ships v7 support if we ever want it. |
| 2 | Chat transport | **Route Handler at `/api/chat`, NOT tRPC** | `DefaultChatTransport` expects a raw SSE `Response` carrying `UIMessageChunk` frames with `x-vercel-ai-ui-message-stream`; tRPC owns its envelope and this repo layers superjson on top — a procedure physically cannot emit those bytes. |
| 3 | Generative UI mechanism | **Tool parts + client-side switch** (not `@ai-sdk/rsc`/`streamUI`) | We stream tool JSON and render ordinary Recharts client components keyed on `part.type === 'tool-<name>'`; the RSC path would fight the MCP tool-reuse goal. |
| 4 | AI Elements | **Do NOT run the CLI. Hand-roll ~6 components on Base UI; take `streamdown@2.5.0` only.** | Its registry declares **24 shadcn `registryDependencies` — all 24 already exist here as Base UI files** — so the install offers to overwrite them with Radix versions and would silently reintroduce Radix into a repo that has zero. (Also: `ai-elements@1.9.0` was published **2026-03-12**, ~4 months stale.) |
| 5 | Canonical tool definition | **Our own `AppTool` descriptor + 3 adapters** (not `ai`'s `tool()`, not `contextSchema`/`toolsContext`) | One authorization point across chat/MCP/cron, and it insulates us from both the `ai` rename churn and the MCP 2026-07-28 transport rewrite. |
| 6 | MCP transport lib | **Default: raw `@modelcontextprotocol/sdk@1.29.0` + `StreamableHTTPServerTransport` (stateless). Fallback: `mcp-handler@1.1.0` if a 1-day spike shows the Route-Handler bridge is painful.** | `mcp-handler` peer-pins the SDK to the exact string `"1.26.0"` and **hard-depends on `redis`** (which we deliberately removed in #78) — it saves us an afternoon of route wiring at the cost of blocking the SDK release that implements the spec shipping in 15 days. |
| 7 | MCP auth | **Bearer API key first** (accept both `Authorization: Bearer` and `x-api-key`). OAuth/DCR deferred. | Claude Code and Cursor work with a plain bearer key today; Claude.ai's `static_headers` is Beta + org-admin-shared (not per-user) and ChatGPT wants OAuth+CIMD — neither is a Phase 0 target. **Do not serve `/.well-known/oauth-protected-resource`** — it makes Cursor and Claude Code abandon the configured headers and force OAuth. |
| 8 | API key verification | **Add a `keyHmac` unique column; verify with `timingSafeEqual`. Keep bcrypt for one release, then drop it.** | The current `findMany({where:{start}})` + `bcrypt.compareSync` loop is ~100–300 ms of synchronous CPU **per candidate** on the request thread — a trivial DoS on a hot MCP endpoint, and bcrypt buys nothing over a peppered HMAC for a 64-hex-char high-entropy secret. |
| 9 | Better Auth apiKey plugin | **Do not adopt** (`@better-auth/api-key`) | The bespoke implementation already works and the `ApiKey` table is already Better-Auth-shaped; adopting the plugin is a migration, not a config line, and it is orthogonal to Phase 0. |
| 10 | Eval runner | **`bun test`** | Already in `package.json`; **evalite is stalled** (main untouched since 2025-11-10, v1 beta since Feb 2026) and promptfoo's trajectory assertions need legacy OTel spans we don't want to emit. |
| 11 | Cost table | **Vendored `models.dev` snapshot + `priceSnapshotId` on every row. No `ModelPrice` DB table.** | Prices are a build-time constant; `llm-cost` is dead (2024) and `tokenlens` is stale, but models.dev is MIT, commits daily, includes Azure, and a git-versioned snapshot makes historical re-pricing reproducible for free. |
| 12 | Cost precision | **`costNanoUsd BigInt`** | `gpt-5.4-nano` input is $0.20/1M = 0.2 µUSD/token — micro-USD integers truncate to zero and silently under-bill; superjson already serialises BigInt in this repo. |
| 13 | Correlation mechanism | **`AsyncLocalStorage`**, not `runtimeContext`/`includeRuntimeContext` | Middleware doesn't know the user, and whether `includeRuntimeContext` surfaces `userId` on `onLanguageModelCallEnd` is UNVERIFIED — ALS is SDK-independent and identical across chat/MCP/cron. |
| 14 | Postgres image | **Swap `postgres:16-alpine` → `pgvector/pgvector:0.8.5-pg16` in Phase 0, then `REINDEX DATABASE`. Add no vector columns yet.** | pgvector ships **no alpine image**; swapping later on a populated PGDATA changes the libc collation provider (musl→glibc) and **silently corrupts btree indexes on text columns** — do it while the data is small. Pin ≥0.8.5 (CVE-2026-3172 in <0.8.2; HNSW vacuum corruption in <0.8.4). |
| 15 | Mutating tools | **Phase 0 is READ-ONLY on every surface.** `mutates`/`preview`/`requiredScope` exist in the type from day one. | It deletes the entire destructive-confirmation-over-untrusted-client problem, which is exactly the thing the MCP spec is rewriting in 15 days (elicitation → `InputRequiredResult`). Phase 1 adds writes additively. |
| 16 | Default model | **`gpt-5.4-mini`** (0.75/4.50, Tier-1 1k RPM / 1M TPM). Escalate to `gpt-5.4` behind a tier flag. | **Avoid `gpt-5.5` (0 TPM below Tier 5)** and `gpt-5.6-*` (Preview, unpriced). No registration form is needed for any of these any more. |

---

## 4. RISKS — ranked, with mitigations

**R1 — `ai@7` under Bun 1.3 + Next 16 Turbopack + React Compiler is completely untested.** ESM-only, `engines: node >=22`. Bun claims Node compat and the repo is already `"type": "module"`, but nobody has run this combination.
→ **Mitigation: this is the first task. A 1-day spike (`generateText` against Azure from a Route Handler, under `next dev --turbo` AND in the Docker image) gates everything else.** If it fails, the whole spec's dependency plan changes.

**R2 — Telemetry defaults will exfiltrate user portfolios on day one.** v7 telemetry is **opt-out**, and `recordInputs`/`recordOutputs` default to `true`. Register the ledger, and every prompt (containing positions, transactions, PII) lands in the sink.
→ **Mitigation: `recordInputs: false, recordOutputs: false` on the platform default, enforced by a Tier-0 test that fails if any call site omits it.**

**R3 — Silent under-billing.** Four independent traps: (a) `result.usage` flipped meaning in v7 (now = all steps; a copied v6 snippet under-bills every multi-step turn); (b) every token leaf is `number | undefined` → naive math yields 0; (c) `cacheReadTokens` is ~10× cheaper and must be priced separately; (d) **for Azure, `e.modelId` is the DEPLOYMENT NAME** — pricing on it silently fails to match any catalogue entry.
→ **Mitigation: `resolvedModel` column, `pricingStatus: UNKNOWN_MODEL` + `costNanoUsd: null` (never 0) + an alert; Tier-0 tests for all four.**

**R4 — Failed calls are invisible.** `onLanguageModelCallEnd` fires **only on success**. Azure content-filter 400s **are billed**. Without `onError`, we eat cost we never see.
→ **Mitigation: wire `onError` alongside `onLanguageModelCallEnd`; `outcome: CONTENT_FILTERED` as a first-class value.**

**R5 — The MCP spec changes under us in 15 days.** `2026-07-28` removes the `initialize` handshake and `Mcp-Session-Id` (stateless), adds required `Mcp-Method`/`Mcp-Name` headers, and replaces elicitation. The TS SDK has **not** shipped support (latest = 1.29.0, no v2 on npm).
→ **Mitigation: keep the MCP transport a thin, replaceable seam behind the `AppTool` adapter; ship MCP behind a feature flag; budget an explicit follow-up. Phase 0's read-only decision means we depend on none of the changing surfaces (no sessions, no elicitation, no sampling).**

**R6 — Prompt injection via a *symbol name* or *transaction note*, not a news article.** Yahoo search results and user-entered `Transaction.note` land verbatim in context and are attacker-influenceable (a phished broker statement, a crafted ticker).
→ **Mitigation: read-only tools (§2.8 layer 1) + structured tool-result delivery, not text fences (a `</untrusted_data>` fence is escapable) + control/zero-width/bidi stripping + a Tier-1 injection eval suite.**

**R7 — Eval determinism is impossible the way everyone writes it.** Every eval snippet uses `temperature: 0, seed: 42`. **All Azure GPT-5.x models 400 on both.**
→ **Mitigation: assert on tool selection (robust), pin `reasoning_effort`, best-of-3 for flaky cases, and keep the merge gate on Tier-0 hermetic tests only.**

**R8 — Secret leakage through error objects, not logs.** Provider SDK errors commonly embed the request config, including the `api-key` header. `JSON.stringify(err)` into telemetry, or a golden fixture recorded from a real run, leaks a BYOK key.
→ **Mitigation: the `Secret` branded type (toString/toJSON/inspect → `[redacted]`), explicit field-picking in `safeErrorMessage`, and a Tier-0 test that asserts a `Secret` cannot be JSON-serialised.**

**R9 — The Postgres image swap corrupts text indexes.** musl→glibc collation change on a live PGDATA.
→ **Mitigation: do it in Phase 0 while data is small; `REINDEX DATABASE` immediately after; do NOT bundle a PG major bump into the same change. Self-hosters with an external DB just need `CREATE EXTENSION vector`.**

**R10 — Multi-instance quota bypass.** The app is explicitly multi-replica (#78). A quota counter in module memory is a free lunch for anyone who reloads.
→ **Mitigation: the atomic `UPDATE … WHERE spent + reserved + ceiling <= limit RETURNING` (§2.6). Zero rows returned = 429. Plus an orphan-reservation sweeper.**

**R11 — `mcp-handler` drags Redis back in.** It hard-depends on `redis ^4.6.0` — a package we deliberately removed.
→ **Mitigation: decision #6 (raw SDK). If we fall back to mcp-handler, set `disableSse: true` and accept the dependency knowingly.**

**R12 — Azure `baseURL` footgun.** `@ai-sdk/azure` appends `/v1{path}` itself. A BYOK user who pastes `https://x.openai.azure.com/openai/v1` produces `/v1/v1/responses` → 404, which will look like "their key is broken."
→ **Mitigation: normalise + validate the endpoint at save time (strip trailing `/v1`, assert host ends in `.openai.azure.com` unless they explicitly choose OpenAI-compatible), and run the 1-token probe.**

---

## 5. WHAT PHASE 0 MUST GET RIGHT (expensive to reverse)

### 5.1 The BYOK credential blob shape — **the single most expensive thing to reverse**

Reversing it means re-encrypting every row, which requires the old key to still exist. Get these five right on day one:

1. **`kid` column from day one.** Without it, key rotation needs downtime or a guess-and-retry decrypt loop.
2. **`authTag` persisted as its own column.** Forget `getAuthTag()`/`setAuthTag()` and the data is permanently undecryptable. (And `setAuthTag` after `final()` throws.)
3. **`iv` is a fresh `randomBytes(12)` per encryption.** GCM nonce reuse under the same key leaks plaintext XOR and enables forgery. **Never derive it from `userId` or a counter.**
4. **AAD = `${userId}|${provider}|v1`.** This is what makes a row copied to another tenant *fail to decrypt* rather than silently work.
5. **Azure credentials are multi-field, so only the secret is encrypted.** `resourceName`/`baseURL`/`deployment`/`apiVersion` are plaintext columns. **A single `apiKey TEXT` column cannot model Azure and would have to be blown up later.**

Corollary: **Better Auth's `ApiKey` model cannot be reused** — it stores a bcrypt hash (one-way, verification only), which is the exact opposite of BYOK's requirement (reversible decryption at call time). New table, no exceptions.

### 5.2 The telemetry table

- **`resolvedModel` separate from `modelId`.** For Azure, `modelId` is an arbitrary deployment name (`embed-prod-3`) that tells you nothing about cost or capability. Without both columns, every Azure cost figure is unrecoverable retroactively.
- **`costNanoUsd BigInt?` + `pricingStatus`.** Micro-USD truncates nano-priced models to zero; a `0` fallback on an unknown model means the platform silently eats the bill.
- **`billedTo` enum.** BYOK calls must be in the ledger (latency, outcome, tool calls, notional cost) but excluded from platform spend. Retro-fitting this means guessing which historical rows were BYOK.
- **`requestId` on both `AiCall` and `AiToolCall`.** Tool execution happens *between* model calls, so a foreign key to `AiCall.id` doesn't work. `requestId` (from AsyncLocalStorage) is the only correlation key that spans a turn.
- **`priceSnapshotId`.** Makes historical re-pricing reproducible when models.dev revises a price.
- **`outputTokens` nullable.** Embedding calls (Phase 1) expose only `usage.tokens` (input) — there is no output count. A `NOT NULL` here blocks embeddings.
- **Append-only, `onDelete: SetNull` on `userId`.** Keeps aggregate spend after account deletion, drops the PII linkage. (Also the shape ESMA's AI statement expects if this ever becomes regulated.)

### 5.3 pgvector / Docker image

**Swap the image in Phase 0 even though nothing uses vectors yet.** `pgvector/pgvector:0.8.5-pg16`, `CREATE EXTENSION IF NOT EXISTS vector;` in a migration, `REINDEX DATABASE`, **no vector columns**. The alpine→Debian move is a libc collation change; doing it later on a populated PGDATA silently corrupts btree indexes on text columns. It costs ten minutes today and a data-integrity incident in Phase 2.

Two Phase-1 decisions that this schema choice forces, and that should be **pre-committed in the Phase 0 spec** because they determine whether a single fixed-width vector column is even possible:
- **Embeddings are always platform-funded and platform-keyed. BYOK applies to chat only.** If BYOK users could supply embedding credentials, different users would produce different models/dimensions and a shared corpus could not have one fixed-width column.
- **Dimension is 1536** (`text-embedding-3-small`, or `3-large` truncated via `dimensions: 1536`). `text-embedding-3-large` at native 3072 **cannot be HNSW-indexed as `vector`** (2,000-dim ceiling) and would force `halfvec`.

### 5.4 The tool-layer interface

`AppTool` is what chat, MCP and cron all consume. Getting it right now is what makes Phase 1 (writes), Phase 2 (RAG tools) and Phase 3 (an MCP OAuth surface) cheap:

- **`userId` never appears in an `inputSchema`.** It comes from `ToolCtx`, which comes from the session/bearer token. This is the whole multi-tenancy control; everything else is defence in depth.
- **`mutates`, `preview`, `requiredScope`, `annotations` exist in the type from day one**, even though Phase 0 sets `mutates: false` everywhere. Adding them later means touching every tool.
- **`outputSchema` is mandatory**, not optional — MCP's `structuredContent` needs it, the chat's typed `part.output` needs it, and the eval harness needs it. Retro-fitting output schemas onto a dozen tools is a day of tedium.
- **The confirmation seam is designed but not built:** when Phase 1 adds writes, the tool returns a `PendingMutation { confirmationToken, preview, requiresConfirmation }` — an HMAC over `{userId, tool, argsHash, jti, exp:120s}` — and the actual write happens in a normal authenticated tRPC mutation. **Stateless by design**, because the MCP protocol is going stateless in 15 days and MCP clients cannot be trusted to render a confirm dialog (annotations are hints).
- **Tools call the existing service layer** (`getCachedStructure`, `getCachedFullSeries`, the transactions/watchlist/goals router services). No new data-access paths, no model-authored `where` clauses.
- **Scopes reuse `PERMISSION_SCOPES`** (`portfolio:read`, `transactions:read`, …) with **one new scope `ai`** meaning "may spend platform LLM quota." The `ApiKey.permissions` JSON string already carries them, so MCP bearer auth and tRPC authz share one vocabulary.