# Performance Improvements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate the "clingy" feel — restore client-side navigation, add loading feedback, cut redundant per-request work, and cache the one expensive portfolio computation (no Redis).

**Architecture:** Three sequential PRs off `main`. PR1 = navigation + per-request quick wins (low risk). PR2 = portfolio computation caching via Next Data Cache. PR3 = enable React Compiler. Each PR: implement → gates → push → CI → squash-merge on green → sync `main` → branch the next.

**Tech Stack:** Next.js 16.2 (App Router, Turbopack), React 19.2, tRPC 11 + @tanstack/react-query 5, Prisma 7 (Postgres), InfluxDB 2.x, Better Auth. Runtime/tests: Bun.

**Design doc:** `docs/superpowers/specs/2026-07-08-performance-improvements-design.md`
**Diagnosis:** `docs/performance-audit-2026-07-08.md`

## Global Constraints

- **Never commit to `main`.** Each PR is its own branch (`perf/pr1-navigation-quickwins` already exists for PR1; PR2/PR3 branch off `main` after the prior merges).
- **Gates per task/PR:** `bun test src` (bun:test) · `bun run typecheck` (tsc, exit 0) · `bun run check` (Biome — tabs width 4, single quotes, no trailing commas, line width 120, sorted object keys/JSX attributes) · `bun run build` (Turbopack; a Google-Fonts network flake can fail the build once — re-run a second time before treating it as real).
- **Biome formatting is enforced.** Object keys and JSX attributes are sorted alphabetically. Match the surrounding file's style exactly.
- **No behavior/output-shape changes** to tRPC procedures except where a task explicitly says so. PR2 must keep `portfolio.performance` and `portfolio.structure` returning the exact same object shape.
- **Push** via `git -c credential.helper='!gh auth git-credential' push`. **`gh`** via `GH_TOKEN=$(gh auth token) gh ...`.
- **Commit trailer:** end each commit message with `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>` and the `Claude-Session:` line.
- **PR body** ends with `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.
- This branch already contains the two docs (audit + design). Include them in PR1.

---

## PR 1 — Navigation & per-request quick wins

Branch: `perf/pr1-navigation-quickwins` (current).

### Task 1: Restore client-side navigation (sidebar + breadcrumbs)

**Files:**
- Modify: `src/app/(dashboard)/_components/nav-main.tsx` (add import; line ~69)
- Modify: `src/app/(dashboard)/_components/breadcrumbs.tsx` (line ~75)

**Why:** Both render raw `<a href>`, forcing a full document reload on every primary navigation. Switching to `next/link` restores App Router client transitions + prefetch. This does NOT change roles (`Link` still renders an `<a role="link">`), so no a11y/E2E role regression (contrast the earlier Button-as-link fix).

- [ ] **Step 1: Add the `next/link` import to `nav-main.tsx`**

Add to the import block (after the `next/navigation` import, keeping imports ordered as Biome expects):

```tsx
import Link from 'next/link';
```

- [ ] **Step 2: Swap the sidebar sub-item anchor for `Link`**

In `nav-main.tsx`, the `SidebarMenuSubButton`:

```tsx
// before
<SidebarMenuSubButton
	isActive={isSubItemActive}
	render={<a href={subItem.url} />}
>
// after
<SidebarMenuSubButton
	isActive={isSubItemActive}
	render={<Link href={subItem.url} />}
