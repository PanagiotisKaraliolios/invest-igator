# Multi-instance readiness + deferred perf — Design

**Date:** 2026-07-09
**Follow-up to:** the 3-PR performance effort (`2026-07-08-performance-improvements-design.md`, PRs #74/#75/#76).
**Goal:** finish the two remaining Bucket-A latency wins, and make the app correct/efficient when scaled horizontally to multiple instances serving multiple users.

## Decisions (locked with user)

- **Portfolio cache → Postgres-backed shared cache.** PR2's per-process in-memory `Map` is only correct for a single instance. Replace it with a Postgres table so all instances share one store (read-your-writes across instances), invalidated by row delete on mutation. **No Redis** (fits the single-store-in-Postgres stance; Postgres is already shared infra).
- **`cookieCache` enabled, 60s.** Removes the per-request Postgres session lookup from most requests (the main per-request DB load that limits multi-user throughput). Tradeoff: revocation / role change / start-stop impersonation propagate within 60s — accepted.

## Scope

### PR-α — Bucket A latency wins (no schema change)
- **Watchlist `events` + `history` N+1 → batched Influx.** Replace the per-symbol query loops with one OR-filtered query per measurement (`events`: dividends/splits/capital_gains = 3 queries total; `history`: 1 query), bucketed by `symbol` client-side. Mirrors `getLatestCloses`. **Verify with a differential check against the live Influx** (per-symbol vs batched must return identical data) since there is no watchlist E2E.
- **`/returns` server prefetch.** Convert `returns/page.tsx` to an async server component that reads the `ui-currency` cookie, computes the default (month) preset's from/to, and `void api.portfolio.performance.prefetch(...)` inside `<HydrateClient>` — mirroring `structure/page.tsx`. The existing client UI moves to a child and reads the same query key; preset/currency changes still refetch.

### PR-β — Multi-instance readiness (schema changes → Prisma migrations)
- **`PortfolioCache` table** `(userId, currency, day, kind, payload Jsonb, computedAt)`, PK `(userId, currency, day, kind)`. `getCachedFullSeries`/`getCachedStructure` in `portfolio-compute.ts`: SELECT row → fresh hit returns `payload`; miss → compute → upsert → return. `computedAt` + a max-age guard (1h) backstops. `invalidatePortfolioCache(userId)` = `DELETE WHERE userId`; `invalidateAllPortfolioCache()` = `DELETE` all (admin currency change). Remove the in-process `Map`. `kind ∈ {'full','structure'}`.
- **`cookieCache`** in `src/lib/auth.ts`: `session.cookieCache = { enabled: true, maxAge: 60 }`.
  - **Security hardening (from PR-β review):** with the session served from a signed cookie, `session.user.role`/`banned` can be up to 60s stale — and `adminProcedure` trusted it. That gave a **≤60s privilege-retention window**: a just-demoted admin could still impersonate users, ban accounts, and read audit logs. Fixed by having `adminProcedure`/`superadminProcedure` (`api/routers/admin.ts`) re-read the **current** role + ban status from Postgres via `assertCurrentRole()`. Admin routes are rare, so this costs nothing at scale, and ordinary reads keep the full cookie-cache win.
  - Accepted, documented bound: an ordinary (non-admin) revoked/banned session remains valid for ≤60s. That is inherent to any session cache and is why `maxAge` is 60s, not the 5-minute default.
- **`@@index([userId])` on `Session` and `Account`** — FK columns with `onDelete: Cascade` and no index; helps cascade deletes / per-user listing as the tables grow. (Honest note: the auth hot path is session-by-`token`, already unique-indexed; this is hygiene, not the headline win.)

## Explicitly excluded (not multi-instance beneficial)
`getFxMatrix` per-process memo (tiny global read, 10-min TTL, eventually-consistent — fine per instance); Yahoo search cache; admin query parallelization; bundle/`optimizePackageImports`/`/account` split/avatar (client-download concerns, independent of instance count); precomputed `daily_nav` rows (the Postgres cache already gives multi-instance correctness; revisit only if cold compute gets slow).

## Cache hardening (from PR-β review)
- **`PAYLOAD_VERSION` in the row key** (`kind = 'full:v1'`). A persistent cache survives deploys, and `cached()` casts `row.payload` to `T` **unchecked** — so a payload-shape change would deserialize stale rows as the new type for up to the TTL. Versioning the key makes any shape change an automatic miss. Bump it whenever `FullSeries`/`StructureResult` changes shape or meaning.
- **Clamp `to` to today** in `portfolio.performance`. `to` was unvalidated: `to: '9999-12-31'` made the inception→to day loop (and the durable row it writes) effectively unbounded. Clamping is a no-op for every legitimate `to` (≤ today), so **computed values are unchanged**. _(A prefix-truncation design was tried and rejected: values are prefix-consistent, but `computeFullSeries(to=X)` ends at `X-1` under a pre-existing UTC-vs-local boundary artifact, so truncating would have silently shifted totals by a day.)_
- **Prune on write.** Nothing else reclaimed rows (the TTL only causes recompute-and-overwrite of the *same* key). Each cache write also deletes that user's rows older than the TTL — which is the only thing that ever cleans up old-`day`/old-`PAYLOAD_VERSION` rows for read-mostly users.
- **Log real cache failures.** Both `try/catch`es were silent, so a permanently failing upsert would degrade every request to the cold path forever with zero signal. Now the benign cross-instance `P2002` upsert race is ignored and everything else is logged.
- **Watchlist mutations deliberately still not invalidated.** The review suggested wiring them, but `add` never sets `currency` (not in its input; the upsert uses defaults) and `remove` is guarded against symbols that have transactions — so neither can change a portfolio input. Adding invalidation there would be dead code. The real gap is ingest-driven `WatchlistItem.currency` writes (separate process), which stay TTL-bounded.

## Notes / bounds
- The FX ingest + Yahoo ingest run as separate cron processes (Ofelia `job-exec`); they still can't clear the web instances' cache directly — but with the Postgres cache, invalidation is only needed on user mutations (handled). Nightly-ingest price freshness remains bounded by the day-key + 1h `computedAt` guard (same as before, now shared).
- `PortfolioCache.payload` for the full series is ~100–150 KB JSON; one indexed-row fetch per request is acceptable and shared. If it ever becomes a bottleneck, add a short-lived in-process L1 in front of the Postgres L2.

## Testing / gates
Per PR: `bun test src` · `bun run typecheck` · `bun run check` · `bun run build` · Docker build for the schema PR. Watchlist batching additionally gets a live-Influx differential check. Full E2E on CI (returns.spec covers the prefetch path).
