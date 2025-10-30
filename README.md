<div align="center">

# 🔍 Invest-igator

**An opinionated personal investing tracker**

[![Next.js](https://img.shields.io/badge/Next.js-15-black?logo=next.js)](https://nextjs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-blue?logo=typescript)](https://www.typescriptlang.org/)
[![tRPC](https://img.shields.io/badge/tRPC-11-2596be?logo=trpc)](https://trpc.io/)
[![Prisma](https://img.shields.io/badge/Prisma-ORM-2D3748?logo=prisma)](https://www.prisma.io/)
[![Bun](https://img.shields.io/badge/Bun-Runtime-f9f1e1?logo=bun)](https://bun.sh/)

![Docker Image Size](https://img.shields.io/docker/image-size/mrdeathrider/invest-igator)


Built with Next.js App Router, tRPC v11, Prisma/PostgreSQL, shadcn/ui, and InfluxDB for fast timeseries. Auth is powered by Better Auth (Prisma adapter) with email/password, magic links, 2FA, and Discord OAuth.

[Getting Started](#-getting-started-local-dev) • [Features](#-features) • [Documentation](#-project-structure) • [Contributing](#-contributing)

</div>

---

## ✨ Features

- 📊 **Watchlist** with historical OHLCV from InfluxDB (AAPL, MSFT, etc.)
  - 📅 Date range filtering with customizable presets and max date constraints
  - 📈 Interactive charts with Recharts integration
- 💰 **Corporate events**: dividends, splits, capital gains
- 📈 **Transactions** with CSV import/export, duplicate detection, and FX-aware currencies
  - 🔄 Sortable columns with visual indicators
  - 🔍 Advanced filtering and search
- 🎯 **Portfolio analytics**: structure and performance calculations (TWR/MWR via tRPC)
- 🎪 **Goals tracking**: simple personal financial goals model
- 🎨 **Modern UI**: theming, toasts, and shadcn/ui + Recharts
  - ⚡ TanStack Table v8 for complex data tables
  - 🔎 Debounced search inputs (300ms) for better UX
  - 💀 Skeleton loading states for professional loading experience
  - 🎯 Active navigation indicators in sidebar
- 🔄 **Auto-sync**: Yahoo Finance ingestion job for OHLCV and events; FX rates via Alpha Vantage
- 🔐 **Admin interface**: comprehensive user management and audit logging
  - 👥 User management with sorting, filtering, and role-based permissions
  - 📋 Audit logs with date range filtering and action tracking
  - 📊 Statistics dashboard with user metrics
  - 🔍 Debounced search across users and logs
- 🔑 **API Keys**: programmatic access with granular permissions
  - 🎯 8 permission scopes (account, admin, apiKeys, fx, goals, portfolio, transactions, watchlist)
  - 📋 4 built-in templates (read-only, full-access, portfolio-manager, custom)
  - 🚦 Rate limiting and expiration controls
  - 🔒 SHA-256 hashed keys with secure generation
  - 📊 Usage tracking and management UI

## 🛠️ Tech stack

| Layer | Technology |
|-------|-----------|
| **Frontend** | Next.js 15 (App Router) • React 19 |
| **API** | tRPC v11 + React Query (RSC + CSR hydration) |
| **Database** | Prisma + PostgreSQL |
| **Auth** | Better Auth (email/password, magic link, 2FA, Discord) |
| **UI** | shadcn/ui + TailwindCSS 4 • TanStack Table v8 |
| **Charts** | Recharts |
| **Timeseries** | InfluxDB 2.x (`daily_bars` + event measurements) |

## 🏗️ Architecture (high level)

```mermaid
graph TB
    A[Client: React 19 + Next.js 15] --> B[tRPC v11]
    B --> C[API Routers]
    C --> D[Prisma ORM]
    C --> E[InfluxDB Client]
    D --> F[(PostgreSQL)]
    E --> G[(InfluxDB 2.x)]
    C --> H[Better Auth]
    H --> F
```

**Key components:**

- 📁 App Router under `src/app/*`; dashboard shell in `src/app/(dashboard)/layout.tsx`
- 🔌 tRPC routers in `src/server/api/routers/*`, composed in `src/server/api/root.ts`
- 🔐 Context includes `db` (Prisma) and `session` from Better Auth in `src/server/api/trpc.ts`
- ⚡ Influx helpers in `src/server/influx.ts`
- 📥 Yahoo ingestion in `src/server/jobs/ingest-yahoo.ts` with helpers in `yahoo-lib.ts`
- 🪝 Client hooks in `src/trpc/react.tsx`; RSC callers via `src/trpc/server.ts`

**Example API usage:**

```ts
// Server (RSC)
import { api } from "@/trpc/server";
const me = await api.account.getMe.query();

// Client (CSR)
import { api } from "@/trpc/react";
const { data } = api.watchlist.list.useQuery();
```

---

## 🚀 Getting started (local dev)

### Prerequisites

- ✅ Bun 1.0+
- ✅ Node 20+ (optional, Bun runs everything)
- ✅ A PostgreSQL 16 database (use `./start-database.sh`)
- ✅ An InfluxDB 2.x instance (local or remote)

### Setup steps

**1️⃣ Install dependencies**

```sh
bun install
```

**2️⃣ Create and fill `.env`**

See the [Environment variables](#-environment-variables) section below. For a smoke test you can set placeholders and use `SKIP_ENV_VALIDATION=1` while you iterate.

**3️⃣ Start Postgres (dev helper)**

```sh
./start-database.sh
```

**4️⃣ Generate and apply Prisma schema**

```sh
bun run db:generate
```

**5️⃣ Start the dev server**

```sh
bun run dev
```

🎉 **Open <http://localhost:3000>**

---

## 🔐 Environment variables

Validated in `src/env.js` via `@t3-oss/env-nextjs`. Server-side vars are required unless noted.

<details>
<summary><b>📋 Core application</b></summary>

- `DATABASE_URL`: Postgres connection URL (required)
- `BETTER_AUTH_SECRET`: Secret for Better Auth JWT/cookies (required in production)
- `BETTER_AUTH_URL`: Public base URL of the app (default: <http://localhost:3000>)
- `PASSWORD_PEPPER`: Extra pepper for hashing local passwords (required)
- `EMAIL_SERVER`: Nodemailer connection string (e.g. SMTP URI) (required)
- `EMAIL_FROM`: From address for transactional emails (required)
- `NEXT_PUBLIC_SITE_URL`: Public site URL exposed to client (default: <http://localhost:3000>)

</details>

<details>
<summary><b>🔑 Auth providers</b></summary>

- `AUTH_DISCORD_ID`, `AUTH_DISCORD_SECRET`: Discord OAuth credentials (required if enabling Discord)

</details>

<details>
<summary><b>💾 Data backends</b></summary>

- `INFLUXDB_URL` (default <http://localhost:8086>)
- `INFLUXDB_ORG`
- `INFLUXDB_BUCKET`
- `INFLUXDB_TOKEN`
- `DATABASE_URL` (Postgres, repeated for clarity)

</details>

<details>
<summary><b>🌐 External APIs</b></summary>

- `FINNHUB_API_URL` (default <https://finnhub.io/api/v1>)
- `FINNHUB_API_KEY` (required for search and symbol validation)
- `ALPHAVANTAGE_API_URL` (default <https://www.alphavantage.co/query>)
- `ALPHAVANTAGE_API_KEY` (required for FX ingestion)
- `YAHOO_CHART_API_URL` (default <https://query2.finance.yahoo.com/v8/finance/chart>)
- `POLYGON_API_URL`, `POLYGON_API_KEY` (present in schema; not currently required by code paths)

</details>

<details>
<summary><b>⚙️ Optional/infra</b></summary>

- `CLOUDFLARE_*` (R2 image storage wiring present; optional)
- `NEXT_PUBLIC_*` for Ads/Analytics (Umami/GA/AdSense) are optional and stubbed in E2E tests

</details>

> 💡 **Tip**: during early setup, export `SKIP_ENV_VALIDATION=1` to bypass strict checks until you've filled everything in.

---

## 🗄️ Database (Prisma)

| Command | Description |
|---------|-------------|
| `bun run db:generate` | Generate/apply in dev (migrate dev) |
| `bun run db:migrate` | Deploy migrations |
| `bun run db:push` | Push schema (no migrations) |
| `bun run db:studio` | Prisma Studio (defaults to port 5000) |

**Schema**: `prisma/schema.prisma`

**Relevant models**: `User`, `Account`, `Session`, `WatchlistItem`, `Transaction`, `FxRate`, `Goal`, `ApiKey` and Better Auth support tables `TwoFactor`, `Verification`, `VerificationToken`.

---

## 📊 Timeseries (InfluxDB)

| Measurement | Fields | Tags | Purpose |
|-------------|--------|------|---------|
| `daily_bars` | open, high, low, close, volume | symbol | OHLCV data |
| `dividends` | amount | symbol | Dividend events |
| `splits` | numerator, denominator, ratio | symbol | Stock split events |
| `capital_gains` | amount | symbol | Capital gain distributions |

**Helper code**: `src/server/influx.ts`

---

## 🔄 Ingestion jobs

### Yahoo Finance → InfluxDB

```sh
bun run ingest:yahoo
```

**What it does:**

- ✅ Reads distinct symbols from your `WatchlistItem`s
- ✅ Fetches full-range daily bars plus dividends, splits, capital gains
- ✅ Writes to Influx in batches with retries and gentle pacing (~2s/request)
- ✅ Also updates watchlist currency when available
- ✅ Adding a symbol to your watchlist triggers a background ingest for that symbol

### FX rates (Alpha Vantage)

```sh
bun run ingest:fx
```

**What it does:**

- ✅ Fetches pivoted rates through USD and upserts cross rates into `FxRate`

---

## 🧪 Running tests

E2E tests with Playwright:

```sh
# Install browsers once
bun run test:e2e:install

# Run headless
bun run test:e2e

# Run headed or with the UI
bun run test:e2e:headed
bun run test:e2e:ui
```

**Config**: `playwright.config.ts` (uses a built-in dev server unless `PW_SKIP_WEBSERVER=1`).

---

## ✅ Linting and typecheck

```sh
bun run check       # Biome
bun run typecheck   # TypeScript
```

---

## 🐳 Docker

### Build locally

```sh
docker build -t invest-igator:local .
```

### Run (minimum env)

```sh
docker run --rm -p 3000:3000 \
  -e DATABASE_URL=postgresql://user:pass@host:5432/db \
  -e BETTER_AUTH_SECRET=change-me \
  -e PASSWORD_PEPPER=change-me \
  -e EMAIL_SERVER=smtp://user:pass@mail:587 \
  -e EMAIL_FROM=no-reply@example.com \
  -e FINNHUB_API_KEY=... \
  -e ALPHAVANTAGE_API_KEY=... \
  -e INFLUXDB_URL=http://influx:8086 \
  -e INFLUXDB_ORG=... \
  -e INFLUXDB_BUCKET=... \
  -e INFLUXDB_TOKEN=... \
  invest-igator:local
```

### Docker Compose (App + Postgres + Scheduler)

This repo includes a Compose file that runs:

- `invest-igator`: the app container (published on port 3311)
- `db`: internal Postgres 16
- `scheduler`: Ofelia to run ingestion jobs inside the app container on a cron

**Quick start:**

```sh
cp .env.example .env  # if you have one; otherwise create .env from the vars above
# Fill DATABASE_URL, BETTER_AUTH_SECRET, PASSWORD_PEPPER, INFLUXDB_*, FINNHUB/ALPHAVANTAGE, EMAIL_*
docker compose up -d
```

**Notes:**

- ⚠️ Compose expects you to point `INFLUXDB_URL` to an existing Influx instance (not included in the stack)
- ⏰ Cron labels run `ingest-yahoo` daily at 02:15 UTC and `ingest-fx` at 06:00/18:00 UTC
- 🔄 Migrations run automatically on container start

**Stop and remove:**

```sh
docker compose down -v
```

---

## 📂 Project structure

```plaintext
.
├── prisma/
│   ├── schema.prisma          # 🗄️  Relational models (User, WatchlistItem, Transaction, etc.)
│   └── migrations/            # 📦 Schema migrations
├── src/
│   ├── server/
│   │   ├── api/
│   │   │   ├── root.ts        # 🔗 tRPC router composition
│   │   │   ├── trpc.ts        # ⚙️  Context, middleware, procedures
│   │   │   └── routers/       # 🧩 Feature routers (watchlist, transactions, admin, etc.)
│   │   ├── jobs/
│   │   │   ├── ingest-yahoo.ts  # 📈 Yahoo Finance ingestion job
│   │   │   ├── ingest-fx.ts     # 💱 FX rates ingestion job
│   │   │   └── yahoo-lib.ts     # 🛠️  Yahoo data helpers
│   │   ├── auth/
│   │   │   └── config.ts      # 🔐 Better Auth configuration
│   │   ├── db.ts              # 🗃️  Prisma client singleton
│   │   ├── influx.ts          # 📊 InfluxDB client & helpers
│   │   ├── fx.ts              # 💰 FX rate conversion utilities
│   │   └── r2.ts              # ☁️  Cloudflare R2 storage client
│   ├── app/
│   │   ├── (dashboard)/       # 🏠 Protected dashboard routes
│   │   │   ├── watchlist/     # 📊 Watchlist with charts and date filtering
│   │   │   ├── portfolio/     # 💼 Portfolio analytics
│   │   │   ├── transactions/  # 📈 Transaction management with sorting
│   │   │   ├── account/       # 👤 Account settings with API Keys tab
│   │   │   └── admin/         # 🔐 Admin section
│   │   │       ├── users/     # 👥 User management page
│   │   │       └── audit-logs/  # 📋 Audit logs page
│   │   ├── (auth)/            # 🔑 Auth routes (login, signup, verify-request)
│   │   ├── api/               # 🌐 API endpoints (tRPC, auth, email verification)
│   │   └── layout.tsx         # 🎨 Root layout with providers
│   ├── components/
│   │   ├── ui/                # 🧱 shadcn/ui primitives (incl. DateRangePicker, Skeleton)
│   │   ├── ads/               # 📢 AdSense integration
│   │   ├── consent/           # ✅ Cookie consent provider
│   │   └── theme/             # 🌓 Theme provider
│   ├── hooks/
│   │   ├── use-debounce.ts    # ⏱️  Debounce hook (300ms)
│   │   └── use-currency.ts    # 💱 Currency utilities
│   ├── trpc/
│   │   ├── react.tsx          # ⚛️  Client-side tRPC hooks
│   │   ├── server.ts          # 🖥️  Server-side tRPC helpers
│   │   └── query-client.ts    # 📡 React Query configuration
│   ├── lib/
│   │   ├── auth.ts            # 🔒 Better Auth instance
│   │   ├── api-key-permissions.ts  # 🔑 API key permission framework
│   │   ├── api-key-utils.ts   # 🔧 API key generation & validation
│   │   └── utils.ts           # 🔧 Utility functions (cn, etc.)
│   └── env.js                 # ✔️  Environment validation (@t3-oss/env-nextjs)
├── tests/
│   └── e2e/                   # 🧪 Playwright E2E tests
├── docker/
│   └── entrypoint.sh          # 🐳 Container startup script (migrations, server)
├── Dockerfile                 # 📦 Multi-stage build (deps, builder, runner)
├── docker-compose.yml         # 🐙 Compose stack (app, db, scheduler)
└── start-database.sh          # 🗄️  Dev Postgres script
```

**Quick pointers:**

- Dashboard shell: `src/app/(dashboard)/layout.tsx`
- Sidebar with active navigation: `src/app/(dashboard)/_components/app-sidebar.tsx`
- tRPC glue: `src/server/api/trpc.ts`, `src/trpc/react.tsx`, `src/trpc/server.ts`
- API key system:
  - Permission framework: `src/lib/api-key-permissions.ts`
  - Key utilities: `src/lib/api-key-utils.ts`
  - Router: `src/server/api/routers/api-keys.ts`
  - Middleware: `src/server/api/middleware/with-api-key.ts`
  - UI components: `src/app/(dashboard)/account/_components/api-keys-*.tsx`
- Admin routers with sorting: `src/server/api/routers/admin.ts`
- Table components (reference): `src/app/(dashboard)/admin/_components/user-management-table.tsx`, `audit-logs-table.tsx`
- Influx helpers: `src/server/influx.ts`
- Ingestion: `src/server/jobs/ingest-yahoo.ts`
- Example router: `src/server/api/routers/watchlist.ts`
- Reusable components: `src/components/ui/date-range-picker.tsx`, `src/components/ui/skeleton.tsx`
- Debounce hook: `src/hooks/use-debounce.ts`

---

## � API Keys

Invest-igator supports programmatic API access via API keys with granular permission control.

### Features

- 🎯 **8 permission scopes**: account, admin, apiKeys, fx, goals, portfolio, transactions, watchlist
- 📋 **4 built-in templates**:
  - `read-only`: Read access to all non-admin endpoints
  - `full-access`: Read + write + delete for all user resources
  - `portfolio-manager`: Portfolio, transactions, and goals management
  - `custom`: Build your own permission set
- 🚦 **Rate limiting**: Configure per-key request limits with automatic refills
- ⏰ **Expiration control**: Set expiry dates or create permanent keys
- 🔒 **Secure by design**: SHA-256 hashed keys, cryptographically secure generation
- 📊 **Management UI**: Create, view, and revoke keys from your account page

### Quick Start

1. **Create an API key**: Go to Account → API Keys tab and click "Create API Key"
2. **Select permissions**: Choose a template or create custom permissions
3. **Copy your key**: Save it securely - it's only shown once!
4. **Make requests**: Include `x-api-key` header in your API calls

### Example Usage

```bash
# Get your user profile
curl https://your-app.com/api/trpc/account.getMe \
  -H "x-api-key: your_api_key_here"

# Get FX rates matrix
curl https://your-app.com/api/trpc/fx.matrix \
  -H "x-api-key: your_api_key_here"

# List watchlist items
curl https://your-app.com/api/trpc/watchlist.list \
  -H "x-api-key: your_api_key_here"
```

### Documentation

- 📖 **[API Key Permissions](docs/api-key-permissions.md)**: Detailed permission system documentation
- 📖 **[API Key Usage Guide](docs/api-key-usage.md)**: Examples in cURL, JavaScript/TypeScript, and Python

---

## �🐛 Troubleshooting

| Issue | Solution |
|-------|----------|
| ❌ **Env validation failing at boot** | Set `SKIP_ENV_VALIDATION=1` temporarily and fill missing vars (see `src/env.js`) |
| ❌ **Prisma migrate errors** | Ensure Postgres is reachable; try `prisma migrate reset` in dev |
| ❌ **Influx writes fail** | Verify `INFLUXDB_URL/ORG/BUCKET/TOKEN` and token has write permissions |
| ❌ **Emails not sending** | Verify `EMAIL_SERVER` URI and that your provider allows SMTP from containers |
| ❌ **401s in tRPC** | Confirm cookies are set and `BETTER_AUTH_URL` matches your external origin |

---

## 🤝 Contributing

PRs are welcome! Before submitting:

✅ Run `bun run check` (Biome linting)  
✅ Run `bun run typecheck` (TypeScript)  
✅ Include/update E2E tests where relevant

**Quick demo dataset:**

Add a few symbols to your watchlist and run the Yahoo ingest job; the watchlist add flow also triggers a background ingest for that symbol.

## Star History

[![Star History Chart](https://api.star-history.com/svg?repos=PanagiotisKaraliolios/invest-igator&type=date&legend=top-left)](https://www.star-history.com/#PanagiotisKaraliolios/invest-igator&type=date&legend=top-left)