>
```

- [ ] **Step 3: Swap the breadcrumb link for `Link`**

`breadcrumbs.tsx` already imports `Link`? Verify; if not, add `import Link from 'next/link';`. Then:

```tsx
// before
<BreadcrumbLink href={c.href}>{c.label}</BreadcrumbLink>
// after
<BreadcrumbLink render={<Link href={c.href} />}>{c.label}</BreadcrumbLink>
```

`BreadcrumbLink` (`src/components/ui/breadcrumb.tsx:29`) already forwards `render` through `useRender({defaultTagName:'a'})`, so the rendered element stays `role="link"`.

- [ ] **Step 4: Gates**

Run: `bun run typecheck && bun run check && bun run build`
Expected: all pass. Then run the public-nav E2E smoke that already exists to confirm no link-role regression:
`bunx playwright test tests/e2e/landing.spec.ts tests/e2e/public-pages.spec.ts --project=Chromium`
Expected: pass (these assert `role="link"` on nav CTAs).

- [ ] **Step 5: Commit**

```bash
git add src/app/\(dashboard\)/_components/nav-main.tsx src/app/\(dashboard\)/_components/breadcrumbs.tsx docs/
git commit -m "perf(nav): use next/link for sidebar sub-items and breadcrumbs"
```

### Task 2: Add loading.tsx boundaries to heavy portfolio routes

**Files:**
- Create: `src/app/(dashboard)/portfolio/loading.tsx`
- Create: `src/app/(dashboard)/portfolio/structure/loading.tsx`
- Create: `src/app/(dashboard)/portfolio/returns/loading.tsx`

**Why:** No `loading.tsx` exists under `(dashboard)/`; the root one never fires because the dashboard layout persists across leaf navigations. These async Server Component pages freeze with no feedback until data resolves. A route-level `loading.tsx` renders instantly on navigation.

**Interfaces:**
- Consumes: existing `Skeleton` component at `@/components/ui/skeleton` (verify it exists; if the import path differs, use the project's skeleton primitive — grep `components/ui/skeleton`).

- [ ] **Step 1: Confirm the Skeleton primitive**

Run: `ls src/components/ui/skeleton.tsx && grep -n "export" src/components/ui/skeleton.tsx`
Expected: a `Skeleton` export. Use it; match its API.

- [ ] **Step 2: Create `portfolio/loading.tsx`**

Mirror the card grid of `portfolio/page.tsx` (two cards side by side):

```tsx
import { Skeleton } from '@/components/ui/skeleton';

export default function Loading() {
	return (
		<div className='space-y-6'>
			<Skeleton className='h-8 w-40' />
			<div className='grid grid-cols-1 gap-4 sm:grid-cols-2'>
				<Skeleton className='h-40 w-full' />
				<Skeleton className='h-40 w-full' />
			</div>
		</div>
	);
}
```

- [ ] **Step 3: Create `portfolio/structure/loading.tsx`**

```tsx
import { Skeleton } from '@/components/ui/skeleton';

export default function Loading() {
	return (
		<div className='space-y-6'>
			<Skeleton className='h-8 w-56' />
			<div className='grid grid-cols-1 gap-6 lg:grid-cols-2'>
				<Skeleton className='h-72 w-full' />
				<Skeleton className='h-72 w-full' />
			</div>
		</div>
	);
}
```

- [ ] **Step 4: Create `portfolio/returns/loading.tsx`**

```tsx
import { Skeleton } from '@/components/ui/skeleton';

export default function Loading() {
	return (
		<div className='space-y-6'>
			<Skeleton className='h-8 w-56' />
			<Skeleton className='h-9 w-72' />
			<Skeleton className='h-[360px] w-full' />
		</div>
	);
}
```

- [ ] **Step 5: Gates + commit**

Run: `bun run check && bun run typecheck && bun run build`
```bash
git add src/app/\(dashboard\)/portfolio/loading.tsx src/app/\(dashboard\)/portfolio/structure/loading.tsx src/app/\(dashboard\)/portfolio/returns/loading.tsx
git commit -m "perf(portfolio): add loading.tsx skeletons for heavy routes"
```

### Task 3: Deduplicate getSession with React cache()

**Files:**
- Create: `src/lib/auth/get-session.ts`
- Modify: `src/app/layout.tsx:57`
- Modify: `src/app/(dashboard)/layout.tsx:14`

**Why:** Root layout and dashboard layout each call `auth.api.getSession({ headers: await headers() })` in the same render pass — two Postgres round-trips (cookieCache is disabled). Wrapping in React `cache()` collapses them to one per request.

**Interfaces:**
- Produces: `getServerSession(): Promise<Session | null>` — argless, reads `next/headers` internally, memoized per request.

- [ ] **Step 1: Create the cached helper**

`src/lib/auth/get-session.ts`:

```ts
import { headers } from 'next/headers';
import { cache } from 'react';

import { auth } from '@/lib/auth';

