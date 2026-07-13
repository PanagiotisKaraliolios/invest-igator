# Runbook: swapping Postgres to `pgvector/pgvector:0.8.5-pg16`

Applies to anyone with an **existing populated volume** (`pgdata`). A fresh install needs
none of this — just `docker compose up` and the migration runs.

## Why this is not a normal image bump

The old image was **musl** (alpine). `pgvector/pgvector:0.8.5-pg16` is **Debian/glibc**.
The Postgres major is identical (16), so `PGDATA` is binary-compatible and the new image
will start cleanly on the old volume. The danger is quieter: **libc provides the collation
for text sorting**, and musl and glibc do not sort identically. A btree index on a `text`
column built under musl and queried under glibc can return wrong results — with no error,
no warning in your app, and no crash.

Postgres knows this and records a collation version per database. After the swap it will
log `WARNING: database "investigator" has a collation version mismatch`. **That warning is
the only thing standing between you and silent index corruption. Do not ignore it.**

The fix is a `REINDEX`, and on a small database it takes seconds.

## Procedure

**1. Back up. Non-negotiable — this is the step you cannot redo.**

```sh
docker compose exec -T db pg_dump -U postgres -Fc investigator > investigator-pre-pgvector.dump
ls -lh investigator-pre-pgvector.dump   # a few KB means the dump failed; stop and fix it
```

**2. Stop the app, then stop the database.**

```sh
docker compose stop invest-igator scheduler
docker compose stop db
```

**3. Pull the new image and start the database on the SAME volume.**

```sh
docker compose pull db
docker compose up -d db
docker compose logs db | tail -20
```

Expect the cluster to start. A `collation version mismatch` warning here is **expected and
correct** — it is Postgres telling you exactly what step 4 is for.

**4. REINDEX, then refresh the recorded collation version.**

`REINDEX` cannot run inside a transaction block, which is why it is not in the Prisma
migration — Prisma wraps every migration in one, and a `REINDEX` there aborts it.

```sh
docker compose exec -T db psql -U postgres -d investigator -c 'REINDEX DATABASE investigator;'
docker compose exec -T db psql -U postgres -d investigator -c 'ALTER DATABASE investigator REFRESH COLLATION VERSION;'
```

Reindex **first**, refresh **second**. Refreshing first tells Postgres the indexes are fine
when they are not, and you lose the warning that would have told you they aren't.

**5. Start the app.** Its entrypoint (`docker/entrypoint.sh`) runs `prisma migrate deploy`
when `DATABASE_URL` is set, which applies `20260713120000_enable_pgvector`
(`CREATE EXTENSION IF NOT EXISTS vector`).

```sh
docker compose up -d
docker compose logs invest-igator | grep -i migrate
```

Note the entrypoint swallows migration failures (`|| echo "... Continuing."`), so a failed
`CREATE EXTENSION` will **not** stop the container. Do step 6 — do not assume.

**6. Verify.**

```sh
docker compose exec -T db psql -U postgres -d investigator \
  -c "SELECT extname, extversion FROM pg_extension WHERE extname = 'vector';"
```
Expect one row: `vector | 0.8.5`. **Zero rows means the migration failed silently** — read
`docker compose logs invest-igator` and fix it before moving on.

```sh
docker compose exec -T db psql -U postgres -d investigator \
  -c "SELECT datname, datcollversion FROM pg_database WHERE datname = 'investigator';"
docker compose logs db | grep -i 'collation version mismatch' || echo 'ok: no mismatch warning'
```
No mismatch warning on a fresh start = the swap is complete.

## Managed Postgres (RDS, Cloud SQL, Neon, Supabase…)

You are not changing images, so there is **no collation risk and no REINDEX** — skip steps
1–4. You only need the `vector` extension available. Most providers ship it; enable it in
their console, or run `CREATE EXTENSION vector;` as a superuser once. Then
`prisma migrate deploy` no-ops on the `IF NOT EXISTS`.

If your provider does not offer `vector`, migration `20260713120000_enable_pgvector` fails
with `permission denied to create extension "vector"`. Phase 0 adds **no vector columns**,
so nothing in the app breaks — but the migration is recorded as failed and will block
subsequent `migrate deploy` runs. Get the extension enabled, then
`bunx prisma migrate resolve --applied 20260713120000_enable_pgvector`.

## Rollback

Swapping back to the alpine image reintroduces the collation change **in the other
direction** and requires another `REINDEX DATABASE`. It is not free and it is not a
rollback. If the swap goes wrong, restore the step-1 dump into a fresh alpine volume.
