# AI Layer — Phase 2: MCP Server Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expose the seven Phase 0 read tools to external MCP clients (Claude Code/Desktop, Cursor) over `POST /api/mcp`, authenticated per-user by a bearer API key, behind an `ENABLE_MCP` flag.

**Architecture:** A thin MCP adapter (`AppTool[] → McpServer.registerTool`) over the *same* `buildToolset(ctx)` authorization point that Phase 1's chat adapter uses. Auth resolves a bearer key to its owner `userId` + the key's tool scopes via an O(1) `keyHmac` lookup; the toolset is that key's scopes ∩ read-only tools. Each request builds a fresh, stateless MCP server + a Web-native transport and returns `transport.handleRequest(req)` — no session state, no LLM, no quota.

**Tech Stack:** `@modelcontextprotocol/sdk@1.29.0` (raw SDK), Next 16 App Router route handler, zod (^3.25 || ^4.0), Prisma 7 / Postgres, `bun test`, biome.

## Spike outcome (already performed — folded into this plan)

The spec's §4 "#1 risk" (Node-http ↔ Web-Request bridge) is **resolved**: SDK 1.29.0 ships `WebStandardStreamableHTTPServerTransport`, whose `handleRequest(req: Request): Promise<Response>` is exactly the Web-native shape a Next route handler needs (the SDK's own docstring shows `return transport.handleRequest(request)` for Cloudflare Workers / Hono). All API names below were verified against the shipped `dist/esm/**/*.d.ts` of 1.29.0. Task 1 re-confirms them at **runtime** in this repo's toolchain before any real adapter work.

**Verified SDK surface (1.29.0):**
- `import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'` — `new McpServer({ name, version })`; `server.registerTool(name, { title?, description?, inputSchema?, outputSchema?, annotations?, _meta? }, cb)`; `server.connect(transport)`. `registerTool`'s `inputSchema`/`outputSchema` accept a **full constructed zod object** (`AnySchema`), so our `z.strictObject(...)` schemas pass directly; the SDK's `normalizeObjectSchema` handles v3/v4.
- `cb: (args, extra) => CallToolResult | Promise<CallToolResult>`. `extra.signal` is an `AbortSignal` (always present); `extra.authInfo` optional. Return `{ content: [{ type: 'text', text }], structuredContent }`. Throwing makes the SDK emit an `isError` result.
- `import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'` — stateless = `new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true })`; `handleRequest(req: Request): Promise<Response>`.
- `import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'` — `InMemoryTransport.createLinkedPair(): [client, server]` (for hermetic end-to-end tests, doing a proper `initialize` handshake over a persistent linked pair).
- `import { Client } from '@modelcontextprotocol/sdk/client/index.js'` — `new Client({ name, version })`; `client.connect(transport)`; `client.listTools() → { tools }`; `client.callTool({ name, arguments }) → { content, structuredContent }`.

---

## Global Constraints

Every task's requirements implicitly include this section.

- **Pin `@modelcontextprotocol/sdk` to exactly `1.29.0`** (no caret). It is currently only a transitive dep; this plan makes it direct. Verify SDK API names against the shipped package, never from memory — Task 1 runtime-confirms them.
- **Read-only, full stop.** No mutating tool ever registers on MCP. Enforcement is `buildToolset`'s existing `if (t.mutates && ctx.surface === 'mcp') return false` filter — do not re-implement it in the adapter. Tested in Task 7.
- **`userId` comes only from the verified key** — never from the request body or a tool argument. The adapter handler closes over `ctx`; the client supplies only `args`.
- **Key comparison is constant-time** — `timingSafeEqual` over the HMAC. Never a raw-string `===` on the token, and never a bcrypt loop on the fast path.
- **MCP tool names permit dots** — register the canonical `group.verb` name **as-is**. Do NOT apply the AI SDK adapter's `.`→`_` mapping.
- **`ENABLE_MCP` off ⇒ 404.** The surface does not exist unless deliberately enabled. Default off.
- **Every tool call is logged** — one `AiToolCall` row per call (`surface: 'MCP'`), written by the adapter itself (the AI SDK telemetry hooks do NOT fire on the MCP path). **No quota reservation** (no LLM spend on our side).
- **Privacy:** telemetry stores a SHA-256 `inputHash`, never the raw tool arguments.
- **No OAuth** — no `/.well-known/oauth-protected-resource` route.
- **Tests:** hermetic unit tests (mock `@/server/db` before the dynamic `import` of the module under test) live under `src/**`; the real-Postgres end-to-end lives under `prisma/**` and MUST be added to the `test:db` script.
- **Commits** end with the trailers `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>` and `Claude-Session: https://claude.ai/code/session_01TY5vHxHcvShQEeKhbJPuSE`.

---

## File Structure

**Create:**
- `src/server/ai/mcp/verify-key.ts` — `permissionsToScopes()` (pure) + `verifyMcpKey()` (DB-backed HMAC auth with legacy backfill).
- `src/server/ai/mcp/verify-key.test.ts` — hermetic unit tests (Pattern A).
- `src/server/ai/tools/adapters/mcp.ts` — `buildMcpServer(tools, ctx, requestId)` (registration + handler + per-call telemetry).
- `src/server/ai/tools/adapters/mcp.test.ts` — hermetic adapter test via in-memory transport (Pattern A).
- `src/app/api/mcp/route.ts` — the `POST`/`GET`/`DELETE` handler.
- `src/app/api/mcp/route.test.ts` — hermetic route test: flag/auth gating + in-process `initialize` bridge proof (Pattern A).
- `prisma/ai-mcp-e2e.test.ts` — real-Postgres end-to-end: scoped key lists/executes only its permitted read tools over the caller's own data (Pattern B).
- `docs/mcp.md` — client-configuration documentation.
- `src/server/ai/tools/adapters/sdk-smoke.test.ts` — Task 1 raw-SDK runtime smoke (kept as a regression guard on the SDK contract).

**Modify:**
- `package.json` — add `@modelcontextprotocol/sdk: "1.29.0"` to dependencies; append `prisma/ai-mcp-e2e.test.ts` to the `test:db` script.
- `src/server/ai/tool-ctx.ts` — add an optional `scopes` parameter to `createToolCtx`.
- `src/server/ai/tool-ctx.test.ts` — cover the new parameter.
- `src/env.js` — add `ENABLE_MCP` to the server schema + `runtimeEnv`.
- `.env.example` (if present) — document `ENABLE_MCP` and `AI_API_KEY_PEPPER`.

---

## Task 1: Pin the SDK + runtime smoke test

