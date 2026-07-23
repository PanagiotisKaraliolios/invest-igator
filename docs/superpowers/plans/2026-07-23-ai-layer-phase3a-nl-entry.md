# AI Layer — Phase 3a: Natural-Language Transaction Entry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the first *write* AI tool — `transactions.create` — so a chat user can say "I bought 10 Apple at 150 yesterday" and, after clicking Confirm on a card, record exactly one transaction.

**Architecture:** The write tool is **side-effect-free**: it resolves symbol/currency/date, previews, and signs a stateless 120s HMAC `PendingMutation` token — it writes nothing. An interactive read-only Confirm card (the first interactive chat artifact) fires a session-authenticated tRPC mutation whose testable core re-checks HMAC / expiry / cross-user / single-use `jti`, then writes via a shared `createTransaction()`. Chat gains `transactions:write`; MCP stays read-only.

**Tech Stack:** Next 16 App Router, tRPC v11, Prisma 7 / Postgres, Vercel AI SDK v7, zod, `node:crypto` HMAC (no new deps), `bun test`, biome.

## Global Constraints

Every task's requirements implicitly include this section.

- **The write tool writes nothing.** `transactions.create.execute` only reads (for resolution) and returns a `PendingMutation`. The single write path is the commit core → `createTransaction()`.
- **`userId` comes only from the session (commit) or the signed token (verified) — never from model input or the request body.** Tool `inputSchema` is `z.strictObject` with NO `userId` (enforced by `registry.test.ts`).
- **The confirmation token is HMAC-SHA256, compared with `timingSafeEqual`, time-bounded (120s, server-authoritative), single-use (`jti` PK), and non-transferable (`payload.userId === session.user.id`).**
- **Dedicated secret `AI_MUTATION_SECRET`** (`z.string().min(32).optional()`) — never `AI_API_KEY_PEPPER`. Token helpers and the commit core take the secret as a **parameter** (hermetically testable); only the runtime tool/procedure read it from `env`.
- **Tool name is the dot form `transactions.create`** (like `transactions.search`), `requiredScope: 'transactions:write'`, `mutates: true`, `preview` defined, `annotations.readOnlyHint: false`.
- **MCP stays read-only** — `buildToolset` already drops `mutates` tools on the MCP surface; do not weaken it. Chat gains write via an explicit `CHAT_SCOPES` set (the `createToolCtx` default stays `ALL_READ_SCOPES`).
- **Not advice** (MiFID II): the tool is transactional-only; `eval:advice` must stay green.
- **Tests:** hermetic unit under `src/**` (mock `@/server/db`, `@/env`, Yahoo modules before the dynamic `import` of the module under test); real-Postgres under `prisma/**` added to the `test:db` script (`seedUser`/`resetAiTables` from `src/server/ai/evals/db-support`).
- **Commits** end with the trailers `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>` and `Claude-Session: https://claude.ai/code/session_01TY5vHxHcvShQEeKhbJPuSE`.

---

## File Structure

**Create:**
- `src/server/ai/mutations/token.ts` — `signMutation`/`verifyMutation` + `MutationPayload` type (HMAC envelope; secret is a param).
- `src/server/ai/mutations/token.test.ts` — hermetic (Pattern A).
- `src/server/ai/mutations/commit.ts` — `commitPendingTransaction(deps)` testable core (verify → cross-user → jti → write).
- `prisma/ai-commit-pending-transaction.test.ts` — real-Postgres (Pattern B).
- `src/server/ai/tools/transactions-create.ts` — the write tool: `resolveProposed`, `formatProposed`, `ProposedTransaction`, `transactionsCreateTool`.
- `src/server/ai/tools/transactions-create.test.ts` — hermetic (Pattern A).
- `src/app/(dashboard)/_components/chat/artifacts/confirm-card.tsx` — the `'use client'` `ConfirmCard`.
- `src/app/(dashboard)/_components/chat/artifacts/confirm-card.helpers.ts` — `isExpired` (+ pure display helpers).
- `src/app/(dashboard)/_components/chat/artifacts/confirm-card.helpers.test.ts` — hermetic (Pattern A).
- `prisma/transaction-create-service.test.ts` — real-Postgres parity for the extracted service (Pattern B).

**Modify:**
- `prisma/schema.prisma` — add `AiMutationCommit` model.
- `src/env.js` — add `AI_MUTATION_SECRET` (server schema + `runtimeEnv`).
- `.env.example` — document `AI_MUTATION_SECRET`.
- `src/server/services/transactions.ts` — add `createTransaction()` (pure write).
- `src/server/api/routers/transactions.ts` — repoint the `create` mutation's write to `createTransaction()`.
- `src/server/api/routers/transactions.schemas.ts` — export `CreateTransactionInput` type.
- `src/server/api/routers/ai-chat.ts` — add the `commitPendingTransaction` procedure.
- `src/server/ai/tools/registry.ts` — add `transactionsCreateTool` to `ALL_TOOLS`.
- `src/server/ai/tools/registry.test.ts` — exempt the write tool from the "all read-only" assertions; add the 8th name.
- `src/server/ai/tool-ctx.ts` — add `CHAT_SCOPES`.
- `src/server/ai/chat/gateway.ts` — pass `CHAT_SCOPES` to `createToolCtx`.
- `src/app/(dashboard)/_components/chat/artifacts/registry.ts` — add the `transactions.create` renderer.

---

## Task 1: `AI_MUTATION_SECRET` env + `AiMutationCommit` table

The foundation: the dedicated secret (runtime) and the single-use `jti` store (exactly-once replay guard).

**Files:**
- Modify: `src/env.js` (server schema block ~L73-90, `runtimeEnv` ~L30-31)
- Modify: `.env.example`
- Modify: `prisma/schema.prisma`
- Test: `prisma/ai-commit-pending-transaction.test.ts` (created here with the jti sub-test; extended in Task 5)

**Interfaces:**
- Produces: `env.AI_MUTATION_SECRET: string | undefined`; the Prisma model `AiMutationCommit { jti @id, userId, tool, createdAt }` reachable as `db.aiMutationCommit`.

- [ ] **Step 1: Add the env var**

In `src/env.js`, add to the `server:` schema block (alphabetized, next to `AI_API_KEY_PEPPER`):

```js
// HMAC key for write-confirmation tokens (Phase 3a). Dedicated, NOT AI_API_KEY_PEPPER.
// `openssl rand -base64 32`. Unset ⇒ transactions.create is unavailable and commit fails closed.
AI_MUTATION_SECRET: z.string().min(32).optional(),
```

And to `runtimeEnv`:

```js
AI_MUTATION_SECRET: process.env.AI_MUTATION_SECRET,
```

- [ ] **Step 2: Document it in `.env.example`**

