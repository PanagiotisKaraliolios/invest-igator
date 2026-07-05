# Local InfluxDB Dev Helper Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a standalone `./start-influxdb.sh` dev helper that boots a local, auto-provisioned InfluxDB 2.x container matching the `INFLUXDB_*` values in `.env`, mirroring `./start-database.sh`.

**Architecture:** A single Bash script sources `.env`, validates the InfluxDB settings, derives the host port from `INFLUXDB_URL`, and runs `docker.io/influxdb:2` in setup mode so the container comes up pre-provisioned with the org/bucket/admin-token from `.env`. It is non-destructive (never edits `.env`) and structurally parallel to the existing Postgres helper. README is updated to document the new step.

**Tech Stack:** Bash, Docker/Podman, InfluxDB 2.x (`docker.io/influxdb:2`).

## Global Constraints

- Image pinned to `docker.io/influxdb:2` — never unpinned/`latest` (that resolves to 3.x and breaks the `@influxdata/influxdb-client@1.35` 2.x client).
- Non-destructive: the script MUST NOT modify `.env` or any env file.
- Mirror `./start-database.sh` structure and messages where applicable (docker/podman detection, daemon check, `nc` port check with prompt fallback, running/stopped container short-circuits).
- No named volume (data persists across container start/stop only), no `docker-compose.yml` changes, no `package.json` entry.
- Config source of truth is `.env`: `INFLUXDB_URL`, `INFLUXDB_ORG`, `INFLUXDB_BUCKET`, `INFLUXDB_TOKEN`.

---

### Task 1: `start-influxdb.sh` script

**Files:**
- Create: `start-influxdb.sh` (repo root)
- Reference (do not modify): `start-database.sh` (pattern to mirror)

**Interfaces:**
- Consumes: `.env` variables `INFLUXDB_URL`, `INFLUXDB_ORG`, `INFLUXDB_BUCKET`, `INFLUXDB_TOKEN`; optional overrides `INFLUXDB_INIT_USERNAME`, `INFLUXDB_INIT_PASSWORD`.
- Produces: a running container named `${INFLUXDB_BUCKET}-influxdb` listening on the derived port (default `8086`), provisioned with org=`$INFLUXDB_ORG`, bucket=`$INFLUXDB_BUCKET`, operator token=`$INFLUXDB_TOKEN`.

> Note on TDD: this is a provisioning shell script, not a unit — there is no
> test framework in this repo for Bash. The "test cycle" is: syntax check
> (`bash -n`), then a functional boot + health + idempotency check. Those are
> the failing→passing gates below.

- [ ] **Step 1: Write the script**

Create `start-influxdb.sh` with exactly this content:

```bash
#!/usr/bin/env bash
# Use this script to start a local development InfluxDB 2.x container.
#
# It mirrors ./start-database.sh: it reads the INFLUXDB_* values from your
# .env and boots a container provisioned to match them, so `bun run dev` can
# talk to a local timeseries database with no manual InfluxDB setup.
#
# TO RUN ON WINDOWS: see the notes in ./start-database.sh (install WSL +
# Docker Desktop or Podman, then run this script from within WSL).
#
# On Linux and macOS you can run this script directly - `./start-influxdb.sh`

# import env variables from .env
set -a
source .env
set +a

# InfluxDB 2.x connection settings come from discrete env vars (not a URL).
# Derive the host port from INFLUXDB_URL; default to 8086 when the URL has no
# explicit port (e.g. a remote https://... URL).
INFLUX_PORT=$(echo "${INFLUXDB_URL:-}" | sed -E 's#^[a-zA-Z]+://##' | awk -F: 'NF>1 {print $2}' | awk -F/ '{print $1}')
INFLUX_PORT=${INFLUX_PORT:-8086}

# Admin bootstrap credentials for setup mode (InfluxDB requires an initial
# user). Local-dev only; override via INFLUXDB_INIT_USERNAME /
# INFLUXDB_INIT_PASSWORD. Password must be >= 8 chars.
INFLUX_INIT_USERNAME=${INFLUXDB_INIT_USERNAME:-admin}
INFLUX_INIT_PASSWORD=${INFLUXDB_INIT_PASSWORD:-admin-password}

INFLUX_CONTAINER_NAME="${INFLUXDB_BUCKET}-influxdb"

# The container is provisioned from these; they must be set.
missing=()
[ -z "${INFLUXDB_ORG:-}" ] && missing+=("INFLUXDB_ORG")
[ -z "${INFLUXDB_BUCKET:-}" ] && missing+=("INFLUXDB_BUCKET")
[ -z "${INFLUXDB_TOKEN:-}" ] && missing+=("INFLUXDB_TOKEN")
if [ ${#missing[@]} -ne 0 ]; then
  echo "Missing required InfluxDB settings in .env: ${missing[*]}"
  echo "Set them (see .env.example) and try again."
  exit 1
fi

if ! [ -x "$(command -v docker)" ] && ! [ -x "$(command -v podman)" ]; then
  echo -e "Docker or Podman is not installed. Please install docker or podman and try again.\nDocker install guide: https://docs.docker.com/engine/install/\nPodman install guide: https://podman.io/getting-started/installation"
  exit 1
fi

# determine which docker command to use
if [ -x "$(command -v docker)" ]; then
  DOCKER_CMD="docker"
elif [ -x "$(command -v podman)" ]; then
  DOCKER_CMD="podman"
fi

if ! $DOCKER_CMD info > /dev/null 2>&1; then
  echo "$DOCKER_CMD daemon is not running. Please start $DOCKER_CMD and try again."
  exit 1
fi

if command -v nc >/dev/null 2>&1; then
  if nc -z localhost "$INFLUX_PORT" 2>/dev/null; then
    echo "Port $INFLUX_PORT is already in use."
    exit 1
  fi
else
  echo "Warning: Unable to check if port $INFLUX_PORT is already in use (netcat not installed)"
  read -p "Do you want to continue anyway? [y/N]: " -r REPLY
  if ! [[ $REPLY =~ ^[Yy]$ ]]; then
    echo "Aborting."
    exit 1
  fi
fi

if [ "$($DOCKER_CMD ps -q -f name=$INFLUX_CONTAINER_NAME)" ]; then
  echo "InfluxDB container '$INFLUX_CONTAINER_NAME' already running"
  exit 0
fi

if [ "$($DOCKER_CMD ps -q -a -f name=$INFLUX_CONTAINER_NAME)" ]; then
  $DOCKER_CMD start "$INFLUX_CONTAINER_NAME"
  echo "Existing InfluxDB container '$INFLUX_CONTAINER_NAME' started"
  exit 0
fi

$DOCKER_CMD run -d \
  --name $INFLUX_CONTAINER_NAME \
  -e DOCKER_INFLUXDB_INIT_MODE="setup" \
  -e DOCKER_INFLUXDB_INIT_USERNAME="$INFLUX_INIT_USERNAME" \
  -e DOCKER_INFLUXDB_INIT_PASSWORD="$INFLUX_INIT_PASSWORD" \
  -e DOCKER_INFLUXDB_INIT_ORG="$INFLUXDB_ORG" \
  -e DOCKER_INFLUXDB_INIT_BUCKET="$INFLUXDB_BUCKET" \
  -e DOCKER_INFLUXDB_INIT_ADMIN_TOKEN="$INFLUXDB_TOKEN" \
  -p "$INFLUX_PORT":8086 \
  docker.io/influxdb:2 \
  && echo "InfluxDB container '$INFLUX_CONTAINER_NAME' was successfully created" \
  && echo "" \
  && echo "InfluxDB is provisioning (a few seconds on first run)." \
  && echo "For local dev, point the app at the local instance by setting:" \
  && echo "  INFLUXDB_URL=http://localhost:$INFLUX_PORT" \
  && echo "in .env.local (org/bucket/token already match your .env)."
```

- [ ] **Step 2: Make it executable**

```bash
chmod +x start-influxdb.sh
```

- [ ] **Step 3: Syntax check (first gate — must pass)**

Run: `bash -n start-influxdb.sh`
Expected: no output, exit code 0. If `shellcheck` is installed, also run `shellcheck start-influxdb.sh` and address any errors (warnings about `source .env` non-constant path are acceptable — `start-database.sh` has the same).

- [ ] **Step 4: Functional boot check**

Ensure Docker/Podman is running and port 8086 is free, then:

Run: `./start-influxdb.sh`
Expected: prints `InfluxDB container 'invest-igator-influxdb' was successfully created` (container name reflects your `INFLUXDB_BUCKET`) followed by the `INFLUXDB_URL=http://localhost:8086` reminder.

