# AI Chat — Model-Level Selection in the Selector — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show one chat-selector entry per **enabled model** (`Anthropic · claude-opus-5`, `Anthropic · claude-sonnet-5`) instead of one per provider, and route + price the turn on the model actually chosen.

**Architecture:** `ModelSelector`'s byok variant gains an **optional** `modelId`, so every existing provider-only selector keeps working. `resolveModel` builds the selected model when it is in the credential's `enabledModelIds` and prices on it. The chat route re-validates the pair against the user's own credential. The picker expands each credential into one option per enabled model.

**Tech Stack:** TypeScript, Next.js 16 route handler, tRPC v11, zod v4, Prisma 7, AI SDK v7, `bun test`.

**Spec:** `docs/superpowers/specs/2026-07-26-ai-chat-model-selection-design.md`
**Depends on:** the BYOK branch (`enabledModelIds` on `AiProviderCredential` and on `AiCredentialView`). This branch is stacked on `feat/ai-byok-model-list`.

## Global Constraints

- The `modelId` field is **optional and additive**. A selector without it must behave exactly as it does today (use the credential's `defaultModelId`). No existing caller may need changing to keep working.
- **Pricing must follow the model actually used.** `ResolvedModel.resolvedModel` is what usage is priced on — it must be the effective model id, never a different one.
- **`resolveModel` must never build a model that is not in the credential's `enabledModelIds`.** An un-enabled or unknown `modelId` falls back to `defaultModelId` rather than being passed to the provider.
- **AZURE ignores a requested `modelId`** and always resolves its `defaultModelId`. Azure routes on `deployment` (the SDK model id), so honouring a model selection would call one deployment while pricing a different model — a silent billing error. Azure credentials therefore contribute exactly ONE selector entry.
- The chat route must re-validate the selector against the caller's **own** credentials — never trust the client's claim that a provider/model pair is theirs.
- There must be exactly **one** model-selector zod schema in the codebase after this work (it is currently duplicated in `src/app/api/ai/chat/route.ts` and `src/server/api/routers/ai-import.ts`).

---

### Task 1: Shared selector schema + model-aware `resolveModel`

**Files:**
- Create: `src/server/ai/model-selector-schema.ts`
- Modify: `src/server/ai/resolve-model.ts` (the `ModelSelector` type, `byokFromRow`, `resolveModel`)
- Create: `src/server/ai/resolve-model-selection.test.ts`

**Interfaces:**
- Consumes: `AiProviderCredential.enabledModelIds: string[]`.
- Produces: `modelSelectorSchema` (zod, used by Task 2); `ModelSelector = { kind:'platform' } | { kind:'byok'; provider: ByokProvider; modelId?: string }`.

- [ ] **Step 1: Create the single shared selector schema**

Create `src/server/ai/model-selector-schema.ts`:

```ts
import { z } from 'zod';

/**
 * The ONE model-selector schema. Previously duplicated in the chat route and the ai-import
 * router, which meant a shape change had to be made in two places to stay in sync.
 *
 * `modelId` is OPTIONAL: omitted means "the credential's primary model", which is exactly the
 * pre-model-picker behaviour, so every existing client keeps working unchanged.
 */
export const modelSelectorSchema = z.discriminatedUnion('kind', [
	z.object({ kind: z.literal('platform') }),
	z.object({
		kind: z.literal('byok'),
		modelId: z.string().min(1).max(120).optional(),
		provider: z.enum(['ANTHROPIC', 'AZURE', 'GOOGLE', 'OPENAI', 'OPENAI_COMPATIBLE'])
	})
]);
```

- [ ] **Step 2: Widen the `ModelSelector` type**

In `src/server/ai/resolve-model.ts`, replace the `ModelSelector` declaration (currently line 241):

```ts
/** Names either the platform model or one specific BYOK provider — the chat model picker's shape. */
export type ModelSelector = { kind: 'platform' } | { kind: 'byok'; provider: ByokProvider };
```

with:

```ts
/**
 * Names either the platform model, or one specific model on one BYOK provider.
 *
 * `modelId` is OPTIONAL and additive: omitted means the credential's `defaultModelId`, which is
 * the pre-picker behaviour. One key commonly serves several models (an Anthropic key serves both
 * Opus and Sonnet), so the picker names the model, not just the provider.
 */
export type ModelSelector = { kind: 'platform' } | { kind: 'byok'; modelId?: string; provider: ByokProvider };
```

- [ ] **Step 3: Write the failing tests**

Create `src/server/ai/resolve-model-selection.test.ts`. Mock `@/server/db` the same way the existing `resolve-model.test.ts` does — open that file first and copy its mocking setup and row fixture rather than inventing one:

```ts
import { describe, expect, test } from 'bun:test';
// NOTE: copy the `mock.module('@/server/db', ...)` setup and the credential-row fixture
// from src/server/ai/resolve-model.test.ts — do not invent a second mocking style.

describe('resolveModel with a model-level selector', () => {
	test('builds and PRICES the selected model when it is enabled', async () => {
		// Row: provider ANTHROPIC, defaultModelId 'claude-opus-5',
		//      enabledModelIds ['claude-opus-5', 'claude-sonnet-5']
		// Selector: { kind: 'byok', provider: 'ANTHROPIC', modelId: 'claude-sonnet-5' }
		// Expect: resolved.modelId === 'claude-sonnet-5' AND resolved.resolvedModel === 'claude-sonnet-5'
		//         (resolvedModel is what usage is priced on — it must follow the selection)
	});

	test('falls back to defaultModelId when the requested model is NOT enabled', async () => {
		// Selector modelId 'claude-haiku-9' (absent from enabledModelIds)
		// Expect: resolvedModel === 'claude-opus-5' — never build an un-enabled model.
	});

	test('omitting modelId keeps the pre-picker behaviour', async () => {
		// Selector: { kind: 'byok', provider: 'ANTHROPIC' }
		// Expect: resolvedModel === 'claude-opus-5'
	});

	test('AZURE ignores a requested modelId (deployment routing would mis-price)', async () => {
		// Row: provider AZURE, defaultModelId 'gpt-5.4-mini', deployment 'my-deployment',
		//      enabledModelIds ['gpt-5.4-mini', 'gpt-5']
		// Selector: { kind: 'byok', provider: 'AZURE', modelId: 'gpt-5' }
		// Expect: resolved.modelId === 'my-deployment' AND resolved.resolvedModel === 'gpt-5.4-mini'
		//         — the call routes on the deployment, so pricing must stay on the default model.
	});
});
```

Fill in each test body using the fixture style from `resolve-model.test.ts`. Every test must assert on real returned values, not on the mock.

- [ ] **Step 4: Run the tests to verify they fail**

Run: `bun test src/server/ai/resolve-model-selection.test.ts`
Expected: FAIL — the selected model is not honoured yet (assertions on `resolvedModel` come back as `defaultModelId`).

- [ ] **Step 5: Make `byokFromRow` model-aware**

In `src/server/ai/resolve-model.ts`, change `byokFromRow`'s signature and body. Replace:

```ts
function byokFromRow(
	row: Parameters<typeof toByokConfig>[0] & {
		authTag: Uint8Array;
		ciphertext: Uint8Array;
		iv: Uint8Array;
		kid: string;
	},
	userId: string
): ResolvedModel {
	const cfg = toByokConfig(row);
```

with:

```ts
/**
 * Choose the model this request actually runs on.
 *
 * AZURE is deliberately excluded from model selection: its SDK "model id" is the DEPLOYMENT, so
 * a different `modelId` would still hit the same deployment while changing what we priced on —
 * a silent billing error. Everywhere else, a requested model is honoured ONLY if the credential
 * enables it; anything else falls back to the primary rather than being sent to the provider.
 */
function effectiveModelId(cfg: ByokConfig, enabledModelIds: string[], requested: string | undefined): string {
	if (requested === undefined || cfg.provider === 'AZURE') return cfg.defaultModelId;
	return enabledModelIds.includes(requested) ? requested : cfg.defaultModelId;
}

function byokFromRow(
	row: Parameters<typeof toByokConfig>[0] & {
		authTag: Uint8Array;
		ciphertext: Uint8Array;
		enabledModelIds: string[];
		iv: Uint8Array;
		kid: string;
	},
	userId: string,
	requestedModelId?: string
): ResolvedModel {
	const cfg = toByokConfig(row);
	const effective = effectiveModelId(cfg, row.enabledModelIds, requestedModelId);
```

Then, further down in the same function, replace the `buildByokModel` call and the returned object:

```ts
	const model = buildByokModel(cfg, secret.expose());

	return {
		byok: true,
		// The SAME guardrail stack the platform registry uses. BYOK cannot skip it.
		model: applyGuardrails(model),
		modelId: cfg.provider === 'AZURE' ? (cfg.deployment ?? cfg.defaultModelId) : cfg.defaultModelId,
		providerId: cfg.provider.toLowerCase(),
		// The REAL model. NEVER price on modelId — for Azure that is the deployment name.
		resolvedModel: cfg.defaultModelId
	};
```

with:

```ts
	// Build on the EFFECTIVE model, not the credential's default — this is what makes a
	// per-model selection actually change which model answers the turn.
	const model = buildByokModel({ ...cfg, defaultModelId: effective }, secret.expose());

	return {
		byok: true,
		// The SAME guardrail stack the platform registry uses. BYOK cannot skip it.
		model: applyGuardrails(model),
		modelId: cfg.provider === 'AZURE' ? (cfg.deployment ?? effective) : effective,
		providerId: cfg.provider.toLowerCase(),
		// The REAL model, and what usage is priced on. NEVER price on modelId — for Azure that is
		// the deployment name. `effective` is Azure-safe: `effectiveModelId` pins Azure to its default.
		resolvedModel: effective
	};
```

- [ ] **Step 6: Pass the selector's model through `resolveModel`**

In the same file, in `resolveModel`, change the explicit-byok branch's return:

```ts
		return byokFromRow(row, userId);
```

to:

```ts
		return byokFromRow(row, userId, selector.modelId);
```

Leave the no-selector branch's `byokFromRow(row, userId)` call unchanged — omitting the argument is exactly the back-compat path.

- [ ] **Step 7: Run the tests to verify they pass**

Run: `bun test src/server/ai/resolve-model-selection.test.ts src/server/ai/resolve-model.test.ts`
Expected: the new tests pass AND the pre-existing `resolve-model.test.ts` still passes unchanged (proving the change is additive).

- [ ] **Step 8: Typecheck, lint, commit**

```bash
bun run typecheck && bunx @biomejs/biome check --write src/server/ai/model-selector-schema.ts src/server/ai/resolve-model.ts src/server/ai/resolve-model-selection.test.ts
git add src/server/ai/model-selector-schema.ts src/server/ai/resolve-model.ts src/server/ai/resolve-model-selection.test.ts
git commit -m "feat(ai): resolveModel honours and prices a per-model BYOK selection"
```

---

### Task 2: Route re-validation + schema consolidation

**Files:**
- Modify: `src/app/api/ai/chat/route.ts`
- Modify: `src/server/api/routers/ai-import.ts`
- Create: `src/app/api/ai/chat/model-selection.test.ts`

**Interfaces:**
- Consumes: `modelSelectorSchema` (Task 1).
- Produces: a route that rejects a `modelId` the caller's credential does not enable.

- [ ] **Step 1: Use the shared schema in the chat route**

In `src/app/api/ai/chat/route.ts`, add the import:

```ts
import { modelSelectorSchema } from '@/server/ai/model-selector-schema';
```

and replace the inline `model:` field in `bodySchema` (currently lines 37–43):

```ts
	model: z.discriminatedUnion('kind', [
		z.object({ kind: z.literal('platform') }),
		z.object({
			kind: z.literal('byok'),
			provider: z.enum(['ANTHROPIC', 'AZURE', 'GOOGLE', 'OPENAI', 'OPENAI_COMPATIBLE'])
		})
	])
```

with:

```ts
	model: modelSelectorSchema
```

- [ ] **Step 2: Re-validate the model against the caller's own credential**

Still in `route.ts`, replace the byok ownership check (currently lines 87–93):

```ts
	if (model.kind === 'byok') {
		const owned = await db.aiProviderCredential.findFirst({
			select: { id: true },
			where: { enabled: true, provider: model.provider, userId }
		});
		if (owned === null) return json(403, { error: 'NO_SUCH_CREDENTIAL' });
	}
```

with:

```ts
	if (model.kind === 'byok') {
		const owned = await db.aiProviderCredential.findFirst({
			select: { enabledModelIds: true, id: true },
			where: { enabled: true, provider: model.provider, userId }
		});
		if (owned === null) return json(403, { error: 'NO_SUCH_CREDENTIAL' });
		// Reject rather than silently falling back: the user picked a specific model, and quietly
		// answering on a different one would also bill them for a model they did not choose.
		// (Azure never names a model — `resolveModel` pins it to the credential's default.)
		if (model.kind === 'byok' && model.modelId !== undefined && model.provider !== 'AZURE') {
			if (!owned.enabledModelIds.includes(model.modelId)) {
				return json(403, { error: 'NO_SUCH_MODEL' });
			}
		}
	}
```

- [ ] **Step 3: Consolidate the ai-import copy**

In `src/server/api/routers/ai-import.ts`, delete the local `modelSelectorSchema` declaration (currently lines 28–34) and import the shared one instead:

```ts
import { modelSelectorSchema } from '@/server/ai/model-selector-schema';
```

The procedure's `.input(z.object({ csv: …, model: modelSelectorSchema }))` needs no other change — the added `modelId` is optional, so existing callers are unaffected.

- [ ] **Step 4: Write the tests**

Create `src/app/api/ai/chat/model-selection.test.ts`, testing the shared schema's contract (the part that guards the route):

```ts
import { describe, expect, test } from 'bun:test';
import { modelSelectorSchema } from '@/server/ai/model-selector-schema';

describe('modelSelectorSchema', () => {
	test('accepts a byok selector WITHOUT a modelId (back-compat)', () => {
		const parsed = modelSelectorSchema.safeParse({ kind: 'byok', provider: 'ANTHROPIC' });
		expect(parsed.success).toBe(true);
	});

	test('accepts a byok selector WITH a modelId', () => {
		const parsed = modelSelectorSchema.safeParse({
			kind: 'byok',
			modelId: 'claude-sonnet-5',
			provider: 'ANTHROPIC'
		});
		expect(parsed.success).toBe(true);
	});

	test('accepts the platform selector', () => {
		expect(modelSelectorSchema.safeParse({ kind: 'platform' }).success).toBe(true);
	});

	test('rejects an unknown provider', () => {
		expect(modelSelectorSchema.safeParse({ kind: 'byok', provider: 'NOPE' }).success).toBe(false);
	});

	test('rejects an empty modelId', () => {
		const parsed = modelSelectorSchema.safeParse({ kind: 'byok', modelId: '', provider: 'OPENAI' });
		expect(parsed.success).toBe(false);
	});
});
```

- [ ] **Step 5: Run the tests**

Run: `bun test src/app/api/ai/chat/model-selection.test.ts`
Expected: 5 pass, 0 fail.

- [ ] **Step 6: Typecheck, lint, commit**

```bash
bun run typecheck && bun run check
git add "src/app/api/ai/chat/route.ts" "src/app/api/ai/chat/model-selection.test.ts" src/server/api/routers/ai-import.ts
git commit -m "feat(ai): chat route validates the selected model, one shared selector schema"
```

---

### Task 3: One picker entry per enabled model

**Files:**
- Modify: `src/app/(dashboard)/_components/chat/use-chat-selector.ts`
- Modify: `src/app/(dashboard)/_components/chat/model-picker.tsx`
- Create: `src/app/(dashboard)/_components/chat/use-chat-selector.test.ts`

**Interfaces:**
- Consumes: `AiCredentialView.enabledModelIds` / `.defaultModelId`; the widened `ModelSelector` (Task 1).

- [ ] **Step 1: Expand each credential into one option per enabled model**

Replace the body of `buildSelectorOptions` in `src/app/(dashboard)/_components/chat/use-chat-selector.ts`:

```ts
/**
 * Builds the model picker's option list: the platform model first (when configured), then one
 * entry PER ENABLED MODEL for each BYOK credential — one key commonly serves several models, so
 * naming only the provider would make Opus and Sonnet indistinguishable.
 *
 * AZURE contributes exactly one entry and never names a model: Azure routes on the deployment,
 * so a per-model choice there would change pricing without changing which model answers.
 *
 * `provider` is cast to `never` rather than the (unexported) `ByokProvider` union — the route
 * re-validates the selector server-side, so a stale value fails safely downstream.
 */
export function buildSelectorOptions(
	platformConfigured: boolean,
	creds: { defaultModelId?: string; enabledModelIds?: string[]; provider: string }[]
): SelectorOption[] {
	const opts: SelectorOption[] = [];
	if (platformConfigured) opts.push({ label: 'Platform', value: { kind: 'platform' } });

	for (const c of creds) {
		const providerLabel = PROVIDER_LABEL[c.provider] ?? c.provider;

		// Azure: a single, model-less entry (see the note above).
		if (c.provider === 'AZURE') {
			opts.push({
				label: c.defaultModelId ? `${providerLabel} · ${c.defaultModelId}` : providerLabel,
				value: { kind: 'byok', provider: c.provider as never }
			});
			continue;
		}

		// A credential saved before per-model selection has no enabled set — fall back to its
		// primary, and to a bare provider entry if even that is missing.
		const models = c.enabledModelIds?.length
			? c.enabledModelIds
			: c.defaultModelId
				? [c.defaultModelId]
				: [];

		if (models.length === 0) {
			opts.push({ label: providerLabel, value: { kind: 'byok', provider: c.provider as never } });
			continue;
		}

		for (const modelId of models) {
			opts.push({
				label: `${providerLabel} · ${modelId}`,
				value: { kind: 'byok', modelId, provider: c.provider as never }
			});
		}
	}
	return opts;
}
```

- [ ] **Step 2: Make the picker's key model-aware**

In `src/app/(dashboard)/_components/chat/model-picker.tsx`, replace `keyOf`:

```ts
/** `ModelSelector` isn't a primitive Base UI `Select` can key on directly — collapse it to a string. */
function keyOf(selector: ModelSelector): string {
	return selector.kind === 'platform' ? 'platform' : `byok:${selector.provider}`;
}
```

with:

```ts
/**
 * `ModelSelector` isn't a primitive Base UI `Select` can key on directly — collapse it to a
 * string. The model id is part of the key: without it, two models on the same provider would
 * collide onto one option and the picker could not tell them apart.
 */
function keyOf(selector: ModelSelector): string {
	if (selector.kind === 'platform') return 'platform';
	return selector.modelId === undefined
		? `byok:${selector.provider}`
		: `byok:${selector.provider}:${selector.modelId}`;
}
```

- [ ] **Step 3: Write the tests**

Create `src/app/(dashboard)/_components/chat/use-chat-selector.test.ts`:

```ts
import { describe, expect, test } from 'bun:test';
import { buildSelectorOptions } from './use-chat-selector';

describe('buildSelectorOptions', () => {
	test('expands one credential into one option per enabled model', () => {
		const options = buildSelectorOptions(false, [
			{
				defaultModelId: 'claude-opus-5',
				enabledModelIds: ['claude-opus-5', 'claude-sonnet-5'],
				provider: 'ANTHROPIC'
			}
		]);

		expect(options).toEqual([
			{ label: 'Anthropic · claude-opus-5', value: { kind: 'byok', modelId: 'claude-opus-5', provider: 'ANTHROPIC' } },
			{
				label: 'Anthropic · claude-sonnet-5',
				value: { kind: 'byok', modelId: 'claude-sonnet-5', provider: 'ANTHROPIC' }
			}
		]);
	});

	test('puts the platform option first when configured', () => {
		const options = buildSelectorOptions(true, []);
		expect(options).toEqual([{ label: 'Platform', value: { kind: 'platform' } }]);
	});

	test('AZURE gets ONE entry and never names a model', () => {
		const options = buildSelectorOptions(false, [
			{ defaultModelId: 'gpt-5.4-mini', enabledModelIds: ['gpt-5.4-mini', 'gpt-5'], provider: 'AZURE' }
		]);

		expect(options).toHaveLength(1);
		expect(options[0]?.value).toEqual({ kind: 'byok', provider: 'AZURE' });
	});

	test('a credential with no enabled set falls back to its primary model', () => {
		const options = buildSelectorOptions(false, [{ defaultModelId: 'gpt-5', enabledModelIds: [], provider: 'OPENAI' }]);

		expect(options).toEqual([
			{ label: 'OpenAI · gpt-5', value: { kind: 'byok', modelId: 'gpt-5', provider: 'OPENAI' } }
		]);
	});

	test('a credential with neither still yields a usable provider-only entry', () => {
		const options = buildSelectorOptions(false, [{ provider: 'GOOGLE' }]);
		expect(options).toEqual([{ label: 'Google', value: { kind: 'byok', provider: 'GOOGLE' } }]);
	});
});
```

- [ ] **Step 4: Run the tests**

Run: `bun test "src/app/(dashboard)/_components/chat/use-chat-selector.test.ts"`
Expected: 5 pass, 0 fail.

- [ ] **Step 5: Full gate**

```bash
bun run typecheck && bun run check && bun run test:unit
```

Expected: typecheck 0; biome clean; unit suite green with no new failures.

- [ ] **Step 6: Commit**

```bash
git add "src/app/(dashboard)/_components/chat/use-chat-selector.ts" "src/app/(dashboard)/_components/chat/model-picker.tsx" "src/app/(dashboard)/_components/chat/use-chat-selector.test.ts"
git commit -m "feat(ai): chat picker lists one entry per enabled BYOK model"
```

---

## Self-Review

- **Spec coverage:** spec §1 (selector shape) → Task 1 Steps 1–2; §2 (`resolveModel`) → Task 1 Steps 5–6; §3 (selector options) → Task 3 Step 1; §4 (wiring: picker key + route re-validation) → Task 3 Step 2 and Task 2 Step 2; §5 (the other consumer, `ai-import`) → Task 2 Step 3.
- **Deliberate deviation from the spec:** the spec said Azure would map the selected id to the deployment "as today". That is a silent billing bug — Azure routes on `deployment`, so a per-model choice would change only what is priced. This plan pins Azure to its `defaultModelId` in `effectiveModelId`, gives Azure a single picker entry, and skips the route's model check for Azure. Covered by a test in each of Tasks 1 and 3.
- **Placeholder scan:** Task 1 Step 3's test bodies are intentionally specified as behaviour + expected values with the fixture style to copy from `resolve-model.test.ts`, because inventing a second `mock.module('@/server/db')` style would conflict with the existing file. Every other step carries complete code.
- **Type consistency:** `ModelSelector` (Task 1 Step 2) matches `modelSelectorSchema` (Step 1) field-for-field; `keyOf` (Task 3) and `buildSelectorOptions` (Task 3) both produce/consume that same shape; `byokFromRow`'s new `enabledModelIds: string[]` row field matches the Prisma column added on the BYOK branch.
- **Constraint check:** `modelId` optional everywhere; `resolvedModel` is always `effective`; `effectiveModelId` cannot return a non-enabled id; Azure pinned in three places (resolve, route, picker); route re-validates against the caller's own row; exactly one selector schema remains.