Add (mirror the existing `AI_API_KEY_PEPPER` entry's style):

```
# HMAC key for AI write-confirmation tokens (Phase 3a NL transaction entry). >=32 chars.
# openssl rand -base64 32
AI_MUTATION_SECRET=
```

- [ ] **Step 3: Add the Prisma model**

In `prisma/schema.prisma`, add (near the other `Ai*` models):

```prisma
/// One row per consumed write-confirmation token. The `jti` PK makes a commit exactly-once:
/// a replayed/double-clicked token collides here and the whole commit transaction rolls back.
model AiMutationCommit {
  jti       String   @id
  userId    String
  tool      String
  createdAt DateTime @default(now())

  @@index([userId])
}
```

- [ ] **Step 4: Generate + apply the migration**

Run: `bunx prisma migrate dev --name ai_mutation_commit`
Expected: creates `prisma/migrations/<ts>_ai_mutation_commit/migration.sql` with `CREATE TABLE "AiMutationCommit" (...)`, applies it to the local Postgres, and regenerates the client. Confirm the SQL file exists and `db.aiMutationCommit` is now typed (a following `bun run typecheck` is clean).

- [ ] **Step 5: Write the failing jti test**

Create `prisma/ai-commit-pending-transaction.test.ts`:

```ts
import { beforeEach, describe, expect, test } from 'bun:test';
import { resetAiTables, seedUser } from '../src/server/ai/evals/db-support';
import { db } from '../src/server/db';

describe('AiMutationCommit — single-use jti', () => {
	let userId: string;
	beforeEach(async () => {
		await resetAiTables();
		userId = await seedUser('a');
	});

	test('a duplicate jti is rejected (P2002)', async () => {
		await db.aiMutationCommit.create({ data: { jti: 'jti-1', tool: 'transactions.create', userId } });
		await expect(
			db.aiMutationCommit.create({ data: { jti: 'jti-1', tool: 'transactions.create', userId } })
		).rejects.toThrow();
	});
});
```

Note for the implementer: `resetAiTables` (`src/server/ai/evals/db-support.ts`) must also clear `AiMutationCommit` between tests — add `db.aiMutationCommit.deleteMany()` to it alongside the existing `AiToolCall`/`AiCall` clears (it deletes AI tables first, then the seed users). Verify by reading `resetAiTables` and adding the line.

- [ ] **Step 6: Run it, and register the file in `test:db`**

Run: `bun test prisma/ai-commit-pending-transaction.test.ts`
Expected: PASS (the second insert throws on the unique PK).
Then append ` prisma/ai-commit-pending-transaction.test.ts` to the `test:db` script's file list in `package.json` (so CI's `db_tests` job runs it).

- [ ] **Step 7: Commit**

```bash
git add src/env.js .env.example prisma/schema.prisma prisma/migrations src/server/ai/evals/db-support.ts prisma/ai-commit-pending-transaction.test.ts package.json
git commit -m "feat(ai): AI_MUTATION_SECRET env + AiMutationCommit single-use-jti table"
```

---

## Task 2: Confirmation token helpers

A pure, hermetically testable HMAC envelope. Secret is a **parameter**, never read from `env` here.

**Files:**
- Create: `src/server/ai/mutations/token.ts`
- Test: `src/server/ai/mutations/token.test.ts`

**Interfaces:**
- Produces:
  - `type MutationPayload = { v: 1; userId: string; tool: string; args: unknown; jti: string; iat: number; exp: number }`
  - `signMutation(payload: MutationPayload, secret: string): string`
  - `verifyMutation(token: string, secret: string, now?: number): { ok: true; payload: MutationPayload } | { ok: false; reason: 'INVALID' | 'EXPIRED' }`

- [ ] **Step 1: Write the failing test**

Create `src/server/ai/mutations/token.test.ts`:

```ts
import { describe, expect, test } from 'bun:test';
import { type MutationPayload, signMutation, verifyMutation } from './token';

const SECRET = 'x'.repeat(32);
function payload(over: Partial<MutationPayload> = {}): MutationPayload {
	return { v: 1, userId: 'u1', tool: 'transactions.create', args: { symbol: 'AAPL' }, jti: 'j1', iat: 1000, exp: 1120, ...over };
}

describe('mutation token', () => {
	test('round-trips a payload', () => {
		const token = signMutation(payload(), SECRET);
		const res = verifyMutation(token, SECRET, 1000);
		expect(res.ok).toBe(true);
		if (res.ok) expect(res.payload).toEqual(payload());
	});

	test('rejects a tampered payload', () => {
		const token = signMutation(payload(), SECRET);
		const [p, sig] = token.split('.');
		const forged = Buffer.from(JSON.stringify(payload({ args: { symbol: 'TSLA' } }))).toString('base64url');
		const res = verifyMutation(`${forged}.${sig}`, SECRET, 1000);
		expect(res).toEqual({ ok: false, reason: 'INVALID' });
		expect(p.length).toBeGreaterThan(0);
	});

	test('rejects a wrong secret', () => {
		const token = signMutation(payload(), SECRET);
		expect(verifyMutation(token, 'y'.repeat(32), 1000)).toEqual({ ok: false, reason: 'INVALID' });
	});

	test('rejects a malformed token', () => {
		expect(verifyMutation('not-a-token', SECRET, 1000)).toEqual({ ok: false, reason: 'INVALID' });
	});

	test('rejects an expired token (now > exp)', () => {
		const token = signMutation(payload({ exp: 1120 }), SECRET);
		expect(verifyMutation(token, SECRET, 1121)).toEqual({ ok: false, reason: 'EXPIRED' });
	});

	test('signature is verified BEFORE expiry (a tampered expired token is INVALID, not EXPIRED)', () => {
		const token = signMutation(payload({ exp: 1120 }), SECRET);
		const forged = Buffer.from(JSON.stringify(payload({ exp: 9999 }))).toString('base64url');
		const [, sig] = token.split('.');
		expect(verifyMutation(`${forged}.${sig}`, SECRET, 5000)).toEqual({ ok: false, reason: 'INVALID' });
	});
});
```

- [ ] **Step 2: Run to verify failure**

Run: `bun test src/server/ai/mutations/token.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `src/server/ai/mutations/token.ts`:

```ts
import { createHmac, timingSafeEqual } from 'node:crypto';

/** The signed, tamper-evident, time-bounded envelope a mutating tool returns for a human to confirm. */
export type MutationPayload = {
	v: 1;
	userId: string;
	tool: string;
	args: unknown;
	jti: string;
	iat: number;
	exp: number;
};

function sign(encodedPayload: string, secret: string): string {
	return createHmac('sha256', secret).update(encodedPayload).digest('base64url');
}

/** `base64url(json).base64url(hmac)`. */
export function signMutation(payload: MutationPayload, secret: string): string {
	const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
	return `${encoded}.${sign(encoded, secret)}`;
}

function safeEqual(a: string, b: string): boolean {
	const ab = Buffer.from(a);
	const bb = Buffer.from(b);
	if (ab.length !== bb.length) return false;
	return timingSafeEqual(ab, bb);
}

/**
 * Verify signature FIRST (constant-time), THEN expiry — so a forged token never reports EXPIRED
 * (which would leak that the signature check was skipped). `now` is injectable for tests; callers
 * pass `Date.now() / 1000` (seconds) in production.
 */
