# AI Layer — Phase 2: MCP Server (design)

Exposes the Phase 0 read tools to external agents (Claude Code/Desktop, Cursor) over the Model
Context Protocol, authenticated per-user by API key. This is the second "applyable" milestone for
the Visma Severa application and the third surface over the one tool layer: **a chatbot, an MCP
server, and a scheduled agent are the same set of typed, user-scoped operations wearing different
clothes** — Phase 1 shipped the chat adapter, Phase 2 ships the MCP adapter over the identical
`buildToolset(ctx)` authorization point.

## 1. Why

Phase 0 deliberately built the tool layer *for three surfaces at once* and shipped the MCP
prerequisites (the `AppTool` descriptor with `annotations` + `outputSchema` + JSON Schema, the
`AiSurface.MCP` enum, the `mutates && surface==='mcp'` filter in `buildToolset`, and the peppered
`keyHmac` O(1) key lookup). Phase 2 is the thin adapter + endpoint that turns those into a working
MCP server. Because the tools are **read-only** and the authorization lives in one place, MCP adds
no new way to leak another user's portfolio.

## 2. Scope

### In
- A stateless MCP server at `POST /api/mcp`, behind an `ENABLE_MCP` feature flag (default off).
- Bearer API-key authentication → the key's owner `userId` + the key's **resource scopes**.
- The 7 Phase 0 read tools, exposed via a new `mcp.ts` adapter, filtered per-key by scope.
- Per-call telemetry (`AiToolCall`, surface `MCP`) — observability, no quota.
- Client-connection documentation (Claude Code/Desktop, Cursor).

### Explicitly out (and why)
| Out | Why |
| --- | --- |
| Write / mutating tools | Phase 3. `buildToolset` already drops `mutates` on the MCP surface; every Phase 2 tool is read-only. Deletes the "destructive confirmation over an untrusted client" problem entirely. |
| OAuth / `/.well-known/oauth-protected-resource` | Bearer keys work with Claude Code/Cursor today. Serving the well-known makes both clients abandon a configured header and force OAuth. Deferred. |
| Platform LLM quota on MCP calls | MCP tool calls invoke no LLM on our side — the external client does the reasoning. The `ai:use` capability (which gates platform LLM spend) is therefore not required; resource scopes govern. |
| Building to the 2026-07-28 stateless spec | The current SDK transport works with real clients today; the transport is a thin seam we swap when the new SDK ships (§6). |

## 3. Baseline (verified in-tree, not assumed)

- **Adapter seam exists:** `src/server/ai/tools/adapters/` holds only `ai-sdk.ts` today; `mcp.ts`
  is Phase 2. The Phase 0 design named it `AppTool[] -> server.registerTool`.
- **`AppTool` carries the MCP fields:** `name` (dot form), `description`, `inputSchema`
  (z.strictObject → JSON Schema), `outputSchema` (mandatory → MCP `structuredContent`),
  `requiredScope`, `mutates`, `annotations { title, readOnlyHint, destructiveHint?, idempotentHint?,
  openWorldHint }`.
- **Authorization point:** `buildToolset(ctx)` filters by `ctx.scopes.has(t.requiredScope)` and
  drops `t.mutates` when `ctx.surface === 'mcp'`. Unchanged.
- **`createToolCtx(session, surface)`** (Phase 1) builds `{ userId, scopes, surface, currency }`.
  Today it always grants `ALL_READ_SCOPES`; Phase 2 needs it to accept an explicit scope set (§5.4).
- **API-key auth prerequisite:** `ApiKey.keyHmac` = `HMAC-SHA256(key, AI_API_KEY_PEPPER)`, unique,
  O(1) lookup, compared with `timingSafeEqual`; `enabled`, expiry, `permissions`, and rate-limit
  columns present. `AI_API_KEY_PEPPER` is a `z.string().min(32).optional()` env var.
- **Permission vocabulary:** `PERMISSION_SCOPES` (`src/lib/api-key-permissions.ts`) has the 5 tool
  resources (`portfolio`, `transactions`, `watchlist`, `goals`, `fx`) with a `read` action each,
  plus `ai: { actions: ['use'] }` — a **capability, not a resource**, deliberately absent from the
  tool `Scope` union. A key's `permissions` (Better-Auth shape `{ resource: [actions] }`) maps to
  tool scopes by: for each tool resource with `read` in its actions → `${resource}:read`.
- **Telemetry:** `AiToolCall` rows + the `runWithAiContext` / `aiContext` AsyncLocalStorage spine
  correlate calls; `AiSurface.MCP` and `functionId: 'mcp.tool'` are already in the schema.

## 4. Pinned dependencies (new)

