# Phase 0 Spike Result — `ai@7` on Bun 1.3 + Next 16.2 Turbopack + Docker

**Date:** 2026-07-13

## Part A — the stack (Task 0a, mock model, no Azure)

**Verdict:** GO
**Fallback applied:** none — no rung of the F1→F2→F3 ladder was needed.

Stack under test: Bun 1.3.14, Next 16.2.10 (Turbopack, `reactCompiler: true`),
`ai@7.0.22`, `@ai-sdk/azure@4.0.11`, `oven/bun:1.3-debian`.
Model: `MockLanguageModelV4` from `ai/test` — no network, no credentials.

| Gate | Result | Evidence |
|---|---|---|
| P1 install (`bun add --exact`) | PASS | exit 0, 11 packages installed in 4.05s. `"ai": "7.0.22"` and `"@ai-sdk/azure": "4.0.11"` pinned literally (no `^`/`~`). No `engines` error, no ESM/CJS resolution error. |
| P2 `bun run typecheck` | PASS | exit 0 — but only after correcting the mock's `usage`/`finishReason` to the *real* shipped provider-spec shape (see "Fact-sheet drift" below). The code as written in the brief did **not** compile. |
| P3 `bun run dev` (Turbopack) → `GET /api/ai-spike` | PASS | HTTP 200, `mode: "mock"`, `text: "OK"`, `outputTokens: 1`. Turbopack bundled `ai` + `@ai-sdk/azure` with zero warnings. Ready in 897ms; route served in 1443ms cold. |
| P4 `docker build` | PASS | exit 0. Image `invest-igator:spike`, 2.36GB. Turbopack bundled the SDK in the production build with **no** `serverExternalPackages` needed. |
| P5 `docker run` (port 3312) → `GET /api/ai-spike` | PASS | HTTP 200, `mode: "mock"`, `text: "OK"`, `outputTokens: 1`. `ai/test` subpath resolved fine at runtime in the runner stage. |

Verbatim responses:

```jsonc
// P3 — dev (next dev --turbo)
{"bun":false,"deployment":"mock","latencyMs":45,"mode":"mock","nodeVersion":"v24.18.0",
 "text":"OK","usage":{"inputTokens":7,"outputTokens":1,"totalTokens":8}}

// P5 — Docker (bun run start, via docker/entrypoint.sh)
{"bun":true,"deployment":"mock","latencyMs":1,"mode":"mock","nodeVersion":"v24.3.0",
 "text":"OK","usage":{"inputTokens":7,"outputTokens":1,"totalTokens":8}}
```

**What this does and does not prove.** It proves `ai@7` — ESM-only, `engines: node>=22` —
installs, typechecks, bundles through Turbopack with the React Compiler on, and executes
`generateText` end-to-end inside the production Docker image under Bun. That was the risk
that could have invalidated the plan. It proves **nothing** about Azure; see Part B.

## Confirmed in passing — later tasks must know these

### 1. Fact-sheet drift: the mock's `doGenerate` return shape is NOT what the plan assumed
The plan's fact sheet gave `MockLanguageModelV4.doGenerate` a **flat** usage object
(`inputTokens: 7`, `inputTokenDetails: {...}`, `totalTokens: 8`) and a bare
`finishReason: 'stop'`. **That does not compile against the shipped tarball.**
`ai@7.0.22` depends on `@ai-sdk/provider@4.0.3`, whose `LanguageModelV4Usage` is **nested**
and whose `LanguageModelV4FinishReason` is an **object**. The shape that actually compiles:

```ts
new MockLanguageModelV4({
  doGenerate: async () => ({
    content: [{ text: 'OK', type: 'text' as const }],
    finishReason: { raw: 'stop', unified: 'stop' as const },   // NOT a bare string
    usage: {
      inputTokens:  { cacheRead: 0, cacheWrite: 0, noCache: 7, total: 7 },  // nested
      outputTokens: { reasoning: 0, text: 1, total: 1 },                    // nested
      // NB: no `totalTokens` key at this layer — the SDK derives it
    },
    warnings: []
  })
});
```

**The root cause is that there are two different usage types and the fact sheet conflated them:**

| | Type | Shape | Who uses it |
|---|---|---|---|
| **Provider spec** | `LanguageModelV4Usage` (`@ai-sdk/provider@4.0.3`) | **nested**: `inputTokens: { total, noCache, cacheRead, cacheWrite }`, `outputTokens: { total, text, reasoning }`, optional `raw`. No `totalTokens`. | what a **mock/provider returns** from `doGenerate` |
| **Facade** | `LanguageModelUsage` (`ai`, line 321 of `dist/index.d.ts`) | **flat**: `inputTokens`, `inputTokenDetails: { noCacheTokens, cacheReadTokens, cacheWriteTokens }`, `outputTokens`, `outputTokenDetails: { reasoningTokens, textTokens }`, `totalTokens` | what `result.usage` **gives you back** |

