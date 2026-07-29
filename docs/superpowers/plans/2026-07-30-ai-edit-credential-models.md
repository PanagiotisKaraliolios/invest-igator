# BYOK — Edit an Existing Credential's Model Set — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user add or remove models on a credential they have **already saved**, without re-pasting the API key.

**Problem:** the multi-model chooser only exists in the *add* dialog. `aiCredentialsRouter` has `create`, `delete`, `list`, `listModels` and **no update**, and each credential row renders only a delete button. So adding `claude-opus-5` to an already-verified Anthropic key means re-adding it and re-pasting a secret the UI deliberately never shows again.

**Architecture:** the server can already decrypt a stored secret (`open()`), so both new procedures work from the stored credential and the browser never re-sends the key. A pencil button opens an edit dialog that reuses the *same* model-chooser component as the add dialog — extracted, not duplicated.

**Tech Stack:** TypeScript, tRPC v11, zod v4, Prisma 7, react-hook-form, Base UI Combobox, `bun test`.

## Global Constraints

- **The plaintext key never leaves the server and is never re-sent by the browser.** Both new procedures take only a `provider` (plus the model set) and decrypt server-side.
- **Never log or leak the key.** Any provider error surfaced to the client goes through `safeProviderErrorMessage`.
- `defaultModelId` **must** be a member of `enabledModelIds` — enforced in the zod input AND the client form schema.
- **Only the primary model is probed** on save — one provider call, matching `create`. Enabling N models must not cause N calls.
- **Tenancy:** every credential lookup is scoped by `userId`. A provider the caller does not own must resolve to a not-found, never another tenant's row.
- **No duplicated JSX.** The add and edit dialogs must render the *same* extracted model-chooser component; copying the Combobox block is a defect.
- Base UI form controls error when a controlled value flips `undefined → defined`: every controlled field needs a defined value from first render.

---

### Task 1: `listStoredModels` + `updateModels`

**Files:**
- Modify: `src/server/api/routers/ai-credentials.ts`
- Create: `src/server/api/routers/ai-credentials-update-models.test.ts`

**Interfaces:**
- Consumes: `open` from `@/server/ai/crypto`; `probeCredential` + `ByokConfig` from `@/server/ai/probe`; `listProviderModels` + `ListModelsResult` from `@/server/ai/list-models`; `safeProviderErrorMessage` from `@/server/ai/provider-errors`; `maskHint` from `@/server/ai/credential-config`.
- Produces: `aiCredentials.listStoredModels({ provider })` and `aiCredentials.updateModels({ provider, enabledModelIds, defaultModelId })` (consumed by Task 2).

- [ ] **Step 1: Add the input schemas**

In `src/server/api/routers/ai-credentials.ts`, after the existing `listModelsInput`, add:

```ts
const storedProviderInput = z.object({ provider: providerSchema });

const updateModelsInput = z
	.object({
		defaultModelId: z.string().min(1).max(120),
		enabledModelIds: z.array(z.string().min(1).max(120)).min(1).max(100),
		provider: providerSchema
	})
	.superRefine((value, ctx) => {
		if (!value.enabledModelIds.includes(value.defaultModelId)) {
			ctx.addIssue({
				code: 'custom',
				message: 'The primary model must be one of the enabled models.',
				path: ['defaultModelId']
			});
		}
	});
```

- [ ] **Step 2: Add the shared load-and-decrypt helper**

Above `aiCredentialsRouter`, add:

```ts
/**
 * Load the caller's OWN enabled credential for a provider and decrypt its secret.
 *
 * This is what lets the edit flow work without the browser re-sending the key: the plaintext
 * exists only inside this request. Scoped by `userId`, so a provider the caller does not own is
 * a NOT_FOUND rather than another tenant's row.
 *
 * A decrypt failure is NOT "this row is corrupt, delete it" — the sealing key may simply have
 * been retired from the keyring. Surface it as an actionable precondition instead.
 */
async function loadOwnCredential(db: PrismaClient, userId: string, provider: ByokProvider) {
	const row = await db.aiProviderCredential.findFirst({ where: { enabled: true, provider, userId } });
	if (row === null) {
		throw new TRPCError({ code: 'NOT_FOUND', message: 'No saved key for this provider.' });
	}
	try {
		const secret = open(
			{ authTag: row.authTag, ciphertext: row.ciphertext, iv: row.iv, kid: row.kid },
			userId,
			provider
		);
		return { row, secret };
	} catch {
		throw new TRPCError({
			code: 'PRECONDITION_FAILED',
			message: 'This key cannot be read — the encryption key that sealed it was retired. Re-add the key.'
		});
	}
}
```

