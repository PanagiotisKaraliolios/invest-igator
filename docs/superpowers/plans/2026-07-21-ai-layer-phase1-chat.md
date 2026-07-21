# AI Layer Phase 1 — Chat Assistant Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a streaming, tool-calling chat assistant (global slide-over drawer) with inline charts/tables, an explicit platform/BYOK model picker, and persisted per-user conversation history — a thin surface over the Phase 0 AI foundation.

**Architecture:** A raw Next route handler (`POST /api/ai/chat`) authenticates, validates a model selector against the user's own credentials, loads prior turns server-side, and calls a gateway (`streamChatTurn`) that composes the Phase 0 pieces — `resolveModel` → `createToolCtx`/`buildToolset`/`toAiSdkTools` → quota `reserve` → `runWithAiContext` → `streamText` → persist + `settle`. History CRUD is a tRPC router. The client is a `useChat` drawer that renders text via `streamdown` and tool outputs via deterministic renderers keyed on each tool's typed output (Approach A).

**Tech Stack:** Next 16 (App Router), React 19, TypeScript, Vercel AI SDK v7 (`ai@7`, `@ai-sdk/react`, `@ai-sdk/azure`), tRPC v11, Prisma v7, Base UI, recharts, `streamdown`, bun test, Playwright.

## Global Constraints

- **AI SDK is v7 — never write from memory.** Verified names used throughout: `isStepCount(n)` (NOT `stepCountIs`, an alias only); `streamText`/`generateText` take `instructions` (NOT `system`); `convertToModelMessages(messages)` is awaited; tool parts are detected with `isToolUIPart(part)` + `getToolName(part)` and carry `state: 'output-available'` with `part.output`; `DefaultChatTransport` is imported from `ai`; `useChat` from `@ai-sdk/react`; `MockLanguageModelV4` from `ai/test`.
- **Two new deps only:** `@ai-sdk/react` and `streamdown@2.5.0`. **Do NOT install `ai-elements`** (drags Radix into this Radix-free repo).
- **Security invariants (tested, not asserted):** `userId` comes only from the session via `createToolCtx` — never from request body or model input. The model selector is re-validated server-side against the user's own credentials. Prior history is loaded from the DB scoped to `{ chatId, userId }` — client-sent history is never trusted as model input. Every chat CRUD op re-checks ownership `{ id, userId }`.
- **Price on `resolvedModel`, never `modelId`.** For Azure, `modelId` is the deployment name and matches nothing in the price catalogue.
- **Quota:** platform calls reserve then settle with the priced actual; BYOK bypasses quota and nothing else. A broken BYOK credential throws — never falls through to the platform card.
- **Regulatory (unchanged from Phase 0):** the frozen `PORTFOLIO_ANALYST` prompt is reused verbatim; the EU AI Act Art. 50 disclosure is on by default with no off switch; the tier-1 advice-boundary eval must still pass.
- **Commit trailers on every commit:**
  ```
  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01TY5vHxHcvShQEeKhbJPuSE
  ```
- **Gates:** `bun run typecheck` and `bun run check` (biome) must stay clean; `bun run test:unit` green.

## File Structure

**Server (new):**
- `src/server/ai/tool-ctx.ts` — `createToolCtx(session, surface)` factory + `ALL_READ_SCOPES`.
- `src/server/ai/chat/gateway.ts` — `streamChatTurn(...)`, the request orchestrator.
- `src/server/ai/chat/persistence.ts` — `loadTurnHistory`, `saveTurn`, `createChat`, ownership-scoped.
- `src/server/api/routers/ai-chat.ts` — tRPC router: `list`/`get`/`rename`/`delete`.
- `src/app/api/ai/chat/route.ts` — `POST` handler.

**Server (modify):**
- `src/server/ai/resolve-model.ts` — add `ModelSelector` + `resolveModel(userId, selector?)`.
- `src/server/api/root.ts` — register `aiChat` router.

**Client (new), under `src/app/(dashboard)/_components/chat/`:**
- `use-chat-selector.ts` — builds the picker option list (pure).
- `artifacts/registry.ts` — tool name → renderer map (pure, unit-tested).
- `artifacts/portfolio-allocation.tsx`, `artifacts/time-series.tsx`, `artifacts/data-table-artifact.tsx`, `artifacts/tool-call-chip.tsx`.
- `chat-launcher.tsx`, `chat-drawer.tsx`, `chat-header.tsx`, `model-picker.tsx`, `conversation-list.tsx`, `message-thread.tsx`, `message.tsx`, `composer.tsx`, `disclosure.tsx`, `chat-errors.ts`.

**Client (modify):**
- `src/app/(dashboard)/layout.tsx` — mount `<ChatLauncher/>` in the header.

**Tests:** colocated `*.test.ts(x)` for server + pure logic; `e2e/chat.spec.ts` for the happy path.

---

### Task 1: `resolveModel(userId, selector?)` — picker-aware model resolution

**Files:**
- Modify: `src/server/ai/resolve-model.ts`
- Test: `src/server/ai/resolve-model.test.ts` (append cases; follow its existing db harness)

**Interfaces:**
- Consumes: existing `platformModel()`, `toByokConfig(row)`, `buildByokModel(cfg, secret)`, `applyGuardrails`, `open(...)`, `db.aiProviderCredential`.
- Produces:
  - `export type ModelSelector = { kind: 'platform' } | { kind: 'byok'; provider: ByokProvider }`
  - `export async function resolveModel(userId: string, selector?: ModelSelector): Promise<ResolvedModel>`

- [ ] **Step 1: Read the existing file and its test to reuse the row→model path and db harness.**

Run: `sed -n '1,240p' src/server/ai/resolve-model.ts && sed -n '1,60p' src/server/ai/resolve-model.test.ts`
Expected: confirm the current `resolveModel(userId)` body (findFirst enabled → build BYOK, else `platformModel()`), and how the test seeds `aiProviderCredential` rows + a keyring.

- [ ] **Step 2: Extract the row→ResolvedModel builder (refactor, no behavior change).**

In `resolve-model.ts`, factor the existing "decrypt + build BYOK from a credential row" block (the part after `findFirst` that calls `toByokConfig`, `open`, `buildByokModel`, returns `{ byok:true, ... }`) into:

```ts
function byokFromRow(
	row: Parameters<typeof toByokConfig>[0] & {
		authTag: string; ciphertext: string; iv: string; kid: string;
	},
	userId: string
): ResolvedModel {
	const cfg = toByokConfig(row);
	const secret = open(
		{ authTag: row.authTag, ciphertext: row.ciphertext, iv: row.iv, kid: row.kid },
		userId,
		cfg.provider
	);
	const model = buildByokModel(cfg, secret.expose());
	return {
		byok: true,
		model: applyGuardrails(model),
		modelId: cfg.provider === 'AZURE' ? (cfg.deployment ?? cfg.defaultModelId) : cfg.defaultModelId,
		providerId: cfg.provider.toLowerCase(),
		resolvedModel: cfg.defaultModelId
	};
}
```

- [ ] **Step 3: Add the selector type and rewrite `resolveModel`.**

```ts
export type ModelSelector = { kind: 'platform' } | { kind: 'byok'; provider: ByokProvider };

export async function resolveModel(userId: string, selector?: ModelSelector): Promise<ResolvedModel> {
	if (selector?.kind === 'platform') return platformModel();

	if (selector?.kind === 'byok') {
		const row = await db.aiProviderCredential.findFirst({
			where: { enabled: true, provider: selector.provider, userId }
		});
		if (row === null) {
			throw new InvalidCredentialError(`No enabled ${selector.provider} credential for this user`);
		}
		return byokFromRow(row, userId);
	}

	// No selector: back-compat — most-recent enabled BYOK, else platform.
	const row = await db.aiProviderCredential.findFirst({
		orderBy: { updatedAt: 'desc' },
		where: { enabled: true, userId }
	});
	if (row === null) return platformModel();
	return byokFromRow(row, userId);
}
```

- [ ] **Step 4: Write failing tests for the new selector branches.**

Append to `resolve-model.test.ts`, reusing that file's existing credential-seeding + keyring setup helpers (call them exactly as the existing tests do):