export function verifyMutation(
	token: string,
	secret: string,
	now: number = Math.floor(Date.now() / 1000)
): { ok: true; payload: MutationPayload } | { ok: false; reason: 'INVALID' | 'EXPIRED' } {
	const dot = token.indexOf('.');
	if (dot <= 0) return { ok: false, reason: 'INVALID' };
	const encoded = token.slice(0, dot);
	const sig = token.slice(dot + 1);
	if (!safeEqual(sig, sign(encoded, secret))) return { ok: false, reason: 'INVALID' };

	let payload: MutationPayload;
	try {
		payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as MutationPayload;
	} catch {
		return { ok: false, reason: 'INVALID' };
	}
	if (payload.v !== 1 || typeof payload.exp !== 'number') return { ok: false, reason: 'INVALID' };
	if (now > payload.exp) return { ok: false, reason: 'EXPIRED' };
	return { ok: true, payload };
}
```

- [ ] **Step 4: Run to verify passing**

Run: `bun test src/server/ai/mutations/token.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/server/ai/mutations/token.ts src/server/ai/mutations/token.test.ts
git commit -m "feat(ai): HMAC mutation-confirmation token sign/verify (signature-before-expiry)"
```

---

## Task 3: Extract the shared `createTransaction()` write

The pure write both the tRPC `create` and the commit core will use. Yahoo validation + cache invalidation stay with the *callers* (the tRPC path validates; the commit trusts the signed token), so `createTransaction` holds no network call and can run inside a DB transaction.

**Files:**
- Modify: `src/server/api/routers/transactions.schemas.ts` (add the inferred type)
- Modify: `src/server/services/transactions.ts` (add `createTransaction`)
- Modify: `src/server/api/routers/transactions.ts` (repoint the `create` write)
- Test: `prisma/transaction-create-service.test.ts`

**Interfaces:**
- Consumes: `createTransactionInput` (`transactions.schemas.ts:15`).
- Produces:
  - `type CreateTransactionInput = z.infer<typeof createTransactionInput>` (in `transactions.schemas.ts`)
  - `createTransaction(userId: string, input: CreateTransactionInput, client?: Pick<typeof db, 'transaction' | 'watchlistItem'>): Promise<{ id: string }>` (in `services/transactions.ts`) — pure write: `transaction.create` + `watchlistItem.upsert`. No Yahoo, no cache invalidation.

- [ ] **Step 1: Export the input type**

In `src/server/api/routers/transactions.schemas.ts`, after the `createTransactionInput` declaration add:

```ts
export type CreateTransactionInput = z.infer<typeof createTransactionInput>;
```

- [ ] **Step 2: Write the failing service test**

Create `prisma/transaction-create-service.test.ts`:

```ts
import { beforeEach, describe, expect, test } from 'bun:test';
import { resetAiTables, seedUser } from '../src/server/ai/evals/db-support';
import { createTransaction } from '../src/server/services/transactions';
import { db } from '../src/server/db';

describe('createTransaction service', () => {
	let userId: string;
	beforeEach(async () => {
		await resetAiTables();
		userId = await seedUser('a');
		// Seed a watchlist item so createTransaction's callers don't need Yahoo; the service itself
		// does no Yahoo — this just gives us a symbol to reference.
		await db.watchlistItem.create({ data: { symbol: 'AAPL', userId } });
	});

	test('writes a transaction row and returns its id', async () => {
		const { id } = await createTransaction(userId, {
			date: new Date('2026-01-02'),
			price: 150,
			priceCurrency: 'USD',
			quantity: 10,
			side: 'BUY',
			symbol: 'AAPL'
		});
		const row = await db.transaction.findUnique({ where: { id } });
		expect(row?.userId).toBe(userId);
		expect(row?.symbol).toBe('AAPL');
		expect(row?.quantity).toBe(10);
		expect(row?.side).toBe('BUY');
	});

	test('upserts the symbol into the watchlist (idempotent)', async () => {
		await createTransaction(userId, {
			date: new Date('2026-01-02'), price: 5, priceCurrency: 'USD', quantity: 1, side: 'BUY', symbol: 'MSFT'
		});
		const wl = await db.watchlistItem.findUnique({ where: { userId_symbol: { symbol: 'MSFT', userId } } });
		expect(wl).not.toBeNull();
	});
});
```

Implementer note: confirm the seeded `date` type — `createTransactionInput.date` is `isoDateSchema`; check whether it yields a `Date` or an ISO string and pass the matching type (read `isoDateSchema` in `transactions.schemas.ts`; the `Transaction.date` column is `DateTime`). Adjust the test's `date` value to the exact type `createTransactionInput` produces.

- [ ] **Step 3: Run to verify failure**

Run: `bun test prisma/transaction-create-service.test.ts`
Expected: FAIL — `createTransaction` is not exported from the service.

- [ ] **Step 4: Implement the service function**

In `src/server/services/transactions.ts` add (the `normalizeSymbol` import may already be needed elsewhere — add `import { normalizeSymbol } from '@/lib/validation';` and `import type { Currency } from '@/lib/currency';` and `import type { CreateTransactionInput } from '@/server/api/routers/transactions.schemas';` if not present):

```ts
/**
 * The single transaction WRITE path, shared by the tRPC `create` mutation and the AI write-commit.
 * PURE: no Yahoo validation (callers do it — the tRPC path validates the symbol; the commit trusts
 * the signed token) and NO cache invalidation (callers invalidate after). Accepts a Prisma client
 * so the commit can run it inside a `$transaction` alongside the single-use `jti` insert.
 */
export async function createTransaction(
	userId: string,
	input: CreateTransactionInput,
	client: Pick<typeof db, 'transaction' | 'watchlistItem'> = db
): Promise<{ id: string }> {
	const symbol = normalizeSymbol(input.symbol);
	const created = await client.transaction.create({
		data: {
			date: input.date,
			fee: input.fee,
			feeCurrency: (input.feeCurrency as Currency | undefined) ?? null,
			note: input.note,
			price: input.price,
			priceCurrency: input.priceCurrency as Currency,
			quantity: input.quantity,
			side: input.side,
			symbol,
			userId
		}
	});
	try {
		await client.watchlistItem.upsert({
			create: { symbol: created.symbol, userId },
			update: {},
			where: { userId_symbol: { symbol: created.symbol, userId } }
		});
	} catch {}
	return { id: created.id };
}
```

- [ ] **Step 5: Repoint the tRPC `create` mutation**

In `src/server/api/routers/transactions.ts`, in the `create` mutation, **keep the Yahoo validation exactly as-is** (the `normalizeSymbol` + watchlist fast-path + `symbolExistsOnYahoo` block), then replace the inline `ctx.db.transaction.create({...})` + `ctx.db.watchlistItem.upsert({...})` block with a call to the service, preserving the cache invalidation:

```ts
import { createTransaction } from '@/server/services/transactions';
// ...inside the create mutation, after the Yahoo validation block:
const { id } = await createTransaction(userId, input);
await invalidatePortfolioCache(userId);
return { id } as const;
```

(The `symbol` normalization now happens inside `createTransaction`; the validation block above still normalizes for the Yahoo lookup — that duplicate `normalizeSymbol` is harmless and idempotent.)

- [ ] **Step 6: Run the service test + existing transaction tests (parity)**

Run: `bun test prisma/transaction-create-service.test.ts`
Expected: PASS.
Run the existing transaction test suite to confirm the tRPC `create` behavior is unchanged: `bun test $(git ls-files 'src/**/transactions*.test.ts' 'prisma/**/transaction*.test.ts')` (and any router test that exercises `transactions.create`). Expected: all still PASS. If none exist, note that in the report.
Then append ` prisma/transaction-create-service.test.ts` to the `test:db` script's file list in `package.json`.
Run: `bun run typecheck` — expected clean.

- [ ] **Step 7: Commit**

```bash
git add src/server/services/transactions.ts src/server/api/routers/transactions.ts src/server/api/routers/transactions.schemas.ts prisma/transaction-create-service.test.ts package.json
git commit -m "refactor(transactions): extract shared createTransaction() write (pure, tx-capable)"
```

---

## Task 4: The `transactions.create` write tool

Side-effect-free: resolve → preview → sign. Registers into `ALL_TOOLS`; updates the registry test that forbids write tools.

**Files:**
- Create: `src/server/ai/tools/transactions-create.ts`
- Test: `src/server/ai/tools/transactions-create.test.ts`
- Modify: `src/server/ai/tools/registry.ts` (add to `ALL_TOOLS`)
- Modify: `src/server/ai/tools/registry.test.ts` (exempt the write tool)

**Interfaces:**
- Consumes: `signMutation`/`MutationPayload` (Task 2); `symbolExistsOnYahoo`/`searchYahooSymbols` (`@/server/yahoo-search`); `fetchYahooDaily` (`@/server/yahoo-lib`); `SUPPORTED_CURRENCIES`/`Currency` (`@/lib/currency`); `AppTool`/`ToolCtx` (`@/server/ai/tools/types`); `env.AI_MUTATION_SECRET`; `db.user` (currency).
- Produces:
  - `type ProposedTransaction = { date: string; symbol: string; side: 'BUY' | 'SELL'; quantity: number; price: number; priceCurrency: string; fee?: number; feeCurrency?: string; note?: string }`
  - `transactionsCreateTool: AppTool` (name `transactions.create`) with `outputSchema` = discriminated union on `requiresConfirmation`:
    - `{ requiresConfirmation: true; preview: string; proposed: ProposedTransaction; description?: string; expiresAt: string; confirmationToken: string }`
    - `{ requiresConfirmation: false; error: string }`

- [ ] **Step 1: Write the failing test**

Create `src/server/ai/tools/transactions-create.test.ts` (mock the resolution deps, `@/env`, and `@/server/db`; a write would call `db.transaction.create`, which is NOT provided on the mock, so any accidental write throws):

```ts
import { describe, expect, mock, test } from 'bun:test';
import { verifyMutation } from '../mutations/token';