The SDK translates provider-shape → facade-shape (which is why the mock returns nested and the
route reads back a flat `totalTokens: 8` it never set). The fact sheet described the *facade*
type and mistakenly used it for the *provider* return. **Every later test fixture that mocks a
model must use the nested provider shape**; every consumer of `result.usage` reads the flat one.

### 2. `generateText().usage` is NOT PromiseLike; `streamText().usage` IS
Verified against the shipped `.d.ts`:
- `GenerateTextResult.usage: LanguageModelUsage` (plain object — `dist/index.d.ts:4532`)
- `StreamTextResult.usage: PromiseLike<LanguageModelUsage>` (`dist/index.d.ts:2781`)

So `await result.usage` on a `generateText` result raises editor hint **TS80007
("'await' has no effect on the type of this expression")**. It is a *suggestion*, not an error —
`tsc --noEmit` still exits 0, and `await` on a non-promise is harmless. But **Task 7's telemetry
must not assume a uniform `await`-then-read**: the stream path genuinely needs the `await`
(usage resolves only when the stream finishes), the generate path does not.

### 3. `typeof Bun` does not typecheck here; `'Bun' in globalThis` does
Confirmed. This repo's `tsconfig` sets `types: ["@playwright/test"]`, so the `Bun` global is
undeclared and `typeof Bun` emits TS2868. Use `'Bun' in globalThis`.

### 4. Dev runs under Node, Docker runs under Bun — `'Bun' in globalThis` differs by environment
An unexpected and load-bearing observation:
- **dev** (`next dev --turbo`) reported `bun: false`, `nodeVersion: v24.18.0` — `node_modules/.bin/next`
  is a `#!/usr/bin/env node` shim, so the Next dev server runs under **real Node** (nvm's v24.18.0),
  *not* Bun, even when launched via `bun run dev`.
- **Docker** (`bun run start` via `docker/entrypoint.sh`) reported `bun: true`,
  `nodeVersion: v24.3.0` (Bun's Node-compat shim).

So the Bun runtime is only genuinely exercised **in the container**, and P5 — not P3 — is the gate
that actually proved `ai@7` runs under Bun. Any later code that branches on `'Bun' in globalThis`
will take a different branch in dev than in production. Do not rely on it for behaviour.

### 5. `engines: node>=22` is satisfied in practice
Bun does not enforce `engines`, and `process.version` reports `v24.3.0` under Bun's compat shim
anyway, so nothing in the SDK's runtime checks trips.

## Environment notes (not stack findings — do not confuse these with gate failures)

Two Docker problems on this machine were **environmental** and had nothing to do with `ai@7`:

1. **`docker pull` failed** with `docker-credential-desktop.exe: executable file not found`
   (`~/.docker/config.json` has `"credsStore": "desktop.exe"`, a Docker-Desktop-on-Windows leftover
   that does not exist in this WSL2 Linux install). Worked around with a throwaway
   `DOCKER_CONFIG` dir containing `{"auths": {}}` — the user's global config was left untouched.
2. **Container DNS is broken on Docker's default bridge network.** `getent hosts deb.debian.org`
   fails inside a bridge-network container (resolv.conf points at `10.255.255.254`, the WSL host
   gateway, which is unreachable from the bridge) but succeeds with `--network=host`. The first two
   `docker build` attempts died in `apt-get update` with `Temporary failure resolving 'deb.debian.org'`
   — **before** `bun install` or `next build` ever ran. The build was retried as
   `docker build --network=host` and passed. This changes nothing about the Dockerfile or the stack
   under test; it is a WSL2 networking artifact. **CI/other machines are unaffected.**

## Part B — the Azure transport (Task 0b)

**Verdict:** NOT RUN — no Azure credentials on this machine, by design. Task 0a is the stack test.

<!-- When run, record:
| P6 `bun run dev` with AZURE_OPENAI_* set → mode "azure" | PASS | HTTP 200, real tokens |
Confirmed: azure('<deployment>') — the deployment name is the SDK model id, and the
deployment is named differently from the model, proving the modelId/resolvedModel split
is load-bearing rather than academic. apiVersion left unset -> defaults to literal 'v1'.
No sampling params sent; GPT-5.x 400s on temperature/top_p/seed/max_tokens.
-->

## Decision

Part A is **GO**, so Tasks 1–12 proceed as specced — all of them test against mocks.
Task 13's live save-probe and the Tier-1 evals wait on Part B.

The throwaway route `src/app/api/ai-spike/route.ts` is deleted; `package.json` /
`bun.lock` are reverted so Task 1 owns the dependency commit in full.

**One correction Task 1 and every mock-writing task must carry forward:** the
`MockLanguageModelV4` `doGenerate` fixture in the plan does not compile. Use the nested
provider-spec `usage` and the `{ unified, raw }` `finishReason` documented above.
