# Frontend Agent Playbook

## App Router Basics
- Default to React Server Components in `src/app`. Mark files with `'use client'` only when you need state, effects, or browser APIs.
- Dashboard routes live under `src/app/(dashboard)` and use the shared shell (`layout.tsx`). Reuse the breadcrumb, sidebar, and theme switch components instead of duplicating headers.
- Public pages (landing/auth) should remain statically optimized when possible. Avoid dynamic rendering unless you require session data (`auth()`).

## Component Patterns
- Always prefer shadcn/ui primitives from `src/components/ui` (e.g., `Button`, `Card`, `Dialog`). Keep variants consistent and compose via `asChild` rather than nesting raw `<a>` tags.
- Extract shared widgets into `src/components/*` and colocate smaller helpers inside feature folders (e.g., `watchlist/_components`).
- When touching theming, route through `ThemeSwitch` and honor the cookie set by the server (`ui-theme`).
- Tables: Use TanStack Table v8 (`@tanstack/react-table`) for complex data tables. Define columns with `ColumnDef<T>[]`, use `useReactTable` hook with manual pagination/sorting, and render with `flexRender`. See `admin/_components/user-management-table.tsx` and `audit-logs-table.tsx` for reference.
- Date pickers: Use `DateRangePicker` from `src/components/ui/date-range-picker.tsx` with `strictMaxDate` prop to prevent future date selection. Component supports custom presets and disabled dates.
- Search inputs: Apply debouncing with `useDebounce` hook (300ms) from `src/hooks/use-debounce.ts` to reduce API calls and improve UX. Remove search buttons when using debounced auto-search.
- Loading states: Use `Skeleton` component from `src/components/ui/skeleton.tsx` for professional loading UX. Render multiple skeletons matching your data structure during loading.
- Sorting indicators: Use lucide-react icons (`ArrowUpDown` for unsorted, `ArrowUp`/`ArrowDown` for sorted). Conditionally hide `ArrowUpDown` when column is sorted: `{!header.column.getIsSorted() && <ArrowUpDown />}`.
- Active navigation: Menu items detect active state using `pathname.startsWith(item.url)`. Apply `isActive` prop to `SidebarMenuSubButton` for visual highlighting.

## Data Fetching
- Server components should call `auth()` or `api.*` helpers from `@/trpc/server`. Client components use hooks from `@/trpc/react`.
- Mutations must invalidate queries via `api.useUtils()`, mirroring the `watchlist` example (`utils.watchlist.list.invalidate()`).
- Use the `env` helper for any runtime configuration visible to the client. Never read from `process.env` in client components.

## Ads & Consent
- Only render ads through `<AdSlot>`; wrap placements with env checks like the landing page (`env.NEXT_PUBLIC_ADSENSE_SLOT_*`).
- Do not bypass `ConsentProvider`. If a feature depends on ad consent, check local storage via the provider state rather than reimplementing the logic.

## UX Guidelines
- Maintain responsiveness with Tailwind utility classes already in use (e.g., `md:grid-cols-2`). Follow the design language established on the landing page.
- Provide accessible labels and keyboard-friendly interactions. For dialogs, use Radix primitives and ensure triggers have `aria-label`s.
- Add `data-testid` attributes for new interactive elements that Playwright will exercise.

## Testing Hooks
- New forms or flows should expose stable selectors (`data-testid`) and surface validation errors via visible text for accessibility.
- Keep analytics and consent prompts unobtrusive in tests; rely on the shared Playwright fixture that seeds consent unless explicitly verifying the banner.
