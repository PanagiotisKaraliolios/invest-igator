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
- Client usage: `import { api } from "@/trpc/react";` → `api.watchlist.list.useQuery()`; RSC usage via `src/trpc/server.ts` helpers.

## Prisma & Models
- `WatchlistItem` has composite unique `(userId, symbol)`; use upsert patterns accordingly.
- After editing `schema.prisma`, run `bun run db:generate`; if dev drift blocks, use `prisma migrate reset` (dev only).

## Charts (shadcn + Recharts)
- Wrap charts with `ChartContainer` and a config whose keys match `dataKey`s; container exposes `--color-<key>` CSS vars.
- If series keys contain special chars (e.g., `VUSA.L`), sanitize IDs for gradients or pass explicit colors to `stroke`/`stopColor` instead of CSS vars.

## External Calls
- Keep fetches server-side inside tRPC procedures; read base URLs/keys from `env` (e.g., `FINNHUB_*`, `ALPHAVANTAGE_*`, `POLYGON_*`). Never expose secrets client-side.

## Pointers
- Layout/shell: `src/app/(dashboard)/layout.tsx`; global providers: `src/app/layout.tsx`.
- tRPC glue: `src/server/api/trpc.ts`, `src/trpc/react.tsx`, `src/trpc/server.ts`.
- DB models: `prisma/schema.prisma`; Auth: `src/server/auth/config.ts`.
- Influx helpers: `src/server/influx.ts`; Ingest job: `src/server/jobs/ingest-alpha.ts`.
- Feature example: `src/server/api/routers/watchlist.ts` + `src/app/(dashboard)/watchlist/*`.