Import `PrismaClient` as a type from wherever the repo already exposes it (check how another router types `ctx.db`; if there is no convenient export, type the parameter as `typeof import('@/server/db').db` rather than inventing a new alias).

- [ ] **Step 3: Add both procedures**

Add these members to `aiCredentialsRouter`, keeping members alphabetical (`create`, `delete`, `list`, `listModels`, `listStoredModels`, `updateModels`):

```ts
	/**
	 * List a SAVED credential's available models, using the stored key. The browser never sends
	 * the secret for an existing credential — it does not have it. Persists nothing.
	 */
	listStoredModels: protectedProcedure
		.input(storedProviderInput)
		.mutation(async ({ ctx, input }): Promise<ListModelsResult> => {
			const { row, secret } = await loadOwnCredential(ctx.db, ctx.session.user.id, input.provider);
			try {
				return await listProviderModels({
					baseURL: row.baseURL,
					provider: input.provider,
					secret: secret.expose()
				});
			} catch (error) {
				throw new TRPCError({
					code: 'BAD_REQUEST',
					message: `Could not list models: ${safeProviderErrorMessage(error, secret.expose())}`
				});
			}
		}),

	/**
	 * Change which models a saved credential serves, without touching the key.
	 *
	 * The NEW primary is probed with the stored secret, so choosing a model this key cannot serve
	 * fails here rather than mid-conversation. Only the primary is probed — enabling N models must
	 * not cost N provider calls.
	 */
	updateModels: protectedProcedure
		.input(updateModelsInput)
		.mutation(async ({ ctx, input }): Promise<AiCredentialView> => {
			const { row, secret } = await loadOwnCredential(ctx.db, ctx.session.user.id, input.provider);

			const config: ByokConfig = {
				apiVersion: row.apiVersion,
				baseURL: row.baseURL,
				defaultModelId: input.defaultModelId,
				deployment: row.deployment,
				provider: input.provider,
				resourceName: row.resourceName
			};
			const probe = await probeCredential(config, secret);
			if (!probe.ok) {
				throw new TRPCError({
					code: 'BAD_REQUEST',
					message: `The provider rejected this model: ${probe.error}`
				});
			}

			// `row` was already scoped by userId, so updating by its id cannot cross tenants.
			const updated = await ctx.db.aiProviderCredential.update({
				data: {
					defaultModelId: input.defaultModelId,
					enabledModelIds: input.enabledModelIds,
					lastVerifiedAt: new Date()
				},
				where: { id: row.id }
			});

			return {
				createdAt: updated.createdAt,
				defaultModelId: updated.defaultModelId,
				deployment: updated.deployment,
				enabled: updated.enabled,
				enabledModelIds: updated.enabledModelIds,
				hint: maskHint(secret.expose()),
				id: updated.id,
				label: updated.label,
				lastUsedAt: updated.lastUsedAt,
				lastVerifiedAt: updated.lastVerifiedAt,
				provider: updated.provider,
				resourceName: updated.resourceName
			};
		})
```

Add the imports it needs (`open` from `@/server/ai/crypto` is likely already imported; `probeCredential`/`ByokConfig` already are; add `listProviderModels`/`ListModelsResult` and `safeProviderErrorMessage` if not present).

- [ ] **Step 4: Write the tests**

Create `src/server/api/routers/ai-credentials-update-models.test.ts`. **Read `src/server/api/routers/ai-credentials.test.ts` first** and reuse its `callerFor` harness and `@/server/db` / `@/server/ai/probe` / `@/server/ai/crypto` mocking style verbatim — do not invent a second harness.