```ts
test('selector platform returns the platform model even when a BYOK credential exists', async () => {
	await seedEnabledCredential('ANTHROPIC'); // existing helper in this file
	const resolved = await resolveModel(userId, { kind: 'platform' });
	expect(resolved.byok).toBe(false);
	expect(resolved.providerId).toBe('azure');
});

test('selector byok picks that specific provider', async () => {
	await seedEnabledCredential('ANTHROPIC');
	await seedEnabledCredential('GOOGLE');
	const resolved = await resolveModel(userId, { kind: 'byok', provider: 'GOOGLE' });
	expect(resolved.byok).toBe(true);
	expect(resolved.providerId).toBe('google');
});

test('selector byok for a provider the user lacks throws (never falls through to platform)', async () => {
	await expect(resolveModel(userId, { kind: 'byok', provider: 'ANTHROPIC' })).rejects.toThrow(
		InvalidCredentialError
	);
});

test('no selector preserves back-compat: most-recent BYOK else platform', async () => {
	const platform = await resolveModel(userId);
	expect(platform.byok).toBe(false);
	await seedEnabledCredential('ANTHROPIC');
	const byok = await resolveModel(userId);
	expect(byok.byok).toBe(true);
});
```

If the file lacks a `seedEnabledCredential` helper, replicate the seeding the existing BYOK test already performs (same `db.aiProviderCredential.create` + `seal(...)` call) inline in each test.

- [ ] **Step 5: Run the tests — expect FAIL first, then PASS after the code from Steps 2-3.**

Run: `bun test src/server/ai/resolve-model.test.ts`
Expected: the four new tests pass; pre-existing tests still pass.

- [ ] **Step 6: Typecheck + commit.**

Run: `bun run typecheck`
```bash
git add src/server/ai/resolve-model.ts src/server/ai/resolve-model.test.ts
git commit -m "feat(ai): resolveModel accepts an optional platform/byok selector

Additive: no selector preserves today's most-recent-BYOK-else-platform
behavior. A byok selector names a specific enabled provider and throws if
the user lacks it — never falls through to the platform card.
<trailers>"
```

---

### Task 2: `createToolCtx(session, surface)` — the tenant-safe context factory

**Files:**
- Create: `src/server/ai/tool-ctx.ts`
- Test: `src/server/ai/tool-ctx.test.ts`

**Interfaces:**
- Consumes: `ToolCtx`, `Scope` from `./tools/types`; `Currency` from `@/lib/currency`; `db`.
- Produces:
  - `export const ALL_READ_SCOPES: ReadonlySet<Scope>`
  - `export async function createToolCtx(session: { user: { id: string } }, surface: ToolCtx['surface']): Promise<ToolCtx>`

- [ ] **Step 1: Write the failing test.**

```ts
import { describe, expect, test } from 'bun:test';
import { ALL_READ_SCOPES, createToolCtx } from './tool-ctx';

describe('createToolCtx', () => {
	test('userId comes from the session, not any argument', async () => {
		const ctx = await createToolCtx({ user: { id: 'user-123' } }, 'chat');
		expect(ctx.userId).toBe('user-123');
		expect(ctx.surface).toBe('chat');
	});

	test('grants exactly the five read scopes and no write scope', async () => {
		const ctx = await createToolCtx({ user: { id: 'user-123' } }, 'chat');
		expect([...ctx.scopes].sort()).toEqual(
			['fx:read', 'goals:read', 'portfolio:read', 'transactions:read', 'watchlist:read']
		);
		expect([...ctx.scopes].some((s) => s.endsWith(':write'))).toBe(false);
	});

	test('defaults currency to USD when the user has none set', async () => {
		const ctx = await createToolCtx({ user: { id: 'user-no-currency' } }, 'chat');
		expect(ctx.currency).toBe('USD');
	});
});
```

- [ ] **Step 2: Run it — expect FAIL (module not found).**

Run: `bun test src/server/ai/tool-ctx.test.ts`
Expected: FAIL — cannot find `./tool-ctx`.

- [ ] **Step 3: Implement the factory.**

```ts
import type { Currency } from '@/lib/currency';
import { db } from '@/server/db';
import type { Scope, ToolCtx } from './tools/types';

/** Phase 1 grants every read scope and no write scope. */
export const ALL_READ_SCOPES: ReadonlySet<Scope> = new Set<Scope>([
	'portfolio:read',
	'transactions:read',
	'watchlist:read',
	'goals:read',
	'fx:read'
]);

/**
 * THE only sanctioned way to build a ToolCtx for a real request. userId comes from the
 * authenticated session — never from request body or model input — which is what stops a
 * caller from hand-writing `{ userId: someOtherId }` (the Phase 0 concern: ToolCtx was a
 * bare type). Currency is the user's saved preference (default USD), matching the dashboard.
 */
export async function createToolCtx(
	session: { user: { id: string } },
	surface: ToolCtx['surface']
): Promise<ToolCtx> {
	const userId = session.user.id;
	const user = await db.user.findUnique({ select: { currency: true }, where: { id: userId } });
	const currency = (user?.currency ?? 'USD') as Currency;
	return { currency, scopes: ALL_READ_SCOPES, surface, userId };
}
```

- [ ] **Step 4: Run tests — expect PASS.** (The db-backed test needs the test DB; run under the same command the other db-touching unit tests use.)

Run: `bun test src/server/ai/tool-ctx.test.ts`
Expected: PASS. If the DB isn't available in the plain unit runner, run it in the db test set and note it in the commit; the seams (`db.user.findUnique`) are unchanged from other tools.

- [ ] **Step 5: Typecheck + commit.**

Run: `bun run typecheck`
```bash
git add src/server/ai/tool-ctx.ts src/server/ai/tool-ctx.test.ts
git commit -m "feat(ai): createToolCtx factory — userId from session, all read scopes

Closes the Phase 0 gap where ToolCtx was a bare type: every real request
now builds its context here, so userId can only come from the session.
<trailers>"
```

---

### Task 3: Chat persistence helpers

**Files:**
- Create: `src/server/ai/chat/persistence.ts`
- Test: `src/server/ai/chat/persistence.test.ts`

**Interfaces:**
- Consumes: `db`; `UIMessage` from `ai`.
- Produces:
  - `export async function createChat(userId: string, title: string): Promise<{ id: string }>`
  - `export async function loadTurnHistory(chatId: string, userId: string): Promise<UIMessage[]>` — returns `[]` if the chat isn't owned by the user.
  - `export async function saveTurn(args: { chatId: string; userId: string; messages: UIMessage[] }): Promise<void>` — upserts each message by id (ownership-checked), bumps `updatedAt`.
  - `export function deriveTitle(firstUserText: string): string` — first line, trimmed to 60 chars, fallback `'New chat'`.

- [ ] **Step 1: Write failing tests (ownership + round-trip + title).**

```ts
import { describe, expect, test } from 'bun:test';
import type { UIMessage } from 'ai';
import { db } from '@/server/db';
import { createChat, deriveTitle, loadTurnHistory, saveTurn } from './persistence';

const msg = (id: string, role: 'user' | 'assistant', text: string): UIMessage => ({
	id, role, parts: [{ type: 'text', text }]
});

describe('chat persistence', () => {
	test('deriveTitle trims to 60 chars and falls back', () => {
		expect(deriveTitle('  How is my portfolio?  ')).toBe('How is my portfolio?');
		expect(deriveTitle('')).toBe('New chat');
		expect(deriveTitle('x'.repeat(80))).toHaveLength(60);
	});

	test('saveTurn then loadTurnHistory round-trips parts for the owner', async () => {
		const { id: userId } = await db.user.create({ data: fakeUser() }); // fakeUser(): existing test factory
		const { id: chatId } = await createChat(userId, 'T');
		await saveTurn({ chatId, userId, messages: [msg('m1', 'user', 'hi'), msg('m2', 'assistant', 'hello')] });
		const loaded = await loadTurnHistory(chatId, userId);
		expect(loaded.map((m) => m.id)).toEqual(['m1', 'm2']);
		expect(loaded[1]?.parts).toEqual([{ type: 'text', text: 'hello' }]);
	});

	test('loadTurnHistory returns [] for a chat the user does not own', async () => {
		const owner = await db.user.create({ data: fakeUser() });
		const other = await db.user.create({ data: fakeUser() });
		const { id: chatId } = await createChat(owner.id, 'T');
		await saveTurn({ chatId, userId: owner.id, messages: [msg('m1', 'user', 'secret')] });
		expect(await loadTurnHistory(chatId, other.id)).toEqual([]);
	});

	test('saveTurn refuses to write into a chat the user does not own', async () => {
		const owner = await db.user.create({ data: fakeUser() });
		const other = await db.user.create({ data: fakeUser() });
		const { id: chatId } = await createChat(owner.id, 'T');
		await saveTurn({ chatId, userId: other.id, messages: [msg('x', 'user', 'inject')] });
		expect(await loadTurnHistory(chatId, owner.id)).toEqual([]);
	});
});
```