const SECRET = 'x'.repeat(32);
mock.module('@/env', () => ({ env: { AI_MUTATION_SECRET: SECRET } }));

let existence: 'yes' | 'no' | 'unreachable' = 'yes';
let searchResults: Array<{ symbol: string; description: string }> = [];
let dailyCurrency: string | undefined = 'USD';
mock.module('@/server/yahoo-search', () => ({
	symbolExistsOnYahoo: async () => existence,
	searchYahooSymbols: async () => searchResults
}));
mock.module('@/server/yahoo-lib', () => ({ fetchYahooDaily: async () => ({ currency: dailyCurrency, status: 'ok', bars: [] }) }));
mock.module('@/server/db', () => ({ db: { user: { findUnique: async () => ({ currency: 'EUR' }) } } }));

const { transactionsCreateTool } = await import('./transactions-create');

const ctx = { userId: 'u1', scopes: new Set(['transactions:write']), surface: 'chat', currency: 'EUR' } as never;

describe('transactions.create tool', () => {
	test('is a mutating write tool with a preview and the write scope', () => {
		expect(transactionsCreateTool.name).toBe('transactions.create');
		expect(transactionsCreateTool.mutates).toBe(true);
		expect(transactionsCreateTool.requiredScope).toBe('transactions:write');
		expect(transactionsCreateTool.annotations.readOnlyHint).toBe(false);
		expect(typeof transactionsCreateTool.preview).toBe('function');
	});

	test('resolves a known symbol, signs a valid token, and writes NOTHING', async () => {
		existence = 'yes';
		dailyCurrency = 'USD';
		const out = await transactionsCreateTool.execute(
			{ symbol: 'AAPL', side: 'BUY', quantity: 10, price: 150, date: '2026-01-02' },
			ctx
		);
		expect(out.requiresConfirmation).toBe(true);
		if (!out.requiresConfirmation) throw new Error('expected confirm branch');
		expect(out.proposed).toMatchObject({ symbol: 'AAPL', side: 'BUY', quantity: 10, price: 150, priceCurrency: 'USD', date: '2026-01-02' });
		const v = verifyMutation(out.confirmationToken, SECRET, Math.floor(Date.parse('2026-01-02') / 1000));
		expect(v.ok).toBe(true);
		if (v.ok) expect((v.payload.args as { symbol: string }).symbol).toBe('AAPL');
		expect(out.preview).toContain('AAPL');
	});

	test('falls back to the user default currency when the listing currency is unsupported', async () => {
		existence = 'yes';
		dailyCurrency = 'ZWL'; // not in SUPPORTED_CURRENCIES
		const out = await transactionsCreateTool.execute({ symbol: 'AAPL', side: 'BUY', quantity: 1, price: 1, date: '2026-01-02' }, ctx);
		if (!out.requiresConfirmation) throw new Error('expected confirm branch');
		expect(out.proposed.priceCurrency).toBe('EUR'); // user default from the db mock
	});

	test('resolves a company name via search when the raw symbol is unknown', async () => {
		existence = 'no';
		searchResults = [{ symbol: 'AAPL', description: 'Apple Inc.' }];
		dailyCurrency = 'USD';
		const out = await transactionsCreateTool.execute({ symbol: 'Apple', side: 'BUY', quantity: 1, price: 1, date: '2026-01-02' }, ctx);
		if (!out.requiresConfirmation) throw new Error('expected confirm branch');
		expect(out.proposed.symbol).toBe('AAPL');
		expect(out.description).toBe('Apple Inc.');
	});

	test('returns the error branch for an unresolvable symbol', async () => {
		existence = 'no';
		searchResults = [];
		const out = await transactionsCreateTool.execute({ symbol: 'Zzz', side: 'BUY', quantity: 1, price: 1, date: '2026-01-02' }, ctx);
		expect(out.requiresConfirmation).toBe(false);
		if (out.requiresConfirmation) throw new Error('expected error branch');
		expect(out.error.length).toBeGreaterThan(0);
	});
});
```

Also add a test that the tool fails closed with no secret — create `src/server/ai/tools/transactions-create-nosecret.test.ts` (its own file because `@/env` is mocked at module scope):

```ts
import { describe, expect, mock, test } from 'bun:test';
mock.module('@/env', () => ({ env: { AI_MUTATION_SECRET: undefined } }));
mock.module('@/server/yahoo-search', () => ({ symbolExistsOnYahoo: async () => 'yes', searchYahooSymbols: async () => [] }));
mock.module('@/server/yahoo-lib', () => ({ fetchYahooDaily: async () => ({ currency: 'USD', status: 'ok', bars: [] }) }));
mock.module('@/server/db', () => ({ db: { user: { findUnique: async () => ({ currency: 'USD' }) } } }));
const { transactionsCreateTool } = await import('./transactions-create');

describe('transactions.create without a configured secret', () => {
	test('returns the error branch (fails closed, no token)', async () => {
		const out = await transactionsCreateTool.execute(
			{ symbol: 'AAPL', side: 'BUY', quantity: 1, price: 1, date: '2026-01-02' },
			{ userId: 'u1', scopes: new Set(['transactions:write']), surface: 'chat', currency: 'USD' } as never
		);
		expect(out.requiresConfirmation).toBe(false);
	});
});
```

- [ ] **Step 2: Run to verify failure**

Run: `bun test src/server/ai/tools/transactions-create.test.ts src/server/ai/tools/transactions-create-nosecret.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the tool**

Create `src/server/ai/tools/transactions-create.ts`:

```ts
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { env } from '@/env';
import { type Currency, SUPPORTED_CURRENCIES } from '@/lib/currency';
import { normalizeSymbol } from '@/lib/validation';
import { signMutation } from '@/server/ai/mutations/token';
import { db } from '@/server/db';
import { fetchYahooDaily } from '@/server/yahoo-lib';
import { searchYahooSymbols, symbolExistsOnYahoo } from '@/server/yahoo-search';
import type { AppTool, ToolCtx } from './types';

const CONFIRM_TTL_SECONDS = 120;
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected yyyy-mm-dd');

export type ProposedTransaction = {
	date: string;
	symbol: string;
	side: 'BUY' | 'SELL';
	quantity: number;
	price: number;
	priceCurrency: string;
	fee?: number;
	feeCurrency?: string;
	note?: string;
};

const inputSchema = z.strictObject({
	symbol: z.string().min(1).max(64).describe('Ticker or company name, e.g. "AAPL" or "Apple".'),
	side: z.enum(['BUY', 'SELL']),
	quantity: z.number().positive(),
	price: z.number().positive().describe('Price per share, in the security currency.'),
	date: isoDate.optional().describe('Trade date yyyy-mm-dd; defaults to today. Resolve relative dates before calling.'),
	priceCurrency: z.enum(SUPPORTED_CURRENCIES).optional(),
	fee: z.number().nonnegative().optional(),
	feeCurrency: z.enum(SUPPORTED_CURRENCIES).optional(),
	note: z.string().max(500).optional()
});

const confirmBranch = z.strictObject({
	requiresConfirmation: z.literal(true),
	preview: z.string(),
	proposed: z.strictObject({
		date: z.string(),
		symbol: z.string(),
		side: z.enum(['BUY', 'SELL']),
		quantity: z.number(),
		price: z.number(),
		priceCurrency: z.string(),
		fee: z.number().optional(),
		feeCurrency: z.string().optional(),
		note: z.string().optional()
	}),
	description: z.string().optional(),
	expiresAt: z.string(),
	confirmationToken: z.string()
});
const errorBranch = z.strictObject({ requiresConfirmation: z.literal(false), error: z.string() });
const outputSchema = z.discriminatedUnion('requiresConfirmation', [confirmBranch, errorBranch]);

type Input = z.infer<typeof inputSchema>;

function todayIso(): string {
	return new Date().toISOString().slice(0, 10);
}
function isSupportedCurrency(c: string | undefined): c is Currency {
	return !!c && (SUPPORTED_CURRENCIES as readonly string[]).includes(c);
}

/** One human-readable line for the preview + confirm card. */
export function formatProposed(p: ProposedTransaction): string {
	const verb = p.side === 'BUY' ? 'Buy' : 'Sell';
	const fee = p.fee ? ` (fee ${p.fee} ${p.feeCurrency ?? p.priceCurrency})` : '';
	return `${verb} ${p.quantity} ${p.symbol} @ ${p.price} ${p.priceCurrency} on ${p.date}${fee}`;
}

type Resolved =
	| { ok: true; proposed: ProposedTransaction; description?: string }
	| { ok: false; error: string };

/** Resolve symbol + currency + date. READ-ONLY (Yahoo + user currency). No writes. */
export async function resolveProposed(input: Input, ctx: ToolCtx): Promise<Resolved> {
	const raw = normalizeSymbol(input.symbol);
	let symbol = raw;
	let description: string | undefined;

	const existence = await symbolExistsOnYahoo(raw);
	if (existence === 'unreachable') return { ok: false, error: `Couldn't reach the market data service to verify ${raw}. Please try again.` };
	if (existence === 'no') {
		const matches = await searchYahooSymbols(input.symbol);
		if (matches.length === 0) return { ok: false, error: `I couldn't find a tradable security matching "${input.symbol}".` };
		symbol = matches[0].symbol;
		description = matches[0].description;
	}

	// Listing currency (field access — robust to fetchYahooDaily's status), then user default.
	let listing: string | undefined;
	try {
		listing = (await fetchYahooDaily(symbol)).currency;
	} catch {
		listing = undefined;
	}
	const user = await db.user.findUnique({ select: { currency: true }, where: { id: ctx.userId } });
	const userDefault = (user?.currency ?? 'USD') as string;
	const priceCurrency = input.priceCurrency ?? (isSupportedCurrency(listing) ? listing : userDefault);

	const date = input.date ?? todayIso();
	if (date > todayIso()) return { ok: false, error: `The trade date ${date} is in the future.` };

	const proposed: ProposedTransaction = {
		date,
		symbol,
		side: input.side,
		quantity: input.quantity,
		price: input.price,
		priceCurrency,
		...(input.fee !== undefined ? { fee: input.fee } : {}),
		...(input.feeCurrency ? { feeCurrency: input.feeCurrency } : {}),
		...(input.note ? { note: input.note } : {})
	};
	return { ok: true, proposed, description };
}

