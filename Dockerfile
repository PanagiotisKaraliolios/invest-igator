## Multi-stage Dockerfile for Next.js 15 + Prisma on Bun runtime

FROM oven/bun:1.3-debian AS base
WORKDIR /app

FROM base AS deps
# Ensure SSL certs and openssl are present for Prisma and fetch
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*

# Install dependencies with Bun
COPY package.json bun.lock* ./
# Ensure Prisma schema exists for postinstall prisma generate
COPY prisma ./prisma
RUN bun install --frozen-lockfile

FROM deps AS builder
WORKDIR /app

# Generate Prisma client
COPY prisma ./prisma
COPY prisma.config.ts ./prisma.config.ts
RUN --mount=type=secret,id=DATABASE_URL \
	DATABASE_URL=$(cat /run/secrets/DATABASE_URL) \
	bunx prisma generate

# Copy source and build Next.js
COPY . .
RUN --mount=type=secret,id=DATABASE_URL \
	--mount=type=secret,id=BETTER_AUTH_SECRET \
	SKIP_ENV_VALIDATION=1 \
	DATABASE_URL=$(cat /run/secrets/DATABASE_URL) \
	BETTER_AUTH_SECRET=$(cat /run/secrets/BETTER_AUTH_SECRET) \
	BETTER_AUTH_URL=http://localhost:3000 \
	NEXT_PUBLIC_SITE_URL=http://localhost:3000 \
	PASSWORD_PEPPER=build-time-dummy-pepper \
	EMAIL_FROM=dummy@localhost \
	EMAIL_SERVER=smtp://localhost:25 \
	INFLUXDB_URL=http://localhost:8086 \
	INFLUXDB_ORG=dummy \
	INFLUXDB_BUCKET=dummy \
	INFLUXDB_TOKEN=dummy-token \
	YAHOO_API_URL=https://query2.finance.yahoo.com/v8/finance \
	ALPHAVANTAGE_API_KEY=dummy \
	POLYGON_API_KEY=dummy \
	AUTH_DISCORD_ID=dummy \
	AUTH_DISCORD_SECRET=dummy \
	CLOUDFLARE_ACCESS_KEY_ID=dummy \
	CLOUDFLARE_ACCOUNT_ID=dummy \
	CLOUDFLARE_BUCKET_NAME=dummy \
	CLOUDFLARE_SECRET_ACCESS_KEY=dummy \
	bun run build

FROM oven/bun:1.3-debian AS runner
ENV NODE_ENV=production
WORKDIR /app

# System deps
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*

# Copy runtime artifacts
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/next.config.js ./next.config.js
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/prisma.config.ts ./prisma.config.ts
COPY --from=builder /app/src ./src
COPY --from=builder /app/tsconfig.json ./tsconfig.json

# Entrypoint to run migrations then start app
COPY docker/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

EXPOSE 3000
ENV PORT=3000

CMD ["/entrypoint.sh"]