Use whatever user factory the other db tests use (e.g. `@faker-js/faker` inline or an existing `fakeUser` helper); replicate their exact `db.user.create` shape.

- [ ] **Step 2: Run — expect FAIL (module not found).**

Run: `bun test src/server/ai/chat/persistence.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement.**

```ts
import type { UIMessage } from 'ai';
import { db } from '@/server/db';

export function deriveTitle(firstUserText: string): string {
	const line = firstUserText.split('\n')[0]?.trim() ?? '';
	if (line.length === 0) return 'New chat';
	return line.slice(0, 60);
}

export async function createChat(userId: string, title: string): Promise<{ id: string }> {
	const chat = await db.aiChat.create({ data: { title, userId }, select: { id: true } });
	return { id: chat.id };
}

/** Ownership-scoped. Returns [] for a chat the user does not own (never throws to the caller). */
export async function loadTurnHistory(chatId: string, userId: string): Promise<UIMessage[]> {
	const chat = await db.aiChat.findFirst({ select: { id: true }, where: { id: chatId, userId } });
	if (chat === null) return [];
	const rows = await db.aiMessage.findMany({
		orderBy: { createdAt: 'asc' },
		where: { chatId }
	});
	return rows.map((r) => ({
		id: r.id,
		metadata: r.metadata ?? undefined,
		parts: r.parts as UIMessage['parts'],
		role: r.role as UIMessage['role']
	}));
}

export async function saveTurn(args: {
	chatId: string;
	userId: string;
	messages: UIMessage[];
}): Promise<void> {
	// Ownership gate: silently no-op on a foreign chat rather than leaking existence.
	const chat = await db.aiChat.findFirst({ select: { id: true }, where: { id: args.chatId, userId: args.userId } });
	if (chat === null) return;
	for (const m of args.messages) {
		await db.aiMessage.upsert({
			create: {
				chatId: args.chatId,
				id: m.id,
				metadata: (m.metadata ?? undefined) as object | undefined,
				parts: m.parts as object,
				role: m.role
			},
			update: { metadata: (m.metadata ?? undefined) as object | undefined, parts: m.parts as object },
			where: { id: m.id }
		});
	}
	await db.aiChat.update({ data: { updatedAt: new Date() }, where: { id: args.chatId } });
}
```

- [ ] **Step 4: Run — expect PASS.**

Run: `bun test src/server/ai/chat/persistence.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck + commit.**

Run: `bun run typecheck`
```bash
git add src/server/ai/chat/persistence.ts src/server/ai/chat/persistence.test.ts
git commit -m "feat(ai): chat persistence helpers, ownership-scoped

createChat/loadTurnHistory/saveTurn keyed on {chatId,userId}; a foreign
chat loads as [] and saves as a no-op — client-sent history can never
overwrite or read another user's turns.
<trailers>"
```

---

### Task 4: `ai-chat` tRPC router (history CRUD)

**Files:**
- Create: `src/server/api/routers/ai-chat.ts`
- Modify: `src/server/api/root.ts` (register `aiChat`)
- Test: `src/server/api/routers/ai-chat.test.ts`

**Interfaces:**
- Consumes: `createTRPCRouter`, `protectedProcedure`; `db`; `loadTurnHistory` (Task 3).
- Produces router `aiChatRouter` with:
  - `list: () => { id, title, updatedAt }[]` (this user's chats, newest first)
  - `get: ({ chatId }) => { id, title, messages: UIMessage[] }` — throws `NOT_FOUND` if not owned
  - `rename: ({ chatId, title }) => { ok: true }`
  - `delete: ({ chatId }) => { ok: true }`

- [ ] **Step 1: Write failing tests (mirror an existing router test, e.g. `ai-credentials.test.ts`, for caller/session setup).**

```ts
import { describe, expect, test } from 'bun:test';
// reuse the existing pattern that builds an authed caller for a given userId
import { callerFor, fakeUser } from '@/test/trpc-harness'; // whatever the repo's routers tests use
import { db } from '@/server/db';

describe('aiChat router', () => {
	test('list returns only the caller’s chats, newest first', async () => {
		const me = await db.user.create({ data: fakeUser() });
		const other = await db.user.create({ data: fakeUser() });
		await db.aiChat.create({ data: { title: 'mine-old', userId: me.id } });
		await db.aiChat.create({ data: { title: 'mine-new', userId: me.id } });
		await db.aiChat.create({ data: { title: 'theirs', userId: other.id } });
		const caller = callerFor(me.id);
		const chats = await caller.aiChat.list();
		expect(chats.map((c) => c.title)).toEqual(['mine-new', 'mine-old']);
	});

	test('get throws NOT_FOUND for a chat owned by another user', async () => {
		const me = await db.user.create({ data: fakeUser() });
		const other = await db.user.create({ data: fakeUser() });
		const chat = await db.aiChat.create({ data: { title: 'x', userId: other.id } });
		await expect(callerFor(me.id).aiChat.get({ chatId: chat.id })).rejects.toThrow();
	});

	test('delete a foreign chat throws and leaves it intact', async () => {
		const me = await db.user.create({ data: fakeUser() });
		const other = await db.user.create({ data: fakeUser() });
		const chat = await db.aiChat.create({ data: { title: 'x', userId: other.id } });
		await expect(callerFor(me.id).aiChat.delete({ chatId: chat.id })).rejects.toThrow();
		expect(await db.aiChat.findUnique({ where: { id: chat.id } })).not.toBeNull();
	});
});
```

Match the actual harness the existing router tests use (open `ai-credentials.test.ts` first and copy its caller construction verbatim).

- [ ] **Step 2: Run — expect FAIL.**

Run: `bun test src/server/api/routers/ai-chat.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement the router.**

```ts
import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { loadTurnHistory } from '@/server/ai/chat/persistence';
import { createTRPCRouter, protectedProcedure } from '@/server/api/trpc';

async function assertOwned(chatId: string, userId: string): Promise<void> {
	const chat = await ctxDb().aiChat.findFirst({ select: { id: true }, where: { id: chatId, userId } });
	if (chat === null) throw new TRPCError({ code: 'NOT_FOUND', message: 'Chat not found' });
}
// use ctx.db in procedures; the helper above is illustrative — inline the check with ctx.db.

export const aiChatRouter = createTRPCRouter({
	delete: protectedProcedure.input(z.object({ chatId: z.string() })).mutation(async ({ ctx, input }) => {
		const { count } = await ctx.db.aiChat.deleteMany({ where: { id: input.chatId, userId: ctx.session.user.id } });
		if (count === 0) throw new TRPCError({ code: 'NOT_FOUND', message: 'Chat not found' });
		return { ok: true } as const;
	}),
	get: protectedProcedure.input(z.object({ chatId: z.string() })).query(async ({ ctx, input }) => {
		const chat = await ctx.db.aiChat.findFirst({
			select: { id: true, title: true },
			where: { id: input.chatId, userId: ctx.session.user.id }
		});
		if (chat === null) throw new TRPCError({ code: 'NOT_FOUND', message: 'Chat not found' });
		const messages = await loadTurnHistory(chat.id, ctx.session.user.id);
		return { id: chat.id, messages, title: chat.title };
	}),
	list: protectedProcedure.query(async ({ ctx }) => {
		return ctx.db.aiChat.findMany({
			orderBy: { updatedAt: 'desc' },
			select: { id: true, title: true, updatedAt: true },
			where: { userId: ctx.session.user.id }
		});
	}),
	rename: protectedProcedure
		.input(z.object({ chatId: z.string(), title: z.string().min(1).max(120) }))
		.mutation(async ({ ctx, input }) => {
			const { count } = await ctx.db.aiChat.updateMany({
				data: { title: input.title },
				where: { id: input.chatId, userId: ctx.session.user.id }
			});
			if (count === 0) throw new TRPCError({ code: 'NOT_FOUND', message: 'Chat not found' });
			return { ok: true } as const;
		})
});
```

Delete the illustrative `assertOwned`/`ctxDb` helper before finishing — each procedure already scopes with `ctx.db` + `ctx.session.user.id` via `deleteMany`/`updateMany` count checks (atomic ownership).

- [ ] **Step 4: Register the router in `root.ts`.**

Add `aiChat: aiChatRouter` to the `createTRPCRouter({ ... })` call (import at top), following the existing alphabetical/ordering convention in that file.

- [ ] **Step 5: Run — expect PASS; typecheck.**

Run: `bun test src/server/api/routers/ai-chat.test.ts && bun run typecheck`
Expected: PASS, clean.

- [ ] **Step 6: Commit.**

```bash
git add src/server/api/routers/ai-chat.ts src/server/api/routers/ai-chat.test.ts src/server/api/root.ts
git commit -m "feat(ai): ai-chat tRPC router — list/get/rename/delete, ownership-scoped

Every op filters by {id, userId}; mutations use *Many + count checks so a
foreign chat is a NOT_FOUND, never a silent success.
<trailers>"
```

---

### Task 5: The gateway — `streamChatTurn`

**Files:**
- Create: `src/server/ai/chat/gateway.ts`
- Test: `src/server/ai/chat/gateway.test.ts`

**Interfaces:**
- Consumes: `resolveModel`/`ModelSelector` (Task 1), `createToolCtx` (Task 2), `loadTurnHistory`/`saveTurn` (Task 3), `buildToolset` + `toAiSdkTools`, `PORTFOLIO_ANALYST`, `MAX_STEPS`, `runWithAiContext`, quota `reserve`/`settle`/`estimateRequestCeilingNanoUsd`, pricing `price`/`toTokenUsage`.
- Produces:
  - `export async function streamChatTurn(args: { session: { user: { id: string } }; chatId: string; incoming: UIMessage; selector: ModelSelector; abortSignal?: AbortSignal }): Promise<Response>`

- [ ] **Step 1: Write failing tests using an injectable model + spies.**

Design the function so the model factory and quota fns are the seams. Simplest testable shape: `streamChatTurn` takes an optional `deps` for tests (default to the real imports). Show the test:

```ts
import { describe, expect, mock, test } from 'bun:test';
import { MockLanguageModelV4 } from 'ai/test';
import { applyGuardrails } from '@/server/ai/registry';

function okModel(): MockLanguageModelV4 {
	return new MockLanguageModelV4({
		doStream: async () => ({
			stream: simulateReadableStream({ chunks: [
				{ type: 'text-delta', id: '1', delta: 'Your portfolio is fine.' },
				{ type: 'finish', finishReason: 'stop', usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 } }
			] })
		})
	});
}

