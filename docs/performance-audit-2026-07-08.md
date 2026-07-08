# Invest-igator Performance Audit — Synthesis & Action Plan

_2026-07-08. Synthesized from six impact-verified investigation dimensions (server/DB, React rendering, data-fetching/caching, bundle/assets, caching-strategy, rendering-strategy). Every item is anchored to code that was read; each finding was adversarially impact-verified at this app's actual scale. Findings the verifier marked negligible or over-engineered are listed as "Considered and rejected."_

## 1. Why the app feels "clingy"

The sluggishness is not one bug. It is **three layers that all fire at the instant of a click**, plus smaller multipliers stacked on the same critical path.

### Layer A — Navigation is a full-page reload (framework-level regression)
The two primary in-app navigation surfaces render raw anchors instead of `next/link`:
- **Sidebar sub-items:** `nav-main.tsx:69` → `render={<a href={subItem.url} />}` (verified: no `next/link` anywhere in the file; contrast `nav-user.tsx:4` which imports Link correctly).
- **Breadcrumbs:** `breadcrumbs.tsx:75` → `<BreadcrumbLink href={c.href}>` with no `render` override, so `BreadcrumbLink` (`breadcrumb.tsx:29-41`, `useRender({defaultTagName:'a'})`) emits a plain `<a>`.

Every section switch (Portfolio ↔ Transactions ↔ Watchlist ↔ Admin) and every breadcrumb click therefore does a **full document teardown**: JS bundle re-parse, full re-hydration, loss of the React Query client cache, no router prefetch, a visible flash, and a from-scratch re-run of both layouts (including their session checks — Layer D). This is the most direct match to "sluggish, especially on navigation."

### Layer B — The pages you land on give zero feedback while blocking on the slowest compute
There is **no Suspense anywhere in `src/app`** and **no `loading.tsx` under `(dashboard)/`** (only the root `src/app/loading.tsx` exists — both verified). Because the dashboard layout persists across leaf navigations, the root `loading.tsx` never fires for these transitions. Meanwhile:
- `portfolio/page.tsx:16-20` is an async Server Component that `await`s `Promise.all([structure, performance({from:'1900-01-01'})])` **before returning any JSX**.
- `portfolio/structure/page.tsx:11` `await`s `api.portfolio.structure` the same way.

Result: clicking "Portfolio" produces a multi-second **frozen screen with no spinner** until the heavy compute resolves — worse UX than a spinner because the click appears not to register.

### Layer C — That compute is expensive and completely uncached
`portfolio.performance` (`portfolio.ts:79-369`):
- Seeds the price fetch, `buildFxByDate` (line 200), and the day-by-day `datesFull` loop (250-327) from **`inceptionDate`, never `input.from`** — `input.from` is only used at line 341 to slice the already-fully-computed array. So a "last 30 days" request costs the same as all-time.
- Runs an O(days × holdings) NAV/TWR/MWR loop plus multiple Influx range scans **on every RSC render**.
- Has **zero server-side cache** (verified: no `unstable_cache`/`revalidate` in these files). Client React Query `staleTime` does not apply because the RSC caller is a fresh server call, not the httpBatchLink client.
- The `/returns` page re-fires the full inception-to-date recompute on **every date-preset click** (`returns/page.tsx:69-72`).

This gets strictly worse every year the tracker accumulates history.

### Layer D — Smaller multipliers on the same request
- **Redundant session lookups:** `auth.api.getSession` is called unmemoized in root layout (`layout.tsx:57`) and dashboard layout (`(dashboard)/layout.tsx:14`), and a third, separately-cached time in the tRPC context (`trpc.ts:33`). With `cookieCache` disabled (`auth.ts:193-195`) each is a real Postgres round-trip → **2-3 serial session hits per render**.
- **Sequential awaits** that should be `Promise.all` in performance (148/200/216) and structure (416/417, 471/490).
- **Currency hook** fires an extra `router.refresh()` on mount for every `/returns` and `/structure` visit (`use-currency.ts:39-56`), forcing an avoidable extra RSC/session round-trip.
- **Transactions table** blanks to skeletons on every page/sort/filter/keystroke (no `keepPreviousData`), fires a server round-trip per keystroke (no debounce), and rides `httpBatchLink` so fast queries wait on the slowest batch member.

**Root-cause cross-reference:** Layers A + B + C compound at exactly the same moment — a nav click does a full reload (A), lands on a page with no loading UI (B), which blocks on an uncached full-history compute (C), after re-doing session checks (D). Fixing any one alone helps; fixing A+B+C together is what removes the "clingy" feel.

---

## 2. Prioritized recommendations

