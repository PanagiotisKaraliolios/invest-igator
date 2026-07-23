# MCP Server

Invest-igator exposes a read-only [Model Context Protocol](https://modelcontextprotocol.io) server
so external agents — Claude Code, Claude Desktop, Cursor, or any MCP-speaking client — can query a
user's own portfolio, transactions, watchlist, goals and FX data directly, without going through the
in-app chat. It is the same typed, user-scoped tool layer the chatbot uses (Phase 1); MCP is just
another surface over it.

- **Endpoint:** `POST /api/mcp` (the route also answers `GET`/`DELETE`, which the streaming
  transport needs — MCP clients treat it as a single HTTP server URL, not a REST API).
- **Auth:** a bearer API key, scoped to the exact data it may read.
- **Tools:** seven read-only tools, filtered per-key to the caller's own granted scopes.
- **Writes:** none. Every mutating operation is deliberately excluded from this surface (Phase 3).

## 1. Enable the server

The MCP endpoint is **off by default** — until configured, `POST /api/mcp` returns `404` regardless
of any credentials sent. Two server-side environment variables turn it on:

```bash
ENABLE_MCP=true
AI_API_KEY_PEPPER=<a secret, at least 32 chars>
```

Generate the pepper with:

```bash
openssl rand -base64 32
```

**Both are required, and the pepper matters even if you think you already set it for something
else.** `AI_API_KEY_PEPPER` is the HMAC pepper used to verify every bearer key presented to `/api/mcp`
(`HMAC-SHA256(token, pepper)`, looked up in O(1) and compared with a constant-time check). If
`ENABLE_MCP=true` but `AI_API_KEY_PEPPER` is unset, the endpoint exists but **authenticates no one at
all** — every request, valid key or not, is rejected with `401`. The server fails closed, never open:
there is no mode where MCP is reachable without both variables set.

## 2. Mint an API key with the read scopes you want to expose

MCP does not have its own key-management UI — it reuses the app's existing API keys, created from
**Account → API Keys**. When creating (or editing) a key, grant `read` on whichever of these five
resources you want an MCP client to be able to query:

- `portfolio`
- `transactions`
- `watchlist`
- `goals`
- `fx`

The key's granted `read` scopes become **exactly** its MCP toolset — least privilege by construction.
A key with only `portfolio: ['read']` can call `portfolio.structure` and `portfolio.performance` and
nothing else; a key with no read scopes at all authenticates fine but sees an empty tool list, not an
error. Write scopes, and any other resource (`account`, `admin`, `apiKeys`, `ai`), are ignored by
MCP — this surface is read-only no matter what a key is otherwise allowed to do elsewhere in the app.

**Already have an API key?** It works with MCP unmodified — nothing to re-mint. Keys created before
MCP shipped don't yet have the internal `keyHmac` field MCP's fast-path lookup uses; the first
successful MCP call backfills it transparently, and every call after that is the fast O(1) path. You
only need to *create a new key* if you want to grant it different (typically narrower) scopes than an
existing one already has.

## 3. Connect a client

Point your MCP client at `https://<host>/api/mcp` with an `Authorization: Bearer <key>` header. No
other configuration is required.

### Claude Code (CLI)

```bash
claude mcp add --transport http invest-igator https://<host>/api/mcp \
  --header "Authorization: Bearer <key>"
```

### Claude Desktop / Cursor (JSON config)

Both read an `mcpServers` object from their respective config file (Claude Desktop:
`claude_desktop_config.json`; Cursor: `mcp.json`). The shape for a remote HTTP MCP server is:

```json
{
  "mcpServers": {
    "invest-igator": {
      "type": "http",
      "url": "https://<host>/api/mcp",
      "headers": {
        "Authorization": "Bearer <key>"
      }
    }
  }
}
```

Replace `<host>` with wherever the app is deployed (`localhost:3000` for local dev) and `<key>` with
the API key from step 2. This is the canonical current form for both clients as of this writing —
**verify the exact field names (`type`, `headers` vs. an alternate key) against your installed
client's own docs**, since remote-MCP config has changed shape across client versions before and may
again.

## 4. What you get

Every tool is read-only and returns only the authenticated key's own user's data — a key can never
see another account's information, and `userId` is never taken from anything the client sends; it
comes solely from the verified key. The available tools, each gated by one scope from step 2:

| Tool | Required scope | Returns |
| --- | --- | --- |
| `portfolio.structure` | `portfolio:read` | Current holdings: symbol, quantity, average cost, latest price, market value, portfolio weight. |
| `portfolio.performance` | `portfolio:read` | NAV and time-/money-weighted return series over a trailing window. |
| `transactions.search` | `transactions:read` | The user's own buy/sell transactions, optionally filtered by symbol, side, date range. |
| `watchlist.list` | `watchlist:read` | Symbols on the user's watchlist, starred ones first. |
| `market.priceHistory` | `watchlist:read` | Daily price history for one symbol over a trailing window. |
| `goals.list` | `goals:read` | The user's financial goals: title, target amount/currency, target date. |
| `fx.rates` | `fx:read` | Latest FX rates from a base currency to every supported currency. |

Note `market.priceHistory` is gated by `watchlist:read`, not a separate scope — a key only needs
watchlist read access to pull price history for a symbol.

No mutating tool is ever reachable over MCP, regardless of what scopes a key holds — write access is
deliberately out of scope for this phase and is enforced at the same authorization point (`buildToolset`)
that filters tools by scope, not by client-side convention.

## 5. No OAuth — this is intentional

Unlike some remote MCP servers, this endpoint does **not** serve a
`/.well-known/oauth-protected-resource` discovery document, and there is no OAuth flow. This is a
deliberate design choice, not a gap to be filled in later: several MCP clients, when they see that
well-known response, abandon a manually configured `Authorization` header and try to force an OAuth
handshake instead — which this server does not implement and does not want to. Bearer API keys,
minted and scoped the same way as every other API key in the app, are the only supported
authentication method for MCP.

## 6. Observability

Every MCP tool call is logged as an `AiToolCall` row (surface `MCP`) through the same telemetry
pipeline the chat and cron surfaces use — tool name, latency, success/failure, correlated by request.
These calls show up in the admin AI observability dashboard (**Admin → AI**) alongside chat and
scheduled-agent activity.

Unlike chat, **MCP tool calls consume no platform LLM quota**. No LLM runs on the server for an MCP
request — the calling client (Claude Code, Desktop, Cursor, etc.) does its own reasoning and simply
invokes tools over the protocol. Only chat and any future agent surfaces that run a model in-process
spend quota; MCP is pure data access.

## Troubleshooting

- **`404 Not Found` on every request:** `ENABLE_MCP` is not `true` on the server. The endpoint does
  not exist until it is.
- **`401 Unauthorized` on every request, even with a key you know is valid:** `AI_API_KEY_PEPPER` is
  unset (or was rotated) on the server — see §1. Verify the key itself is `enabled` and unexpired in
  **Account → API Keys**.
- **Connects, but `tools/list` returns fewer tools than expected (or none):** the key's `read` scopes
  don't cover the resources you expect. Edit the key's permissions or mint a new one with the read
  scopes from §2.
