#!/usr/bin/env sh
set -e

# Run database migrations if DATABASE_URL is provided
if [ -n "$DATABASE_URL" ]; then
  echo "Running Prisma migrate deploy..."
  bunx prisma migrate deploy || echo "Prisma migrate deploy failed or no migrations to apply. Continuing."
  
  # Run database seeder (creates admin user if ADMIN_EMAIL is set)
  echo "Running database seed..."
  bun prisma/seed.ts || echo "Database seed failed or skipped. Continuing."
else
  echo "DATABASE_URL not set; skipping migrations and seed."
fi

# Start the Next.js server
exec bun run start
