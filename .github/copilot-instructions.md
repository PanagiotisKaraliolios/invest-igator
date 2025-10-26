# Copilot instructions for this repo

Next.js App Router (T3-ish) with tRPC v11, Prisma/PostgreSQL, NextAuth, shadcn/ui, and InfluxDB for timeseries. Follow these project-specific notes to move fast.

## Stack & Architecture
- App Router under `src/app/*`; protected group `(dashboard)` renders persistent shell in `src/app/(dashboard)/layout.tsx`.
- API: tRPC routers in `src/server/api/routers/*`, composed in `src/server/api/root.ts`; context (`db`, `session`, `headers`) in `src/server/api/trpc.ts`.
- Auth: NextAuth (JWT) via Prisma adapter in `src/server/auth/config.ts`; dashboard pages gate on server (`auth()` + redirect).
- Data: Prisma models in `prisma/schema.prisma` for relational data; InfluxDB stores OHLCV in measurement `daily_bars` (tag: `symbol`) via job in `src/server/jobs/ingest-alpha.ts`.
- Client data: React Query + tRPC hooks from `src/trpc/react.tsx`; RSC callers via `src/trpc/server.ts` (`HydrateClient`).
- UI: shadcn/ui in `src/components/ui/*`; toasts via `sonner`; theme cookie-based.

## Dev Workflows
- Runtime: prefer Bun; scripts in `package.json`. Common: `bun run dev`, `bun run build`, `bun run start`.
- DB (Postgres): `./start-database.sh`, then `bun run db:generate` (dev) or `bun run db:migrate` (deploy); schema-only: `bun run db:push`; Studio: `bun run db:studio`.
- Lint/type: `bun run check` (biome), `bun run typecheck` (tsc).
- Ingestion (Alpha → Influx): `bun run ingest:alpha` (requires `ALPHAVANTAGE_*` and `INFLUXDB_*` env). Job skips symbols already present and backs off for free-tier limits.
- Env: validated in `src/env.js`. Required (server): `DATABASE_URL`, `AUTH_*`, `EMAIL_*`, `PASSWORD_PEPPER`, `FINNHUB_API_KEY`, `ALPHAVANTAGE_API_KEY`, `INFLUXDB_*` (URL/org/bucket/token), optional `POLYGON_*`.

## API Patterns
- Define routers in `src/server/api/routers/*` and register in `src/server/api/root.ts`.
- Use `publicProcedure` for open endpoints, `protectedProcedure` when `ctx.session.user` is required; DB access via `ctx.db.*`.
- Dev-only timing middleware adds a small delay and logs `[TRPC] <path> took Nms` (see `src/server/api/trpc.ts`).
- Server usage: `import { HydrateClient, api } from "@/trpc/server";` → `const data = await api.watchlist.list.query();`
- Client usage: `import { api } from "@/trpc/react";` → `api.watchlist.list.useQuery()`; RSC usage via `src/trpc/server.ts` helpers.

## Prisma & Models
- `WatchlistItem` has composite unique `(userId, symbol)`; use upsert patterns accordingly.
- After editing `schema.prisma`, run `bun run db:generate`; if dev drift blocks, use `prisma migrate reset` (dev only).

## UI Components & Patterns
- shadcn/ui in `src/components/ui/*`; toasts via `sonner`; theme cookie-based.
- Tables: Use TanStack Table v8 for complex data tables with sorting, filtering, and pagination. See `src/app/(dashboard)/admin/_components/user-management-table.tsx` and `audit-logs-table.tsx` for full implementation patterns.
- Date pickers: Use reusable `DateRangePicker` from `src/components/ui/date-range-picker.tsx` with `strictMaxDate` prop to enforce date constraints.
- Search inputs: Apply debouncing with `useDebounce` hook (300ms) from `src/hooks/use-debounce.ts` for better UX and reduced API calls.
- Sorting indicators: Use lucide-react icons (`ArrowUpDown` for unsorted, `ArrowUp`/`ArrowDown` for sorted columns). Hide `ArrowUpDown` when column is sorted.
- Loading states: Use `Skeleton` component from `src/components/ui/skeleton.tsx` for professional loading UX.
- Active navigation: Sidebar menu items show active state using `isActive` prop with `pathname.startsWith()` checks.

## Admin Features
- Admin routes split into `/admin/users` and `/admin/audit-logs` for better organization.
- Root `/admin` redirects to `/admin/users` as default landing page.
- User management: Full CRUD with role-based permissions, email search, sortable columns (email, name, role, createdAt).
- Audit logs: Filterable by date range, action type, admin/target email with debounced search.
- Both tables use TanStack Table with manual pagination, server-side sorting, and skeleton loading states.

## Charts (shadcn + Recharts)
- Wrap charts with `ChartContainer` and a config whose keys match `dataKey`s; container exposes `--color-<key>` CSS vars.
- If series keys contain special chars (e.g., `VUSA.L`), sanitize IDs for gradients or pass explicit colors to `stroke`/`stopColor` instead of CSS vars.
- Date filtering: Use `DateRangePicker` with `strictMaxDate={true}` to prevent future date selection. Watchlist charts use yesterday as max date with custom presets.

## External Calls
- Keep fetches server-side inside tRPC procedures; read base URLs/keys from `env` (e.g., `FINNHUB_*`, `ALPHAVANTAGE_*`, `POLYGON_*`). Never expose secrets client-side.

## Pointers
- Layout/shell: `src/app/(dashboard)/layout.tsx`; global providers: `src/app/layout.tsx`.
- Sidebar: `src/app/(dashboard)/_components/app-sidebar.tsx` with role-based navigation and active indicators.
- Navigation: `nav-main.tsx` uses `pathname.startsWith()` for active state detection on sub-items.
- tRPC glue: `src/server/api/trpc.ts`, `src/trpc/react.tsx`, `src/trpc/server.ts`.
- DB models: `prisma/schema.prisma`; Auth: `src/server/auth/config.ts`.
- Influx helpers: `src/server/influx.ts`; Ingest job: `src/server/jobs/ingest-alpha.ts`.
- Admin routers: `src/server/api/routers/admin.ts` with sorting params (sortBy/sortDir) for both users and audit logs.
- Table components: `src/app/(dashboard)/admin/_components/user-management-table.tsx` and `audit-logs-table.tsx` for reference implementations.
- Feature example: `src/server/api/routers/watchlist.ts` + `src/app/(dashboard)/watchlist/*`.


## Tests
- E2E: Playwright tests in `tests/e2e/*`; run with `bun run test:e2e` (headless) or `bun run test:e2e:headed` (headed).
- Test config: `playwright.config.ts` (e.g., timeouts, base URL).
- Always add `data-testid` attributes to interactive elements (buttons, inputs) for stable selectors.
- Test patterns: use `data-testid` attributes for stable selectors; prefer `getByRole` with name/label for accessibility-aligned queries.
- CI: GitHub Actions workflow in `.github/workflows/ci.yml` runs lint, typecheck, build, and e2e tests on pushes and PRs.

## Agent Alignment
For autonomous assistants (non-Copilot), follow `agents.md` at the repo root for norms and safety constraints. These Copilot notes and `agents.md` are intended to be consistent; if they diverge, prefer the stricter guidance and open a PR to reconcile.
