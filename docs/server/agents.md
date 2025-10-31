# Server Agent Playbook

## tRPC Routing
- Implement new server capabilities as procedures inside `src/server/api/routers/*` and register them in `src/server/api/root.ts`.
- Use `publicProcedure` for anonymous access, `protectedProcedure` when `ctx.session.user` is required. Protected procedures guarantee a non-null session.
- Every procedure passes through the timing middleware; keep resolver work async-friendly and avoid long blocking tasks.

## Database Access
- Relational data lives in Prisma (`prisma/schema.prisma`). Access it via `ctx.db.*`. If you modify the schema, run `bun run db:generate` and include the migration.
- Honor existing unique constraints, especially `(userId, symbol)` on watchlist items. Handle conflicts with `update` or `upsert` patterns instead of swallowing errors.
- When deleting cascaded data (e.g., account removal), rely on Prisma relations configured in the schema rather than manual cleanup.

## Auth & Security
- Session context comes from NextAuth (`auth()` in `src/server/auth`). Do not bypass it; extend callbacks/config if you need new claims.
- Password operations must append `env.PASSWORD_PEPPER` before hashing or comparing (`bcrypt.compare(`${input}${pepper}`)`).
- Never leak secrets: log IDs and symbols, not raw tokens or API keys. Scrub external responses before returning to clients.

## External Services
- InfluxDB queries are assembled as Flux strings. Keep user-controlled values sanitized (uppercase, trimmed) and limit the result sets (see `watchlist.history`).
- Ingestion jobs live under `src/server/jobs`. If you add new providers, follow the backoff + dedupe patterns and reuse shared helpers.

## API Hygiene
- Validate all input with Zod. Keep schemas close to the procedure definition for readability.
- Surface actionable errors via `TRPCError` with appropriate codes (`UNAUTHORIZED`, `CONFLICT`, `BAD_REQUEST`). Clients expect these codes.
- Return plain JSON serializable data. Use `superjson` serialization only when necessary (already configured globally).

## Performance & Reliability
- Avoid unbounded loops or queries that could fan out across many symbols. Enforce safety limits like the existing `slice(0, 12)` guard.
- Wrap fire-and-forget async operations (e.g., ingestion triggers) in `void` with try/catch to prevent crashing request lifecycles.
- Consider rate limits and retries when calling third-party APIs. Use environment-configured URLs (`env.*`) to support staging setups.