export const transactionsCreateTool: AppTool<typeof inputSchema, typeof outputSchema> = {
	name: 'transactions.create',
	description:
		'Record a transaction the user says they made (buy/sell). Resolves the symbol and previews the ' +
		'trade for the user to confirm — it does NOT write until the user confirms. Ask for the price if unstated.',
	inputSchema,
	outputSchema,
	requiredScope: 'transactions:write',
	mutates: true,
	preview: async (input, ctx) => {
		const r = await resolveProposed(input, ctx);
		return r.ok ? formatProposed(r.proposed) : r.error;
	},
	annotations: { title: 'Record a transaction', readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
	execute: async (input, ctx) => {
		const secret = env.AI_MUTATION_SECRET;
		if (!secret) return { requiresConfirmation: false as const, error: 'Transaction entry is not configured on this server.' };
		const r = await resolveProposed(input, ctx);
		if (!r.ok) return { requiresConfirmation: false as const, error: r.error };

		const iat = Math.floor(Date.now() / 1000);
		const exp = iat + CONFIRM_TTL_SECONDS;
		const token = signMutation(
			{ v: 1, userId: ctx.userId, tool: 'transactions.create', args: r.proposed, jti: randomUUID(), iat, exp },
			secret
		);
		return {
			requiresConfirmation: true as const,
			preview: formatProposed(r.proposed),
			proposed: r.proposed,
			...(r.description ? { description: r.description } : {}),
			expiresAt: new Date(exp * 1000).toISOString(),
			confirmationToken: token
		};
	}
};
```

Implementer notes: (1) verify `normalizeSymbol` is exported from `@/lib/validation` and `SUPPORTED_CURRENCIES`/`Currency` from `@/lib/currency` (the Task-3 refactor and `tool-ctx.ts` already import these). (2) If `AppTool`'s `outputSchema` generic rejects a `z.discriminatedUnion`, widen the generic to `z.ZodType` (the read tools use `z.strictObject`; the type param is `O extends z.ZodType`, which a discriminated union satisfies). (3) The `execute` return type must match the discriminated union — keep the `as const` on `requiresConfirmation`.

- [ ] **Step 4: Register in `ALL_TOOLS`**

In `src/server/ai/tools/registry.ts`, import and append `transactionsCreateTool` to the `ALL_TOOLS` array.

- [ ] **Step 5: Update `registry.test.ts` to allow the write tool**

In `src/server/ai/tools/registry.test.ts`: (a) the "exactly the seven read-only tools" name-list assertion (~L297-305) — add `'transactions.create'` and update the count/title to eight; (b) the per-tool loop (~L306-311) that asserts `mutates === false` / `preview === undefined` / `readOnlyHint === true` — split it so it exempts the write tool, e.g.:

```ts
for (const t of ALL_TOOLS) {
	expect(t.description.length).toBeGreaterThan(0);
	if (t.name === 'transactions.create') {
		expect(t.mutates).toBe(true);
		expect(t.annotations.readOnlyHint).toBe(false);
		expect(typeof t.preview).toBe('function');
	} else {
		expect(t.mutates).toBe(false);
		expect(t.annotations.readOnlyHint).toBe(true);
		expect(t.preview).toBeUndefined();
	}
}
```

Do NOT weaken the other security assertions (no `userId` in any `inputSchema`; every `inputSchema` is `strictObject`; every tool has an `outputSchema`) — the write tool's `inputSchema` is `z.strictObject` with no `userId`, so it passes them unchanged.

- [ ] **Step 6: Run tests**

Run: `bun test src/server/ai/tools/transactions-create.test.ts src/server/ai/tools/transactions-create-nosecret.test.ts src/server/ai/tools/registry.test.ts`
Expected: PASS. Then `bun run typecheck` — clean.

- [ ] **Step 7: Commit**

```bash
git add src/server/ai/tools/transactions-create.ts src/server/ai/tools/transactions-create.test.ts src/server/ai/tools/transactions-create-nosecret.test.ts src/server/ai/tools/registry.ts src/server/ai/tools/registry.test.ts
git commit -m "feat(ai): transactions.create write tool — resolve, preview, sign (no write)"
```

---

## Task 5: The commit core + tRPC mutation

The single write trigger. A testable core (secret injected) + a thin tRPC wrapper (reads `env` + session).

**Files:**
- Create: `src/server/ai/mutations/commit.ts`
- Modify: `src/server/api/routers/ai-chat.ts` (add `commitPendingTransaction`)
- Test: `prisma/ai-commit-pending-transaction.test.ts` (extend Task 1's file)

**Interfaces:**
- Consumes: `verifyMutation`/`MutationPayload` (Task 2); `createTransaction`/`CreateTransactionInput` (Task 3); `createTransactionInput` (schema); `invalidatePortfolioCache` (`@/server/portfolio-compute`); `db`; the client path `api.aiChat.commitPendingTransaction`.
- Produces: `commitPendingTransaction(deps: { token: string; sessionUserId: string; secret: string; now?: number }): Promise<{ id: string }>` (throws `TRPCError` on every rejection path).

- [ ] **Step 1: Write the failing tests (extend Task 1's file)**

Append to `prisma/ai-commit-pending-transaction.test.ts`:

```ts
import { signMutation } from '../src/server/ai/mutations/token';
import { commitPendingTransaction } from '../src/server/ai/mutations/commit';

const SECRET = 'z'.repeat(32);
function tokenFor(userId: string, over: Record<string, unknown> = {}, secret = SECRET): string {
	const iat = 1_000_000;
	return signMutation(
		{
			v: 1,
			userId,
			tool: 'transactions.create',
			args: { date: new Date('2026-01-02'), price: 150, priceCurrency: 'USD', quantity: 10, side: 'BUY', symbol: 'AAPL' },
			jti: (over.jti as string) ?? 'commit-jti-1',
			iat,
			exp: iat + 120,
			...over
		},
		secret
	);
}

describe('commitPendingTransaction core', () => {
	let userId: string;
	beforeEach(async () => {
		await resetAiTables();
		userId = await seedUser('a');
	});

	test('valid token writes exactly one transaction + a jti row, returns the id', async () => {
		const { id } = await commitPendingTransaction({ token: tokenFor(userId), sessionUserId: userId, secret: SECRET, now: 1_000_010 });
		expect((await db.transaction.findUnique({ where: { id } }))?.symbol).toBe('AAPL');
		expect(await db.aiMutationCommit.findUnique({ where: { jti: 'commit-jti-1' } })).not.toBeNull();
	});

	test('a replayed token is rejected and writes no second transaction', async () => {
		const token = tokenFor(userId);
		await commitPendingTransaction({ token, sessionUserId: userId, secret: SECRET, now: 1_000_010 });
		await expect(commitPendingTransaction({ token, sessionUserId: userId, secret: SECRET, now: 1_000_010 })).rejects.toThrow();
		expect(await db.transaction.count({ where: { userId } })).toBe(1);
	});

	test('an expired token is rejected, no write', async () => {
		await expect(
			commitPendingTransaction({ token: tokenFor(userId), sessionUserId: userId, secret: SECRET, now: 9_999_999 })
		).rejects.toThrow();
		expect(await db.transaction.count({ where: { userId } })).toBe(0);
	});

	test('a token signed with a different secret is rejected, no write', async () => {
		await expect(
			commitPendingTransaction({ token: tokenFor(userId, {}, 'w'.repeat(32)), sessionUserId: userId, secret: SECRET, now: 1_000_010 })
		).rejects.toThrow();
		expect(await db.transaction.count({ where: { userId } })).toBe(0);
	});

	test("a token whose userId != the session user is rejected (non-transferable), no write", async () => {
		const other = await seedUser('b');
		await expect(
			commitPendingTransaction({ token: tokenFor(other), sessionUserId: userId, secret: SECRET, now: 1_000_010 })
		).rejects.toThrow();
		expect(await db.transaction.count({ where: { userId } })).toBe(0);
	});
});
```

- [ ] **Step 2: Run to verify failure**

Run: `bun test prisma/ai-commit-pending-transaction.test.ts`
Expected: FAIL — `commitPendingTransaction` not found.

- [ ] **Step 3: Implement the core**

Create `src/server/ai/mutations/commit.ts`:

```ts
import { TRPCError } from '@trpc/server';
import { createTransactionInput } from '@/server/api/routers/transactions.schemas';
import { createTransaction } from '@/server/services/transactions';
import { db } from '@/server/db';
import { invalidatePortfolioCache } from '@/server/portfolio-compute';
import { verifyMutation } from './token';

/**
 * The one write trigger. Verifies the signed token (signature-then-expiry), enforces the token is
 * non-transferable (`payload.userId === sessionUserId`), then — atomically — burns the single-use
 * `jti` and writes the transaction; a replay collides on the `jti` PK and the whole transaction
 * rolls back. Yahoo is NOT re-run: the token is the tool's signed validation attestation. Cache is
 * invalidated after the commit. `now` is injectable for tests.
 */
export async function commitPendingTransaction(deps: {
	token: string;
	sessionUserId: string;
	secret: string;
	now?: number;
}): Promise<{ id: string }> {
	const v = verifyMutation(deps.token, deps.secret, deps.now);
	if (!v.ok) {
		throw new TRPCError({
			code: v.reason === 'EXPIRED' ? 'TIMEOUT' : 'BAD_REQUEST',
			message: v.reason === 'EXPIRED' ? 'This confirmation expired. Ask me to prepare it again.' : 'Invalid confirmation.'
		});
	}
	if (v.payload.userId !== deps.sessionUserId) {
		throw new TRPCError({ code: 'FORBIDDEN', message: 'This confirmation does not belong to you.' });
	}
	if (v.payload.tool !== 'transactions.create') {
		throw new TRPCError({ code: 'BAD_REQUEST', message: 'Unsupported confirmation.' });
	}
	const args = createTransactionInput.parse(v.payload.args);

	let id: string;
	try {
		id = (
			await db.$transaction(async (tx) => {
				await tx.aiMutationCommit.create({ data: { jti: v.payload.jti, tool: v.payload.tool, userId: deps.sessionUserId } });
				return createTransaction(deps.sessionUserId, args, tx);
			})
		).id;
	} catch (err) {
		if (err instanceof Error && err.message.includes('Unique constraint')) {
			throw new TRPCError({ code: 'CONFLICT', message: 'This transaction was already recorded.' });
		}
		throw err;
	}
	await invalidatePortfolioCache(deps.sessionUserId);
	return { id };
}
```

Implementer note: confirm the Prisma unique-violation detection — prefer `Prisma.PrismaClientKnownRequestError` with `err.code === 'P2002'` over the message string. Import the Prisma error type the way the codebase already does (grep for `P2002` / `PrismaClientKnownRequestError`) and use that; the message-substring check is a fallback only.

- [ ] **Step 4: Add the tRPC procedure**

In `src/server/api/routers/ai-chat.ts`, add to `aiChatRouter`:

```ts
import { z } from 'zod';
import { env } from '@/env';
import { commitPendingTransaction } from '@/server/ai/mutations/commit';
// ...inside createTRPCRouter({ ... }):
commitPendingTransaction: protectedProcedure
	.input(z.object({ token: z.string().min(1) }))
	.mutation(async ({ ctx, input }) => {
		const secret = env.AI_MUTATION_SECRET;
		if (!secret) throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'Transaction entry is not configured.' });
		return commitPendingTransaction({ secret, sessionUserId: ctx.session.user.id, token: input.token });
	}),
