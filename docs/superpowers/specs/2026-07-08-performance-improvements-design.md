# Performance Improvements — Design

**Date:** 2026-07-08
**Source diagnosis:** [`docs/performance-audit-2026-07-08.md`](../../performance-audit-2026-07-08.md) (six-dimension, impact-verified audit)
**Goal:** Remove the "clingy"/sluggish feel — dominated by full-page reloads on navigation, no loading feedback on heavy routes, and an uncached full-history portfolio computation.

## Problem (one paragraph)

Sluggishness is three layers compounding at the instant of a click: (A) primary navigation renders raw `<a href>` instead of `next/link`, so every section switch is a full document reload; (B) the heaviest routes have no `loading.tsx`/Suspense, so they freeze with no spinner while an async Server Component awaits data; (C) `portfolio.performance`/`structure` recompute the entire inception-to-date NAV/TWR/MWR series from InfluxDB+FX on every visit with zero server-side caching. Smaller multipliers ride the same path: 2–3 redundant `getSession` DB hits per render, sequential awaits that should be parallel, a currency hook firing `router.refresh()` on every mount, and a transactions table that blanks to skeletons on every keystroke.

## Decisions (locked)

- **No Redis.** Single Docker container / single process → a shared cross-instance store buys nothing. Use the Next.js Data Cache (`unstable_cache`) + React `cache()` + in-process memo. Revisit only on a multi-instance deployment; if cold-load grows, precompute a nightly `daily_nav` table via the existing cron — still no external infra.
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
- Factor `portfolio.performance` into `computeFullSeries(userId, currency, todayIso)` (pure of `ctx` — imports `db`/Influx directly) returning `{ full, unconvertedSymbols }`; wrap in `unstable_cache([...], { tags: ['portfolio', \`portfolio:${userId}\`], revalidate: 3600 })`. Procedure slices to `[from,to]` + derives totals (unchanged output shape). **Parallelize** the independent post-tx I/O (price rows / `buildFxByDate` / `watchlistItem.findMany`) with `Promise.all` inside the extracted function.
- Factor `portfolio.structure` into `computeStructure(userId, currency, todayIso)` similarly (output is already small/cacheable), same tag.
- **Invalidation:** `revalidateTag(\`portfolio:${userId}\`)` from every input-changing mutation — `transactions` create (`:101`), importCsv (`:270`), importDuplicates (`:599`), remove (`:800`), update (`:829`), and watchlist add/remove — so edits appear immediately.
- **In-process TTL memo** (module-level `{data, expiresAt}`, ~10 min) for the global, user-independent `getFxMatrix()` and latest-closes lookups.
- Verify the current Next.js API surface (`unstable_cache` vs `'use cache'`) against installed Next 16.2 before implementing.

### PR 3 — Enable React Compiler
- `next.config.js`: uncomment/set `reactCompiler: true`, remove the stale Turbopack comment. Verify `bun run build` + full Playwright E2E green before merge.

## Testing / gates
Each PR: `bun test src` · `bun run typecheck` · `bun run check` (Biome) · `bun run build`. PR1 + PR3 additionally run the affected Playwright E2E (navigation, portfolio, transactions). PR2 adds unit coverage for the extracted `computeFullSeries`/`computeStructure` (equivalence to the pre-refactor output) and a cache-invalidation assertion.

## Out of scope (verifier-rejected / deferred)
Missing Session/Account `@@index` (tables tiny), admin-page query parallelization (rarely viewed), recharts wildcard-import micro-opt (~0 bytes), `/account` code-split (off hot path — opportunistic later), Yahoo-search cache (human-paced), materialized `daily_nav` table (only if cold-load grows). See the audit's §5.
