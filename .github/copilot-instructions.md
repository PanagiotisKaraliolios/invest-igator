# Copilot instructions for this repo

This is a Next.js App Router app (T3 stack) with tRPC v11, Prisma/PostgreSQL, NextAuth, and shadcn/ui. Use these conventions to move fast and avoid pitfalls.

## Architecture & Data Flow
- App Router structure under `src/app/` with a protected route group `(dashboard)` that renders a persistent sidebar/header via `src/app/(dashboard)/layout.tsx`.
- API: tRPC v11 routers in `src/server/api/routers/*`, composed in `src/server/api/root.ts`. Context (`db`, `session`, `headers`) is created in `src/server/api/trpc.ts`.
- Auth: NextAuth (JWT sessions) via `src/server/auth/config.ts` with Prisma adapter and providers (Email, Credentials, Discord). Dashboard pages guard on the server (`auth()` + redirect).
- Database: Prisma models in `prisma/schema.prisma` including NextAuth tables and domain models (`Post`, `WatchlistItem`). Access via `ctx.db` in tRPC.
- Client data: React Query + tRPC hooks via `src/trpc/react.tsx` (global provider in `src/app/layout.tsx`). RSC callers available in `src/trpc/server.ts`.
- UI: shadcn/ui components live in `src/components/ui/*`. Toasts are globally mounted (`<Toaster />`), theme is cookie based.

## Dev workflows
- Runtime: Bun is the primary runtime/package manager. Prefer `bun run <script>` (npm works too).
- Install & run:
  - DB: `./start-database.sh` (reads `DATABASE_URL` from `.env` and runs Postgres with Docker/Podman).
  - Prisma: `bun run db:generate` (dev migrations) or `bun run db:migrate` (deploy). For schema-only sync: `bun run db:push`.
  - App dev: `bun run dev` (alias: `bun dev`). Build: `bun run build`. Start: `bun run start`.
  - Checks: `bun run typecheck` (tsc) and `bun run check` (biome). Studio: `bun run db:studio`.
  - Tip: If you prefer npm, replace `bun run` with `npm run`—scripts are identical.
- Env: validated with `@t3-oss/env-nextjs` in `src/env.js`. Required server vars include: `DATABASE_URL`, `AUTH_*`, `AUTH_SECRET` (prod), `FINNHUB_API_KEY`, `PASSWORD_PEPPER`, and email provider vars.

## Conventions & patterns
- API routers:
  - Create a new file in `src/server/api/routers/` and export a router. Register it in `src/server/api/root.ts` under `appRouter`.
  - Use `publicProcedure` for unauthenticated, `protectedProcedure` when `ctx.session.user` is required.
  - Access DB via `ctx.db.*`. Return small, serializable payloads (SuperJSON is configured).
- Client usage:
  - From client components, import hooks via `import { api } from "@/trpc/react";` e.g., `api.something.list.useQuery()`.
  - From RSC, use `src/trpc/server.ts` (`api` + `HydrateClient`) to fetch and prehydrate.
- Routing & layouts:
  - Place dashboard pages under `src/app/(dashboard)/*`. The group layout already checks auth and renders the sidebar and breadcrumbs.
- Styling/UI:
  - Prefer shadcn/ui primitives from `src/components/ui/*` and lucide-react icons.
  - Toasts: use `import { toast } from "sonner";` – toaster is already mounted in the root layout.

## Prisma model notes
- `WatchlistItem` has a composite unique on `(userId, symbol)`. Upserts should account for this to avoid duplicates.
- When changing `schema.prisma`:
  - Dev: `npm run db:generate` to create a migration and update the client.
  - If drift blocks development, reset locally with `prisma migrate reset` (dev only).

## tRPC extension example
```ts
// src/server/api/routers/example.ts
import { createTRPCRouter, protectedProcedure } from "@/server/api/trpc";
import { z } from "zod";

export const exampleRouter = createTRPCRouter({
  list: protectedProcedure.query(async ({ ctx }) => {
    return ctx.db.post.findMany({ where: { createdById: ctx.session.user.id } })
  }),
  add: protectedProcedure.input(z.object({ name: z.string().min(1) })).mutation(async ({ ctx, input }) => {
    return ctx.db.post.create({ data: { name: input.name, createdById: ctx.session.user.id } })
  }),
});

// Then register in src/server/api/root.ts
// export const appRouter = createTRPCRouter({ ..., example: exampleRouter })
```

## Charts (shadcn + Recharts) pattern
- Use `ChartContainer` with a config whose keys match your series names. The container exposes CSS vars like `--color-<key>`.
- Example (two series):
```tsx
const chartConfig = {
  desktop: { label: "Desktop", color: "var(--chart-1)" },
  mobile: { label: "Mobile", color: "var(--chart-2)" },
} satisfies ChartConfig

<ChartContainer config={chartConfig} className="h-[250px] w-full">
  <AreaChart data={data}> {/* defs for gradients */}
    <defs>
      <linearGradient id="fillDesktop" x1="0" y1="0" x2="0" y2="1">
        <stop offset="5%" stopColor="var(--color-desktop)" stopOpacity={0.8} />
        <stop offset="95%" stopColor="var(--color-desktop)" stopOpacity={0.1} />
      </linearGradient>
    </defs>
    <Area dataKey="desktop" type="natural" fill="url(#fillDesktop)" stroke="var(--color-desktop)" />
  </AreaChart>
</ChartContainer>
```
- If your series keys contain special chars (e.g., `VUSA.L`), either sanitize for gradient IDs only or avoid CSS-var mapping and pass explicit hex colors to `stroke`/`stopColor`.

## External calls
- Do server-side fetches inside tRPC procedures. Example Finnhub base config comes from `env` (`FINNHUB_API_URL`, `FINNHUB_API_KEY`). Don’t expose secrets client-side.

## Where to look first
- Routing/layout: `src/app/(dashboard)/layout.tsx`
- Global providers: `src/app/layout.tsx`
- tRPC setup: `src/server/api/trpc.ts`, `src/trpc/react.tsx`, `src/trpc/server.ts`
- DB models: `prisma/schema.prisma`
- Auth config: `src/server/auth/config.ts`
- Example domain: `src/server/api/routers/watchlist.ts` (+ `src/app/(dashboard)/watchlist/*` UI)