/**
 * Per-request memoized session lookup. React cache() dedupes all calls within a
 * single RSC render pass to one DB round-trip (root layout + dashboard layout).
 */
export const getServerSession = cache(async () => auth.api.getSession({ headers: await headers() }));
```

- [ ] **Step 2: Use it in the root layout**

`src/app/layout.tsx`: replace `const session = await auth.api.getSession({ headers: await headers() });` with `const session = await getServerSession();`. Add `import { getServerSession } from '@/lib/auth/get-session';`. Remove the now-unused `headers` import IF nothing else in the file uses it (the file still uses `cookies` — keep that; check whether `headers` is used elsewhere and drop it only if unused).

- [ ] **Step 3: Use it in the dashboard layout**

`src/app/(dashboard)/layout.tsx`: replace the `getSession` call at line 14 with `const session = await getServerSession();`, add the import, and drop the now-unused `headers` import if nothing else uses it.

- [ ] **Step 4: Gates**

Run: `bun run typecheck && bun run check && bun run build`
Expected: pass. Then confirm auth still gates the dashboard:
`bunx playwright test tests/e2e --grep-invert @slow --project=Chromium` (or the auth/login spec if one exists — grep `tests/e2e` for a login/dashboard spec and run it).
Expected: unauthenticated → redirect to `/login` still works.

- [ ] **Step 5: Commit**

```bash
git add src/lib/auth/get-session.ts src/app/layout.tsx src/app/\(dashboard\)/layout.tsx
git commit -m "perf(auth): dedupe per-render getSession with React cache()"
```

### Task 4: Transactions table — keepPreviousData + debounced search

**Files:**
- Modify: `src/app/(dashboard)/transactions/_components/data-table.tsx` (imports; `symbol` state ~line 65; `useQuery` ~line 188; search `Input` ~line 366)

**Why:** The table has no `placeholderData`, so every page/sort/filter/keystroke drops `data` to undefined and flips ~100 rows to skeletons. And the search `Input` feeds `symbol` straight into the query key, firing a server round-trip per keystroke.

- [ ] **Step 1: Import `keepPreviousData`**

Add to the `@tanstack/react-query` import (create the import if none exists in this file):

```tsx
import { keepPreviousData } from '@tanstack/react-query';
```

- [ ] **Step 2: Add a debounced search value**

Near the existing `const [symbol, setSymbol] = useState('');` add a separate input-bound state and debounce it into `symbol`:

```tsx
const [symbolInput, setSymbolInput] = useState('');
useEffect(() => {
	const t = setTimeout(() => setSymbol(symbolInput), 300);
	return () => clearTimeout(t);
}, [symbolInput]);
```

Keep `symbol` as the value that flows into the query key. (`useEffect` is already imported — verify; add if missing.)

- [ ] **Step 3: Bind the search Input to the fast local state**

At the search `Input` (~line 366):

```tsx
// before
onChange={(e) => setSymbol(e.target.value)}
...
value={symbol}
// after
onChange={(e) => setSymbolInput(e.target.value)}
...
value={symbolInput}
```

- [ ] **Step 4: Add placeholderData to the list query**

In the `api.transactions.list.useQuery({...})` call, add a second argument (options) — note this query currently has no options object:

```tsx
const { data, isLoading, refetch, isFetching } = api.transactions.list.useQuery(
	{
		dateFrom: dateRange?.from ? dateRange.from.toISOString().slice(0, 10) : undefined,
		dateTo: dateRange?.to ? dateRange.to.toISOString().slice(0, 10) : undefined,
		page: pageIndex + 1,
		pageSize,
		side: side === 'ALL' ? undefined : side,
		sortBy,
		sortDir,
		symbol: symbol || undefined
	},
	{ placeholderData: keepPreviousData }
);
```

- [ ] **Step 5: Gates + commit**

Run: `bun run check && bun run typecheck && bun run build`
Then run the transactions E2E if one exists: `grep -rl transactions tests/e2e` and run any match on Chromium.
```bash
git add src/app/\(dashboard\)/transactions/_components/data-table.tsx
git commit -m "perf(transactions): keepPreviousData + debounced symbol search"
```

### Task 5: Streaming tRPC batch link

**Files:**
- Modify: `src/trpc/react.tsx:53`

**Why:** `httpBatchStreamLink` is imported but unused; `httpBatchLink` makes every query in a batch wait for the slowest member. Streaming flushes each result as it resolves.

- [ ] **Step 1: Swap the link**

In the `links` array, change `httpBatchLink({` to `httpBatchStreamLink({` (all other options identical). Remove `httpBatchLink` from the import if it becomes unused (keep `httpBatchStreamLink` and `loggerLink`).

- [ ] **Step 2: Gates + commit**

Run: `bun run check && bun run typecheck && bun run build`
```bash
git add src/trpc/react.tsx
git commit -m "perf(trpc): use httpBatchStreamLink for streamed batch responses"
```

### Task 6: Currency hook — stop refresh() on mount

**Files:**
- Modify: `src/hooks/use-currency.ts`

**Why:** The mount `useEffect` (lines 37-58) writes the cookie and fires `requestAnimationFrame(() => router.refresh())` on every mount, not just on a user-initiated change — forcing an avoidable RSC/session round-trip on every `/returns` and `/structure` visit. On a fresh mount the cookie already equals `currency` (state is initialized from it), so the write + refresh are pure waste.

**Interfaces:** No change to the hook's public return (`{ currency, mounted, setCurrency }`).

- [ ] **Step 1: Write the failing/behavioral guard**

Restructure so cookie-write + `router.refresh()` happen only when `currency` actually differs from the cookie. The mount pass sets `mounted` but must not refresh. Concretely, in the currency `useEffect`, read the current cookie and skip the persist/refresh block when it already matches `currency`:

```tsx
useEffect(() => {
	setMounted(true);
	if (skipNextPersistRef.current) {
		skipNextPersistRef.current = false;
		return;
	}
	// Skip the write+refresh when the cookie already reflects this currency
	// (true on initial mount, since state is initialized from the cookie).
	const currentCookie =
		typeof document !== 'undefined'
			? (document.cookie.match(/(?:^|; )ui-currency=([^;]+)/)?.[1] ?? null)
			: null;
	const cookieMatches = currentCookie ? decodeURIComponent(currentCookie) === currency : false;
	if (cookieMatches) {
		return;
	}
	if (isAuthenticated) {
		if (debounceRef.current) clearTimeout(debounceRef.current);
		debounceRef.current = setTimeout(() => {
			mutateRef.current(currency);
		}, 1000);
	}
	try {
		document.cookie = `ui-currency=${currency}; Path=/; Max-Age=${60 * 60 * 24 * 365}; SameSite=Lax`;
		requestAnimationFrame(() => router.refresh());
	} catch {}
	return () => {
		if (debounceRef.current) clearTimeout(debounceRef.current);
	};
}, [currency, isAuthenticated]);
```

Leave the second effect (remote-init at lines 60-72) as-is — it already sets `skipNextPersistRef` and only refreshes when the remote currency genuinely differs.

- [ ] **Step 2: Manual reasoning check**

Confirm: (a) initial mount with matching cookie → no refresh; (b) user calls `setCurrency('EUR')` → `currency` changes → effect runs → cookie differs → writes + refreshes once; (c) remote-init path unchanged.

- [ ] **Step 3: Gates + commit**

Run: `bun run check && bun run typecheck && bun run build`
```bash
git add src/hooks/use-currency.ts
git commit -m "perf(currency): only refresh on real currency change, not on mount"
```

### Task 7: PR1 finish — final review, push, PR, CI, merge

- [ ] Dispatch the final whole-branch code review for PR1 (most-capable model) using `scripts/review-package $(git merge-base main HEAD) HEAD`.
- [ ] Address Critical/Important findings (one fix subagent with the full list).
- [ ] Push branch; open PR titled `perf: navigation & per-request quick wins`; body summarizes Tasks 1-6 + links the audit/design docs; ends with the Claude Code line.
- [ ] Watch CI (Build, E2E, Migration Check, Type Check, Lint, CodeQL, gitleaks). Re-run a single Google-Fonts build flake once. Squash-merge on green. Delete branch. `git checkout main && git pull`.

---

## PR 2 — Portfolio computation caching

Branch off fresh `main`: `git checkout main && git pull && git checkout -b perf/pr2-portfolio-caching`.

### Task 8: Verify the Next.js cache API for 16.2

**Files:** none (research task; record findings in the PR2 branch's ledger note).

- [ ] Confirm the correct API on the installed Next version: `grep '"next"' package.json` and check whether `unstable_cache` is exported from `next/cache` in `node_modules/next` (`grep -r "unstable_cache" node_modules/next/dist/server/web/spec-extension/ 2>/dev/null | head` or check the Next 16 docs via Context7). Decide `unstable_cache` (no extra config) vs `'use cache'` (needs `cacheComponents`/`dynamicIO` flag). **Default: `unstable_cache`** unless the flag is already enabled. Record the choice; the rest of PR2 uses it.

### Task 9: Extract + cache computeFullSeries (portfolio.performance)

**Files:**
- Modify: `src/server/api/routers/portfolio.ts`
- Create: `src/server/portfolio-compute.ts` (extracted pure computation)
- Create: `src/server/portfolio-compute.test.ts`

**Why:** `performance` recomputes the full inception→today NAV/TWR/MWR chain from Influx+FX on every RSC render, uncached. Extract the expensive part to a function of `(userId, currency, todayIso)`, cache it (one entry serves `/portfolio` + all `/returns` presets), and parallelize its independent I/O.

**Interfaces:**
- Produces: `computeFullSeries(userId: string, currency: Currency, todayIso: string): Promise<{ full: { date: string; nav: number; twrIndex: number; mwrIndex: number }[]; unconvertedSymbols: string[] }>`.
- Consumes: `db` from `@/server/db`, plus the same Influx/FX helpers `performance` uses today.

- [ ] **Step 1: Write the equivalence test first (TDD)**

`portfolio-compute.test.ts`: seed a small deterministic set of transactions + a stub FX/price path (or run against the extracted pure loop with injected inputs). At minimum assert: given a fixed tx set and FX/price maps, `computeFullSeries` produces a `full` array whose last `twrIndex`/`mwrIndex` and length match the values the current inline computation produces. If fully stubbing Influx is impractical, extract the **pure day-loop core** (`buildFullSeries(txs, priceBySymbolDate, fxByDate, symbolCurrencies, latestTxCurrencyBySymbol, target)`) as a separately-unit-tested function and test that with hand-built maps; `computeFullSeries` then just does the I/O + calls it.

Run: `bun test src/server/portfolio-compute.test.ts` → expect FAIL (function not defined).

- [ ] **Step 2: Extract the computation**

Move the body of `performance` that builds `full[]` + `unconvertedSymbols` (lines ~97-338 of portfolio.ts — tx fetch through the day loop) into `computeFullSeries` in `portfolio-compute.ts`, importing `db`, `convertAmount`/`FxMatrix`/`MissingFxRateError` from `@/server/fx`, `buildFxByDate`/`getFxMatrix` from `@/server/fx-history`, and the Influx helpers. Keep the pure day-loop core as `buildFullSeries(...)` so the test in Step 1 covers it. **Parallelize** the independent post-tx I/O with `Promise.all`: after fetching `txs` and deriving `symbols`/`inceptionDate`/`latestTxCurrencyBySymbol` (all sync), run `[ price-rows Influx query, buildFxByDate(inception,today), db.watchlistItem.findMany(...) ]` concurrently. Compute `today` from the passed `todayIso` (do not read the clock inside the cached fn).

- [ ] **Step 3: Wrap in the Data Cache**

Export a cached wrapper:

```ts
import { unstable_cache } from 'next/cache';

export const getCachedFullSeries = (userId: string, currency: Currency, todayIso: string) =>
	unstable_cache(
		() => computeFullSeries(userId, currency, todayIso),
		['portfolio-full-series', userId, currency, todayIso],
		{ revalidate: 3600, tags: ['portfolio', `portfolio:${userId}`] }
	)();
```

- [ ] **Step 4: Rewire `performance` to slice the cached series**

In portfolio.ts `performance`, replace the extracted body with: derive `todayIso`/`fromDate`/`toDate` from input, call `const { full, unconvertedSymbols } = await getCachedFullSeries(userId, target, toLocalIsoDate(toDate));` then keep the existing slice/normalize/totals code (lines ~340-368) verbatim. Output shape unchanged. (Note: cache key uses `toIso` = `input.to`; `/portfolio` passes today, `/returns` passes its preset `to` — both slice the same-or-superset chain; if `input.to` < today the series is still correct since it's inception→to.)

- [ ] **Step 5: Gates**

Run: `bun test src && bun run typecheck && bun run check && bun run build`
Expected: the equivalence test passes; typecheck/biome/build clean.

- [ ] **Step 6: Commit**

```bash
git add src/server/portfolio-compute.ts src/server/portfolio-compute.test.ts src/server/api/routers/portfolio.ts
git commit -m "perf(portfolio): extract + cache inception-to-date series (performance)"
```

### Task 10: Extract + cache computeStructure

**Files:**
- Modify: `src/server/api/routers/portfolio.ts`
- Modify: `src/server/portfolio-compute.ts`

**Why:** Same uncached-recompute problem for `structure`; its output is small and directly cacheable.

**Interfaces:**
- Produces: `getCachedStructure(userId, currency, todayIso): Promise<{ items: ...; totalValue: number }>` (exact current `structure` return shape).

- [ ] **Step 1: Extract `computeStructure(userId, currency, todayIso)`**

Move the `structure` body (lines ~394-528) into `portfolio-compute.ts`, importing `db` directly. Parallelize the two independent I/O pairs with `Promise.all`: `[buildFxByDate(...), getFxMatrix()]` and `[db.watchlistItem.findMany(...), getLatestCloses(symbols)]`. Derive "today" from `todayIso`, not the clock.

- [ ] **Step 2: Wrap in the Data Cache** (mirror Task 9 Step 3, key `['portfolio-structure', userId, currency, todayIso]`, same tags).

- [ ] **Step 3: Rewire `structure`** to `return await getCachedStructure(userId, target, toLocalIsoDate(new Date()));`

- [ ] **Step 4: Gates + commit**

Run: `bun test src && bun run typecheck && bun run check && bun run build`
```bash
git add src/server/portfolio-compute.ts src/server/api/routers/portfolio.ts
git commit -m "perf(portfolio): extract + cache structure computation"
```

### Task 11: Invalidate the cache on mutations

**Files:**
- Modify: `src/server/api/routers/transactions.ts` (mutations: create ~101, importCsv ~270, importDuplicates ~599, remove ~800, update ~829)
- Modify: `src/server/api/routers/watchlist.ts` (add/remove mutations — grep for `.mutation(` to locate)

**Why:** With time-based `revalidate`, a just-added transaction wouldn't reflect until expiry. `revalidateTag` makes edits appear immediately.

- [ ] **Step 1: Add the invalidation helper**

In `portfolio-compute.ts`:

```ts
import { revalidateTag } from 'next/cache';

export function invalidatePortfolioCache(userId: string): void {
	revalidateTag(`portfolio:${userId}`);
}
```

- [ ] **Step 2: Call it at the end of each portfolio-affecting mutation**

In each transactions mutation and each watchlist add/remove mutation, after the DB write succeeds and before returning, call `invalidatePortfolioCache(ctx.session.user.id);`. Locate every `.mutation()` in transactions.ts (create/importCsv/importDuplicates/remove/update) and the add/remove in watchlist.ts. Do not add it to read-only procedures.

- [ ] **Step 3: Gates + commit**

Run: `bun test src && bun run typecheck && bun run check && bun run build`
```bash
git add src/server/portfolio-compute.ts src/server/api/routers/transactions.ts src/server/api/routers/watchlist.ts
git commit -m "perf(portfolio): revalidate cache on transaction/watchlist mutations"
```

### Task 12: In-process TTL memo for global FX/latest-close lookups

**Files:**
- Modify: `src/server/fx-history.ts` (memo `getFxMatrix`)

**Why:** `getFxMatrix()` hits Influx fresh every request for data identical across all users and unchanged for hours between ingest runs. A tiny module-level TTL memo removes pure latency at zero infra cost. (Latest-closes is user-scoped by symbol list — leave it to the per-user structure cache in Task 10 rather than a global memo.)

- [ ] **Step 1: Add a TTL memo around `getFxMatrix`**

Wrap the existing `getFxMatrix` body so a module-level `{ data, expiresAt }` cache (TTL ~600_000 ms) serves repeat calls; refetch when expired. Keep the same signature and return value.

```ts
let fxMatrixMemo: { data: FxMatrix; expiresAt: number } | null = null;
const FX_MATRIX_TTL_MS = 10 * 60 * 1000;

export async function getFxMatrix(): Promise<FxMatrix> {
	const now = Date.now();
	if (fxMatrixMemo && fxMatrixMemo.expiresAt > now) return fxMatrixMemo.data;
	const data = await /* existing computation */;
	fxMatrixMemo = { data, expiresAt: now + FX_MATRIX_TTL_MS };
	return data;
}
```

(If `Date.now()` is disallowed in this module for any reason, it is not — this is app runtime, not a workflow script.)

- [ ] **Step 2: Gates + commit**

Run: `bun test src && bun run typecheck && bun run check && bun run build`
```bash
git add src/server/fx-history.ts
git commit -m "perf(fx): in-process TTL memo for getFxMatrix"
```

### Task 13: PR2 finish — review, push, PR, CI, merge

- [ ] Final whole-branch review (most-capable model) via `scripts/review-package $(git merge-base main HEAD) HEAD`. Special attention: output-shape equivalence of performance/structure; every mutation path calls `invalidatePortfolioCache`; cache keys include currency+day; no clock reads inside cached fns.
- [ ] Fix Critical/Important findings (one fix subagent, full list).
- [ ] Push; PR `perf: cache portfolio computation (no Redis)`; body explains the caching design + invalidation; Claude Code line. Watch CI; squash-merge on green; delete branch; sync main.

---

## PR 3 — Enable React Compiler

Branch off fresh `main`: `git checkout main && git pull && git checkout -b perf/pr3-react-compiler`.

### Task 14: Enable React Compiler

**Files:**
- Modify: `next.config.js`

**Why:** Disabled on a stale Turbopack-incompatibility note; an isolated build verified `reactCompiler: true` compiles and builds clean on this stack. Gives automatic memoization across all client components. No Biome rule step (project uses Biome, not ESLint).

- [ ] **Step 1: Enable the flag**

In `next.config.js`, replace the commented line with an active `reactCompiler: true` inside the config object (Biome-formatted, key sorted). Remove the stale comment.

- [ ] **Step 2: Full build + E2E gate (this is the whole point)**

Run: `bun run typecheck && bun run check && bun run build`
Then the FULL Playwright suite (all projects) since the compiler changes client-render behavior app-wide:
`bunx playwright test`
Expected: all green. If any spec regresses, capture it, revert the flag, and escalate — do NOT merge a red E2E.

- [ ] **Step 3: Commit**

```bash
git add next.config.js
git commit -m "perf(build): enable React Compiler"
```

### Task 15: PR3 finish — push, PR, CI, merge

- [ ] Push; PR `perf: enable React Compiler`; body notes the earlier build verification + the full-E2E gate; Claude Code line. Watch CI (esp. E2E across all browsers). Squash-merge on green; delete branch; sync main.

---

## Self-Review notes
- Spec coverage: PR1 covers audit items #1,#2,#5,#6,#8,#9 (+ currency #13-minimal); PR2 covers #3,#7,#15 (+ #11 batching is NOT included — deferred as opportunistic; note in PR2 body); PR3 covers #10. Windowing #4 intentionally dropped (design doc §Decisions).
- #11 (watchlist events/history Influx batching) and #12 (returns server-prefetch) are **not** in this plan — they're medium/low and independent. Leave for a follow-up; mention in PR2 body as known-remaining.
- Type consistency: `computeFullSeries`/`getCachedFullSeries`/`computeStructure`/`getCachedStructure`/`invalidatePortfolioCache` names used consistently across Tasks 9-11.
