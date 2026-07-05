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

if [ "$("$DOCKER_CMD" ps -q -f "name=^${INFLUX_CONTAINER_NAME}$")" ]; then
  echo "InfluxDB container '$INFLUX_CONTAINER_NAME' already running"
  exit 0
fi

if [ "$("$DOCKER_CMD" ps -q -a -f "name=^${INFLUX_CONTAINER_NAME}$")" ]; then
  $DOCKER_CMD start "$INFLUX_CONTAINER_NAME"
  echo "Existing InfluxDB container '$INFLUX_CONTAINER_NAME' started"
  exit 0
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

$DOCKER_CMD run -d \
  --name "$INFLUX_CONTAINER_NAME" \
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