```

(Import `TRPCError` if not already imported in that file.)

- [ ] **Step 5: Run tests + typecheck**

Run: `bun test prisma/ai-commit-pending-transaction.test.ts`
Expected: PASS (all cases; each rejection leaves 0 rows / no second row).
Run: `bun run typecheck` — clean.

- [ ] **Step 6: Commit**

```bash
git add src/server/ai/mutations/commit.ts src/server/api/routers/ai-chat.ts prisma/ai-commit-pending-transaction.test.ts
git commit -m "feat(ai): commit core + ai.commitPendingTransaction — verify/cross-user/single-use write"
```

---

## Task 6: Grant chat the `transactions:write` scope

Make the tool reachable on chat (only). MCP stays read-only.

**Files:**
- Modify: `src/server/ai/tool-ctx.ts` (add `CHAT_SCOPES`)
- Modify: `src/server/ai/chat/gateway.ts` (pass it)
- Test: `src/server/ai/tool-ctx.test.ts` (assert `CHAT_SCOPES`); `src/server/ai/tools/registry.test.ts` already covers the surface filter — add a chat-vs-mcp reachability assertion if not present.

**Interfaces:**
- Consumes: `ALL_READ_SCOPES`, `Scope`, `buildToolset`.
- Produces: `CHAT_SCOPES: ReadonlySet<Scope>` = `ALL_READ_SCOPES ∪ { 'transactions:write' }`.

- [ ] **Step 1: Write the failing test**

Append to `src/server/ai/tool-ctx.test.ts`:

```ts
test('CHAT_SCOPES adds transactions:write to the read scopes (chat can reach the write tool)', async () => {
	const { CHAT_SCOPES } = await import('./tool-ctx');
	expect(CHAT_SCOPES.has('transactions:write')).toBe(true);
	expect(CHAT_SCOPES.has('portfolio:read')).toBe(true);
});
```

And append to `src/server/ai/tools/registry.test.ts` (uses the real `ALL_TOOLS`):

```ts
test('the write tool is reachable on chat with CHAT_SCOPES but never on mcp', async () => {
	const { CHAT_SCOPES } = await import('../tool-ctx');
	const chat = buildToolset({ userId: 'u', scopes: CHAT_SCOPES, surface: 'chat', currency: 'USD' } as never);
	const mcp = buildToolset({ userId: 'u', scopes: CHAT_SCOPES, surface: 'mcp', currency: 'USD' } as never);
	expect(chat.some((t) => t.name === 'transactions.create')).toBe(true);
	expect(mcp.some((t) => t.name === 'transactions.create')).toBe(false);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `bun test src/server/ai/tool-ctx.test.ts src/server/ai/tools/registry.test.ts`
Expected: FAIL — `CHAT_SCOPES` not exported.

- [ ] **Step 3: Implement**

In `src/server/ai/tool-ctx.ts`, after `ALL_READ_SCOPES`:

```ts
/** Chat is interactive + authenticated, so it may reach write tools. The actual write still requires
 *  a human Confirm click hitting a session-authenticated, token-validated mutation. MCP stays read-only. */
export const CHAT_SCOPES: ReadonlySet<Scope> = new Set<Scope>([...ALL_READ_SCOPES, 'transactions:write']);
```

In `src/server/ai/chat/gateway.ts`, change the tool-ctx construction (currently `createToolCtx(args.session, 'chat')`):

```ts
import { CHAT_SCOPES, createToolCtx } from '@/server/ai/tool-ctx';
// ...
const toolCtx = await createToolCtx(args.session, 'chat', CHAT_SCOPES);
```

- [ ] **Step 4: Run to verify passing**

Run: `bun test src/server/ai/tool-ctx.test.ts src/server/ai/tools/registry.test.ts`
Expected: PASS. Confirm the existing `tool-ctx.test.ts` default-scopes assertion (chat default = read-only) still passes — `createToolCtx`'s DEFAULT is unchanged (`ALL_READ_SCOPES`); only the gateway now passes an explicit set.

- [ ] **Step 5: Commit**

```bash
git add src/server/ai/tool-ctx.ts src/server/ai/chat/gateway.ts src/server/ai/tool-ctx.test.ts src/server/ai/tools/registry.test.ts
git commit -m "feat(ai): grant chat transactions:write via CHAT_SCOPES (mcp stays read-only)"
```

---

## Task 7: The interactive Confirm card

The first interactive chat artifact. A `'use client'` component (renderers are plain functions, so the registry returns `createElement(ConfirmCard, { output })`, mirroring `DataTableArtifact`).

**Files:**
- Create: `src/app/(dashboard)/_components/chat/artifacts/confirm-card.helpers.ts`
- Test: `src/app/(dashboard)/_components/chat/artifacts/confirm-card.helpers.test.ts`
- Create: `src/app/(dashboard)/_components/chat/artifacts/confirm-card.tsx`
- Modify: `src/app/(dashboard)/_components/chat/artifacts/registry.ts`

**Interfaces:**
- Consumes: the tool's confirm-branch output (`{ requiresConfirmation, preview, proposed, description?, expiresAt, confirmationToken }`); `api.aiChat.commitPendingTransaction` (Task 5); `createElement`/`ARTIFACT_RENDERERS` (registry).
- Produces: `isExpired(expiresAt: string, now?: number): boolean`; `ConfirmCard` component; a `'transactions.create'` entry in `ARTIFACT_RENDERERS`.

- [ ] **Step 1: Write the failing helpers test**

Create `src/app/(dashboard)/_components/chat/artifacts/confirm-card.helpers.test.ts`:

```ts
import { describe, expect, test } from 'bun:test';
import { isExpired } from './confirm-card.helpers';

describe('isExpired', () => {
	const at = '2026-01-02T00:02:00.000Z';
	test('false before expiry', () => {
		expect(isExpired(at, Date.parse('2026-01-02T00:01:00.000Z'))).toBe(false);
	});
	test('true after expiry', () => {
		expect(isExpired(at, Date.parse('2026-01-02T00:03:00.000Z'))).toBe(true);
	});
	test('malformed expiresAt is treated as expired (fail closed)', () => {
		expect(isExpired('not-a-date', Date.parse('2026-01-02T00:00:00.000Z'))).toBe(true);
	});
});
```

- [ ] **Step 2: Run to verify failure**

Run: `bun test src/app/(dashboard)/_components/chat/artifacts/confirm-card.helpers.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the helper**

Create `src/app/(dashboard)/_components/chat/artifacts/confirm-card.helpers.ts`:

```ts
/** Client-side expiry check (the server remains authoritative). Malformed input ⇒ expired. */
export function isExpired(expiresAt: string, now: number = Date.now()): boolean {
	const t = Date.parse(expiresAt);
	if (Number.isNaN(t)) return true;
	return now > t;
}
```

- [ ] **Step 4: Run to verify passing**

Run: `bun test src/app/(dashboard)/_components/chat/artifacts/confirm-card.helpers.test.ts`
Expected: PASS.

- [ ] **Step 5: Implement the card + wire the registry**

First **read the existing `data-table-artifact.tsx`** (the artifact the registry already renders) to copy its exact card/button imports and styling — the repo uses **Base UI** primitives (not shadcn), so the presentational imports below are placeholders to replace with whatever `data-table-artifact.tsx` uses. The *logic* (state machine, mutation, expiry, narrowing) is complete and must be kept as-is. Create `src/app/(dashboard)/_components/chat/artifacts/confirm-card.tsx`:

```tsx
'use client';

import { useState } from 'react';
import { api } from '@/trpc/react';
// Replace these with the SAME card/button primitives data-table-artifact.tsx imports:
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { isExpired } from './confirm-card.helpers';

// The tool's confirm-branch output shape (Task 4). Kept local to avoid importing server code into the client.
type ConfirmOutput = {
	requiresConfirmation: true;
	preview: string;
	proposed: {
		date: string; symbol: string; side: 'BUY' | 'SELL'; quantity: number; price: number;
		priceCurrency: string; fee?: number; feeCurrency?: string; note?: string;
	};
	description?: string;
	expiresAt: string;
	confirmationToken: string;
};

export function ConfirmCard({ output }: { output: unknown }): React.ReactNode {
	const o = output as { requiresConfirmation?: boolean };
	// The error branch (requiresConfirmation === false) is relayed by the model as text — render nothing.
	if (!o || o.requiresConfirmation !== true) return null;
	const out = output as ConfirmOutput;

	const utils = api.useUtils();
	const [state, setState] = useState<'idle' | 'cancelled'>('idle');
	const commit = api.aiChat.commitPendingTransaction.useMutation({
		onSuccess: () => {
			// Invalidate anything showing transactions/portfolio (adjust to the real query keys):
			void utils.invalidate();
		}
	});

	const expired = isExpired(out.expiresAt);
	const p = out.proposed;

	if (state === 'cancelled') return <Card>Cancelled — nothing was recorded.</Card>;
	if (commit.isSuccess) return <Card>✓ Recorded {p.side} {p.quantity} {p.symbol}.</Card>;

	return (
		<Card>
			<div>
				<strong>{p.side}</strong> {p.quantity} <strong>{p.symbol}</strong>
				{out.description ? ` (${out.description})` : ''} @ {p.price} {p.priceCurrency} on {p.date}
				{p.fee ? ` · fee ${p.fee} ${p.feeCurrency ?? p.priceCurrency}` : ''}
				{p.note ? ` · ${p.note}` : ''}
			</div>
			{expired ? (
				<div>This confirmation expired — ask me to prepare it again.</div>
			) : (
				<div>
					<Button
						disabled={commit.isPending}
						onClick={() => commit.mutate({ token: out.confirmationToken })}
					>
						{commit.isPending ? 'Recording…' : 'Confirm'}
					</Button>
					<Button disabled={commit.isPending} onClick={() => setState('cancelled')}>
						Cancel
					</Button>
				</div>
			)}
			{commit.isError ? <div>{commit.error.message}</div> : null}
		</Card>
	);
}
```

Then in `src/app/(dashboard)/_components/chat/artifacts/registry.ts`, add the renderer (mirror the `createElement(DataTableArtifact, ...)` entries):

```ts
import { ConfirmCard } from './confirm-card';
// ...inside ARTIFACT_RENDERERS:
'transactions.create': (o) => createElement(ConfirmCard, { output: o as never }),
```

Implementer notes: (1) swap `Button`/`Card` for the exact primitives `data-table-artifact.tsx` uses (Base UI). (2) `void utils.invalidate()` is the broad hammer — if `data-table-artifact.tsx` or the transactions page exposes a narrower query util (e.g. `utils.transactions.list.invalidate()`), prefer it. (3) keep the confirm-branch narrowing (`requiresConfirmation !== true → null`) exactly — it is what lets the same renderer safely receive the error branch.

In `src/app/(dashboard)/_components/chat/artifacts/registry.ts`, add the renderer (mirror the `createElement(DataTableArtifact, ...)` entries):

```ts
import { ConfirmCard } from './confirm-card';
// ...inside ARTIFACT_RENDERERS:
'transactions.create': (o) => createElement(ConfirmCard, { output: o as never }),
```

- [ ] **Step 6: Verify build + typecheck + biome**

Run: `bun run typecheck` — clean.
Run: `bun run check` — clean.
(The full click-to-commit render is validated manually / via the creds-gated chat E2E, consistent with the Phase 1 chat-client test convention; the security-critical commit path is fully covered by Task 5's real-Postgres tests, and the card's own logic by the `isExpired` unit test.)

- [ ] **Step 7: Commit**

```bash
git add "src/app/(dashboard)/_components/chat/artifacts/confirm-card.tsx" "src/app/(dashboard)/_components/chat/artifacts/confirm-card.helpers.ts" "src/app/(dashboard)/_components/chat/artifacts/confirm-card.helpers.test.ts" "src/app/(dashboard)/_components/chat/artifacts/registry.ts"
git commit -m "feat(ai): interactive Confirm card for NL transaction entry"
```

---

## Task 8: Advice-eval re-run + usage docs

**Files:**
- Modify: `docs/mcp.md` or a new `docs/ai-transaction-entry.md` (a short usage note)

- [ ] **Step 1: Re-run the advice-boundary eval**

Run: `bun run eval:advice`
Expected: still green (recording a stated trade is not advice). If it regresses, STOP — the tool's copy has leaked into advisory territory; fix before proceeding.

- [ ] **Step 2: Write a short usage doc**

Create `docs/ai-transaction-entry.md`: what it does ("tell the assistant a trade in plain language → Confirm card → recorded"), the requirement (`AI_MUTATION_SECRET` set, else the tool is unavailable), that it is **create-only** (edit/remove via the existing UI), chat-only (not MCP), and that nothing is written without the human Confirm click. Note the 120s confirmation window.

- [ ] **Step 3: Commit**

```bash
git add docs/ai-transaction-entry.md
git commit -m "docs(ai): NL transaction-entry usage guide"
```

---

## Final verification (before the whole-branch review)

- [ ] `bun run test:unit` — all green (new token/tool/tool-ctx/helpers tests included).
- [ ] `bun run test:db` — green, including `prisma/ai-commit-pending-transaction.test.ts` and `prisma/transaction-create-service.test.ts` (both must be added to the `test:db` script's file list).
- [ ] `bun run typecheck` + `bun run check` — clean.
- [ ] `bun run eval:advice` — green.

## Done when

- In chat, "I bought 10 Apple at 150 yesterday" yields a Confirm card with the resolved transaction; **Confirm** records exactly one transaction and shows ✓; **Cancel** writes nothing.
- No write happens without a human click; tampered / expired / replayed / cross-user tokens are each rejected with no row written; `userId` never comes from the client; the tool writes nothing.
- MCP remains read-only; `eval:advice` stays green; `typecheck`/`check`/`test:unit`/`test:db` all green.

Related: `docs/superpowers/specs/2026-07-23-ai-layer-phase3a-nl-entry-design.md`, `2026-07-13-ai-layer-phase0-design.md` (§9.4).