De-risks the SDK contract in this repo's runtime (ESM `.js` imports, zod normalization, the initialize handshake, `structuredContent`) **before** building the real adapter. Uses the raw SDK only — no repo code — so a later adapter failure is unambiguously ours, not the SDK's.

**Files:**
- Modify: `package.json` (add dependency)
- Create: `src/server/ai/tools/adapters/sdk-smoke.test.ts`

**Interfaces:**
- Produces: proof that `McpServer` + `InMemoryTransport` + `Client` interoperate and that a `z.object` passed as `inputSchema`/`outputSchema` validates and round-trips `structuredContent`.

- [ ] **Step 1: Add the pinned dependency**

Run: `bun add @modelcontextprotocol/sdk@1.29.0 --exact`
Expected: `package.json` `dependencies` gains `"@modelcontextprotocol/sdk": "1.29.0"` (exact, no caret). Then run `bun install` and confirm `node_modules/@modelcontextprotocol/sdk/package.json` still reports `"version": "1.29.0"`.

- [ ] **Step 2: Write the failing smoke test**

Create `src/server/ai/tools/adapters/sdk-smoke.test.ts`:

```ts
import { describe, expect, test } from 'bun:test';
import { z } from 'zod';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

/**
 * Runtime contract check for @modelcontextprotocol/sdk@1.29.0 (the Phase 2 spike).
 * Proves, in THIS repo's toolchain: a full zod object works as inputSchema/outputSchema,
 * dot-form tool names are accepted verbatim, the initialize+callTool handshake works over
 * the in-memory transport, and structuredContent round-trips. NOT a test of our own code.
 */
describe('mcp sdk runtime contract (1.29.0)', () => {
	test('registers a dot-named tool and round-trips structuredContent', async () => {
		const server = new McpServer({ name: 'smoke', version: '0.0.0' });
		server.registerTool(
			'echo.say',
			{
				description: 'Echoes its message back.',
				inputSchema: z.strictObject({ message: z.string() }),
				outputSchema: z.strictObject({ echoed: z.string() }),
				annotations: { title: 'Echo', readOnlyHint: true, openWorldHint: false }
			},
			async (args: { message: string }) => {
				const echoed = `${args.message}!`;
				return { content: [{ type: 'text', text: echoed }], structuredContent: { echoed } };
			}
		);

		const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
		await server.connect(serverTransport);
		const client = new Client({ name: 'smoke-client', version: '0.0.0' });
		await client.connect(clientTransport);

		const listed = await client.listTools();
		expect(listed.tools.map((t) => t.name)).toContain('echo.say');

		const result = await client.callTool({ name: 'echo.say', arguments: { message: 'hi' } });
		expect(result.structuredContent).toEqual({ echoed: 'hi!' });

		await client.close();
		await server.close();
	});
});
```

- [ ] **Step 3: Run it to verify it passes (this is a runtime discovery test, not TDD-red)**

Run: `bun test src/server/ai/tools/adapters/sdk-smoke.test.ts`
Expected: PASS. If it FAILS, the SDK contract differs from what the spike found — STOP and report the exact discrepancy (this is the de-risking gate; do not proceed to build the adapter on a wrong contract).

- [ ] **Step 4: Commit**

```bash
git add package.json bun.lock src/server/ai/tools/adapters/sdk-smoke.test.ts
git commit -m "feat(ai): pin @modelcontextprotocol/sdk 1.29.0 + runtime contract smoke test"
```

---

## Task 2: `permissionsToScopes` — API-key permissions → tool scopes

A pure function: an API key's Better-Auth `permissions` JSON (`{ resource: [actions] }`) → the tool `Scope` set. Read-only mapping; defensive against malformed input.

**Files:**
- Create: `src/server/ai/mcp/verify-key.ts`
- Create: `src/server/ai/mcp/verify-key.test.ts`

**Interfaces:**
- Consumes: `Scope` from `@/server/ai/tools/types` (`` `${'portfolio'|'transactions'|'watchlist'|'goals'|'fx'}:${'read'|'write'}` ``).
- Produces: `permissionsToScopes(permissionsJson: string | null): Set<Scope>`.

- [ ] **Step 1: Write the failing test**

Create `src/server/ai/mcp/verify-key.test.ts`:

```ts
import { describe, expect, test } from 'bun:test';
import { permissionsToScopes } from './verify-key';

describe('permissionsToScopes', () => {
	test('maps a read action on a tool resource to `${resource}:read`', () => {
		const scopes = permissionsToScopes(JSON.stringify({ portfolio: ['read'], fx: ['read'] }));
		expect([...scopes].sort()).toEqual(['fx:read', 'portfolio:read']);
	});

	test('ignores write actions (Phase 2 is read-only)', () => {
		const scopes = permissionsToScopes(JSON.stringify({ portfolio: ['read', 'write'], transactions: ['write'] }));
		expect([...scopes]).toEqual(['portfolio:read']);
	});

	test('ignores non-tool resources (account/admin/ai/apiKeys)', () => {
		const scopes = permissionsToScopes(JSON.stringify({ ai: ['use'], admin: ['read'], account: ['read'] }));
		expect(scopes.size).toBe(0);
	});

	test('null, empty, and malformed permissions yield an empty set (fail closed)', () => {
		expect(permissionsToScopes(null).size).toBe(0);
		expect(permissionsToScopes('').size).toBe(0);
		expect(permissionsToScopes('{not json').size).toBe(0);
		expect(permissionsToScopes(JSON.stringify(['portfolio'])).size).toBe(0);
	});

	test('a full read-only key yields exactly the five read scopes', () => {
		const scopes = permissionsToScopes(
			JSON.stringify({ portfolio: ['read'], transactions: ['read'], watchlist: ['read'], goals: ['read'], fx: ['read'] })
		);
		expect([...scopes].sort()).toEqual(['fx:read', 'goals:read', 'portfolio:read', 'transactions:read', 'watchlist:read']);
	});
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bun test src/server/ai/mcp/verify-key.test.ts`
Expected: FAIL — `permissionsToScopes` is not exported / module not found.

- [ ] **Step 3: Write the minimal implementation**

Create `src/server/ai/mcp/verify-key.ts`:

