# BYOK — Fetch Models & Enable a Set per Credential — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user fetch a provider's available models when adding a BYOK key, enable **several** of them per credential (searchable multi-select with free-text fallback), and persist that set.

**Architecture:** A new provider-agnostic `listProviderModels` module does one `GET` per provider and returns sorted model ids. A new `aiCredentials.listModels` tRPC procedure calls it with the *in-progress* form values (the credential is not saved yet). `AiProviderCredential` gains `enabledModelIds String[]`; `defaultModelId` stays as the primary (probed at save, priced on). The dialog swaps the free-text model input for a Base UI creatable multi-select.

**Tech Stack:** TypeScript, Next.js 16, tRPC v11, Prisma 7 (Postgres), zod v4, react-hook-form, Base UI Combobox, `bun test`.

**Spec:** `docs/superpowers/specs/2026-07-26-ai-custom-model-list-design.md`

## Global Constraints

- **Never log or leak the API key.** Every provider error surfaced to the client must go through the shared redactor, which replaces the plaintext secret with `[redacted]` and truncates to 300 chars.
- `defaultModelId` **must** be a member of `enabledModelIds` — enforced in the zod input (server) and the form schema (client).
- Only `defaultModelId` is live-probed at save (`probeCredential`); enabling N models must **not** cause N provider calls.
- **Azure is unsupported** for model listing (it lists *deployments*, a different data-plane call). `listProviderModels` returns `{ supported: false }` and the UI keeps free-text entry.
- The secret is **never** persisted by `listModels` — that procedure writes nothing.
- Existing rows must keep working: the migration backfills `enabledModelIds = ARRAY[defaultModelId]`.
- Base UI form controls error when a controlled value flips `undefined → defined`: every new controlled field needs a value in `DEFAULTS` from first render.
- A new `prisma/*.test.ts` file only runs if it is added to the `test:db` script's explicit file list in `package.json`.

---

### Task 1: Persist the enabled-model set

**Files:**
- Modify: `prisma/schema.prisma` (model `AiProviderCredential`, around line 318)
- Create: `prisma/migrations/20260727120000_byok_enabled_models/migration.sql`
- Modify: `src/server/api/routers/ai-credentials.ts` (`AiCredentialView`, and the two `return` shapes in `create`/`list`)
- Create: `prisma/byok-enabled-models.test.ts`
- Modify: `package.json` (`test:db` file list)

**Interfaces:**
- Produces: `AiProviderCredential.enabledModelIds: string[]`; `AiCredentialView.enabledModelIds: string[]` (consumed by Task 3's `create` and Task 4's UI).

- [ ] **Step 1: Add the column to the Prisma schema**

In `prisma/schema.prisma`, inside `model AiProviderCredential`, immediately after the `defaultModelId` line, add:

```prisma
  /// Every model this credential may serve. One key often serves a family
  /// (e.g. Anthropic Opus + Sonnet). `defaultModelId` is the primary and MUST
  /// be a member of this list.
  enabledModelIds String[]
```

- [ ] **Step 2: Write the migration by hand (it needs a backfill)**

Create `prisma/migrations/20260727120000_byok_enabled_models/migration.sql`:

```sql
-- AlterTable: add the enabled-model set, defaulting to empty so existing rows can be added to.
ALTER TABLE "AiProviderCredential" ADD COLUMN "enabledModelIds" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- Backfill: every pre-existing credential serves exactly the model it was created with.
UPDATE "AiProviderCredential"
SET "enabledModelIds" = ARRAY["defaultModelId"]
WHERE "enabledModelIds" IS NULL OR cardinality("enabledModelIds") = 0;

-- Now that no row is null, enforce NOT NULL (Prisma's String[] is non-nullable).
ALTER TABLE "AiProviderCredential" ALTER COLUMN "enabledModelIds" SET NOT NULL;
```

- [ ] **Step 3: Apply the migration and regenerate the client**

Run:

```bash
bun run db:migrate && bunx prisma generate
```

Expected: the migration applies cleanly and the client regenerates. If your local DB is empty the backfill is a no-op — that is fine, Step 6 tests the backfill explicitly.

- [ ] **Step 4: Expose the field in the client-facing view**

In `src/server/api/routers/ai-credentials.ts`, add the field to the `AiCredentialView` type (keep the keys alphabetical — the file is biome-sorted):

