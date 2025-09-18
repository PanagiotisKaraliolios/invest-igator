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
- Email flows rely on `EMAIL_SERVER` and `EMAIL_FROM`. Reuse `sendVerificationRequest` instead of rolling new transport logic.
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
