# BYOK — Fetch Models & Enable a Set per Credential (Design)

**Date:** 2026-07-26
**Status:** Approved (design)
**Spec 3 of 4.** Independent of Specs 1 & 2. **Spec 4 (chat model-level selection) depends on this.**

## Problem

Adding a custom/BYOK model requires typing the model id as **free text** (`defaultModelId`), and a credential holds exactly **one** model. Users don't always know valid ids (self-hosted/proxy endpoints), and can't register more than one model per provider (e.g. Anthropic Opus 5 *and* Sonnet 5 from the same key).

## Goal

In the add/edit-key dialog:
1. Offer **"Fetch models"** to list a provider's available models (OpenAI, OpenAI-compatible, Anthropic, Google; **Azure stays free-text**).
2. Let the user **enable multiple models** for the credential (multi-select from the fetched list **plus** free-text custom ids), stored on the credential so the chat selector (Spec 4) can offer one entry per model.

## Data model change

`prisma/schema.prisma` — `AiProviderCredential`:
- **Add** `enabledModelIds String[]` — the set of model ids offered for this credential (one Anthropic key ⇒ `['claude-opus-5','claude-sonnet-5']`).
- **Keep** `defaultModelId String` — the **primary** model: what's probed at save time, priced/used when a selection omits a model, and the back-compat anchor. Invariant: `defaultModelId ∈ enabledModelIds`.
- **Migration** (`prisma/migrations/*_byok_enabled_models`): add the column; **backfill** `enabledModelIds = ARRAY[defaultModelId]` for every existing row so current credentials keep working.

## Design

### Component 1 — Backend model listing
- **New module** `src/server/ai/list-models.ts`:
  `listProviderModels({ provider, secret, baseURL?, resourceName?, apiVersion? }) → Promise<{ supported: true; models: string[] } | { supported: false }>`.
- Per-provider `fetch` (10s timeout, bounded response), returning **sorted, de-duplicated** ids:
  - **OPENAI / OPENAI_COMPATIBLE:** `GET {baseURL || https://api.openai.com/v1}/models`, `Authorization: Bearer <secret>`; parse `data[].id`.
  - **ANTHROPIC:** `GET https://api.anthropic.com/v1/models`, headers `x-api-key`, `anthropic-version: <pinned>`; parse `data[].id`.
  - **GOOGLE:** `GET https://generativelanguage.googleapis.com/v1beta/models?key=<secret>`; parse `models[].name`, strip `models/` prefix.
  - **AZURE:** `{ supported: false }`.
- **Never log the secret;** redact errors with `safeErrorMessage` (from `src/server/ai/probe.ts`). `baseURL` normalized via existing `normalizeBaseUrl`.

### Component 2 — tRPC `aiCredentials.listModels`
- `protectedProcedure` on `aiCredentialsRouter`. **Input:** `{ provider, secret: z.string().min(8), baseURL?, resourceName?, apiVersion? }` (same endpoint `superRefine` as `create`; credential need not be saved yet). Returns `{ supported, models }`; errors are typed + **redacted**; **persists nothing.**

### Component 3 — `create`/`update` procedure + storage
- `create` input gains `enabledModelIds: z.array(z.string().min(1).max(120)).min(1)`, keeps `defaultModelId` with a `superRefine` that `defaultModelId ∈ enabledModelIds`.
- `probeCredential` still probes only the **`defaultModelId`** (one live call validates the key; enabled models come from the trusted fetch list or explicit free-text).
- Upsert writes `enabledModelIds` + `defaultModelId`.

### Component 4 — Frontend (`ai-credentials-card.tsx`)
- **"Fetch models"** button — enabled when provider is supported (not Azure) + `secret` present + required endpoint fields present. Click → `listModels` → populate the model chooser.
- **Model chooser** replaces the single free-text `<Input>`:
  - A **multi-select** of enabled models — searchable over the fetched list (reuse `@/components/ui/combobox`/`command`), **with free-text add** for custom/unlisted ids.
  - A **primary** marker → `defaultModelId` (defaults to the first enabled).
  - **Fallback:** Azure / pre-fetch / fetch error ⇒ current free-text single-model behavior (still allowed to enable ≥1 model by typing).
- **Pricing hint:** an id not in `models.snapshot.json` bills as `UNKNOWN_MODEL`; v1 shows a **generic** hint (no snapshot lookup client-side).

## Data flow

Select provider → enter key (+ base URL) → **Fetch models** → multi-select the models to enable (+ any custom) → mark a primary → **Save** (existing `create` flow probes the primary + upserts `enabledModelIds`). No chat behavior changes until Spec 4; until then the chat keeps using the credential's `defaultModelId` at the provider level.

## Error handling

- Bad key / unreachable → inline redacted error; chooser falls back to free-text.
- Azure / empty list → free-text; enable ≥1 model by typing.

## Testing

- **Unit — `listProviderModels`** per provider (mock `fetch`): parsing, sort/dedupe, redaction (secret never in error), Azure `{ supported:false }`, timeout.
- **tRPC — `listModels`:** happy / redacted-error / unsupported / input validation.
- **DB (Pattern B) — migration:** existing row backfills `enabledModelIds=[defaultModelId]`; `create` persists a multi-model set; `defaultModelId ∈ enabledModelIds` enforced.
- **Client:** fetch populates chooser; multi-select + free-text; primary selection; provider-conditional rendering; pricing hint.

## Risks

- **Provider API drift** — isolated per-provider parsers, each unit-tested.
- **Secret handling** — sent over tRPC (same trust boundary as `create`), never logged; errors redacted.
- **Base UI combobox/command** controlled-from-first-render (known repo gotcha).

## Out of scope (v1)

- Listing Azure deployments (Azure enabled-models are typed manually).
- Auto-pricing unlisted models (bill `UNKNOWN_MODEL` until added to `models.snapshot.json`).