```ts
import type { Scope } from '@/server/ai/tools/types';

/** The five tool resources that map to a `Scope`. `account`/`admin`/`ai`/`apiKeys` are not tools. */
const TOOL_RESOURCES = ['portfolio', 'transactions', 'watchlist', 'goals', 'fx'] as const;

/**
 * Maps an API key's Better-Auth permissions JSON (`{ resource: [actions] }`) to the tool `Scope`
 * set. Read-only surface: only a `read` action on one of the five TOOL_RESOURCES becomes a
 * `${resource}:read` scope. Write actions and non-tool resources are ignored — Phase 2 is
 * read-only, and `buildToolset` drops mutating tools on the MCP surface regardless. Fails closed:
 * null / empty / malformed / non-object JSON yields an empty set.
 */
export function permissionsToScopes(permissionsJson: string | null): Set<Scope> {
	const scopes = new Set<Scope>();
	if (!permissionsJson) return scopes;

	let parsed: unknown;
	try {
		parsed = JSON.parse(permissionsJson);
	} catch {
		return scopes;
	}
	if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return scopes;

	const perms = parsed as Record<string, unknown>;
	for (const resource of TOOL_RESOURCES) {
		const actions = perms[resource];
		if (Array.isArray(actions) && actions.includes('read')) {
			scopes.add(`${resource}:read`);
		}
	}
	return scopes;
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `bun test src/server/ai/mcp/verify-key.test.ts`
Expected: PASS (all 5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/server/ai/mcp/verify-key.ts src/server/ai/mcp/verify-key.test.ts
git commit -m "feat(ai): map API-key permissions to read-only tool scopes for MCP"
```

---

## Task 3: `verifyMcpKey` — bearer → { userId, scopes }

HMAC fast path (O(1) unique lookup, constant-time re-check) + legacy fallback (start-bucket bcrypt) that lazily backfills `keyHmac`, so every key self-heals on first MCP use without touching key creation. Fails closed on unconfigured pepper, disabled, or expired keys.

**Files:**
- Modify: `src/server/ai/mcp/verify-key.ts`
- Modify: `src/server/ai/mcp/verify-key.test.ts`

**Interfaces:**
- Consumes: `db.apiKey` (`findUnique`/`findMany`/`update`), `env.AI_API_KEY_PEPPER`, `bcryptjs`, `permissionsToScopes` (Task 2). `ApiKey` columns used: `id`, `key` (bcrypt), `keyHmac` (unique, nullable), `start`, `enabled`, `expiresAt`, `permissions`, `userId`.
- Produces: `verifyMcpKey(bearer: string): Promise<{ userId: string; scopes: Set<Scope> } | null>`.

- [ ] **Step 1: Write the failing tests**

Append to `src/server/ai/mcp/verify-key.test.ts`. The DB and env are mocked; `mock.module` calls MUST run before the dynamic `import` of the module under test, so this block re-imports `verifyMcpKey` dynamically:

```ts
import { beforeEach, describe as describe2, expect as expect2, mock, test as test2 } from 'bun:test';
import { createHmac } from 'node:crypto';

const PEPPER = 'x'.repeat(32);
function hmacOf(token: string): string {
	return createHmac('sha256', PEPPER).update(token).digest('hex');
}

type Row = {
	id: string;
	key: string;
	keyHmac: string | null;
	start: string | null;
	enabled: boolean;
	expiresAt: Date | null;
	permissions: string | null;
	userId: string;
};

let rows: Row[] = [];
const updates: Array<{ id: string; keyHmac: string }> = [];

mock.module('@/env', () => ({ env: { AI_API_KEY_PEPPER: PEPPER } }));
mock.module('@/server/db', () => ({
	db: {
		apiKey: {
			findUnique: async ({ where }: { where: { keyHmac: string } }) =>
				rows.find((r) => r.keyHmac === where.keyHmac) ?? null,
			findMany: async ({ where }: { where: { keyHmac: null; start: string } }) =>
				rows.filter((r) => r.keyHmac === null && r.start === where.start),
			update: async ({ where, data }: { where: { id: string }; data: { keyHmac: string } }) => {
				updates.push({ id: where.id, keyHmac: data.keyHmac });
				const r = rows.find((x) => x.id === where.id);
				if (r) r.keyHmac = data.keyHmac;
				return r;
			}
		}
	}
}));

// bcryptjs is used for the legacy fallback; stub compareSync so "raw==='secret'+id" matches its hash.
mock.module('bcryptjs', () => ({
	default: { compareSync: (raw: string, hash: string) => hash === `bcrypt:${raw}` }
}));

const { verifyMcpKey: verify } = await import('./verify-key');

function baseRow(over: Partial<Row> = {}): Row {
	return {
		id: 'k1',
		key: 'bcrypt:secret-token',
		keyHmac: hmacOf('secret-token'),
		start: 'secret',
		enabled: true,
		expiresAt: null,
		permissions: JSON.stringify({ portfolio: ['read'] }),
		userId: 'owner-1',
		...over
	};
}

describe2('verifyMcpKey', () => {
	beforeEach(() => {
		rows = [];
		updates.length = 0;
	});

	test2('fast path: valid hmac hit returns owner + mapped scopes', async () => {
		rows = [baseRow()];
		const res = await verify('secret-token');
		expect2(res).not.toBeNull();
		expect2(res?.userId).toBe('owner-1');
		expect2([...(res?.scopes ?? [])]).toEqual(['portfolio:read']);
		expect2(updates).toHaveLength(0); // no backfill needed
	});

	test2('rejects a disabled key', async () => {
		rows = [baseRow({ enabled: false })];
		expect2(await verify('secret-token')).toBeNull();
	});

	test2('rejects an expired key', async () => {
		rows = [baseRow({ expiresAt: new Date(Date.now() - 1000) })];
		expect2(await verify('secret-token')).toBeNull();
	});

	test2('unknown token returns null', async () => {
		rows = [baseRow()];
		expect2(await verify('not-the-token')).toBeNull();
	});

	test2('legacy fallback: keyHmac=null key matches by start-bucket + bcrypt and is backfilled', async () => {
		rows = [baseRow({ keyHmac: null })];
		const res = await verify('secret-token');
		expect2(res?.userId).toBe('owner-1');
		expect2(updates).toEqual([{ id: 'k1', keyHmac: hmacOf('secret-token') }]); // lazily backfilled
	});

	test2('empty bearer returns null', async () => {
		expect2(await verify('   ')).toBeNull();
	});
});
```

Also add a separate file for the pepper-unconfigured case, because `@/env` is mocked at module scope above. Create `src/server/ai/mcp/verify-key-nopepper.test.ts`:

```ts
import { describe, expect, mock, test } from 'bun:test';

mock.module('@/env', () => ({ env: { AI_API_KEY_PEPPER: undefined } }));
mock.module('@/server/db', () => ({ db: { apiKey: { findUnique: async () => null, findMany: async () => [], update: async () => null } } }));
mock.module('bcryptjs', () => ({ default: { compareSync: () => false } }));

const { verifyMcpKey } = await import('./verify-key');

describe('verifyMcpKey without a configured pepper', () => {
	test('cannot authenticate anyone → null', async () => {
		expect(await verifyMcpKey('any-token')).toBeNull();
	});
});
```