- **`@modelcontextprotocol/sdk`** — the raw MCP TypeScript SDK. **NOT `mcp-handler`** (it peer-pins
  the SDK to the exact string `"1.26.0"` and hard-depends on `redis`, which was removed in #78).
  Pin the version literally.

**Standing rule (as with the AI SDK): the MCP SDK and protocol are moving — verify every API name
and shape against the shipped package before writing code.** In particular, two things MUST be
confirmed at implementation time and are the plan's first spike:
1. **The exact server API:** `McpServer` / `Server`, `registerTool` (name, `{ description,
   inputSchema, outputSchema, annotations }`, handler returning `{ content, structuredContent }`),
   and how a JSON Schema / zod schema is supplied.
2. **The Node-http ↔ Web-Request bridge (the #1 implementation risk).** `StreamableHTTPServerTransport`
   is written against Node's `IncomingMessage`/`ServerResponse`; a Next App-Router route handler
   receives a Web `Request` and returns a Web `Response`. The plan must resolve how the transport is
   fed the route's request (a Node-compat shim, the SDK's own fetch/Web transport if one exists, or
   reading the JSON-RPC body and driving the server directly) **before** the adapter work.

## 5. Architecture

```
External agent (Claude Code / Cursor)
   │  Authorization: Bearer <api-key>
   ▼
POST /api/mcp  (route.ts)                    [ENABLE_MCP flag; 404 when off]
   │  1. verifyMcpKey(bearer) → { userId, scopes }   (keyHmac O(1), timingSafeEqual, enabled/expiry)
   │  2. createToolCtx({ user:{id:userId} }, 'mcp', scopes)   ← explicit key scopes
   │  3. tools = buildToolset(ctx)                    ← per-key, read-only
   │  4. server = buildMcpServer(tools, ctx)          ← mcp.ts adapter: AppTool → registerTool
   │  5. stateless StreamableHTTPServerTransport handles the JSON-RPC request
   ▼
each tool call:  runWithAiContext(MCP, mcp.tool, userId, …) → tool.execute(input, ctx)
                 → AiToolCall telemetry row (no quota)
```

### 5.1 Endpoint & transport — `src/app/api/mcp/route.ts`
- `POST` (and `GET`/`DELETE` if the transport requires them for the stream) handler.
- `ENABLE_MCP` env flag (`z.boolean` / `"true"`-string): when off, return `404`. Keeps the surface
  dark until deliberately enabled.
- **Stateless** `StreamableHTTPServerTransport` (no session IDs / `sessionIdGenerator: undefined`,
  per the SDK's stateless mode) — each request is independent, which is also where the protocol is
  heading (§6). The transport construction + request handoff is isolated in this one file (the seam).
- **No** `/.well-known/oauth-protected-resource` route.

### 5.2 The adapter — `src/server/ai/tools/adapters/mcp.ts`
`buildMcpServer(tools: AppTool[], ctx: ToolCtx): McpServer` — for each tool, `server.registerTool`
with: the tool `name` (MCP tool names permit dots, so the **canonical dot form is used as-is** — no
underscore mapping like the AI SDK adapter needs); `description`; `inputSchema` (from the tool's zod
`inputSchema`); `outputSchema` (→ `structuredContent`); `annotations`. The handler closes over `ctx`
(so the caller cannot reach `userId`), runs `tool.execute(input, ctx)` inside `runWithAiContext`,
and returns the result as MCP `content` + `structuredContent`. Mirrors `toAiSdkTools`.

### 5.3 Auth — `verifyMcpKey(bearer: string): Promise<{ userId; scopes: Set<Scope> } | null>`
- Extract the bearer token from `Authorization`. Compute `HMAC-SHA256(token, AI_API_KEY_PEPPER)`,
  look up `ApiKey` by `keyHmac` (O(1), unique), compare with `timingSafeEqual`. Reject if missing,
  disabled, or expired. (Lazily backfill `keyHmac` on a legacy key's first successful verify, as the
  Phase 0 design specified.)
- Map the key's `permissions` to the tool `Scope` set (§3). Return `{ userId: key.userId, scopes }`.
- A missing/invalid key → `401`; a valid key with zero read scopes → authenticated but an **empty
  toolset** (not an error).

### 5.4 `createToolCtx` extension
`createToolCtx(session, surface, scopes?)` — `scopes` defaults to `ALL_READ_SCOPES` (chat's
behavior, unchanged), and the MCP route passes the key's scopes explicitly. `userId` still comes
only from the resolved key/session; `currency` still from `db.user.currency`.

### 5.5 Telemetry
Each tool call logs an `AiToolCall` (surface `MCP`, `functionId: 'mcp.tool'`, tool name, latency,
outcome) through the existing ledger + ALS spine — visible in the admin observability dashboard. **No
quota reservation** (no LLM spend). The tool-result token cap (`MAX_TOOL_RESULT_TOKENS`) still
applies (each tool already enforces it), bounding response size.

### 5.6 Security invariants (tested, not asserted)
1. `userId` comes only from the verified key — never from the request body or a tool argument.
2. The toolset is the key's own scopes ∩ read tools; a scoped key cannot reach a tool it lacks.
3. Read-only, full stop: `mutates` tools never register on MCP (`buildToolset` filter) — verified by
   a test that no registered tool has `mutates: true`.
4. Key comparison is constant-time (`timingSafeEqual` over the HMAC), not a string `===` or bcrypt
   loop (no timing oracle, no CPU-DoS).
5. Annotations are advertised as untrusted hints; enforcement is `requiredScope` + `buildToolset`.
6. `ENABLE_MCP` off ⇒ the endpoint does not exist (404), so the surface can't be probed by default.

## 6. The 2026-07-28 stateless-spec seam

The MCP spec revision on 2026-07-28 removes the `initialize` handshake and session IDs and replaces
elicitation; the TS SDK has not shipped support. We build to the **current** Streamable HTTP
transport (stateless-configured), which real clients speak today, and keep the transport construction
+ request handoff isolated in `route.ts`. Because Phase 2 is **read-only and stateless**, it depends
on none of the changing surfaces — the swap, when the new SDK lands, touches one file and no tool.

## 7. Testing

- **Unit (hermetic):**
  - `verifyMcpKey`: valid/invalid/disabled/expired key → correct `{userId, scopes}` / null; the
    `keyHmac` lookup + `timingSafeEqual` path; the permissions→scopes mapping (a `portfolio:read`-only
    key yields exactly `{portfolio:read}`).
  - `createToolCtx(…, scopes)`: honors the explicit scope set; still sources `userId` from the arg.
  - `mcp.ts` adapter: every read tool registers with the right name/description/schemas/annotations;
    **no `mutates` tool ever registers**; the handler closes over `ctx` (no `userId` argument).
  - An end-to-end JSON-RPC `tools/list` + `tools/call` over an **in-memory transport** (the SDK's
    in-memory pair) proving a scoped key lists/executes only its permitted tools and gets
    `structuredContent`.
  - Route: `ENABLE_MCP` off → 404; missing/invalid bearer → 401.
- **Real-client smoke (documented, manual):** connect Claude Code with a bearer key against a
  running instance; confirm the tools appear and return the caller's own data.

## 8. Client configuration (documentation deliverable)
A short doc / README section: enable `ENABLE_MCP`, mint an API key with the desired read scopes, and
the client config (the `/api/mcp` URL + `Authorization: Bearer <key>` header) for Claude Code,
Claude Desktop, and Cursor. Explicitly note the absence of OAuth is intentional.

## 9. Decisions
- **Build now to the current transport, thin seam** — real clients work today; the read-only tools
  depend on none of the 2026-07-28 changes. (User choice.)
- **Per-key least privilege** — the key's resource scopes govern the toolset; reuses the existing
  api-key permission vocabulary and enables narrow integration keys. (User choice.)
- **Log each MCP call** (`AiToolCall`, no quota) for observability. (User choice.)
- **Raw `@modelcontextprotocol/sdk`, bearer auth, no OAuth well-known, read-only, feature-flagged** —
  carried from the Phase 0 design.

## 10. Risks
- **The Node-http ↔ Web-Request transport bridge** (§4) is the primary unknown — resolved by a
  first-task spike before the adapter work; if the current SDK can't be bridged cleanly in a Next
  route handler, fall back to reading the JSON-RPC body and driving `McpServer` directly.
- **MCP SDK API drift** — mitigated by verifying names against the shipped package and by the
  in-memory-transport end-to-end test.
- **The 2026-07-28 spec change** — mitigated by the one-file transport seam and the read-only design.
- **Key-scope mapping mismatch** — a key created before the tool resources existed may have partial
  permissions; map defensively (unknown/absent resource ⇒ no scope) and test it.

## 11. Build order (for the plan)
1. **Spike:** install `@modelcontextprotocol/sdk`; confirm the server API + resolve the Node/Web
   transport bridge in a Next route handler (a trivial one-tool echo end-to-end). This de-risks §4.
2. `verifyMcpKey` + the permissions→scopes mapping + tests.
3. `createToolCtx(…, scopes)` extension + test.
4. `mcp.ts` adapter (`buildMcpServer`) + adapter/read-only/no-userId tests.
5. `POST /api/mcp` route (flag, auth, transport handoff) + route tests + the in-memory end-to-end.
6. MCP tool-call telemetry (`AiToolCall`, surface MCP) + test.
7. `ENABLE_MCP` env wiring; client-config docs; a real-client smoke.

## 12. Done when
- With `ENABLE_MCP` on, an external MCP client authenticated by a scoped bearer key can `tools/list`
  and `tools/call` the read tools its scopes permit, over `/api/mcp`, and receive the caller's own
  data as `structuredContent`.
- No mutating tool is ever reachable; a key cannot reach a tool outside its scopes; `userId` never
  comes from the client.
- Each call is logged (`AiToolCall`, surface MCP); no platform quota is spent.
- `ENABLE_MCP` off ⇒ 404. Key comparison is constant-time.
- `typecheck` + `biome` clean; unit + the in-memory end-to-end green; the advice-boundary eval is
  unaffected (MCP involves no LLM).

Related: `2026-07-13-ai-layer-phase0-design.md`, `2026-07-21-ai-layer-phase1-chat-design.md`.