```ts
export type AiCredentialView = {
	createdAt: Date;
	defaultModelId: string;
	deployment: string | null;
	enabled: boolean;
	enabledModelIds: string[];
	hint: string | null;
	id: string;
	label: string | null;
	lastUsedAt: Date | null;
	lastVerifiedAt: Date | null;
	provider: ByokProvider;
	resourceName: string | null;
};
```

Then add `enabledModelIds: row.enabledModelIds,` to **both** returned object literals — the one at the end of `create` (after `enabled: row.enabled,`) and the one inside `list`'s `rows.map` (same position).

- [ ] **Step 5: Write the failing DB test**

Create `prisma/byok-enabled-models.test.ts`. Follow the existing Pattern-B style in `prisma/ai-schema.test.ts` for imports and user seeding:

```ts
import { describe, expect, test } from 'bun:test';
import { db } from '@/server/db';
import { seedUser } from './helpers';

const BYTES = new Uint8Array([1, 2, 3, 4]);

async function makeCredential(userId: string, defaultModelId: string, enabledModelIds: string[]) {
	return db.aiProviderCredential.create({
		data: {
			authTag: BYTES,
			ciphertext: BYTES,
			defaultModelId,
			enabledModelIds,
			iv: BYTES,
			kid: 'k1',
			provider: 'ANTHROPIC',
			userId
		}
	});
}

describe('AiProviderCredential.enabledModelIds', () => {
	test('round-trips a multi-model set', async () => {
		const user = await seedUser('byok-enabled-multi');
		const row = await makeCredential(user.id, 'claude-opus-5', ['claude-opus-5', 'claude-sonnet-5']);

		const read = await db.aiProviderCredential.findUniqueOrThrow({ where: { id: row.id } });
		expect(read.enabledModelIds).toEqual(['claude-opus-5', 'claude-sonnet-5']);
		expect(read.enabledModelIds).toContain(read.defaultModelId);
	});

	test('the migration backfills a legacy row to exactly its defaultModelId', async () => {
		// Simulate a pre-migration row: the column exists now, so emulate the legacy state by
		// clearing it, then run the migration's backfill statement verbatim and assert the result.
		const user = await seedUser('byok-enabled-backfill');
		const row = await makeCredential(user.id, 'claude-opus-5', []);

		await db.$executeRawUnsafe(`
			UPDATE "AiProviderCredential"
			SET "enabledModelIds" = ARRAY["defaultModelId"]
			WHERE cardinality("enabledModelIds") = 0 AND "id" = $1
		`, row.id);

		const read = await db.aiProviderCredential.findUniqueOrThrow({ where: { id: row.id } });
		expect(read.enabledModelIds).toEqual(['claude-opus-5']);
	});
});
```

If `prisma/helpers.ts` does not export `seedUser`, open `prisma/ai-schema.test.ts` and copy whatever user-seeding helper it uses — do not invent a new one.

- [ ] **Step 6: Register the test file and run it**

In `package.json`, append ` prisma/byok-enabled-models.test.ts` to the end of the `test:db` command string (the list is explicit — an unlisted file never runs).

Run:

```bash
bun test prisma/byok-enabled-models.test.ts
```

Expected: 2 pass, 0 fail.

- [ ] **Step 7: Typecheck, lint, commit**

```bash
bun run typecheck && bunx @biomejs/biome check --write prisma/byok-enabled-models.test.ts src/server/api/routers/ai-credentials.ts
git add prisma/schema.prisma prisma/migrations src/server/api/routers/ai-credentials.ts prisma/byok-enabled-models.test.ts package.json
git commit -m "feat(ai): BYOK credentials carry an enabled-model set"
```

---

### Task 2: Provider model listing

**Files:**
- Create: `src/server/ai/provider-errors.ts`
- Modify: `src/server/ai/probe.ts` (use the shared redactor instead of its private copy)
- Create: `src/server/ai/list-models.ts`
- Create: `src/server/ai/list-models.test.ts`

**Interfaces:**
- Consumes: `normalizeBaseUrl` from `@/server/ai/credential-config`; `ByokProvider` from `@/server/ai/probe`.
- Produces: `safeProviderErrorMessage(error: unknown, secretPlaintext: string): string`; `listProviderModels(params: ListModelsParams): Promise<ListModelsResult>` (consumed by Task 3).

- [ ] **Step 1: Extract the error redactor into a shared module**

`probe.ts` already has exactly the redaction logic we need, but it is private and typed to `Secret`. Create `src/server/ai/provider-errors.ts`:

```ts
/**
 * Provider SDK and HTTP errors embed the request config, INCLUDING the auth header.
 * Serialising one into a tRPC error body leaks the user's key straight back to the
 * browser (and into any log that captures it). Pick fields explicitly, redact the
 * plaintext defensively, and truncate.
 *
 * Shared by the save-time probe (`probe.ts`) and model listing (`list-models.ts`) so
 * there is exactly one redaction implementation to audit.
 */
export function safeProviderErrorMessage(error: unknown, secretPlaintext: string): string {
	const raw = error instanceof Error ? `${error.name}: ${error.message}` : 'Unknown provider error';
	return raw.replaceAll(secretPlaintext, '[redacted]').slice(0, 300);
}
```

- [ ] **Step 2: Point `probe.ts` at the shared redactor**

In `src/server/ai/probe.ts`, delete the private `safeErrorMessage` function (and its docstring), add the import, and update the single call site:

```ts
// add near the other imports
import { safeProviderErrorMessage } from '@/server/ai/provider-errors';
```

```ts
// in probeCredential's catch — before:
		return { error: safeErrorMessage(error, secret), ok: false };
// after:
		return { error: safeProviderErrorMessage(error, secret.expose()), ok: false };
```

- [ ] **Step 3: Write the failing tests for `listProviderModels`**

Create `src/server/ai/list-models.test.ts`:

```ts
import { afterEach, describe, expect, test } from 'bun:test';
import { listProviderModels } from './list-models';

const originalFetch = globalThis.fetch;
afterEach(() => {
	globalThis.fetch = originalFetch;
});

/** Records the requests the module makes, and replies with a fixed JSON body. */
function mockFetch(body: unknown, init?: { ok?: boolean; status?: number }) {
	const calls: Array<{ url: string; headers: Record<string, string> }> = [];
	globalThis.fetch = (async (input: RequestInfo | URL, options?: RequestInit) => {
		calls.push({ headers: (options?.headers ?? {}) as Record<string, string>, url: String(input) });
		return {
			json: async () => body,
			ok: init?.ok ?? true,
			status: init?.status ?? 200,
			statusText: 'OK'
		} as Response;
	}) as typeof fetch;
	return calls;
}

describe('listProviderModels', () => {
	test('OPENAI parses data[].id, sorts, and de-duplicates', async () => {
		const calls = mockFetch({ data: [{ id: 'gpt-5' }, { id: 'gpt-4' }, { id: 'gpt-5' }] });
		const result = await listProviderModels({ provider: 'OPENAI', secret: 'sk-test-key' });

		expect(result).toEqual({ models: ['gpt-4', 'gpt-5'], supported: true });
		expect(calls[0]?.url).toBe('https://api.openai.com/v1/models');
		expect(calls[0]?.headers.Authorization).toBe('Bearer sk-test-key');
	});

	test('OPENAI_COMPATIBLE uses the supplied baseURL, normalised', async () => {
		const calls = mockFetch({ data: [{ id: 'llama-3' }] });
		const result = await listProviderModels({
			baseURL: 'https://ollama.example.com/v1/',
			provider: 'OPENAI_COMPATIBLE',
			secret: 'sk-test-key'
		});

		expect(result).toEqual({ models: ['llama-3'], supported: true });
		// normalizeBaseUrl strips the trailing slash AND the trailing /v1 before we re-append it.
		expect(calls[0]?.url).toBe('https://ollama.example.com/v1/models');
	});

	test('ANTHROPIC sends x-api-key and the pinned anthropic-version', async () => {
		const calls = mockFetch({ data: [{ id: 'claude-opus-5' }] });
		const result = await listProviderModels({ provider: 'ANTHROPIC', secret: 'sk-ant-key' });

		expect(result).toEqual({ models: ['claude-opus-5'], supported: true });
		expect(calls[0]?.url).toBe('https://api.anthropic.com/v1/models');
		expect(calls[0]?.headers['x-api-key']).toBe('sk-ant-key');
		expect(calls[0]?.headers['anthropic-version']).toBe('2023-06-01');
	});

	test('GOOGLE strips the models/ prefix', async () => {
		mockFetch({ models: [{ name: 'models/gemini-3-pro' }, { name: 'models/gemini-3-flash' }] });
		const result = await listProviderModels({ provider: 'GOOGLE', secret: 'goog-key' });

		expect(result).toEqual({ models: ['gemini-3-flash', 'gemini-3-pro'], supported: true });
	});

	test('AZURE is unsupported and makes no request', async () => {
		const calls = mockFetch({ data: [] });
		const result = await listProviderModels({ provider: 'AZURE', secret: 'azure-key' });

		expect(result).toEqual({ supported: false });
		expect(calls).toHaveLength(0);
	});

	test('a non-2xx response throws, and the message never contains the secret', async () => {
		mockFetch({}, { ok: false, status: 401 });
		const promise = listProviderModels({ provider: 'OPENAI', secret: 'sk-super-secret' });

		await expect(promise).rejects.toThrow(/401/);
		await promise.catch((err: unknown) => {
			expect(String(err)).not.toContain('sk-super-secret');
		});
	});

	test('OPENAI_COMPATIBLE without a baseURL throws rather than hitting OpenAI', async () => {
		const calls = mockFetch({ data: [] });
		await expect(listProviderModels({ provider: 'OPENAI_COMPATIBLE', secret: 'sk-x' })).rejects.toThrow();
		expect(calls).toHaveLength(0);
	});

	test('ignores malformed entries instead of emitting empty ids', async () => {
		mockFetch({ data: [{ id: 'gpt-5' }, { id: '' }, { notAnId: true }, null] });
		const result = await listProviderModels({ provider: 'OPENAI', secret: 'sk-test-key' });

		expect(result).toEqual({ models: ['gpt-5'], supported: true });
	});
});
```