- [ ] **Step 2: Run to verify failure**

Run: `bun test src/server/ai/mcp/verify-key.test.ts src/server/ai/mcp/verify-key-nopepper.test.ts`
Expected: FAIL — `verifyMcpKey` not exported.

- [ ] **Step 3: Implement**

Append to `src/server/ai/mcp/verify-key.ts` (add the imports at the top of the file):

```ts
import { createHmac, timingSafeEqual } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { env } from '@/env';
import { db } from '@/server/db';

/** HMAC-SHA256(token, pepper) hex, or null when the pepper is unconfigured (cannot verify). */
function computeKeyHmac(token: string): string | null {
	if (!env.AI_API_KEY_PEPPER) return null;
	return createHmac('sha256', env.AI_API_KEY_PEPPER).update(token).digest('hex');
}

/** Constant-time equality of two hex strings of equal byte length. */
function constantTimeEqualHex(a: string, b: string): boolean {
	const ab = Buffer.from(a, 'hex');
	const bb = Buffer.from(b, 'hex');
	if (ab.length !== bb.length) return false;
	return timingSafeEqual(ab, bb);
}

export type VerifiedKey = { userId: string; scopes: Set<Scope> };

/**
 * Resolves a bearer API key to its owner + tool scopes for the MCP surface, or null.
 *
 * Fast path: `keyHmac` is a UNIQUE indexed column, so `HMAC-SHA256(token, pepper)` is an O(1)
 * `findUnique`. A hit is re-confirmed with a constant-time HMAC compare (satisfies the "no timing
 * oracle" invariant; the lookup itself is already the authentication).
 *
 * Legacy fallback: keys minted before `keyHmac` was populated have `keyHmac === null` and miss the
 * fast path. They are matched by their `start` bucket + `bcrypt.compareSync`, then `keyHmac` is
 * LAZILY BACKFILLED so every subsequent call is O(1) — every key self-heals on first MCP use with
 * no change to the key-creation flow.
 *
 * Fails closed: unconfigured pepper, empty/whitespace bearer, disabled, or expired ⇒ null.
 */
export async function verifyMcpKey(bearer: string): Promise<VerifiedKey | null> {
	const token = bearer.trim();
	if (token.length === 0) return null;

	const hmac = computeKeyHmac(token);
	if (hmac === null) return null;

	const byHmac = await db.apiKey.findUnique({ where: { keyHmac: hmac } });
	if (byHmac !== null) {
		if (!byHmac.enabled) return null;
		if (byHmac.expiresAt !== null && byHmac.expiresAt.getTime() <= Date.now()) return null;
		if (byHmac.keyHmac === null || !constantTimeEqualHex(byHmac.keyHmac, hmac)) return null;
		return { scopes: permissionsToScopes(byHmac.permissions), userId: byHmac.userId };
	}

	// Legacy fallback: match by start-bucket + bcrypt, then backfill keyHmac.
	const start = token.slice(0, 6);
	const candidates = await db.apiKey.findMany({ where: { keyHmac: null, start } });
	for (const cand of candidates) {
		if (!bcrypt.compareSync(token, cand.key)) continue;
		if (!cand.enabled) return null;
		if (cand.expiresAt !== null && cand.expiresAt.getTime() <= Date.now()) return null;
		await db.apiKey.update({ data: { keyHmac: hmac }, where: { id: cand.id } });
		return { scopes: permissionsToScopes(cand.permissions), userId: cand.userId };
	}
	return null;
}
```

- [ ] **Step 4: Run to verify passing**

Run: `bun test src/server/ai/mcp/verify-key.test.ts src/server/ai/mcp/verify-key-nopepper.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add src/server/ai/mcp/verify-key.ts src/server/ai/mcp/verify-key.test.ts src/server/ai/mcp/verify-key-nopepper.test.ts
git commit -m "feat(ai): verifyMcpKey — HMAC fast-path bearer auth with lazy keyHmac backfill"
```

---

## Task 4: `createToolCtx` — accept an explicit scope set

Backward-compatible: chat still calls `createToolCtx(session, 'chat')` and gets `ALL_READ_SCOPES`; MCP passes the key's scopes explicitly.

**Files:**
- Modify: `src/server/ai/tool-ctx.ts:21-26`
- Modify: `src/server/ai/tool-ctx.test.ts`

**Interfaces:**
- Consumes: `Scope`, `ALL_READ_SCOPES`.
- Produces: `createToolCtx(session, surface, scopes?: ReadonlySet<Scope>): Promise<ToolCtx>` — `scopes` defaults to `ALL_READ_SCOPES`.

- [ ] **Step 1: Write the failing test**