Verify it is up and provisioned (wait ~5s for setup):

```bash
docker ps --filter name=influxdb --format '{{.Names}} {{.Status}} {{.Ports}}'
curl -s http://localhost:8086/health
```
Expected: the container is listed and `Up`, mapping `...:8086->8086`; the health endpoint returns JSON containing `"status":"pass"`.

- [ ] **Step 5: Idempotency check**

Run: `./start-influxdb.sh` again.
Expected: `InfluxDB container 'invest-igator-influxdb' already running` and exit 0 (no second container).

Then stop and re-run to exercise the start-existing branch:
```bash
docker stop invest-igator-influxdb
./start-influxdb.sh
```
Expected: `Existing InfluxDB container 'invest-igator-influxdb' started` and exit 0.

- [ ] **Step 6: Commit**

```bash
git add start-influxdb.sh
git commit -m "feat(dev): add start-influxdb.sh local InfluxDB 2.x helper

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: README documentation

**Files:**
- Modify: `README.md` (Prerequisites, Setup steps, project file-tree)

**Interfaces:**
- Consumes: the `./start-influxdb.sh` script from Task 1 (name + behavior).
- Produces: docs only; nothing downstream depends on it.

- [ ] **Step 1: Update the Prerequisites line**

In `README.md`, replace:
```
- ✅ An InfluxDB 2.x instance (local or remote)
```
with:
```
- ✅ An InfluxDB 2.x instance (use `./start-influxdb.sh`, or bring your own local/remote)
```

- [ ] **Step 2: Replace the Postgres setup step with a combined databases step**

In `README.md`, replace this block:
````
**3️⃣ Start Postgres (dev helper)**

```sh
./start-database.sh
```
````
with:
````
**3️⃣ Start the databases (dev helpers)**

```sh
./start-database.sh   # Postgres 16
./start-influxdb.sh   # InfluxDB 2.x
```

For local dev, make sure `INFLUXDB_URL` points at the local instance —
`INFLUXDB_URL=http://localhost:8086` in `.env.local` (org/bucket/token stay
as in your `.env`). `./start-influxdb.sh` reads those values and provisions
the container to match.
````

- [ ] **Step 3: Add the script to the file-tree listing**

In `README.md`, replace:
```
└── start-database.sh          # 🗄️  Dev Postgres script
```
with:
```
├── start-database.sh          # 🗄️  Dev Postgres script
└── start-influxdb.sh          # 📊  Dev InfluxDB 2.x script
```

- [ ] **Step 4: Verify the edits**

Run: `grep -n "start-influxdb.sh" README.md`
Expected: three matches (Prerequisites, Setup steps, file-tree). Confirm the file-tree section still renders as a valid tree (the previous last entry `└──` is now `├──`, and `start-influxdb.sh` is the new `└──`).

- [ ] **Step 5: Commit**

```bash
git add README.md
git commit -m "docs: document ./start-influxdb.sh dev helper

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage:**
- Standalone `start-influxdb.sh` mirroring `start-database.sh` → Task 1. ✓
- Non-destructive, reads `.env`, prints URL reminder → Task 1 Step 1 (no `.env` writes; reminder echoed). ✓
- InfluxDB 2.x, image pinned `influxdb:2` → Task 1 Step 1 + Global Constraints. ✓
- Port derived from `INFLUXDB_URL`, default 8086 → Task 1 Step 1. ✓
- Require ORG/BUCKET/TOKEN, error if missing → Task 1 Step 1 (`missing` check). ✓
- docker/podman + daemon + `nc` checks, running/stopped short-circuits → Task 1 Step 1. ✓
- Setup-mode provisioning (org/bucket/admin token/username/password) → Task 1 Step 1. ✓
- No volume / no compose / no package.json → Global Constraints + not present in tasks. ✓
- README prerequisites + setup step + file tree → Task 2. ✓
- Verification (syntax, health, idempotency) → Task 1 Steps 3–5. ✓

**Placeholder scan:** No TBD/TODO; full script and exact edit strings provided. ✓

**Type/name consistency:** Container name `${INFLUXDB_BUCKET}-influxdb` used consistently; port var `INFLUX_PORT`; env var names match `src/env.js` (`INFLUXDB_URL/ORG/BUCKET/TOKEN`). Health-check and idempotency use the literal `invest-igator-influxdb` (the bucket in this repo's `.env`). ✓