- [ ] **Step 4: Run the tests to verify they fail**

Run: `bun test src/server/ai/list-models.test.ts`
Expected: FAIL — `Cannot find module './list-models'`.

- [ ] **Step 5: Implement `list-models.ts`**

Create `src/server/ai/list-models.ts`:

```ts
import { normalizeBaseUrl } from '@/server/ai/credential-config';
import type { ByokProvider } from '@/server/ai/probe';

export type ListModelsParams = {
	baseURL?: string | null;
	provider: ByokProvider;
	secret: string;
};

export type ListModelsResult = { models: string[]; supported: true } | { supported: false };

/** Anthropic requires a pinned API version header; this is the stable public value. */
const ANTHROPIC_VERSION = '2023-06-01';
const TIMEOUT_MS = 10_000;
/** A misbehaving endpoint must not be able to push an unbounded list into the browser. */
const MAX_MODELS = 500;

const DEFAULT_BASE_URLS = {
	ANTHROPIC: 'https://api.anthropic.com',
	GOOGLE: 'https://generativelanguage.googleapis.com',
	OPENAI: 'https://api.openai.com'
} as const;

/**
 * `normalizeBaseUrl` strips a trailing `/v1` (the Azure `/v1/v1` trap), so every caller
 * re-appends the full path it needs. That keeps one normalisation rule for what a user pastes.
 */
function resolveBase(raw: string | null | undefined, fallback: string): string {
	const trimmed = raw?.trim();
	return trimmed ? normalizeBaseUrl(trimmed) : fallback;
}

async function getJson(url: string, headers: Record<string, string>): Promise<unknown> {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
	try {
		const response = await fetch(url, { headers, signal: controller.signal });
		if (!response.ok) {
			throw new Error(`The provider returned ${response.status} ${response.statusText}`);
		}
		return await response.json();
	} finally {
		clearTimeout(timer);
	}
}

/** Sort, de-duplicate, drop blanks, and bound the list. */
function tidy(ids: Array<string | undefined>): string[] {
	const clean = ids.filter((id): id is string => typeof id === 'string' && id.trim().length > 0);
	return Array.from(new Set(clean.map((id) => id.trim())))
		.sort()
		.slice(0, MAX_MODELS);
}

/** `{ data: [{ id }] }` — OpenAI's /v1/models shape, which Anthropic also uses. */
function idsFromDataArray(payload: unknown): string[] {
	const data = (payload as { data?: unknown })?.data;
	if (!Array.isArray(data)) return [];
	return tidy(data.map((entry) => (entry as { id?: string } | null)?.id));
}

/** `{ models: [{ name: 'models/gemini-x' }] }` — Google's ListModels shape. */
function idsFromGoogleModels(payload: unknown): string[] {
	const models = (payload as { models?: unknown })?.models;
	if (!Array.isArray(models)) return [];
	return tidy(models.map((entry) => (entry as { name?: string } | null)?.name?.replace(/^models\//, '')));
}

/**
 * List the models a BYOK credential can serve.
 *
 * Called with the values a user has typed into the add-key dialog — the credential row does
 * not exist yet — so it takes a plaintext secret rather than a userId. It performs no writes.
 *
 * AZURE is deliberately unsupported: Azure exposes *deployments*, not models, via a different
 * data-plane call, and a deployment name is not the model name we price on.
 */
export async function listProviderModels(params: ListModelsParams): Promise<ListModelsResult> {
	const { baseURL, provider, secret } = params;

	if (provider === 'AZURE') return { supported: false };

	if (provider === 'GOOGLE') {
		const base = resolveBase(baseURL, DEFAULT_BASE_URLS.GOOGLE);
		const payload = await getJson(`${base}/v1beta/models?key=${encodeURIComponent(secret)}`, {});
		return { models: idsFromGoogleModels(payload), supported: true };
	}

	if (provider === 'ANTHROPIC') {
		const base = resolveBase(baseURL, DEFAULT_BASE_URLS.ANTHROPIC);
		const payload = await getJson(`${base}/v1/models`, {
			'anthropic-version': ANTHROPIC_VERSION,
			'x-api-key': secret
		});
		return { models: idsFromDataArray(payload), supported: true };
	}

	if (provider === 'OPENAI_COMPATIBLE' && !baseURL?.trim()) {
		throw new Error('A base URL is required to list models for an OpenAI-compatible provider.');
	}

	const base = resolveBase(baseURL, DEFAULT_BASE_URLS.OPENAI);
	const payload = await getJson(`${base}/v1/models`, { Authorization: `Bearer ${secret}` });
	return { models: idsFromDataArray(payload), supported: true };
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `bun test src/server/ai/list-models.test.ts`
Expected: 8 pass, 0 fail.

- [ ] **Step 7: Verify the probe refactor did not break its tests**

Run: `bun test src/server/ai/probe.test.ts`
Expected: PASS (if no such file exists, run `bun test src/server/ai` and expect no new failures).

- [ ] **Step 8: Typecheck, lint, commit**

```bash
bun run typecheck && bunx @biomejs/biome check --write src/server/ai/list-models.ts src/server/ai/list-models.test.ts src/server/ai/provider-errors.ts src/server/ai/probe.ts
git add src/server/ai/list-models.ts src/server/ai/list-models.test.ts src/server/ai/provider-errors.ts src/server/ai/probe.ts
git commit -m "feat(ai): list a BYOK provider's available models"
```

---

### Task 3: `aiCredentials.listModels` + persist the enabled set

**Files:**
- Modify: `src/server/api/routers/ai-credentials.ts`
- Create: `src/server/api/routers/ai-credentials-list-models.test.ts`

**Interfaces:**
- Consumes: `listProviderModels` + `ListModelsResult` (Task 2); `enabledModelIds` column (Task 1).
- Produces: `aiCredentials.listModels` procedure; `create` accepting `enabledModelIds` (consumed by Task 4).

- [ ] **Step 1: Add `enabledModelIds` to the create input**

In `src/server/api/routers/ai-credentials.ts`, add the field to `createInput`'s object (keys are alphabetical):

```ts
		enabledModelIds: z.array(z.string().min(1).max(120)).min(1).max(100),