Cover:
1. `updateModels` **rejects** when `defaultModelId ∉ enabledModelIds` (zod, before any DB or provider call).
2. `updateModels` **rejects with NOT_FOUND** when the user has no credential for that provider.
3. `updateModels` **probes exactly once** and persists `enabledModelIds` + `defaultModelId` on success (assert the recorded `update` args).
4. `updateModels` **does not persist** when the probe fails, and the error message is the redacted probe error.
5. `listStoredModels` returns the provider's models and **never receives a secret from the input** (assert its input schema rejects an extra `secret` key, or that the call succeeds with only `{ provider }`).
6. The credential lookup is **scoped by userId** — assert the captured `findFirst` args include the caller's `userId` and the requested `provider`.

- [ ] **Step 5: Run the tests**

Run: `bun test src/server/api/routers/ai-credentials-update-models.test.ts src/server/api/routers/ai-credentials.test.ts`
Expected: the new tests pass and the pre-existing router tests still pass unchanged.

- [ ] **Step 6: Typecheck, lint, commit**

```bash
bun run typecheck && bun run check
git add src/server/api/routers/ai-credentials.ts src/server/api/routers/ai-credentials-update-models.test.ts
git commit -m "feat(ai): edit a saved credential's model set without re-entering the key"
```

---

### Task 2: Pencil button + edit dialog, sharing one model chooser

**Files:**
- Create: `src/app/(dashboard)/account/_components/model-set-field.tsx`
- Modify: `src/app/(dashboard)/account/_components/ai-credentials-card.tsx`

**Interfaces:**
- Consumes: `api.aiCredentials.listStoredModels`, `api.aiCredentials.updateModels` (Task 1); `AiCredentialView.enabledModelIds` / `.defaultModelId`.

- [ ] **Step 1: Extract the model chooser into a shared component**

Create `src/app/(dashboard)/account/_components/model-set-field.tsx` (`'use client'`) exporting `ModelSetField`. Move the existing **Models** `Field` block and the conditional **Primary model** `Field` block out of `ai-credentials-card.tsx` verbatim (currently the `Field` containing `htmlFor='byok-model'` plus the `enabledModelIds.length > 1` block), turning the values it reads into props:

```ts
export type ModelSetFieldProps = {
	/** Distinguishes element ids between the add and edit dialogs. */
	idPrefix: string;
	canListModels: boolean;
	enabledModelIds: string[];
	defaultModelId: string;
	fetchedModels: string[];
	modelQuery: string;
	onModelQueryChange: (query: string) => void;
	onEnabledChange: (next: string[]) => void;
	onPrimaryChange: (model: string) => void;
	onFetch: () => void;
	fetching: boolean;
	fetchDisabled: boolean;
	error?: React.ReactNode;
};
```

Requirements:
- Keep every existing behaviour: the creatable `modelItems` rule (typed text becomes a row when it is in neither `fetchedModels` nor `enabledModelIds`), the `custom` tag, the two helper paragraphs (including the Azure variant), and the Primary-model `Select` appearing only when more than one model is enabled.
- Compute `modelItems` **inside** this component from `modelQuery` / `fetchedModels` / `enabledModelIds`, so both dialogs get the rule for free.
- Element ids become `` `${idPrefix}-model` `` and `` `${idPrefix}-primary` `` so two dialogs cannot collide.
- The primary-repair rule (if the new selection no longer contains the current primary, promote `next[0]`) stays with the **caller**, since only the caller owns the form state — `onEnabledChange` receives the raw new array.

Then have the add dialog render `<ModelSetField idPrefix='byok' … />`. Its behaviour must be unchanged.

- [ ] **Step 2: Add edit state and the mutations**

In `ai-credentials-card.tsx`, add state for the edit dialog — an editing target plus its own model-chooser state, kept separate from the add dialog's:

```ts
	const [editing, setEditing] = useState<AiCredentialView | null>(null);
	const [editModels, setEditModels] = useState<string[]>([]);
	const [editPrimary, setEditPrimary] = useState('');
	const [editQuery, setEditQuery] = useState('');
	const [editFetched, setEditFetched] = useState<string[]>([]);
```

`AiCredentialView` is exported from `@/server/api/routers/ai-credentials` — import it as a **type only**.

Add:

```ts
	const listStoredModelsMutation = api.aiCredentials.listStoredModels.useMutation({
		onError: (error) => toast.error(error.message),
		onSuccess: (result) => {
			if (!result.supported) {
				toast.info('Model listing is not available for this provider — type the model id instead.');
				return;
			}
			setEditFetched(result.models);
			toast.success(
				result.models.length > 0
					? `Found ${result.models.length} model(s)`
					: 'The provider returned no models — you can still type an id.'
			);
		}
	});

	const updateModelsMutation = api.aiCredentials.updateModels.useMutation({
		onError: (error) => toast.error(error.message),
		onSuccess: () => {
			toast.success('Models updated');
			void utils.aiCredentials.list.invalidate();
			setEditing(null);
		}
	});
```

Add an `openEdit` helper that seeds the edit state from a row (falling back to `[defaultModelId]` when `enabledModelIds` is empty, so a pre-migration row still edits sensibly) and clears `editQuery`/`editFetched`.

- [ ] **Step 3: Add the pencil button to each credential row**

In the credentials list, next to the existing delete `Button`, add:

```tsx
							<Button
								aria-label={`Edit ${PROVIDERS[credential.provider]} models`}
								onClick={() => openEdit(credential)}
								size='icon'
								variant='ghost'
							>
								<Pencil className='size-4' />
							</Button>
```

Add `Pencil` to the existing `lucide-react` import.

- [ ] **Step 4: Add the edit dialog**

Render a second `<Dialog>` driven by `editing !== null`. It has **no provider select and no API-key field** — only `<ModelSetField idPrefix='edit' … />` wired to the edit state, plus Cancel and a save button calling:

```ts
updateModelsMutation.mutate({
	defaultModelId: editPrimary,
	enabledModelIds: editModels,
	provider: editing.provider
});
```

Details:
- Title/description should say plainly that the saved key is reused and the primary model is re-verified on save.
- `onEnabledChange`: `setEditModels(next)` and, if `next.length > 0 && !next.includes(editPrimary)`, `setEditPrimary(next[0]!)` — the same primary-repair rule the add dialog uses.
- The save button is disabled while `updateModelsMutation.isPending`, when `editModels.length === 0`, or when `!editModels.includes(editPrimary)`.
- `onFetch`: `listStoredModelsMutation.mutate({ provider: editing.provider })`. `fetchDisabled` is `!canListModels` for that provider (reuse `MODEL_LISTING_PROVIDERS`) — **no secret-length condition**, since the stored key is used.
- Closing the dialog (`onOpenChange`, Cancel, Escape/overlay) clears `editing`, `editQuery` and `editFetched`.

- [ ] **Step 5: Full gate**

```bash
bun run typecheck && bun run check && bun run test:unit
```

Expected: typecheck 0; biome clean; unit suite green with no new failures.

- [ ] **Step 6: Manual smoke check**

`bun run dev`, then Account → AI → the existing Anthropic row:
1. Pencil opens a dialog pre-filled with `claude-sonnet-5` and **no API-key field**.
2. **Fetch models** populates the list without asking for a key.
3. Adding `claude-opus-5` and saving shows two badges on the row, and both appear in the chat model picker.
4. The add dialog still behaves exactly as before.

- [ ] **Step 7: Commit**

```bash
git add "src/app/(dashboard)/account/_components/model-set-field.tsx" "src/app/(dashboard)/account/_components/ai-credentials-card.tsx"
git commit -m "feat(ai): edit a credential's models from the account page"
```

---

## Self-Review

- **Problem coverage:** no-edit-path → Task 2 Steps 3–4; re-pasting the key → Task 1 (server-side decrypt, both procedures take no secret); bad primary caught late → Task 1 Step 3's probe.
- **Placeholder scan:** none. Task 1 Step 2 names a concrete fallback for typing `db` rather than leaving it open; Task 1 Step 4 lists the six cases and points at the existing harness to copy instead of inventing test code that would conflict with it.
- **Type consistency:** `AiCredentialView` is the single row shape used by `list`, `updateModels` and the client; `ListModelsResult` is shared by `listModels` and `listStoredModels`; `enabledModelIds: string[]` / `defaultModelId: string` match the Prisma columns and the form.
- **Constraint check:** neither new procedure accepts a secret; both scope by `userId`; errors are redacted; exactly one probe per save; the chooser is extracted rather than duplicated; edit state is separate from add state so the two dialogs cannot corrupt each other.