test('platform turn reserves then settles with the priced actual', async () => {
	const reserve = mock(async () => ({ id: 'res-1', userId: 'u1', ceilingNanoUsd: 1000n }));
	const settle = mock(async () => {});
	const res = await streamChatTurn(
		{ session: { user: { id: 'u1' } }, chatId: 'c1', incoming: userMsg('hi'), selector: { kind: 'platform' } },
		{ resolveModel: async () => ({ model: applyGuardrails(markUnguarded(okModel())), byok: false, modelId: 'dep', providerId: 'azure', resolvedModel: 'gpt-5-mini' }), reserve, settle, loadTurnHistory: async () => [], saveTurn: async () => {} }
	);
	await res.text(); // drain the stream so onFinish fires
	expect(reserve).toHaveBeenCalledTimes(1);
	expect(settle).toHaveBeenCalledTimes(1);
});

test('byok turn does not reserve or settle', async () => {
	const reserve = mock(async () => ({ id: 'x', userId: 'u1', ceilingNanoUsd: 0n }));
	const settle = mock(async () => {});
	const res = await streamChatTurn(
		{ session: { user: { id: 'u1' } }, chatId: 'c1', incoming: userMsg('hi'), selector: { kind: 'byok', provider: 'ANTHROPIC' } },
		{ resolveModel: async () => ({ model: applyGuardrails(markUnguarded(okModel())), byok: true, modelId: 'claude', providerId: 'anthropic', resolvedModel: 'claude-haiku-4-5' }), reserve, settle, loadTurnHistory: async () => [], saveTurn: async () => {} }
	);
	await res.text();
	expect(reserve).not.toHaveBeenCalled();
	expect(settle).not.toHaveBeenCalled();
});

test('persists the turn on finish', async () => {
	const saveTurn = mock(async () => {});
	const res = await streamChatTurn(
		{ session: { user: { id: 'u1' } }, chatId: 'c1', incoming: userMsg('hi'), selector: { kind: 'platform' } },
		{ resolveModel: async () => ({ model: applyGuardrails(markUnguarded(okModel())), byok: false, modelId: 'dep', providerId: 'azure', resolvedModel: 'gpt-5-mini' }), reserve: async () => ({ id: 'r', userId: 'u1', ceilingNanoUsd: 1n }), settle: async () => {}, loadTurnHistory: async () => [], saveTurn })
	);
	await res.text();
	expect(saveTurn).toHaveBeenCalledTimes(1);
});
```

`userMsg`, `markUnguarded`, `simulateReadableStream` come from the repo's test helpers / `ai` (`simulateReadableStream` is exported from `ai`; `markUnguarded` from the guardrails module — confirm the exact export used by `registry.test.ts` and reuse it). Verify the exact `doStream` chunk shape against `MockLanguageModelV4` usage in `src/server/ai/registry.test.ts` and copy that shape.

- [ ] **Step 2: Run — expect FAIL (module not found).**

Run: `bun test src/server/ai/chat/gateway.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement the gateway with an injectable `deps` seam.**

```ts
import { convertToModelMessages, isStepCount, streamText, type UIMessage } from 'ai';
import { PORTFOLIO_ANALYST } from '@/server/ai/prompts/portfolio-analyst';
import { runWithAiContext } from '@/server/ai/context';
import { price, toTokenUsage } from '@/server/ai/pricing/price';
import { estimateRequestCeilingNanoUsd, reserve as realReserve, settle as realSettle, type Reservation } from '@/server/ai/quota';
import { MAX_STEPS } from '@/server/ai/registry';
import { resolveModel as realResolveModel, type ModelSelector, type ResolvedModel } from '@/server/ai/resolve-model';
import { createToolCtx } from '@/server/ai/tool-ctx';
import { buildToolset } from '@/server/ai/tools/registry';
import { toAiSdkTools } from '@/server/ai/tools/adapters/ai-sdk';
import { loadTurnHistory as realLoad, saveTurn as realSave } from './persistence';

type Deps = {
	resolveModel: (userId: string, selector?: ModelSelector) => Promise<ResolvedModel>;
	reserve: (userId: string, ceiling: bigint, requestId: string) => Promise<Reservation>;
	settle: (r: Reservation, actual: bigint | null) => Promise<void>;
	loadTurnHistory: (chatId: string, userId: string) => Promise<UIMessage[]>;
	saveTurn: (a: { chatId: string; userId: string; messages: UIMessage[] }) => Promise<void>;
};

const DEFAULT_DEPS: Deps = {
	loadTurnHistory: realLoad,
	reserve: realReserve,
	resolveModel: realResolveModel,
	saveTurn: realSave,
	settle: realSettle
};

const ESTIMATED_INPUT_TOKENS = 2000; // conservative; the guardrail clamps output per call.

export async function streamChatTurn(
	args: {
		session: { user: { id: string } };
		chatId: string;
		incoming: UIMessage;
		selector: ModelSelector;
		abortSignal?: AbortSignal;
	},
	deps: Deps = DEFAULT_DEPS
): Promise<Response> {
	const userId = args.session.user.id;
	const requestId = crypto.randomUUID();

	const resolved = await deps.resolveModel(userId, args.selector);
	const toolCtx = await createToolCtx(args.session, 'chat');
	const tools = toAiSdkTools(buildToolset(toolCtx), toolCtx);

	const prior = await deps.loadTurnHistory(args.chatId, userId);
	const uiMessages: UIMessage[] = [...prior, args.incoming];

	let reservation: Reservation | null = null;
	if (!resolved.byok) {
		const ceiling = estimateRequestCeilingNanoUsd(resolved.resolvedModel, ESTIMATED_INPUT_TOKENS);
		reservation = await deps.reserve(userId, ceiling, requestId);
	}

	return runWithAiContext(
		{
			byok: resolved.byok,
			chatId: args.chatId,
			functionId: 'chat.turn',
			requestId,
			reservationId: reservation?.id,
			resolvedModel: resolved.resolvedModel,
			surface: 'CHAT',
			userId
		},
		async () => {
			const result = streamText({
				abortSignal: args.abortSignal,
				instructions: PORTFOLIO_ANALYST.text,
				messages: await convertToModelMessages(uiMessages),
				model: resolved.model,
				onFinish: async ({ totalUsage }) => {
					if (reservation !== null) {
						const priced = price(resolved.resolvedModel, toTokenUsage(totalUsage));
						await deps.settle(reservation, priced?.nanoUsd ?? null);
					}
				},
				stopWhen: isStepCount(MAX_STEPS),
				telemetry: { functionId: 'chat.turn' },
				tools
			});

			return result.toUIMessageStreamResponse({
				onFinish: async ({ messages }) => {
					await deps.saveTurn({ chatId: args.chatId, messages, userId });
				},
				originalMessages: uiMessages
			});
		}
	);
}
```

