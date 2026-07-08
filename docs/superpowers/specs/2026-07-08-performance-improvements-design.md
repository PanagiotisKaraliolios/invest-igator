# Performance Improvements — Design

**Date:** 2026-07-08
**Source diagnosis:** [`docs/performance-audit-2026-07-08.md`](../../performance-audit-2026-07-08.md) (six-dimension, impact-verified audit)
**Goal:** Remove the "clingy"/sluggish feel — dominated by full-page reloads on navigation, no loading feedback on heavy routes, and an uncached full-history portfolio computation.

## Problem (one paragraph)

Sluggishness is three layers compounding at the instant of a click: (A) primary navigation renders raw `<a href>` instead of `next/link`, so every section switch is a full document reload; (B) the heaviest routes have no `loading.tsx`/Suspense, so they freeze with no spinner while an async Server Component awaits data; (C) `portfolio.performance`/`structure` recompute the entire inception-to-date NAV/TWR/MWR series from InfluxDB+FX on every visit with zero server-side caching. Smaller multipliers ride the same path: 2–3 redundant `getSession` DB hits per render, sequential awaits that should be parallel, a currency hook firing `router.refresh()` on every mount, and a transactions table that blanks to skeletons on every keystroke.

## Decisions (locked)

- **No Redis.** Single Docker container / single process → a shared cross-instance store buys nothing. Use a process-local TTL memo + React `cache()`. Revisit only on a multi-instance deployment; if cold-load grows, precompute a nightly `daily_nav` table via the existing cron — still no external infra.
  - _Implementation note (discovered during PR2):_ Next 16.2's `revalidateTag` type now **requires** a second `profile` arg (reoriented toward the Cache Components model), creating friction with the `unstable_cache` pairing. Since the deployment is single-container, a plain module-level `Map` TTL memo (keyed `userId::kind::currency::day`, 1h TTL, explicit per-user invalidation on mutation) is simpler, fully type-safe, and delivers the same benefit. Chosen over `unstable_cache`.
- **Cache the inception-to-date intermediate series, not per-range outputs.** `portfolio.performance` is refactored so the expensive part is `computeFullSeries(userId, currency, todayIso)` → the `full[]` inception chain, wrapped in `unstable_cache`. The procedure then slices/normalizes to the requested range cheaply. **One cache entry serves `/portfolio` and every `/returns` date preset**, because they all slice the same chain.
- **Drop audit item #4 (windowing the computation).** TWR/MWR are chain-linked from inception, so the Influx/FX read range cannot be safely shrunk for `/portfolio` (needs inception→today); the per-day JS loop is negligible next to the Influx reads, which caching already collapses to once/day. Windowing would help only a cold-cache visit that goes straight to a short `/returns` preset while never touching `/portfolio` — marginal, with real correctness risk to financial math.
- **React Compiler ships as its own PR**, gated on a full build + Playwright E2E pass, so a rendering regression is isolated and revertible. No ESLint rule step — the project lints with Biome (no react-compiler plugin); the babel plugin does its own bailout detection at build.
- **Three sequential PRs**, PR1 → PR2 → PR3, each watched through CI and squash-merged on green before the next branches off `main`.

## Scope by PR

### PR 1 — Navigation & per-request quick wins (low risk)
1. **Sidebar nav** — `nav-main.tsx:69`: `render={<a href={subItem.url} />}` → `render={<Link href={subItem.url} />}` (add `import Link from 'next/link'`). Restores client-side transition + prefetch on the most-used control.
2. **Breadcrumbs** — `breadcrumbs.tsx:75`: `<BreadcrumbLink href={c.href}>` → `<BreadcrumbLink render={<Link href={c.href} />}>` (`BreadcrumbLink` already forwards `render` via `useRender`).
3. **Loading boundaries** — add `loading.tsx` skeletons under `(dashboard)/portfolio/`, `/portfolio/structure/`, `/portfolio/returns/` (the root `loading.tsx` never fires for these because the dashboard layout persists).
4. **Session dedup** — new `getServerSession = cache(async () => auth.api.getSession({ headers: await headers() }))`; call it from root layout (`layout.tsx:57`) and dashboard layout (`(dashboard)/layout.tsx:14`). React `cache()` collapses the two same-render-pass lookups to one DB hit.
5. **Transactions table** — add `placeholderData: keepPreviousData` to `api.transactions.list.useQuery` so rows persist during page/sort/filter; debounce the symbol search (separate input state → ~300 ms → query key).
6. **Streaming tRPC** — `trpc/react.tsx:53`: `httpBatchLink` → `httpBatchStreamLink` (already imported).
7. **Currency hook** — `use-currency.ts`: stop firing `router.refresh()` on mount; only refresh on a user-initiated currency change.