Ranked by impact ÷ effort. Quick wins (S effort) first where impact justifies.

| # | Change | Effort | Impact | Anchor |
|---|--------|--------|--------|--------|
| 1 | Sidebar `<a>` → `<Link>` | S | critical | nav-main.tsx:69 |
| 2 | Add `loading.tsx` to portfolio / structure / returns | S | high | portfolio/page.tsx:16-20 |
| 3 | Cache performance/structure via `unstable_cache` + `revalidateTag` | M | high | portfolio.ts:79-369, 387-529 |
| 4 | Window the performance compute to requested range | M | high | portfolio.ts:139-197, 341-358 |
| 5 | Breadcrumb `<a>` → `<Link>` | S | medium | breadcrumbs.tsx:75 |
| 6 | Dedupe `getSession` with `cache()` | S | medium | layout.tsx:57, (dashboard)/layout.tsx:14 |
| 7 | `Promise.all` independent I/O | S | medium | portfolio.ts:148/200/216, 416/417, 471/490 |
| 8 | `placeholderData: keepPreviousData` on tx table | S | medium | data-table.tsx:188-199 |
| 9 | `httpBatchLink` → `httpBatchStreamLink` | S | medium | trpc/react.tsx:53-61 |
| 10 | Enable React Compiler | S | medium | next.config.js:23 |
| 11 | Batch watchlist events/history Influx queries | M | medium | watchlist.ts:155-242, 309-339 |
| 12 | Server-prefetch the returns page | M | medium | returns/page.tsx:1, 69-72 |
| 13 | CurrencyProvider / stop extra `router.refresh()` | M | medium | use-currency.ts:39-56 |
| 14 | Explicit `staleTime` on watchlist queries | S | medium | watchlist-charts.tsx:135-150 |
| 15 | In-process TTL memo for FX matrix / latest closes | S | low | fx-history.ts:59-63, portfolio.ts:15-36 |
| 16 | Debounce tx search | S | low | data-table.tsx:366 |
| 17 | `useMemo` the watchlist symbols array | S | low | watchlist-charts.tsx:22-23 |
| 18 | Code-split /account tabs | M | low | profile-card.tsx:17, two-factor-card.tsx:11 |

### Suggested sequencing
1. **Sprint 1 (all S, ship together):** #1, #2, #5, #6, #7, #8, #9 — restores SPA navigation, adds loading feedback, removes redundant per-request work. This alone should eliminate most of the perceived "clingy" feel.
2. **Sprint 2:** #3 + #4 together (cache **and** window the one hot computation — do both so the cache miss is also cheap), #10 (React Compiler, gated on a full build + e2e pass).
3. **Sprint 3:** #11, #12, #13, #14, #15 — targeted latency/jank removal on watchlist/returns/structure.
4. **Opportunistic:** #16, #17, #18.

---

## 3. Detail on the structural items

### #3 Cache performance/structure (the Redis-free win)
Factor the body of `portfolio.performance` / `portfolio.structure` into a pure function of `(userId, currency, toIso)` and wrap in Next `unstable_cache` with `revalidate` ~900-3600s and tag `portfolio:${userId}`. Call `revalidateTag(\`portfolio:${userId}\`)` from every mutation that changes the inputs — `transactions` create/update/delete/import and `watchlist` add/remove — so edits appear immediately while idle navigation is served from the process-local Data Cache. **No Redis** (see §4). Caveat: wire `revalidateTag` into *every* mutation path to avoid staleness surprises.

### #4 Window the computation (do alongside #3)
`input.from` currently only slices the final array. Change the price fetch, `buildFxByDate`, and the `datesFull` loop to span `max(inceptionDate, from - lookback) → toDate` for the chart `points`. **Keep a separate always-inception path** only for the two inception-to-date totals (`totalReturnTwr`/`totalReturnMwr`) which are ITD by design — do not window those or you break their semantics.

### #6 Session dedup
```ts
// lib/auth.ts
export const getServerSession = cache(async () =>
  auth.api.getSession({ headers: await headers() }));
```
Use it in root layout, dashboard layout, admin sub-pages, and feed it into `createTRPCContext` so all calls within one render pass dedupe to one DB hit. (React `cache()`, not external infra — this is exactly its purpose.)

### #11 Batch watchlist N+1
`watchlist.events` runs 3 sequential Influx round-trips per symbol (up to 3N); `watchlist.history` runs 1 per symbol. The batched pattern already exists in the same codebase — `getLatestCloses` (`portfolio.ts:15-36`) uses one Flux query with an OR-joined symbol filter + `group(columns:['symbol'])`. Mirror it: one query per measurement, bucket rows by symbol client-side. (Common case is 5 symbols, not the 12 max, so realistic saving ~50-150ms — real but not the 1s+ the raw finding implied.)