**Verify at implementation:** the exact `onFinish` argument shapes — `streamText`'s callback field for total usage (`totalUsage` vs `usage`) and `toUIMessageStreamResponse`'s `onFinish` payload key for the final message list (`messages` vs `responseMessage`) — against `node_modules/ai/dist/index.d.ts` (`GenerateTextOnEndCallback`, `UIMessageStreamOnEndCallback`). Adjust destructuring to match; the settle/persist logic is unchanged.

- [ ] **Step 4: Run — expect PASS.**

Run: `bun test src/server/ai/chat/gateway.test.ts`
Expected: PASS (reserve/settle once on platform, neither on BYOK, saveTurn once).

- [ ] **Step 5: Typecheck + commit.**

Run: `bun run typecheck`
```bash
git add src/server/ai/chat/gateway.ts src/server/ai/chat/gateway.test.ts
git commit -m "feat(ai): streamChatTurn gateway — resolve/reserve/context/stream/settle/persist

Platform turns reserve then settle with the priced totalUsage (same
pricing path as the telemetry ledger, different table); BYOK bypasses
quota. Persists the finished turn ownership-scoped. Injectable deps seam
for hermetic MockLanguageModelV4 tests.
<trailers>"
```

---

### Task 6: The route handler — `POST /api/ai/chat`

**Files:**
- Create: `src/app/api/ai/chat/route.ts`
- Test: `src/app/api/ai/chat/route.test.ts`

**Interfaces:**
- Consumes: `getServerSession`; `streamChatTurn` (Task 5); `createChat`/`deriveTitle` (Task 3); `platformModel` (to test "configured"); `db` (to validate a byok provider belongs to the user).
- Produces: `export async function POST(req: Request): Promise<Response>` and `export const maxDuration = 60`.
- Request body zod schema:
  ```ts
  const bodySchema = z.object({
    chatId: z.string().optional(),
    message: z.object({ id: z.string(), role: z.literal('user'), parts: z.array(z.any()) }).passthrough(),
    model: z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('platform') }),
      z.object({ kind: z.literal('byok'), provider: z.enum(['AZURE','OPENAI','ANTHROPIC','GOOGLE','OPENAI_COMPATIBLE']) })
    ])
  });
  ```

- [ ] **Step 1: Write failing tests for auth + selector validation + body.**

```ts
import { describe, expect, mock, test } from 'bun:test';
import { POST } from './route';

// Mock getServerSession + streamChatTurn at module scope per the repo's route-test convention.
test('401 when unauthenticated', async () => {
	mockSession(null);
	const res = await POST(new Request('http://x/api/ai/chat', { body: JSON.stringify(validBody()), method: 'POST' }));
	expect(res.status).toBe(401);
});

test('400 on a malformed body', async () => {
	mockSession({ user: { id: 'u1' } });
	const res = await POST(new Request('http://x/api/ai/chat', { body: '{"nope":true}', method: 'POST' }));
	expect(res.status).toBe(400);
});

test('403 when byok selector names a provider the user does not have', async () => {
	mockSession({ user: { id: 'u1' } });
	mockUserProviders([]); // db returns no enabled ANTHROPIC row for u1
	const res = await POST(new Request('http://x/api/ai/chat', { body: JSON.stringify(validBody({ model: { kind: 'byok', provider: 'ANTHROPIC' } })), method: 'POST' }));
	expect(res.status).toBe(403);
});

test('streams when authed with a valid platform selector', async () => {
	mockSession({ user: { id: 'u1' } });
	mockPlatformConfigured(true);
	const streamSpy = mock(async () => new Response('ok'));
	mockGateway(streamSpy);
	const res = await POST(new Request('http://x/api/ai/chat', { body: JSON.stringify(validBody()), method: 'POST' }));
	expect(res.status).toBe(200);
	expect(streamSpy).toHaveBeenCalledTimes(1);
});
```

Follow the existing route-handler test convention in the repo (look at how `src/app/api/**/route.test.ts` or the auth route tests mock session/db; if there is none, mock the imported modules with `mock.module`).

- [ ] **Step 2: Run — expect FAIL.**

Run: `bun test src/app/api/ai/chat/route.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement the handler.**

```ts
import { z } from 'zod';
import { getServerSession } from '@/lib/auth/get-session';
import { createChat, deriveTitle } from '@/server/ai/chat/persistence';
import { streamChatTurn } from '@/server/ai/chat/gateway';
import { platformModel } from '@/server/ai/registry';
import { db } from '@/server/db';

export const maxDuration = 60;

const bodySchema = z.object({
	chatId: z.string().optional(),
	message: z.object({ id: z.string(), parts: z.array(z.any()), role: z.literal('user') }).passthrough(),
	model: z.discriminatedUnion('kind', [
		z.object({ kind: z.literal('platform') }),
		z.object({ kind: z.literal('byok'), provider: z.enum(['ANTHROPIC', 'AZURE', 'GOOGLE', 'OPENAI', 'OPENAI_COMPATIBLE']) })
	])
});

function json(status: number, body: unknown): Response {
	return new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' }, status });
}

function platformConfigured(): boolean {
	try {
		platformModel();
		return true;
	} catch {
		return false;
	}
}

export async function POST(req: Request): Promise<Response> {
	const session = await getServerSession();
	if (!session?.user) return json(401, { error: 'UNAUTHENTICATED' });

	const parsed = bodySchema.safeParse(await req.json().catch(() => null));
	if (!parsed.success) return json(400, { error: 'BAD_REQUEST' });
	const { chatId: incomingChatId, message, model } = parsed.data;
	const userId = session.user.id;

	// Re-validate the selector against the user's OWN credentials.
	if (model.kind === 'platform' && !platformConfigured()) {
		return json(409, { error: 'NO_PLATFORM_MODEL' });
	}
	if (model.kind === 'byok') {
		const owned = await db.aiProviderCredential.findFirst({
			select: { id: true },
			where: { enabled: true, provider: model.provider, userId }
		});
		if (owned === null) return json(403, { error: 'NO_SUCH_CREDENTIAL' });
	}

	// Server owns chat identity: create on first turn, derive a title from the message text.
	const chatId =
		incomingChatId ??
		(await createChat(userId, deriveTitle(firstText(message)))).id;

	try {
		return await streamChatTurn({
			abortSignal: req.signal,
			chatId,
			incoming: message,
			selector: model,
			session
		});
	} catch (err) {
		if (isQuotaExceeded(err)) return json(429, { error: 'QUOTA_EXCEEDED' });
		if (isInvalidCredential(err)) return json(402, { error: 'CREDENTIAL_REJECTED' });
		return json(500, { error: 'CHAT_FAILED' });
	}
}