Append to `src/server/ai/tool-ctx.test.ts` (the file already mocks `@/server/db`'s `user.findUnique`):

```ts
test('honors an explicit scope set and still sources userId from the session arg', async () => {
	const ctx = await createToolCtx({ user: { id: 'u-scoped' } }, 'mcp', new Set(['portfolio:read'] as const));
	expect(ctx.userId).toBe('u-scoped');
	expect(ctx.surface).toBe('mcp');
	expect([...ctx.scopes]).toEqual(['portfolio:read']);
});

test('defaults to ALL_READ_SCOPES when no scope set is passed (chat behavior unchanged)', async () => {
	const ctx = await createToolCtx({ user: { id: 'u-default' } }, 'chat');
	expect(ctx.scopes).toBe(ALL_READ_SCOPES);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `bun test src/server/ai/tool-ctx.test.ts`
Expected: FAIL — `createToolCtx` currently ignores a third argument, so `[...ctx.scopes]` is the full five-scope set, not `['portfolio:read']`.

- [ ] **Step 3: Implement**

Edit `src/server/ai/tool-ctx.ts`, replacing the `createToolCtx` signature and return:

```ts
export async function createToolCtx(
	session: { user: { id: string } },
	surface: ToolCtx['surface'],
	scopes: ReadonlySet<Scope> = ALL_READ_SCOPES
): Promise<ToolCtx> {
	const userId = session.user.id;
	const user = await db.user.findUnique({ select: { currency: true }, where: { id: userId } });
	const currency = (user?.currency ?? 'USD') as Currency;
	return { currency, scopes, surface, userId };
}
```

(Update the doc comment above it to note `scopes` defaults to `ALL_READ_SCOPES`; the MCP route passes the key's scopes.)

- [ ] **Step 4: Run to verify passing**

Run: `bun test src/server/ai/tool-ctx.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/ai/tool-ctx.ts src/server/ai/tool-ctx.test.ts
git commit -m "feat(ai): createToolCtx accepts an explicit scope set (defaults to ALL_READ_SCOPES)"
```

---

## Task 5: `buildMcpServer` adapter — registration + handler + telemetry

Mirror of `toAiSdkTools`, three differences (all in Global Constraints): dot names as-is, per-call `AiToolCall` written by the adapter (no AI SDK hooks here), and MCP `{ content, structuredContent }` results.

**Files:**
- Create: `src/server/ai/tools/adapters/mcp.ts`
- Create: `src/server/ai/tools/adapters/mcp.test.ts`

**Interfaces:**
- Consumes: `McpServer`, `AppTool`/`ToolCtx` (`@/server/ai/tools/types`), `dbSink` (`@/server/ai/telemetry`, whose `writeToolCall(row: AiToolCallRow)` does `db.aiToolCall.create({ data: row })`). `AiToolCallRow` = `{ durationMs, errorMessage, inputHash, ok, requestId, surface, toolCallId, toolName, userId }`.
- Produces: `buildMcpServer(tools: AppTool[], ctx: ToolCtx, requestId: string): McpServer`.

- [ ] **Step 1: Write the failing test**

Create `src/server/ai/tools/adapters/mcp.test.ts`. Mock `@/server/db` so the real `dbSink` writes to a spy; drive the built server with a real in-memory `Client`:

```ts
import { describe, expect, mock, test } from 'bun:test';
import { z } from 'zod';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { AppTool, Scope, ToolCtx } from '../types';

const toolCallRows: unknown[] = [];
mock.module('@/server/db', () => ({
	db: { aiToolCall: { create: async ({ data }: { data: unknown }) => toolCallRows.push(data) } }
}));

const { buildMcpServer } = await import('./mcp');

function readTool(name: string, requiredScope: Scope): AppTool {
	return {
		name,
		description: `${name} tool`,
		inputSchema: z.strictObject({ q: z.string().optional() }),
		outputSchema: z.strictObject({ who: z.string() }),
		requiredScope,
		mutates: false,
		annotations: { title: name, readOnlyHint: true, openWorldHint: false },
		// The handler must receive ctx (with userId) — NOT userId from args.
		execute: async (_input, ctx) => ({ who: ctx.userId })
	} as AppTool;
}

const ctx: ToolCtx = {
	userId: 'owner-9',
	scopes: new Set(['portfolio:read']),
	surface: 'mcp',
	currency: 'USD'
};

async function connect(tools: AppTool[]) {
	const server = buildMcpServer(tools, ctx, 'req-1');
	const [clientT, serverT] = InMemoryTransport.createLinkedPair();
	await server.connect(serverT);
	const client = new Client({ name: 't', version: '0' });
	await client.connect(clientT);
	return { client, server };
}

describe('buildMcpServer', () => {
	test('registers tools under their canonical dot names (no underscore mapping)', async () => {
		toolCallRows.length = 0;
		const { client, server } = await connect([readTool('portfolio.structure', 'portfolio:read')]);
		const listed = await client.listTools();
		expect(listed.tools.map((t) => t.name)).toEqual(['portfolio.structure']);
		await client.close();
		await server.close();
	});

	test('handler closes over ctx.userId (client supplies only args) and returns structuredContent', async () => {
		toolCallRows.length = 0;
		const { client, server } = await connect([readTool('portfolio.structure', 'portfolio:read')]);
		const res = await client.callTool({ name: 'portfolio.structure', arguments: { q: 'anything' } });
		expect(res.structuredContent).toEqual({ who: 'owner-9' }); // userId from ctx, never from args
		await client.close();
		await server.close();
	});

	test('writes one AiToolCall row per call with surface MCP and a hashed (not raw) input', async () => {
		toolCallRows.length = 0;
		const { client, server } = await connect([readTool('portfolio.structure', 'portfolio:read')]);
		await client.callTool({ name: 'portfolio.structure', arguments: { q: 'secret-query' } });
		expect(toolCallRows).toHaveLength(1);
		const row = toolCallRows[0] as Record<string, unknown>;
		expect(row.surface).toBe('MCP');
		expect(row.toolName).toBe('portfolio.structure');
		expect(row.requestId).toBe('req-1');
		expect(row.userId).toBe('owner-9');
		expect(row.ok).toBe(true);
		expect(typeof row.inputHash).toBe('string');
		expect(JSON.stringify(row)).not.toContain('secret-query'); // raw args never stored
		await client.close();
		await server.close();
	});

	test('a throwing tool logs ok:false with the error message and surfaces an MCP error', async () => {
		toolCallRows.length = 0;
		const boom = readTool('portfolio.structure', 'portfolio:read');
		boom.execute = async () => {
			throw new Error('kaboom');
		};
		const { client, server } = await connect([boom]);
		const res = await client.callTool({ name: 'portfolio.structure', arguments: {} });
		expect(res.isError).toBe(true);
		expect(toolCallRows).toHaveLength(1);
		expect((toolCallRows[0] as Record<string, unknown>).ok).toBe(false);
		expect((toolCallRows[0] as Record<string, unknown>).errorMessage).toBe('kaboom');
		await client.close();
		await server.close();
	});
});
```

- [ ] **Step 2: Run to verify failure**

Run: `bun test src/server/ai/tools/adapters/mcp.test.ts`
Expected: FAIL — `buildMcpServer` not found.

- [ ] **Step 3: Implement**

Create `src/server/ai/tools/adapters/mcp.ts`:

```ts
import { createHash, randomUUID } from 'node:crypto';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { dbSink } from '@/server/ai/telemetry';
import type { AppTool, ToolCtx } from '../types';

const SERVER_INFO = { name: 'invest-igator', version: '0.1.0' } as const;

/** SHA-256 (hex) of the tool input — for telemetry correlation, never the raw args. */
function hashToolInput(input: unknown): string {
	return createHash('sha256').update(JSON.stringify(input ?? null)).digest('hex');
}

/**
 * AppTool[] -> an MCP server (Phase 2). Mirror of `toAiSdkTools` with three differences:
 *   1. MCP tool names permit dots, so the canonical `group.verb` name is registered AS-IS
 *      (no '.'->'_' mapping the AI SDK adapter needs).
 *   2. No LLM runs in our process, so there is no quota and the AI SDK telemetry hooks never fire
 *      here — each call writes its OWN `AiToolCall` row (surface MCP) via `dbSink`.
 *   3. The handler returns MCP `{ content, structuredContent }`; a thrown error becomes an MCP
 *      error result (the SDK sets `isError`).
 *
 * The handler closes over `ctx`; the client supplies only `args`, so it can never reach `userId`.
 * `requestId` correlates every tool call within one HTTP request.
 */
export function buildMcpServer(tools: AppTool[], ctx: ToolCtx, requestId: string): McpServer {
	const server = new McpServer(SERVER_INFO);

	for (const def of tools) {
		server.registerTool(
			def.name,
			{
				annotations: def.annotations,
				description: def.description,
				inputSchema: def.inputSchema,
				outputSchema: def.outputSchema
			},
			async (args: unknown, extra: { signal: AbortSignal }) => {
				const toolCallId = randomUUID();
				const started = Date.now();
				const toolCtx: ToolCtx = { ...ctx, abortSignal: extra.signal };
				try {
					// The SDK validates `args` against `def.inputSchema` before calling us, so `args`
					// is already the tool's input type at runtime.
					const result = await def.execute(args as never, toolCtx);
					await dbSink.writeToolCall({
						durationMs: Date.now() - started,
						errorMessage: null,
						inputHash: hashToolInput(args),
						ok: true,
						requestId,
						surface: 'MCP',
						toolCallId,
						toolName: def.name,
						userId: ctx.userId
					});
					return { content: [{ text: JSON.stringify(result), type: 'text' as const }], structuredContent: result };
				} catch (err) {
					await dbSink.writeToolCall({
						durationMs: Date.now() - started,
						errorMessage: err instanceof Error ? err.message : String(err),
						inputHash: hashToolInput(args),
						ok: false,
						requestId,
						surface: 'MCP',
						toolCallId,
						toolName: def.name,
						userId: ctx.userId
					});
					throw err; // SDK formats the MCP error result (isError: true)
				}
			}
		);
	}

	return server;
}
```

Note for the implementer: if `tsc` rejects the callback's generic against `registerTool`'s overload, keep `args: unknown` and the `args as never` cast at the `def.execute` call — the SDK pre-validates `args` against `def.inputSchema`, so the cast is the correct runtime type. Do not remove `inputSchema`/`outputSchema` to dodge the generic; they drive the SDK's input validation and `structuredContent` validation.

- [ ] **Step 4: Run to verify passing**

Run: `bun test src/server/ai/tools/adapters/mcp.test.ts`
Expected: PASS (all 4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/server/ai/tools/adapters/mcp.ts src/server/ai/tools/adapters/mcp.test.ts
git commit -m "feat(ai): MCP adapter — AppTool[] to McpServer with per-call telemetry"
```

---

## Task 6: `POST /api/mcp` route + `ENABLE_MCP` env

Gates on the flag (404 when off), authenticates the bearer, builds a per-request stateless server + Web transport, returns `handleRequest(req)`. The test also proves the Web transport bridge in-process with a real `initialize` JSON-RPC POST.

**Files:**
- Modify: `src/env.js` (server schema L72-122 + `runtimeEnv` L~31)
- Create: `src/app/api/mcp/route.ts`
- Create: `src/app/api/mcp/route.test.ts`

**Interfaces:**
- Consumes: `env.ENABLE_MCP` (boolean), `verifyMcpKey` (Task 3), `createToolCtx` (Task 4), `buildToolset` (`@/server/ai/tools/registry`), `buildMcpServer` (Task 5), `WebStandardStreamableHTTPServerTransport`.
- Produces: `POST`/`GET`/`DELETE` handlers exported from the route.

- [ ] **Step 1: Add the env flag**

Edit `src/env.js`. In the `server:` schema block add (mirroring the `.default()` idiom already used for `NODE_ENV`/`AZURE_OPENAI_CHAT_MODEL`; `z.coerce.boolean()` is NOT used because it treats the string `"false"` as `true`):

```js
// Off by default — the MCP surface returns 404 unless explicitly enabled.
ENABLE_MCP: z
	.enum(['true', 'false'])
	.default('false')
	.transform((v) => v === 'true'),
```

And in `runtimeEnv` add:

```js
ENABLE_MCP: process.env.ENABLE_MCP,
```

- [ ] **Step 2: Write the failing test**

Create `src/app/api/mcp/route.test.ts`. Mock the env flag, `verifyMcpKey`, `createToolCtx`, and `buildToolset`; let the REAL `buildMcpServer` + REAL Web transport handle a real `initialize` POST:

```ts
import { describe, expect, mock, test } from 'bun:test';

let enableMcp = true;
mock.module('@/env', () => ({ env: { get ENABLE_MCP() { return enableMcp; } } }));

let verified: { userId: string; scopes: Set<string> } | null = { userId: 'u1', scopes: new Set() };
const verifyCalls: string[] = [];
mock.module('@/server/ai/mcp/verify-key', () => ({
	verifyMcpKey: async (bearer: string) => {
		verifyCalls.push(bearer);
		return verified;
	}
}));

mock.module('@/server/ai/tool-ctx', () => ({
	createToolCtx: async (session: { user: { id: string } }, surface: string, scopes: Set<string>) => ({
		userId: session.user.id,
		surface,
		scopes,
		currency: 'USD'
	})
}));
mock.module('@/server/ai/tools/registry', () => ({ buildToolset: () => [] }));
// The real buildMcpServer pulls in dbSink (→ @/server/db). Stub telemetry so this route test stays
// hermetic (no DB) while still exercising the REAL McpServer + Web transport for the bridge proof.
mock.module('@/server/ai/telemetry', () => ({ dbSink: { writeToolCall: async () => {}, writeCall: async () => {} } }));

const { POST } = await import('./route');

function initializeBody() {
	return {
		jsonrpc: '2.0',
		id: 1,
		method: 'initialize',
		params: {
			protocolVersion: '2025-06-18',
			capabilities: {},
			clientInfo: { name: 'test', version: '0' }
		}
	};
}

function req(body: unknown, headers: Record<string, string> = {}): Request {
	return new Request('http://x/api/mcp', {
		method: 'POST',
		headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...headers },
		body: JSON.stringify(body)
	});
}

describe('POST /api/mcp', () => {
	test('404 when ENABLE_MCP is off', async () => {
		enableMcp = false;
		verifyCalls.length = 0;
		const res = await POST(req(initializeBody(), { authorization: 'Bearer k' }));
		expect(res.status).toBe(404);
		expect(verifyCalls).toHaveLength(0); // gated before auth
	});

	test('401 when the bearer is missing', async () => {
		enableMcp = true;
		const res = await POST(req(initializeBody()));
		expect(res.status).toBe(401);
	});

	test('401 when the key is invalid', async () => {
		enableMcp = true;
		verified = null;
		const res = await POST(req(initializeBody(), { authorization: 'Bearer bad' }));
		expect(res.status).toBe(401);
		verified = { userId: 'u1', scopes: new Set() };
	});

	test('valid key: initialize round-trips through the Web transport (bridge proof)', async () => {
		enableMcp = true;
		verified = { userId: 'u1', scopes: new Set() };
		verifyCalls.length = 0;
		const res = await POST(req(initializeBody(), { authorization: 'Bearer good' }));
		expect(res.status).toBe(200);
		expect(verifyCalls).toEqual(['good']);
		const payload = await parseJsonRpc(res);
		expect(payload.result?.serverInfo?.name).toBe('invest-igator');
	});
});

/** The transport may answer as JSON or as a single SSE event; accept either. */
async function parseJsonRpc(res: Response): Promise<{ result?: { serverInfo?: { name?: string } } }> {
	const text = await res.text();
	const ct = res.headers.get('content-type') ?? '';
	if (ct.includes('application/json')) return JSON.parse(text);
	const line = text.split('\n').find((l) => l.startsWith('data:'));
	return JSON.parse((line ?? 'data: {}').slice('data:'.length).trim());
}
```

- [ ] **Step 3: Run to verify failure**

Run: `bun test src/app/api/mcp/route.test.ts`
Expected: FAIL — the route module does not exist.

- [ ] **Step 4: Implement**

Create `src/app/api/mcp/route.ts`:

```ts
import { randomUUID } from 'node:crypto';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { env } from '@/env';
import { verifyMcpKey } from '@/server/ai/mcp/verify-key';
import { createToolCtx } from '@/server/ai/tool-ctx';
import { buildMcpServer } from '@/server/ai/tools/adapters/mcp';
import { buildToolset } from '@/server/ai/tools/registry';

/** Tool calls can exceed the default 15s under load. */
export const maxDuration = 60;

function unauthorized(): Response {
	return new Response(JSON.stringify({ error: 'UNAUTHENTICATED' }), {
		headers: { 'content-type': 'application/json', 'www-authenticate': 'Bearer' },
		status: 401
	});
}

/**
 * Stateless per-request MCP endpoint. Every request builds a fresh server scoped to the verified
 * key and a fresh Web-native transport, then hands the request to the transport. No session state,
 * no LLM, no quota. `ENABLE_MCP` off ⇒ the surface does not exist (404), checked before auth so it
 * cannot be probed.
 */
async function handle(req: Request): Promise<Response> {
	if (!env.ENABLE_MCP) return new Response('Not Found', { status: 404 });

	const authHeader = req.headers.get('authorization');
	const bearer = authHeader?.startsWith('Bearer ') ? authHeader.slice('Bearer '.length) : null;
	if (bearer === null) return unauthorized();

	const verified = await verifyMcpKey(bearer);
	if (verified === null) return unauthorized();

	const requestId = randomUUID();
	const ctx = await createToolCtx({ user: { id: verified.userId } }, 'mcp', verified.scopes);
	const tools = buildToolset(ctx);
	const server = buildMcpServer(tools, ctx, requestId);

	const transport = new WebStandardStreamableHTTPServerTransport({
		enableJsonResponse: true,
		sessionIdGenerator: undefined
	});
	await server.connect(transport);
	return transport.handleRequest(req);
}

export const POST = handle;
export const GET = handle;
export const DELETE = handle;
```

- [ ] **Step 5: Run to verify passing**

Run: `bun test src/app/api/mcp/route.test.ts`
Expected: PASS (all 4). The 4th proves the `WebStandardStreamableHTTPServerTransport` ↔ Next `Request`/`Response` bridge works in-process.

- [ ] **Step 6: Commit**

```bash
git add src/env.js src/app/api/mcp/route.ts src/app/api/mcp/route.test.ts
git commit -m "feat(ai): POST /api/mcp — flag-gated, bearer-authed, stateless MCP endpoint"
```

---

## Task 7: Real-Postgres end-to-end (scoped, read-only, own-data)

The crown test: a scoped bearer key over the FULL chain (verify → ctx → buildToolset → adapter → in-memory Client) against REAL seeded data proves scope-narrowing, own-data-only, read-only, and telemetry — the security invariants the spec demands be tested, not asserted.

**Files:**
- Create: `prisma/ai-mcp-e2e.test.ts`
- Modify: `package.json` (`test:db` script — append the new file)

**Interfaces:**
- Consumes: `resetAiTables`, `seedUser` (`../src/server/ai/evals/db-support`), `createToolCtx`, `buildToolset`, `buildMcpServer`, the real tools, `db`, `Client`, `InMemoryTransport`.

- [ ] **Step 1: Register the test in the db suite**

Edit `package.json`, appending ` prisma/ai-mcp-e2e.test.ts` to the end of the `test:db` script's file list.

- [ ] **Step 2: Write the failing test**

Create `prisma/ai-mcp-e2e.test.ts`:

```ts
import { beforeEach, describe, expect, test } from 'bun:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { resetAiTables, seedUser } from '../src/server/ai/evals/db-support';
import { buildMcpServer } from '../src/server/ai/tools/adapters/mcp';
import { createToolCtx } from '../src/server/ai/tool-ctx';
import { buildToolset } from '../src/server/ai/tools/registry';
import type { Scope } from '../src/server/ai/tools/types';
import { db } from '../src/server/db';

let userA: string;
let userB: string;

beforeEach(async () => {
	await resetAiTables();
	userA = await seedUser('a');
	userB = await seedUser('b');
	// Distinct, identifiable holdings so a cross-tenant leak would be visible.
	// Transaction columns verified against prisma/schema.prisma at plan time: `side` (enum
	// TransactionSide BUY|SELL), `priceCurrency` defaults to 'USD'.
	await db.transaction.createMany({
		data: [
			{ userId: userA, symbol: 'AAAA', side: 'BUY', quantity: 10, price: 100, date: new Date('2026-01-01') },
			{ userId: userB, symbol: 'BBBB', side: 'BUY', quantity: 5, price: 50, date: new Date('2026-01-01') }
		]
	});
});

async function connectFor(userId: string, scopes: Set<Scope>) {
	const requestId = 'e2e-req';
	const ctx = await createToolCtx({ user: { id: userId } }, 'mcp', scopes);
	const server = buildMcpServer(buildToolset(ctx), ctx, requestId);
	const [clientT, serverT] = InMemoryTransport.createLinkedPair();
	await server.connect(serverT);
	const client = new Client({ name: 'e2e', version: '0' });
	await client.connect(clientT);
	return { client, server };
}

describe('MCP end-to-end over real Postgres', () => {
	test('a portfolio-only key lists ONLY the portfolio read tools', async () => {
		const { client, server } = await connectFor(userA, new Set<Scope>(['portfolio:read']));
		const names = (await client.listTools()).tools.map((t) => t.name).sort();
		// Exactly the two portfolio tools; transactions/watchlist/goals/fx excluded by scope.
		expect(names).toEqual(['portfolio.performance', 'portfolio.structure']);
		expect(names).not.toContain('transactions.search');
		await client.close();
		await server.close();
	});

	test('no listed tool is a mutating tool (read-only surface)', async () => {
		const all: Set<Scope> = new Set([
			'portfolio:read',
			'transactions:read',
			'watchlist:read',
			'goals:read',
			'fx:read'
		]);
		const { client, server } = await connectFor(userA, all);
		const listed = await client.listTools();
		for (const t of listed.tools) {
			expect(t.annotations?.readOnlyHint).toBe(true);
		}
		await client.close();
		await server.close();
	});

	test('callTool returns the CALLER’S own data as structuredContent — never another tenant’s', async () => {
		// transactions.search returns rows carrying `symbol` directly (no pricing dependency),
		// so a cross-tenant leak is unambiguous. All its input fields are optional → `{}` is valid.
		const { client, server } = await connectFor(userA, new Set<Scope>(['transactions:read']));
		const res = await client.callTool({ name: 'transactions.search', arguments: {} });
		const json = JSON.stringify(res.structuredContent);
		expect(json).toContain('AAAA'); // user A's transaction symbol
		expect(json).not.toContain('BBBB'); // user B's must never appear
		await client.close();
		await server.close();
	});

	test('a tool outside the key’s scope is neither listed nor callable', async () => {
		const { client, server } = await connectFor(userA, new Set<Scope>(['portfolio:read']));
		const names = (await client.listTools()).tools.map((t) => t.name);
		expect(names).not.toContain('transactions.search');
		await expect(client.callTool({ name: 'transactions.search', arguments: {} })).rejects.toThrow();
		await client.close();
		await server.close();
	});

	test('each successful call writes an AiToolCall row with surface MCP', async () => {
		const { client, server } = await connectFor(userA, new Set<Scope>(['transactions:read']));
		await client.callTool({ name: 'transactions.search', arguments: {} });
		const rows = await db.aiToolCall.findMany({ where: { surface: 'MCP', userId: userA } });
		expect(rows.length).toBeGreaterThanOrEqual(1);
		expect(rows[0]?.toolName).toBe('transactions.search');
		await client.close();
		await server.close();
	});
});
```

Implementer note: tool names (`portfolio.structure`/`portfolio.performance` are the two `portfolio:read` tools; `transactions.search` is `transactions:read`), the all-optional `transactions.search` input, and the `Transaction` columns (`side`, `symbol`, defaulted `priceCurrency`) were verified against the tree at plan time. If the `Transaction` model has since gained a required column, add it to the seed. Do NOT weaken the cross-tenant / scope-narrowing / read-only / telemetry assertions to make it pass.

- [ ] **Step 3: Run to verify failure, then passing**

Run: `bun test prisma/ai-mcp-e2e.test.ts` (requires the local Postgres the other `prisma/*.test.ts` use).
Expected: first FAIL (assertion/name mismatches to reconcile against the real tools), then PASS after reconciling names. Do NOT weaken the cross-tenant / scope / read-only assertions to make it pass.

- [ ] **Step 4: Commit**

```bash
git add prisma/ai-mcp-e2e.test.ts package.json
git commit -m "test(ai): MCP end-to-end over Postgres — scope, own-data, read-only, telemetry"
```

---

## Task 8: Client-configuration docs

The documentation deliverable: enable the flag, mint a scoped key, connect Claude Code/Desktop/Cursor. No code.

**Files:**
- Create: `docs/mcp.md`
- Modify: `.env.example` (if it exists) — add `ENABLE_MCP` + a note on `AI_API_KEY_PEPPER`.

- [ ] **Step 1: Write `docs/mcp.md`**

Cover, concretely:
- **Enable:** set `ENABLE_MCP=true` and `AI_API_KEY_PEPPER` (≥32 chars, `openssl rand -base64 32`) in the server env. Note that without the pepper, MCP authenticates no one (fails closed).
- **Mint a key:** create an API key in the app with the desired *read* scopes (e.g. `portfolio:read`); the key's read scopes become its MCP toolset (least privilege). Existing keys work too — `keyHmac` backfills on first MCP use.
- **Connect (Claude Code):** the `/api/mcp` URL + `Authorization: Bearer <key>` header; show the `claude mcp add --transport http ...` invocation and the equivalent JSON config for Claude Desktop / Cursor.
- **What you get:** the read tools your key's scopes permit, over your own data only. No writes (Phase 3). No OAuth — bearer only, by design.
- **Observability:** each call is logged (`AiToolCall`, surface MCP) and visible in the admin AI dashboard; no LLM quota is spent.

- [ ] **Step 2: Update `.env.example`** (only if the file exists)

Add `ENABLE_MCP=false` and a comment pointing `AI_API_KEY_PEPPER` at MCP auth.

- [ ] **Step 3: Commit**

```bash
git add docs/mcp.md .env.example
git commit -m "docs(ai): MCP client-configuration guide"
```

---

## Final verification (run before the whole-branch review)

- [ ] `bun test` (the `src/**` unit suite, hermetic) — all green, including the new verify-key/adapter/route/ctx tests and the SDK smoke.
- [ ] `bun run test:db` — the real-Postgres suite including `prisma/ai-mcp-e2e.test.ts`.
- [ ] `bun run typecheck` — clean.
- [ ] `bun run check` (biome) — clean.
- [ ] Manual real-client smoke (documented, not automated): with `ENABLE_MCP=true` and a scoped key, `claude mcp add` the running instance and confirm the scoped tools appear and return your own data. This is the ultimate proof of the stateless-HTTP handshake with a real client.

## Done when

- With `ENABLE_MCP` on, an external MCP client authenticated by a scoped bearer key can `tools/list` and `tools/call` the read tools its scopes permit, over `/api/mcp`, and receives the caller's own data as `structuredContent`.
- No mutating tool is ever reachable; a key cannot reach a tool outside its scopes; `userId` never comes from the client. (Task 7.)
- Each call logs an `AiToolCall` (surface MCP); no platform quota is spent. (Tasks 5, 7.)
- `ENABLE_MCP` off ⇒ 404; key comparison is constant-time. (Tasks 3, 6.)
- `typecheck` + `biome` clean; unit + the in-memory/e2e tests green; the advice-boundary eval is unaffected (MCP involves no LLM).

Related: `docs/superpowers/specs/2026-07-21-ai-layer-phase2-mcp-design.md`, `docs/superpowers/specs/2026-07-13-ai-layer-phase0-design.md`, `docs/superpowers/specs/2026-07-21-ai-layer-phase1-chat-design.md`.
