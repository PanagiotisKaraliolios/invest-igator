# Invest-igator

Next.js App Router app (T3 stack) with tRPC v11, Prisma/PostgreSQL, NextAuth, shadcn/ui, and InfluxDB for timeseries storage.

## Dev quickstart

- Install deps: `bun install`
- Start DB (Postgres): `./start-database.sh`
- Apply Prisma schema: `bun run db:generate`
- Dev server: `bun run dev`

## Ingestion: Alpha Vantage → InfluxDB

This repo includes a job to ingest historical daily OHLCV bars from Alpha Vantage for symbols in your watchlist and write them into InfluxDB.

Prerequisites (env):

- `ALPHAVANTAGE_API_KEY`
- `ALPHAVANTAGE_API_URL` (default `https://www.alphavantage.co/query`)
- `INFLUXDB_URL` (default `http://localhost:8086`)
- `INFLUXDB_TOKEN`
- `INFLUXDB_ORG`
- `INFLUXDB_BUCKET`

Run the job:

```sh
bun run ingest:alpha
```

Notes:

- The job skips symbols that already have any data in the `daily_bars` measurement.
- Alpha Vantage free tier is rate-limited; the job backs off automatically and waits ~15s between symbols.
- Data source: TIME_SERIES_DAILY (outputsize=full).

## Tech stack

- Next.js 15 (App Router), React 19
- tRPC v11 + React Query
- Prisma + PostgreSQL + NextAuth
- shadcn/ui + TailwindCSS
- Recharts for charts
- InfluxDB for timeseries

## Docker

Build locally:

```sh
docker build -t invest-igator:local .
```

Run (set env vars appropriately):

```sh
docker run --rm -p 3000:3000 \
  -e DATABASE_URL=postgresql://user:pass@host:5432/db \
  -e AUTH_SECRET=change-me \
  -e AUTH_TRUST_HOST=true \
  -e PASSWORD_PEPPER=change-me \
  -e FINNHUB_API_KEY=... \
  -e ALPHAVANTAGE_API_KEY=... \
  -e INFLUXDB_URL=http://influx:8086 \
  -e INFLUXDB_ORG=... \
  -e INFLUXDB_BUCKET=... \
  -e INFLUXDB_TOKEN=... \
  invest-igator:local
```

CI/CD (Docker Hub):

- Add repository secrets: `DOCKERHUB_USERNAME`, `DOCKERHUB_TOKEN`.
- Push to `main` to build and push `${DOCKERHUB_USERNAME}/invest-igator:latest` and a `sha` tag.

### Compose (App + Postgres + InfluxDB)

Quick start:

```sh
cp .env.example .env
# Fill in AUTH_SECRET, PASSWORD_PEPPER, INFLUXDB_* values in .env
docker compose up -d --build
```

This starts:

- `db`: Postgres 16 on an internal network
- `influx`: InfluxDB 2.x with provided org/bucket/token
- `app`: Next.js app at <http://localhost:3000>, running migrations before start

Stop and remove:

```sh
docker compose down -v
```

Run the Yahoo ingest job (one-off):

```sh
# Using compose service
docker compose run --rm ingest-yahoo

# Or directly with the built image
docker run --rm --network=host \
  --env-file .env \
  -e DATABASE_URL=postgresql://postgres:postgres@localhost:5432/investigator \
  -e INFLUXDB_URL=http://localhost:8086 \
  invest-igator:local \
  bun run src/server/jobs/ingest-yahoo.ts
```