function firstText(message: { parts: unknown[] }): string {
	const part = message.parts.find((p): p is { type: 'text'; text: string } =>
		typeof p === 'object' && p !== null && (p as { type?: string }).type === 'text'
	);
	return part?.text ?? '';
}
```

Add `isQuotaExceeded` / `isInvalidCredential` guards: import `InvalidCredentialError` from `resolve-model` for the latter; for quota, match the error `reserve` throws when over limit (open `quota.ts` `reserve` and match its thrown error type/name — reuse it rather than string-matching).

- [ ] **Step 4: Run — expect PASS; typecheck.**

Run: `bun test src/app/api/ai/chat/route.test.ts && bun run typecheck`
Expected: PASS, clean.

- [ ] **Step 5: Commit.**

```bash
git add src/app/api/ai/chat/route.ts src/app/api/ai/chat/route.test.ts
git commit -m "feat(ai): POST /api/ai/chat — auth, selector re-validation, streaming

Accepts only the new user message; server owns chat identity and loads
history. A byok selector must name one of the caller's own enabled
credentials (403 otherwise); platform requires the platform model
configured (409). Quota/credential errors map to 429/402.
<trailers>"
```

---

### Task 7: Client scaffolding — deps, `useChat` wiring, composer, text rendering

**Files:**
- Modify: `package.json` (add deps)
- Create: `src/app/(dashboard)/_components/chat/message-thread.tsx`, `message.tsx`, `composer.tsx`, `disclosure.tsx`
- Test: `e2e/chat.spec.ts` (scaffold; full assertions land in Task 11)

**Interfaces:**
- Produces: `<MessageThread messages composer />`, `<Message message />` (renders `text` parts via `streamdown`, leaves tool parts to Task 8's registry via a `renderToolPart` prop), `<Composer onSend disabled busy onStop />`, `<Disclosure/>`.
- Consumes (from the drawer, Task 10): `messages`, `status`, `sendMessage`, `stop` from `useChat`.

- [ ] **Step 1: Install the two deps.**

Run: `bun add @ai-sdk/react streamdown@2.5.0`
Expected: both added to `package.json`; `bun.lock` updated. Do NOT add `ai-elements`.

- [ ] **Step 2: Verify the v7 client API names before writing components.**

Run: `grep -nE "DefaultChatTransport|useChat" node_modules/@ai-sdk/react/dist/*.d.ts | head`
Expected: confirm `useChat` signature (props `id`, `transport`, `messages`) and that `DefaultChatTransport` is imported from `ai`. Note the actual returned members (`messages`, `status`, `sendMessage`, `stop`, `error`) and use those exact names.

- [ ] **Step 3: Implement `Disclosure` (non-dismissible, Art. 50).**

```tsx
export function Disclosure() {
	return (
		<p className='px-4 py-2 text-muted-foreground text-xs' role='note'>
			AI assistant — informational only, not financial advice.
		</p>
	);
}
```

- [ ] **Step 4: Implement `Composer` (owns its own input state; v7 `useChat` has none).**

```tsx
'use client';
import { useState } from 'react';

export function Composer(props: { busy: boolean; disabled: boolean; onSend: (text: string) => void; onStop: () => void }) {
	const [text, setText] = useState('');
	const send = () => {
		const t = text.trim();
		if (t.length === 0 || props.disabled) return;
		props.onSend(t);
		setText('');
	};
	return (
		<div className='flex items-end gap-2 border-t p-3'>
			<textarea
				className='min-h-10 flex-1 resize-none rounded-md border bg-transparent p-2 text-sm'
				disabled={props.disabled}
				onChange={(e) => setText(e.target.value)}
				onKeyDown={(e) => {
					if (e.key === 'Enter' && !e.shiftKey) {
						e.preventDefault();
						send();
					}
				}}
				placeholder='Ask about your portfolio…'
				value={text}
			/>
			{props.busy ? (
				<button onClick={props.onStop} type='button'>Stop</button>
			) : (
				<button disabled={props.disabled} onClick={send} type='button'>Send</button>
			)}
		</div>
	);
}
```

- [ ] **Step 5: Implement `Message` (text via streamdown; tool parts delegated).**

```tsx
'use client';
import { getToolName, isToolUIPart, type UIMessage } from 'ai';
import { Streamdown } from 'streamdown';

export function Message(props: {
	message: UIMessage;
	renderToolPart: (toolName: string, part: unknown) => React.ReactNode;
}) {
	return (
		<div className='px-4 py-2'>
			{props.message.parts.map((part, i) => {
				if (part.type === 'text') return <Streamdown key={i}>{part.text}</Streamdown>;
				if (isToolUIPart(part)) return <div key={i}>{props.renderToolPart(getToolName(part), part)}</div>;
				return null; // reasoning/other: omitted for MVP
			})}
		</div>
	);
}
```

Confirm `Streamdown`'s exact export/import shape against `node_modules/streamdown` (named vs default) and adjust.

- [ ] **Step 6: Implement `MessageThread` (maps messages).**

```tsx
'use client';
import type { UIMessage } from 'ai';
import { Message } from './message';

export function MessageThread(props: {
	messages: UIMessage[];
	renderToolPart: (toolName: string, part: unknown) => React.ReactNode;
}) {
	return (
		<div className='flex-1 overflow-y-auto'>
			{props.messages.map((m) => (
				<Message key={m.id} message={m} renderToolPart={props.renderToolPart} />
			))}
		</div>
	);
}
```

- [ ] **Step 7: Typecheck + commit (UI wired in Task 10; behavior verified in Task 11).**

Run: `bun run typecheck && bun run check`
```bash
git add package.json bun.lock src/app/\(dashboard\)/_components/chat/
git commit -m "feat(ai): chat client scaffolding — composer, message thread, streamdown text

Adds @ai-sdk/react + streamdown (NOT ai-elements). Composer owns its own
input (v7 useChat has none); Message renders text via streamdown and
delegates tool parts to a renderToolPart prop. Non-dismissible Art. 50
disclosure.
<trailers>"
```

---

### Task 8: Inline artifacts — the deterministic renderer registry

**Files:**
- Create: `src/app/(dashboard)/_components/chat/artifacts/registry.ts`, `tool-call-chip.tsx`, `portfolio-allocation.tsx`, `time-series.tsx`, `data-table-artifact.tsx`
- Test: `src/app/(dashboard)/_components/chat/artifacts/registry.test.ts`

**Interfaces:**
- Produces:
  - `export const ARTIFACT_RENDERERS: Record<string, (output: unknown) => React.ReactNode>` keyed by canonical tool name (`portfolio.structure`, `portfolio.performance`, `market.priceHistory`, `transactions.search`, `watchlist.list`, `goals.list`, `fx.rates`).
  - `export function renderArtifact(toolName: string, part: { state?: string; output?: unknown }): React.ReactNode` — renders the chart/table only when `part.state === 'output-available'`, always renders a `<ToolCallChip/>`.

- [ ] **Step 1: Write the failing registry test (pure — no rendering infra needed).**

```ts
import { describe, expect, test } from 'bun:test';
import { ARTIFACT_RENDERERS } from './registry';
import { ALL_TOOLS } from '@/server/ai/tools/registry';

describe('artifact registry', () => {
	test('every Phase 0 tool name has a renderer', () => {
		for (const tool of ALL_TOOLS) {
			expect(typeof ARTIFACT_RENDERERS[tool.name]).toBe('function');
		}
	});

	test('renderer keys are canonical dot names (no underscores)', () => {
		for (const key of Object.keys(ARTIFACT_RENDERERS)) {
			expect(key.includes('_')).toBe(false);
			expect(key.includes('.')).toBe(true);
		}
	});
});
```

- [ ] **Step 2: Run — expect FAIL.**

Run: `bun test src/app/\(dashboard\)/_components/chat/artifacts/registry.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `ToolCallChip` (collapsible affordance).**

```tsx
'use client';
export function ToolCallChip(props: { toolName: string; state?: string }) {
	return (
		<span className='inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-muted-foreground text-xs'>
			used {props.toolName}
			{props.state && props.state !== 'output-available' ? ` (${props.state})` : ''}
		</span>
	);
}
```

- [ ] **Step 4: Implement the three renderers, typed against each tool's `outputSchema`.**

For each, import the tool's output type (`z.infer<typeof toolNameTool['outputSchema']>`) so the chart binds to real fields. Reuse `src/components/ui/chart.tsx` and the existing recharts patterns in `watchlist/_components` and `portfolio/structure/_components/pie-allocation.tsx`. Example (`portfolio-allocation.tsx`):

```tsx
'use client';
import { Cell, Pie, PieChart } from 'recharts';
import type { z } from 'zod';
import { portfolioStructureTool } from '@/server/ai/tools/portfolio-structure';

type Output = z.infer<typeof portfolioStructureTool.outputSchema>;

export function PortfolioAllocation({ output }: { output: Output }) {
	const data = output.positions.map((p) => ({ name: p.symbol, value: p.weight }));
	return (
		<PieChart height={200} width={280}>
			<Pie data={data} dataKey='value' nameKey='name' outerRadius={80}>
				{data.map((_, i) => <Cell key={i} />)}
			</Pie>
		</PieChart>
	);
}
```

Do the same for `time-series.tsx` (Area/LineChart over `portfolio.performance` + `market.priceHistory` outputs) and `data-table-artifact.tsx` (a small table over `transactions.search`/`watchlist.list`/`goals.list`/`fx.rates` outputs). Confirm each tool's actual output field names by reading its `outputSchema` before writing the renderer (e.g. `sed -n '1,80p' src/server/ai/tools/portfolio-structure.ts`).

- [ ] **Step 5: Implement `registry.ts` + `renderArtifact`.**

```tsx
import type { ReactNode } from 'react';
import { PortfolioAllocation } from './portfolio-allocation';
import { TimeSeries } from './time-series';
import { DataTableArtifact } from './data-table-artifact';
import { ToolCallChip } from './tool-call-chip';

export const ARTIFACT_RENDERERS: Record<string, (output: unknown) => ReactNode> = {
	'fx.rates': (o) => <DataTableArtifact kind='fx.rates' output={o} />,
	'goals.list': (o) => <DataTableArtifact kind='goals.list' output={o} />,
	'market.priceHistory': (o) => <TimeSeries kind='market.priceHistory' output={o} />,
	'portfolio.performance': (o) => <TimeSeries kind='portfolio.performance' output={o} />,
	'portfolio.structure': (o) => <PortfolioAllocation output={o as never} />,
	'transactions.search': (o) => <DataTableArtifact kind='transactions.search' output={o} />,
	'watchlist.list': (o) => <DataTableArtifact kind='watchlist.list' output={o} />
};

export function renderArtifact(toolName: string, part: { state?: string; output?: unknown }): ReactNode {
	const renderer = ARTIFACT_RENDERERS[toolName];
	return (
		<div className='my-2 space-y-1'>
			<ToolCallChip state={part.state} toolName={toolName} />
			{part.state === 'output-available' && renderer ? renderer(part.output) : null}
		</div>
	);
}
```

Wire `renderArtifact` as the `renderToolPart` prop from Task 7's thread in Task 10.

- [ ] **Step 6: Run — expect PASS; typecheck.**

Run: `bun test src/app/\(dashboard\)/_components/chat/artifacts/registry.test.ts && bun run typecheck`
Expected: PASS, clean.

- [ ] **Step 7: Commit.**

```bash
git add src/app/\(dashboard\)/_components/chat/artifacts/
git commit -m "feat(ai): inline artifact registry — deterministic renderers per tool output

Charts/tables bind to each tool's typed outputSchema (Approach A), so the
model cannot hallucinate a number into a chart. renderArtifact always
shows a tool-call chip and renders the artifact only at output-available.
<trailers>"
```

---

### Task 9: Model picker, history rail, error copy

**Files:**
- Create: `src/app/(dashboard)/_components/chat/model-picker.tsx`, `conversation-list.tsx`, `chat-errors.ts`, `use-chat-selector.ts`
- Test: `src/app/(dashboard)/_components/chat/use-chat-selector.test.ts`, `chat-errors.test.ts`

**Interfaces:**
- Produces:
  - `buildSelectorOptions(platformConfigured: boolean, creds: { provider: string }[]): SelectorOption[]` (pure)
  - `errorCopy(code: string): string` (pure map for the route's error codes)
  - `<ModelPicker value onChange options />`, `<ConversationList chats activeId onSelect onNew onRename onDelete />`

- [ ] **Step 1: Write failing pure-logic tests.**

```ts
import { describe, expect, test } from 'bun:test';
import { buildSelectorOptions } from './use-chat-selector';
import { errorCopy } from './chat-errors';

describe('selector options', () => {
	test('platform first when configured, then each byok provider', () => {
		const opts = buildSelectorOptions(true, [{ provider: 'ANTHROPIC' }, { provider: 'GOOGLE' }]);
		expect(opts.map((o) => o.label)).toEqual(['Platform', 'Your key: Anthropic', 'Your key: Google']);
	});
	test('omits platform when not configured', () => {
		const opts = buildSelectorOptions(false, [{ provider: 'ANTHROPIC' }]);
		expect(opts.map((o) => o.value.kind)).toEqual(['byok']);
	});
	test('empty when nothing available', () => {
		expect(buildSelectorOptions(false, [])).toEqual([]);
	});
});

describe('errorCopy', () => {
	test('maps known codes to human copy', () => {
		expect(errorCopy('QUOTA_EXCEEDED')).toMatch(/usage limit/i);
		expect(errorCopy('NO_SUCH_CREDENTIAL')).toMatch(/Settings/i);
		expect(errorCopy('WHATEVER')).toMatch(/something went wrong/i);
	});
});
```

- [ ] **Step 2: Run — expect FAIL.**

Run: `bun test src/app/\(dashboard\)/_components/chat/use-chat-selector.test.ts src/app/\(dashboard\)/_components/chat/chat-errors.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `use-chat-selector.ts` and `chat-errors.ts`.**

```ts
// use-chat-selector.ts
import type { ModelSelector } from '@/server/ai/resolve-model';

export type SelectorOption = { label: string; value: ModelSelector };

const PROVIDER_LABEL: Record<string, string> = {
	ANTHROPIC: 'Anthropic', AZURE: 'Azure', GOOGLE: 'Google', OPENAI: 'OpenAI', OPENAI_COMPATIBLE: 'Custom'
};

export function buildSelectorOptions(platformConfigured: boolean, creds: { provider: string }[]): SelectorOption[] {
	const opts: SelectorOption[] = [];
	if (platformConfigured) opts.push({ label: 'Platform', value: { kind: 'platform' } });
	for (const c of creds) {
		opts.push({
			label: `Your key: ${PROVIDER_LABEL[c.provider] ?? c.provider}`,
			value: { kind: 'byok', provider: c.provider as never }
		});
	}
	return opts;
}
```

```ts
// chat-errors.ts
const COPY: Record<string, string> = {
	CHAT_FAILED: 'Something went wrong. Please try again.',
	CREDENTIAL_REJECTED: 'Your provider key was rejected — check Settings → AI.',
	NO_PLATFORM_MODEL: 'No platform model is configured. Add your own key in Settings → AI.',
	NO_SUCH_CREDENTIAL: 'That provider is not set up. Add a key in Settings → AI.',
	QUOTA_EXCEEDED: 'You have hit your usage limit.'
};
export function errorCopy(code: string): string {
	return COPY[code] ?? 'Something went wrong. Please try again.';
}
```

- [ ] **Step 4: Implement `ModelPicker` and `ConversationList`** (Base UI Select + list; use `api.aiCredentials.list` for creds and `api.aiChat.list`/`rename`/`delete` for history — client components using `@/trpc/react`). Keep them presentational; data is passed in from the drawer (Task 10).

- [ ] **Step 5: Run pure tests — expect PASS; typecheck.**

Run: `bun test src/app/\(dashboard\)/_components/chat/use-chat-selector.test.ts src/app/\(dashboard\)/_components/chat/chat-errors.test.ts && bun run typecheck`
Expected: PASS, clean.

- [ ] **Step 6: Commit.**

```bash
git add src/app/\(dashboard\)/_components/chat/
git commit -m "feat(ai): model picker, history rail, error copy

buildSelectorOptions lists platform + the user's BYOK providers;
errorCopy maps route error codes to human messages (no silent failures).
<trailers>"
```

---

### Task 10: The drawer, header, launcher — wire it together

**Files:**
- Create: `src/app/(dashboard)/_components/chat/chat-drawer.tsx`, `chat-header.tsx`, `chat-launcher.tsx`
- Modify: `src/app/(dashboard)/layout.tsx` (mount `<ChatLauncher/>` in the header)

**Interfaces:**
- `<ChatLauncher/>` — a client button + the drawer; opens/closes; holds the active `chatId` state and the selected model.
- Inside, `useChat({ id: chatId, transport: new DefaultChatTransport({ api: '/api/ai/chat', prepareSendMessagesRequest }) })`; `prepareSendMessagesRequest` sends `{ chatId, message: <last>, model: selector }`.

- [ ] **Step 1: Implement the drawer body** — compose `ConversationList` + `ChatHeader` (with `ModelPicker`) + `MessageThread` (passing `renderArtifact` from Task 8 as `renderToolPart`) + `Composer` + `Disclosure`. Wide by default: `className='w-[clamp(420px,40vw,760px)]'`. Use a right-side dialog (Base UI `Dialog` styled as a side panel, or `vaul` `Drawer` with `direction='right'` — match whichever the repo already uses for side panels; grep `vaul`/`Drawer`/`Sheet` first).

- [ ] **Step 2: Implement `useChat` wiring in `chat-launcher.tsx`.**

```tsx
'use client';
import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport } from 'ai';
import { useState } from 'react';
import type { ModelSelector } from '@/server/ai/resolve-model';

export function ChatLauncher() {
	const [open, setOpen] = useState(false);
	const [chatId, setChatId] = useState<string | undefined>(undefined);
	const [selector, setSelector] = useState<ModelSelector>({ kind: 'platform' });

	const { messages, sendMessage, status, stop, error } = useChat({
		id: chatId,
		transport: new DefaultChatTransport({
			api: '/api/ai/chat',
			prepareSendMessagesRequest: ({ messages, id }) => ({
				body: { chatId: id, message: messages[messages.length - 1], model: selector }
			})
		})
	});
	// ...render launcher button + <ChatDrawer .../> passing these down.
}
```

Verify `prepareSendMessagesRequest`'s exact parameter shape against `@ai-sdk/react`'s `.d.ts` (`PrepareSendMessagesRequest`) and adjust the destructure. The goal is invariant: send only `{ chatId, message: last, model: selector }`.

- [ ] **Step 3: Mount in the layout header.**

In `src/app/(dashboard)/layout.tsx`, inside the header's right-aligned `div` (next to `<CurrencySwitch/>` / `<ThemeSwitch/>`), add `<ChatLauncher/>`.

- [ ] **Step 4: Manual smoke + typecheck + lint.**

Run: `bun run typecheck && bun run check`
Expected: clean. (Behavioral verification is the E2E in Task 11.)

- [ ] **Step 5: Commit.**

```bash
git add src/app/\(dashboard\)/_components/chat/ src/app/\(dashboard\)/layout.tsx
git commit -m "feat(ai): chat drawer + launcher wired into the dashboard header

Global slide-over available on every dashboard page; useChat posts only
the last message + chatId + selector to /api/ai/chat; tool parts render
via the deterministic artifact registry.
<trailers>"
```

---

### Task 11: Happy-path E2E + final verification

**Files:**
- Create: `e2e/chat.spec.ts`
- Possibly modify: a test-env stub so the model is deterministic (see Step 2)

- [ ] **Step 1: Read an existing Playwright spec to reuse auth/setup.**

Run: `ls e2e && sed -n '1,60p' e2e/$(ls e2e | head -1)`
Expected: learn how specs authenticate a user and start the app (`test:e2e` config).

- [ ] **Step 2: Make the model deterministic in the E2E env.** Prefer intercepting `POST /api/ai/chat` with `page.route(...)` to return a canned `UIMessage` stream (a text part + one `tool-portfolio_structure` output-available part), so the test asserts UI behavior without a live model. (This keeps live model behavior covered by the tier-1 evals, not E2E.)

- [ ] **Step 3: Write the E2E.**

```ts
import { expect, test } from '@playwright/test';

test('user opens the chat drawer, sends a message, sees a reply + tool chip', async ({ page }) => {
	await signIn(page); // existing helper
	await page.route('**/api/ai/chat', async (route) => {
		await route.fulfill({ body: cannedUiMessageStream(), contentType: 'text/event-stream', status: 200 });
	});
	await page.goto('/portfolio');
	await page.getByRole('button', { name: /assistant|chat/i }).click();
	await page.getByPlaceholder('Ask about your portfolio…').fill('How is my portfolio?');
	await page.keyboard.press('Enter');
	await expect(page.getByText(/portfolio/i)).toBeVisible();
	await expect(page.getByText(/used portfolio\.structure/i)).toBeVisible();
	await expect(page.getByText(/not financial advice/i)).toBeVisible();
});
```

`cannedUiMessageStream()` returns the AI SDK UI-message SSE framing — build it from the shape `readUIMessageStream`/`toUIMessageStreamResponse` produce (capture one real response body during dev and vendor it as the fixture).

- [ ] **Step 4: Run the E2E.**

Run: `bun run test:e2e -- chat.spec.ts`
Expected: PASS.

- [ ] **Step 5: Full gate sweep.**

Run:
```bash
bun run typecheck && bun run check && bun run test:unit
```
Expected: typecheck clean, biome clean, all unit tests pass.

- [ ] **Step 6: Confirm the advice-boundary eval still passes against live Azure (release gate).**

Run: `bun run eval:advice`
Expected: 18/18 pass (unchanged — chat reuses the same prompt + model stack).

- [ ] **Step 7: Commit.**

```bash
git add e2e/chat.spec.ts
git commit -m "test(ai): happy-path E2E for the chat drawer + final Phase 1 verification