```

and add this check as the **first** statement inside the existing `.superRefine((value, ctx) => {` block:

```ts
			if (!value.enabledModelIds.includes(value.defaultModelId)) {
				ctx.addIssue({
					code: 'custom',
					message: 'The primary model must be one of the enabled models.',
					path: ['defaultModelId']
				});
			}
```

- [ ] **Step 2: Persist it in the upsert**

In `create`, add `enabledModelIds: input.enabledModelIds,` to **both** the `create:` and `update:` objects of `ctx.db.aiProviderCredential.upsert` (alphabetically, right after `defaultModelId`/`deployment` — biome sorts these keys, so place it where `--write` leaves it).

> Note: only `defaultModelId` is probed. Enabling N models must not trigger N provider calls — `probeCredential(config, secret)` is called exactly once, unchanged.

- [ ] **Step 3: Define the listModels input schema**

Add above `aiCredentialsRouter` (after `createInput`):

```ts
const listModelsInput = z
	.object({
		baseURL: z.url().max(500).optional(),
		provider: providerSchema,
		secret: z.string().min(8).max(500)
	})
	.superRefine((value, ctx) => {
		if (value.provider === 'OPENAI_COMPATIBLE' && !value.baseURL) {
			ctx.addIssue({ code: 'custom', message: 'A base URL is required.', path: ['baseURL'] });
		}
	});
```

- [ ] **Step 4: Add the procedure**

Add this member to `aiCredentialsRouter`, placed after `list` (the router's members read alphabetically: `create`, `delete`, `list`, `listModels`):

```ts
	/**
	 * List the models a provider offers, using the key the user has just typed — the
	 * credential row does not exist yet, so this cannot go through `resolveModel`.
	 *
	 * Persists NOTHING. Errors are redacted before they reach the browser: a provider
	 * error can embed the request config, including the auth header.
	 */
	listModels: protectedProcedure.input(listModelsInput).mutation(async ({ input }): Promise<ListModelsResult> => {
		try {
			return await listProviderModels({
				baseURL: input.baseURL ?? null,
				provider: input.provider,
				secret: input.secret
			});
		} catch (error) {
			throw new TRPCError({
				code: 'BAD_REQUEST',
				message: `Could not list models: ${safeProviderErrorMessage(error, input.secret)}`
			});
		}
	})
```

Add the imports:

```ts
import { type ListModelsResult, listProviderModels } from '@/server/ai/list-models';
import { safeProviderErrorMessage } from '@/server/ai/provider-errors';
```

- [ ] **Step 5: Write the tests**

Create `src/server/api/routers/ai-credentials-list-models.test.ts`. This exercises the schema + the error-redaction wrapper without a DB (the procedure touches neither `ctx.db` nor the session beyond auth):

```ts
import { describe, expect, test } from 'bun:test';
import { safeProviderErrorMessage } from '@/server/ai/provider-errors';

describe('safeProviderErrorMessage', () => {
	test('replaces every occurrence of the secret', () => {
		const error = new Error('401 from https://api.openai.com with key sk-secret-123 (sk-secret-123)');
		const message = safeProviderErrorMessage(error, 'sk-secret-123');

		expect(message).not.toContain('sk-secret-123');
		expect(message).toContain('[redacted]');
	});

	test('truncates to 300 characters', () => {
		const message = safeProviderErrorMessage(new Error('x'.repeat(500)), 'sk-x');
		expect(message.length).toBe(300);
	});

	test('handles a non-Error throw without leaking the secret', () => {
		expect(safeProviderErrorMessage('sk-secret-123', 'sk-secret-123')).toBe('Unknown provider error');
	});
});
```

- [ ] **Step 6: Run the tests**

Run: `bun test src/server/api/routers/ai-credentials-list-models.test.ts`
Expected: 3 pass, 0 fail.

- [ ] **Step 7: Typecheck, lint, commit**

```bash
bun run typecheck && bunx @biomejs/biome check --write src/server/api/routers/ai-credentials.ts src/server/api/routers/ai-credentials-list-models.test.ts
git add src/server/api/routers/ai-credentials.ts src/server/api/routers/ai-credentials-list-models.test.ts
git commit -m "feat(ai): aiCredentials.listModels + persist the enabled-model set"
```

---

### Task 4: Dialog — fetch models and enable a set

**Files:**
- Modify: `src/app/(dashboard)/account/_components/ai-credentials-card.tsx`

**Interfaces:**
- Consumes: `api.aiCredentials.listModels` (Task 3); `enabledModelIds` on the create input (Task 3) and on `AiCredentialView` (Task 1).

- [ ] **Step 1: Extend the form schema and defaults**

Replace the `formSchema` / `DEFAULTS` block (currently lines 46–61) with:

```ts
const formSchema = z
	.object({
		apiVersion: z.string().optional(),
		baseURL: z.string().optional(),
		defaultModelId: z.string().min(1, 'Pick a primary model'),
		deployment: z.string().optional(),
		enabledModelIds: z.array(z.string().min(1)).min(1, 'Enable at least one model'),
		label: z.string().optional(),
		provider: z.enum(['ANTHROPIC', 'AZURE', 'GOOGLE', 'OPENAI', 'OPENAI_COMPATIBLE']),
		resourceName: z.string().optional(),
		secret: z.string().min(8, 'Enter your API key')
	})
	.refine((value) => value.enabledModelIds.includes(value.defaultModelId), {
		message: 'The primary model must be one of the enabled models',
		path: ['defaultModelId']
	});

type FormValues = z.infer<typeof formSchema>;

/** Providers that expose a model list. Azure lists deployments, not models. */
const MODEL_LISTING_PROVIDERS = new Set<FormValues['provider']>([
	'ANTHROPIC',
	'GOOGLE',
	'OPENAI',
	'OPENAI_COMPATIBLE'
]);

// Base UI form controls error when a controlled value flips undefined -> defined, so
// `provider` and `enabledModelIds` MUST have defaults here (baseui-controlled-uncontrolled).
const DEFAULTS: Partial<FormValues> = {
	defaultModelId: 'gpt-5.4-mini',
	enabledModelIds: ['gpt-5.4-mini'],
	provider: 'AZURE'
};
```

- [ ] **Step 2: Add the imports**

Add to the import block:

```ts
import {
	Combobox,
	ComboboxChip,
	ComboboxChips,
	ComboboxChipsInput,
	ComboboxContent,
	ComboboxEmpty,
	ComboboxItem,
	ComboboxList,
	ComboboxValue
} from '@/components/ui/combobox';
```

and add `Download` to the existing `lucide-react` import (used for the fetch button icon).

- [ ] **Step 3: Add the component state and the listModels mutation**

Inside `AiCredentialsCard`, after the existing `const provider = watch('provider');` line, add:

```ts
	const [modelQuery, setModelQuery] = useState('');
	const [fetchedModels, setFetchedModels] = useState<string[]>([]);

	const enabledModelIds = watch('enabledModelIds') ?? [];
	const defaultModelId = watch('defaultModelId');
	const canListModels = MODEL_LISTING_PROVIDERS.has(provider);

	const listModelsMutation = api.aiCredentials.listModels.useMutation({
		onError: (error) => toast.error(error.message),
		onSuccess: (result) => {
			if (!result.supported) {
				toast.info('Model listing is not available for this provider — type the model id instead.');
				return;
			}
			setFetchedModels(result.models);
			toast.success(
				result.models.length > 0
					? `Found ${result.models.length} model(s)`
					: 'The provider returned no models — you can still type an id.'
			);
		}
	});

	// The typed text becomes a selectable row when it is not already a known model, so a
	// custom/unlisted id can always be added without a separate free-text field.
	const trimmedQuery = modelQuery.trim();
	const modelItems =
		trimmedQuery !== '' && !fetchedModels.includes(trimmedQuery)
			? [...fetchedModels, trimmedQuery]
			: fetchedModels;
```

Also add `getValues` to the destructured `useForm(...)` result (alongside `handleSubmit`, `register`, …) — it is used in Step 4 to read the current primary without a stale closure.

- [ ] **Step 4: Replace the model-id Field**

Replace the whole `Field` block that currently renders `byok-model` (lines 225–232) with:

```tsx
							<Field>
								<div className='flex items-center justify-between gap-2'>
									<FieldLabel htmlFor='byok-model'>Models</FieldLabel>
									<Button
										disabled={
											!canListModels ||
											listModelsMutation.isPending ||
											(watch('secret') ?? '').length < 8 ||
											(provider === 'OPENAI_COMPATIBLE' && !watch('baseURL'))
										}
										onClick={() =>
											listModelsMutation.mutate({
												baseURL: watch('baseURL') || undefined,
												provider,
												secret: watch('secret')
											})
										}
										size='sm'
										type='button'
										variant='outline'
									>
										{listModelsMutation.isPending ? <Spinner /> : <Download className='size-4' />}
										Fetch models
									</Button>
								</div>

								<Combobox
									items={modelItems}
									multiple
									inputValue={modelQuery}
									onInputValueChange={setModelQuery}
									onValueChange={(next: string[]) => {
										setValue('enabledModelIds', next, { shouldValidate: true });
										// Keep the primary valid: default to the first enabled model.
										if (next.length > 0 && !next.includes(getValues('defaultModelId'))) {
											setValue('defaultModelId', next[0] as string, { shouldValidate: true });
										}
										setModelQuery('');
									}}
									value={enabledModelIds}
								>
									<ComboboxChips>
										<ComboboxValue>
											{(value: string[]) => (
												<>
													{value.map((model) => (
														<ComboboxChip aria-label={model} key={model}>
															{model}
														</ComboboxChip>
													))}
													<ComboboxChipsInput
														id='byok-model'
														placeholder={value.length > 0 ? '' : 'gpt-5.4-mini'}
													/>
												</>
											)}
										</ComboboxValue>
									</ComboboxChips>
									<ComboboxContent>
										<ComboboxEmpty>Type a model id to add it.</ComboboxEmpty>
										<ComboboxList>
											{(item: string) => (
												<ComboboxItem key={item} value={item}>
													{item}
													{!fetchedModels.includes(item) ? (
														<span className='ml-auto text-muted-foreground text-xs'>
															custom
														</span>
													) : null}
												</ComboboxItem>
											)}
										</ComboboxList>
									</ComboboxContent>
								</Combobox>

								<p className='text-muted-foreground text-xs'>
									{canListModels
										? 'Fetch the list, or type any model id to add it. One key often serves several models.'
										: 'Azure lists deployments rather than models — type the model id. This is NOT the deployment name.'}
								</p>
								<p className='text-muted-foreground text-xs'>
									A model we have no published price for is recorded as an unknown-price call.
								</p>
								<FieldError errors={[errors.enabledModelIds, errors.defaultModelId]} />
							</Field>

							{enabledModelIds.length > 1 ? (
								<Field>
									<FieldLabel htmlFor='byok-primary'>Primary model</FieldLabel>
									<Select
										items={enabledModelIds}
										onValueChange={(value) => setValue('defaultModelId', value as string)}
										value={defaultModelId}
									>
										<SelectTrigger className='w-full' id='byok-primary'>
											<SelectValue />
										</SelectTrigger>
										<SelectContent>
											{enabledModelIds.map((model) => (
												<SelectItem key={model} value={model}>
													{model}
												</SelectItem>
											))}
										</SelectContent>
									</Select>
									<p className='text-muted-foreground text-xs'>
										Used when a request does not name a model — and the one we verify on save.
									</p>
								</Field>
							) : null}
```

- [ ] **Step 5: Send the new field on submit**

In `onSubmit`, add to the `createMutation.mutate({ … })` object (alphabetically, after `deployment`):

```ts
			enabledModelIds: values.enabledModelIds,
```

- [ ] **Step 6: Show every enabled model in the credential list**

In the credentials list, replace the single badge:

```tsx
									<Badge variant='outline'>{credential.defaultModelId}</Badge>
```

with one badge per enabled model, marking the primary:

```tsx
									{(credential.enabledModelIds.length > 0
										? credential.enabledModelIds
										: [credential.defaultModelId]
									).map((model) => (
										<Badge
											key={model}
											variant={model === credential.defaultModelId ? 'default' : 'outline'}
										>
											{model}
										</Badge>
									))}
```

- [ ] **Step 7: Reset the transient model state when the dialog closes**

So a second "Add key" does not show the previous provider's fetched list, change the create mutation's `onSuccess` reset and the Cancel button to also clear it. In `createMutation`'s `onSuccess`, after `reset(DEFAULTS);` add:

```ts
				setFetchedModels([]);
				setModelQuery('');
```

and change the Cancel button's handler to:

```tsx
							<Button
								onClick={() => {
									setDialogOpen(false);
									setFetchedModels([]);
									setModelQuery('');
								}}
								type='button'
								variant='outline'
							>
								Cancel
							</Button>
```

- [ ] **Step 8: Verify the whole suite, typecheck and lint**

```bash
bun run typecheck && bun run check && bun run test:unit
```

Expected: typecheck 0; biome clean; unit suite green with no new failures.

- [ ] **Step 9: Manual smoke check**

Start the dev server (`bun run dev`), open **Account → AI provider keys → Add key**, and confirm:
1. Provider `OpenAI` + a key → **Fetch models** populates the dropdown; picking two shows two chips and a **Primary model** select appears.
2. Typing an unlisted id shows it as a row tagged `custom`; selecting it adds a chip.
3. Provider `Azure OpenAI` → the fetch button is disabled and the Azure helper text shows; typing still works.

- [ ] **Step 10: Commit**

```bash
git add "src/app/(dashboard)/account/_components/ai-credentials-card.tsx"
git commit -m "feat(ai): fetch and multi-select BYOK models in the add-key dialog"
```

---

## Self-Review

- **Spec coverage:** Component 1 (listing module) → Task 2; Component 2 (tRPC procedure) → Task 3; Component 3 (create/storage) → Tasks 1 + 3; Component 4 (frontend) → Task 4. The data-model change and its migration/backfill → Task 1.
- **Placeholder scan:** no TBD/TODO; every code step carries complete code. Step 5 of Task 1 names a fallback (copy the seeding helper from `ai-schema.test.ts`) rather than inventing an API.
- **Type consistency:** `enabledModelIds: string[]` is used identically in the Prisma model, `AiCredentialView`, `createInput`, the form schema, and the combobox `value`. `ListModelsResult` is the single return type shared by `listProviderModels` and the tRPC procedure. `safeProviderErrorMessage(error, plaintext)` has one signature, used by both `probe.ts` and the router.
- **Constraint check:** redaction is centralised and applied on the only client-facing error path; `defaultModelId ∈ enabledModelIds` is enforced server-side (Task 3 Step 1) and client-side (Task 4 Step 1); Azure short-circuits before any request; `listModels` performs no writes; the migration backfills; new controlled fields have defaults; the new DB test is registered in `test:db`.