### #13 Currency hook
Minimal fix (recommended first): in the mount effect compare the freshly-read cookie value against current `currency` and skip both the cookie-write and `router.refresh()` when they already match — this removes the redundant refresh per navigation. Fuller fix: hoist to a single `CurrencyProvider` in the dashboard layout so the header, returns page, and pie-allocation share one state and one `getCurrency` query (also fixes silent state drift). Note App Router layout persistence means at most 2 instances are ever live at once (header + current page), not 3.

---

## 4. Redis verdict — **No**

**Deployment reality:** one `invest-igator` Docker service, one Node/Bun process, cron via in-process Ofelia exec (`docker-compose.yml`). There is exactly one cache consumer. Redis's whole value — a store shared across instances — buys nothing here; it only adds an operational dependency, a failure mode, and connection/config overhead, without touching the real latency source (uncached/un-windowed computation on the request path).

**Lightest sufficient approach instead:**
1. **`unstable_cache`** (process-local Data Cache) for portfolio.performance/structure — keyed on `userId+currency+day`, `revalidate` 900-3600s, invalidated by `revalidateTag` on mutations (item #3).
2. **Plain module-level TTL `Map`/memo** for the global lookups `getFxMatrix` / `getLatestCloses` — identical for all users between the 1-2×/day ingest runs (item #15).
3. **React `cache()`** to dedupe `getSession` within a render pass (item #6).

**Revisit Redis only** if the app ever moves to a multi-instance / load-balanced deployment (it explicitly is not). If caching proves insufficient as history grows, the next step is **precompute a `daily_nav(userId, date, currency, nav, twrIndex, mwrIndex)` table via the existing cron** (turns requests into an indexed range SELECT) — still no external cache infra. This materialized-table approach was flagged by the verifier as **over-engineered as a first move** at current hobby scale; try caching + windowing first.

---

## 5. Considered and rejected (or deferred)

These are confirmed-real but the adversarial verifier rated them negligible-impact and/or over-engineered at this app's scale. Do not spend cycles here to fix "clingy."

| Finding | Why deprioritized |
|---------|-------------------|
| admin analytics 8 sequential queries (`admin.ts:213-358`) | Admin-only page, rarely viewed; negligible. Fold into a `Promise.all` opportunistically only. |
| Missing `@@index` on Session/Account.userId (`schema.prisma:38-72`) | Tables have a handful of rows; Postgres seq-scans them sub-ms. Cosmetic hygiene, not a perf fix. |
| getAllSymbols per-row `findFirst` (`financial-data.ts:180-218`) | Admin-only; genuine waste but low. Cheap fix (`_min:{createdAt}` in the groupBy) if touched anyway. |
| `session-lookup` cookieCache disabled (`auth.ts:193-195`) | Intentional freshness/security tradeoff; cost dwarfed by portfolio compute. Leave as-is. |
| Yahoo symbol-search no cache (`yahoo-search.ts`) | Human-paced, infrequent; negligible. Tiny TTL Map is nice-to-have, not priority. |
| `structure` `HydrateClient` no-op (`structure/page.tsx:17`) | Inert boilerplate, ~0 bytes; just delete the wrapper for clarity — do **not** wire up `useSuspenseQuery` (over-engineered here). |
| chart.tsx wildcard recharts import (`chart.tsx:4`) | No `optimizePackageImports` config even exists for recharts; recharts is `sideEffects:false` and every route already imports recharts primitives directly. Bundle saving rounds to zero. 3-line cleanup only if convenient. |
| Avatar raw `<img>` (`avatar.tsx:18`) | 32px cached sidebar icon; over-engineering to wrap in next/image. Skip. |
| `no-dynamic-import-anywhere` blanket adoption | Verifier flagged over-engineered: landing page is already route-split and off the hot path; splitting small dialog bodies adds waterfalls for KB. Only apply next/dynamic to heavy landing sections + the /account tabs (#18). |
| Unused embla/cmdk/vaul wrappers | Unimported → never bundled. Pure dead-code housekeeping, zero perf effect. |
| Root layout forces dynamic / kills landing ISR (`layout.tsx:54-58`) | Affects only the low-traffic marketing page, not dashboards. The only worthwhile bit — dedup the double `getSession` on `/` — is covered by #6. |
| `next-config optimizePackageImports` for recharts/framer/gsap | Low, uncertain payoff; modern bundler already tree-shakes these ESM packages. Add opportunistically, don't oversell. |
| Precomputed `daily_nav` table | Over-engineered as first move; do #3+#4 first, revisit only if cold-cache first load is still too slow. |
