#!/usr/bin/env sh
set -e

# Run database migrations if DATABASE_URL is provided
if [ -n "$DATABASE_URL" ]; then
  echo "Running Prisma migrate deploy..."
  bunx prisma migrate deploy || echo "Prisma migrate deploy failed or no migrations to apply. Continuing."
else
  echo "DATABASE_URL not set; skipping migrations."
fi

# Start the Next.js server
exec bun run start
