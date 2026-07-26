# AI Chat — Model-Level Selection in the Selector (Design)

**Date:** 2026-07-26
**Status:** Approved (design)
**Spec 4 of 4.** Depends on **Spec 3** (credential stores `enabledModelIds`).

## Problem

The chat model selector is **provider-keyed**: `buildSelectorOptions` labels each BYOK credential `Your key: <Provider>`, and `ModelSelector = { kind:'platform' } | { kind:'byok'; provider }` selects a credential *by provider only*. With one Anthropic key that can serve both Opus 5 and Sonnet 5 (Spec 3 lets you enable both), there's no way to choose **which model** to chat with — the selector shows a single provider entry.

## Goal

Show **one selector entry per enabled model** — `<Provider> · <model>` — and route the chat turn (and its pricing) to the **selected model**.

## Design

### 1. `ModelSelector` shape (`src/server/ai/resolve-model.ts`)
- Byok variant gains an **optional** model id:
  `{ kind:'platform' } | { kind:'byok'; provider: ByokProvider; modelId?: string }`.
- Zod (`modelSelectorSchema`) updated to allow `modelId?: string` on the byok branch. **Back-compat:** `modelId` omitted ⇒ use the credential's `defaultModelId` (existing behavior).

### 2. `resolveModel(userId, selector)`
- For `{ kind:'byok', provider, modelId }`: load the enabled credential for `provider`; if `modelId` is present it **must be in `enabledModelIds`** (else fall back to `defaultModelId` — never build an un-enabled model); build the provider client with the selected id; set `resolvedModel = <selected id>` so **pricing keys on the model actually used** (`byokFromRow`).
- Azure: the selected id maps to the deployment as today (`cfg.deployment ?? modelId`).

### 3. Selector options (`src/app/(dashboard)/_components/chat/use-chat-selector.ts`)
- `buildSelectorOptions(platformConfigured, creds)` **expands each credential into one option per `enabledModelIds` entry**:
  - `value` encodes `{ provider, modelId }` (e.g. `byok:ANTHROPIC:claude-opus-5`).
  - `label` = `<Provider> · <modelId>` (+ the credential's optional `label` when set).
  - Platform stays a single option (`Platform · <AZURE_OPENAI_CHAT_MODEL>`), `modelId` omitted.

### 4. Wiring
- `model-picker.tsx` is unchanged structurally (renders `SelectorOption[]`); only the option set grows.
- `chat-launcher.tsx` selector state carries `{ provider, modelId }`; its `prepareSendMessagesRequest` already forwards the selector to `/api/ai/chat`.
- `/api/ai/chat` route (`src/app/api/ai/chat/route.ts`) re-validates the richer selector against the user's credentials (**and that `modelId ∈ enabledModelIds`**) before `streamChatTurn`.

### 5. Other `ModelSelector` consumer
- `src/server/api/routers/ai-import.ts` (`aiImport.preview`) shares `modelSelectorSchema`; it accepts the added optional `modelId` transparently (no behavior change needed, but its schema import stays in sync).

## Data flow

Selector shows `Anthropic · claude-opus-5` and `Anthropic · claude-sonnet-5` (both from one key). Pick `…sonnet-5` → chat-launcher sends `{ kind:'byok', provider:'ANTHROPIC', modelId:'claude-sonnet-5' }` → route validates → `resolveModel` builds the Sonnet client → the turn runs and is **priced on `claude-sonnet-5`**.

## Error handling

- Selector sends a `modelId` no longer enabled (credential edited mid-session) → route rejects with a clear message, or `resolveModel` falls back to `defaultModelId`; UI surfaces the fallback. (Plan picks one; reject-with-message preferred for pricing correctness.)
- Credential for the provider missing/disabled → existing "no usable model" path.

## Testing

- **Unit — `resolveModel`:** byok with a valid `modelId` builds/pric­es that model; with an un-enabled `modelId` falls back to `defaultModelId`; omitted `modelId` = today's behavior; platform unchanged.
- **Unit — `buildSelectorOptions`:** a 2-model credential yields 2 options with correct `value`/`label`; platform single option; empty creds.
- **Unit — `modelSelectorSchema`:** parses byok with/without `modelId`; rejects malformed.
- **Route/integration:** a `{provider,modelId}` selector for an enabled model resolves and streams; an un-enabled `modelId` is handled per the chosen error path.
- Telemetry-privacy build gate unaffected (selection plumbing only; the single generation call site is unchanged).

## Risks

- **Cross-cutting `ModelSelector` change** touches chat route, gateway, selector, ai-import. Mitigation: the change is **additive/optional** (`modelId?`), so every existing `{provider}`-only selector keeps working; consumers updated in one spec.
- **Pricing correctness** — pricing must follow the selected model; covered by the `resolveModel` test asserting `resolvedModel = selected id`.

## Cross-spec note

Requires Spec 3's `enabledModelIds`. Independent of Specs 1 & 2. Sequenced **3 → 4**.
