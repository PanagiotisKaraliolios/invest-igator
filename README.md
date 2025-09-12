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
