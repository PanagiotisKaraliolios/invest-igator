## Multi-stage Dockerfile for Next.js 15 + Prisma on Bun runtime

FROM oven/bun:1.1-debian AS base
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
ENV SKIP_ENV_VALIDATION=1
WORKDIR /app

# Generate Prisma client
COPY prisma ./prisma
RUN bunx prisma generate

# Copy source and build Next.js
COPY . .
RUN bun run build

FROM oven/bun:1.1-debian AS runner
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
COPY --from=builder /app/src ./src
COPY --from=builder /app/tsconfig.json ./tsconfig.json

# Entrypoint to run migrations then start app
COPY docker/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

EXPOSE 3000
ENV PORT=3000

CMD ["/entrypoint.sh"]
