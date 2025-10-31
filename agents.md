# Invest-igator Agent Guide

## Purpose
Give any autonomous assistant the minimum context required to ship safe, on-brand contributions without rediscovering project norms.

## Stack Snapshot
- Next.js 15 App Router + React 19; prefer Server Components unless interactivity forces `'use client'`.
- Data flows through tRPC v11 (`src/server/api`) backed by Prisma/PostgreSQL for relational data and InfluxDB for time-series.
- Auth is handled by NextAuth (JWT) with Prisma adapter. Dashboard routes inside `src/app/(dashboard)` call `auth()` server-side and redirect if unauthenticated.
- UI primitives come from shadcn/ui in `src/components/ui`. Toasts via `sonner`, icons from `lucide-react`.

## Core Directives For Agents
- Respect environment boundaries. Read secrets via the `env` helper (`src/env.js`) and never inline them in code or logs.
- Use existing abstractions: tRPC procedures for server logic, React Query hooks for clients, shared components for UI. Prefer extending a router/component over creating parallel ad hoc calls.
- Match the consent + ads model. Ads render through `AdSlot`; never embed raw AdSense markup. Consent state lives in `ConsentProvider` and should gate any ad-related behavior.
- Keep watchlist/portfolio data consistent. Prisma enforces composite unique `(userId, symbol)` on watchlist items; mutations should use update/upsert patterns like the existing router.
- Maintain accessibility and testability. Add `aria-` labels where relevant and `data-testid` when a Playwright test needs a stable selector.
- Stay deploy-safe. Avoid Node APIs that break on Edge runtimes unless a file is explicitly server-only. Ensure new async work handles rejections and timeouts.

## Workflows & Tooling
- Package manager: Bun. Typical scripts live in `package.json` (`bun run dev`, `bun run build`, `bun run test:e2e`).
- Database: start Postgres via `./start-database.sh`, sync schema with `bun run db:generate` or `bun run db:push`.
- Linting: `bun run check` (Biome). Types: `bun run typecheck`.
- Tests: Playwright in `tests/e2e`. Use shared fixtures from `tests/e2e/fixtures.ts` to seed consent and keep selectors stable.

## Security & Compliance Notes
- Passwords use a pepper from `env.PASSWORD_PEPPER`; any auth changes must respect that scheme.
- Email flows rely on `EMAIL_SERVER` and `EMAIL_FROM`. Reuse the email utilities from `src/server/email.ts` (`sendVerificationEmail`, `sendPasswordResetEmail`, `sendMagicLinkEmail`) instead of rolling new transport logic.
- When touching ingestion jobs, be mindful of rate limits (Alpha Vantage backoff is built in). Never log raw API keys.

## When Adding Features
1. Model the data in Prisma (`prisma/schema.prisma`), migrate with Bun, and expose through a dedicated tRPC router or procedure.
2. Surface data in App Router pages via server calls (`api.*` helpers) and hydrate clients only when interactivity is needed.
3. For dashboards, plug into the existing `SidebarProvider` shell and keep cards responsive.
4. Add or update Playwright coverage if the feature affects user-critical flows (auth, dashboards, onboarding).
5. Document feature toggles or env requirements alongside the change (update `README.md` or create a scoped `agents.md`).

## High-Risk Areas
- `ConsentProvider` and ad loading: breaking the gating can violate policy.
- `src/server/api/trpc.ts`: altering timing middleware or context can affect every procedure.
- Prisma migrations: always validate locally before landing; destructive changes need explicit confirmation.
- InfluxDB queries: flux strings must sanitize user input to avoid injection.

## Additional Guides
Specialized instructions live under `docs/*/agents.md`:
- `docs/frontend/agents.md`
- `docs/server/agents.md`
- `docs/tests/agents.md`
Consult them before modifying those areas.

## Alignment With Copilot
This project also maintains `.github/copilot-instructions.md` for GitHub Copilot. Autonomous agents should mirror those conventions. Key alignments:
- API patterns: define procedures in `src/server/api/routers/*`, register in `src/server/api/root.ts`, use `publicProcedure` vs `protectedProcedure` appropriately, and rely on `ctx.db` for Prisma access. Expect timing middleware logs in `src/server/api/trpc.ts`.
- Server vs client usage: on the server, import from `@/trpc/server` (e.g., `HydrateClient`, `api` helpers). On the client, use hooks from `@/trpc/react` and invalidate via `api.useUtils()` after mutations.
- Charts: wrap Recharts with `ChartContainer` and provide a config whose keys match `dataKey`s; it exposes `--color-<key>` CSS vars. If a series key includes special characters (e.g., `VUSA.L`), sanitize IDs for gradients or pass explicit colors instead of relying on CSS vars. Use `DateRangePicker` with `strictMaxDate={true}` for date constraints.
- Tables: use TanStack Table v8 for complex data tables with sorting, filtering, pagination. Apply debouncing (300ms) to search inputs. Use `Skeleton` component for loading states. Server-side sorting via sortBy/sortDir parameters.
- Navigation: sidebar menu items use `pathname.startsWith()` for active state detection. Active items show visual indicators.
- External calls: keep third‑party fetches inside tRPC procedures; read all configuration from the `env` helper and never expose secrets to clients.
- Prisma specifics: `WatchlistItem` has a composite unique `(userId, symbol)`; use `upsert`/`update` patterns rather than catching unique violations.
- Testing: Playwright e2e lives in `tests/e2e`; add `data-testid` to interactive elements and prefer accessible roles for queries. Use the shared fixtures and keep selectors stable.
- Admin features: routes split into `/admin/users` and `/admin/audit-logs`. Both use TanStack Table with manual pagination, server-side sorting, debounced search, and skeleton loading.

If any discrepancy exists between this guide and `.github/copilot-instructions.md`, prefer the stricter rule or ask for clarification in a PR description.
