# Local InfluxDB Dev Helper — Design

**Date:** 2026-07-05
**Status:** Approved for implementation
**Author:** Panagiotis Karaliolios (with Claude)

## Summary

Add a standalone `./start-influxdb.sh` script that boots a local, fully
auto-provisioned **InfluxDB 2.x** container matching the `INFLUXDB_*` values
already present in `.env`. It is the structural twin of the existing
`./start-database.sh` (local Postgres helper), so that a developer can run
`bun run dev` against a local timeseries database with zero manual InfluxDB
setup.

## Motivation

The project ships a `./start-database.sh` dev helper for Postgres but has no
equivalent for InfluxDB. Today a contributor must supply an InfluxDB 2.x
instance (local or remote) themselves. `.env.example` already anticipates a
local Influx (`INFLUXDB_URL=http://influx:8086`, `INFLUXDB_ORG=local-org`,
`INFLUXDB_BUCKET=daily`, `INFLUXDB_TOKEN=local-secret-token`) but nothing in
the repo actually provisions one. This closes that gap by mirroring the
established Postgres pattern the maintainer already relies on.

## Requirements & Decisions

Locked during brainstorming:

- **Deliverable:** a standalone `./start-influxdb.sh` script — *not* a
  `docker-compose.yml` service. Matches the Postgres dev-helper pattern the
  user explicitly referenced.
- **`.env` handling:** **non-destructive**. The script reads
  `INFLUXDB_ORG/BUCKET/TOKEN` from `.env` and provisions the container to
  match them, but never edits the file. The developer points
  `INFLUXDB_URL` at `http://localhost:<port>` themselves; the script prints a
  reminder. This mirrors `start-database.sh`, which only rewrites the Postgres
  password when it is still the default and otherwise leaves the URL alone.

## Why InfluxDB 2.x specifically

`src/server/influx.ts` uses `@influxdata/influxdb-client@^1.35` with the
org/bucket/token/Flux model — that is the InfluxDB **2.x** API. The image is
therefore pinned to `docker.io/influxdb:2`. (Unlike `start-database.sh`, which
uses the unpinned `docker.io/postgres`, we cannot use unpinned `influxdb`:
`latest` resolves to InfluxDB 3.x, whose API and provisioning differ and would
break the 2.x client.)

## Behavior

Mirrors `start-database.sh` step-for-step:

1. `set -a; source .env` to import `INFLUXDB_URL/ORG/BUCKET/TOKEN`.
2. Derive the host listen **port** from `INFLUXDB_URL`. Strip the scheme,
   take the port component; default to `8086` when the URL has no explicit
   port (e.g. a remote `https://influx.example` URL).
3. **Validate config:** require `INFLUXDB_ORG`, `INFLUXDB_BUCKET`, and
   `INFLUXDB_TOKEN` to be non-empty. If any is missing, print a clear error
   naming the missing variable(s) and exit non-zero. (InfluxDB setup mode
   cannot provision without them.)
4. Detect `docker` or `podman` (`DOCKER_CMD`); error with install links if
   neither is present; verify the daemon is running.
5. Port-in-use check via `nc -z localhost <port>` when `nc` exists; when it
   does not, warn and prompt `[y/N]` to continue (identical fallback to the
   Postgres script).
6. Container name: `${INFLUXDB_BUCKET}-influxdb`.
   - If a container with that name is **running** → print a message, exit 0.
   - If it exists but is **stopped** → `start` it, print a message, exit 0.
7. Otherwise `run -d` in InfluxDB **setup mode** so the container comes up
   fully provisioned:
   - `DOCKER_INFLUXDB_INIT_MODE=setup`
   - `DOCKER_INFLUXDB_INIT_ORG=$INFLUXDB_ORG`
   - `DOCKER_INFLUXDB_INIT_BUCKET=$INFLUXDB_BUCKET`
   - `DOCKER_INFLUXDB_INIT_ADMIN_TOKEN=$INFLUXDB_TOKEN` (becomes the operator
     token, so the app's `INFLUXDB_TOKEN` works immediately)
   - `DOCKER_INFLUXDB_INIT_USERNAME` / `DOCKER_INFLUXDB_INIT_PASSWORD`
     default to `admin` / `admin-password`, overridable via optional
     `INFLUXDB_INIT_USERNAME` / `INFLUXDB_INIT_PASSWORD` env vars. Password is
     kept ≥8 chars, as InfluxDB setup mode requires.
   - `-p $PORT:8086`
   - image `docker.io/influxdb:2`
8. On success, echo a confirmation plus a reminder: for local dev, set
   `INFLUXDB_URL=http://localhost:$PORT` in your env (e.g. `.env.local`),
   because the script does not modify it. Note that InfluxDB takes a few
   seconds to finish first-run provisioning.

### Persistence

No named volume or bind mount — data persists across container **start/stop**
but is lost on container **removal**. This is intentional: it mirrors
`start-database.sh` exactly, and re-running the script recreates and
re-provisions cleanly.

## Documentation changes

- `README.md`:
  - Under **Prerequisites**, note that the InfluxDB 2.x instance can be
    provided by `./start-influxdb.sh` (parallel to the Postgres line).
  - Under **Setup steps**, add a step to run `./start-influxdb.sh` alongside
    the existing `./start-database.sh` step, including the reminder to point
    `INFLUXDB_URL` at `http://localhost:8086` for local dev.
  - Add `start-influxdb.sh` to the project file-tree listing next to
    `start-database.sh`.

No `package.json` script entry (the Postgres helper has none either — both are
run directly as `./start-*.sh`).

## Non-goals (YAGNI)

- No `docker-compose.yml` changes.
- No named volume / persistent data directory.
- No `.env` rewriting or `INFLUXDB_URL` auto-switching.
- No token auto-generation (the Postgres script's default-password flow is
  not replicated; a missing token is a hard error instead).

## Verification

- `bash -n start-influxdb.sh` (syntax) and shellcheck if available.
- Run `./start-influxdb.sh` with Docker available; confirm the container is
  `running`, port 8086 answers `GET /health` with `"status":"pass"`.
- With `INFLUXDB_URL=http://localhost:8086` (+ matching org/bucket/token),
  run an ingest (`bun run ingest:yahoo` or a small Flux query) and confirm the
  app reads/writes the local bucket.
- Re-run the script: confirm it detects the already-running container and
  exits 0 without recreating it. Stop the container, re-run: confirm it
  `start`s the existing one.