Intercepts /api/ai/chat with a canned UI-message stream; asserts streamed
reply, tool chip, and the non-dismissible disclosure. Live advice-boundary
eval still 18/18.
<trailers>"
```

---

## Self-Review

**1. Spec coverage:**
- Global slide-over drawer + launcher → Task 10. ✅
- Streaming + tool-calling → Task 5 (gateway) + Task 6 (route). ✅
- Inline artifacts (Approach A) → Task 8. ✅
- Explicit model picker, server-re-validated → Task 1 (resolveModel selector) + Task 6 (validation) + Task 9 (picker UI). ✅
- Persisted history (list/resume/rename/delete, ownership-scoped) → Task 3 + Task 4 + Task 9/10. ✅
- Quota reserve/settle platform-only; BYOK bypass → Task 5. ✅
- `createToolCtx` gap closed → Task 2. ✅
- No-silent-failure error map → Task 6 (codes) + Task 9 (copy). ✅
- Art. 50 disclosure, no off switch → Task 7 (`Disclosure`) + Task 11 (asserted). ✅
- Two new deps only, no `ai-elements` → Task 7. ✅
- Testing: unit + pure-logic + one E2E + evals unchanged → Tasks 1-11. ✅

**2. Placeholder scan:** No "TBD/TODO/handle edge cases" left. Every code step shows real code; DB-harness and Playwright-fixture steps name the exact existing file to copy from rather than hand-waving. The two explicit "verify against `.d.ts`" notes (streamText `onFinish` payload keys, `prepareSendMessagesRequest` shape) are deliberate v7-safety checks required by the global constraint, with the invariant stated so the implementer knows what must hold.

**3. Type consistency:** `ModelSelector` (Task 1) is consumed unchanged by Tasks 5, 6, 9, 10. `ResolvedModel` fields (`byok`, `resolvedModel`, `model`, `providerId`) match Phase 0. `streamChatTurn` args/`deps` (Task 5) match what Task 6 calls. `renderArtifact`/`ARTIFACT_RENDERERS` names (Task 8) match the `renderToolPart` prop consumed in Tasks 7/10. `buildSelectorOptions`/`errorCopy` (Task 9) match their tests. Tool names use canonical dot form everywhere; the adapter's dot→underscore mapping stays confined to `ai-sdk.ts` and `getToolName` returns the canonical name for registry lookup.
