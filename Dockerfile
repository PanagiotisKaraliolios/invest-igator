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

ARG BUILD_DATABASE_URL=postgresql://postgres:postgres@localhost:5432/investigator
# Better Auth rejects secrets shorter than 32 chars; this build-time dummy is
# overridden by the real BETTER_AUTH_SECRET at runtime.
ARG BUILD_BETTER_AUTH_SECRET=build-time-dummy-secret-not-for-production
ENV DATABASE_URL=${BUILD_DATABASE_URL}
ENV BETTER_AUTH_SECRET=${BUILD_BETTER_AUTH_SECRET}

# Generate Prisma client
COPY prisma ./prisma
COPY prisma.config.ts ./prisma.config.ts
RUN bunx prisma generate

# Copy source and build Next.js
COPY . .
RUN SKIP_ENV_VALIDATION=1 \
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
	AZURE_OPENAI_RESOURCE_NAME=dummy \
	AZURE_OPENAI_API_KEY=dummy \
	AZURE_OPENAI_CHAT_DEPLOYMENT=dummy \
	AZURE_OPENAI_CHAT_MODEL=gpt-5.4-mini \
	AI_CRED_KEYS='{"k1":"aW52ZXN0LWlnYXRvci1idWlsZC1kdW1teS1rZXktMzI="}' \
	AI_CRED_ACTIVE_KID=k1 \
	AI_API_KEY_PEPPER=build-time-dummy-pepper-at-least-32-chars \
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