_(Parallelizing the independent I/O in `performance`/`structure` is folded into PR 2, which already refactors those procedures — avoids editing the hot file twice.)_

### PR 2 — Portfolio computation caching
- Factor `portfolio.performance` into `computeFullSeries(userId, currency, todayIso)` (pure of `ctx` — imports `db`/Influx directly) returning `{ full, unconvertedSymbols }`; cache via the process-local TTL memo keyed `${userId}::full::${currency}::${todayIso}`. Procedure slices to `[from,to]` + derives totals (unchanged output shape). The pure day-loop core `buildFullSeries(...)` is split out and unit-tested. **Parallelize** the independent post-tx I/O (price rows / `buildFxByDate` / `watchlistItem.findMany`) with `Promise.all` inside the extracted function.
- Factor `portfolio.structure` into `computeStructure(userId, currency, todayIso)` similarly (output is already small/cacheable), keyed `${userId}::struct::…`.
- **Invalidation:** `invalidatePortfolioCache(userId)` (clears that user's memo entries by prefix) from every transaction mutation — `bulkDelete`/create/importCsv/importDuplicates/remove/update — so edits appear immediately. _Watchlist add/remove/star are intentionally NOT wired: `add` never sets currency (not in its input), `remove` is guarded to symbols with no transactions, and holdings come only from transactions — so none of them change a portfolio input. The authoritative `WatchlistItem.currency` is set by ingest/backfill jobs; the 1h TTL backstops those out-of-band changes._
- **In-process TTL memo** (module-level `{data, expiresAt}`, ~10 min) for the global, user-independent `getFxMatrix()` lookup. (Latest-closes stays inside the per-user structure memo.)
- **Not a pure extraction — a deliberate correctness fix (found in PR2 review):** the price carry-forward now seeds at **inception** (via the shared `forwardFill`), not at the caller's `from`. The old inline code seeded at `from`, which made the inception-to-date totals (`totalReturnTwr/Mwr`) silently depend on the chart range and degenerate to 0 on `/portfolio` (`from='1900-01-01'`) when the inception day had no price bar. Seeding at inception is correct and is what lets one cached series serve every range. Covered by a new `buildFullSeries` seed test.
- **Admin `updateSymbol` currency change** (`financial-data.ts`) now calls `invalidateAllPortfolioCache()` (in-process, affects many users). Out-of-process currency writes (Yahoo ingest, `currency:backfill`) and nightly price ingest are **not** cross-process invalidatable from the web server — their staleness is bounded by the 1h TTL (acceptable; daily-bar data). Documented, not a blocker.

### PR 3 — Enable React Compiler
- `next.config.js`: uncomment/set `reactCompiler: true`, remove the stale Turbopack comment. Verify `bun run build` + full Playwright E2E green before merge.

## Testing / gates
Each PR: `bun test src` · `bun run typecheck` · `bun run check` (Biome) · `bun run build`. PR1 + PR3 additionally run the affected Playwright E2E (navigation, portfolio, transactions). PR2 adds unit coverage for the extracted `computeFullSeries`/`computeStructure` (equivalence to the pre-refactor output) and a cache-invalidation assertion.

## Out of scope (verifier-rejected / deferred)
Missing Session/Account `@@index` (tables tiny), admin-page query parallelization (rarely viewed), recharts wildcard-import micro-opt (~0 bytes), `/account` code-split (off hot path — opportunistic later), Yahoo-search cache (human-paced), materialized `daily_nav` table (only if cold-load grows). See the audit's §5.
