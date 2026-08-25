#!/usr/bin/env bash
# Local Postgres for development, on Apple's `container` runtime (not Docker).
#
# There is no `container compose`, so this script is the compose file. Keep it boring.
set -euo pipefail

NAME="${DB_CONTAINER_NAME:-hendingar-db}"
VOLUME="${DB_VOLUME:-hendingar-pgdata}"
IMAGE="${DB_IMAGE:-imresamu/postgis:17-3.5}"
PORT="${DB_PORT:-5433}"
PGUSER_="${DB_USER:-hendingar}"
PGPASS_="${DB_PASSWORD:-hendingar}"
PGDB_="${DB_NAME:-hendingar}"
LOCAL_URL="postgres://${PGUSER_}:${PGPASS_}@localhost:${PORT}/${PGDB_}"

die() { echo "error: $*" >&2; exit 1; }

need_runtime() {
  command -v container >/dev/null 2>&1 || die "Apple's \`container\` CLI is not installed. brew install container"
  if ! container system status >/dev/null 2>&1; then
    echo "starting container system services…"
    container system start
  fi
}

running() { container ls --format json 2>/dev/null | grep -q "\"$NAME\"" ; }
exists()  { container ls --all --format json 2>/dev/null | grep -q "\"$NAME\"" ; }

# `reset` and `down --wipe` destroy data. Refuse unless DATABASE_URL is clearly local, so that an
# agent (or a tired human) with a staging URL exported cannot nuke something real.
assert_local() {
  local url="${DATABASE_URL:-$LOCAL_URL}"
  case "$url" in
    *@localhost:*|*@127.0.0.1:*|*@0.0.0.0:*) : ;;
    *) die "refusing to destroy data: DATABASE_URL does not point at localhost ($url)" ;;
  esac
}

wait_ready() {
  for _ in $(seq 1 60); do
    if container exec "$NAME" pg_isready -U "$PGUSER_" -d "$PGDB_" >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done
  die "database did not become ready in 60s — try: pnpm db:logs"
}

ensure_env() {
  local root; root="$(cd "$(dirname "$0")/.." && pwd)"
  if [ ! -f "$root/.env" ] && [ -f "$root/.env.example" ]; then
    cp "$root/.env.example" "$root/.env"
    echo "created .env from .env.example"
  fi
  # Vite loads .env from the app directory, so point it at the single root file rather than
  # keeping a second copy that can drift.
  if [ -f "$root/.env" ] && [ ! -e "$root/app/.env" ]; then
    ln -s ../.env "$root/app/.env"
  fi
}

up() {
  need_runtime
  ensure_env
  if running; then echo "$NAME already running on :$PORT"; return 0; fi
  if exists; then container start "$NAME" >/dev/null; wait_ready; echo "$NAME restarted on :$PORT"; return 0; fi
  container volume inspect "$VOLUME" >/dev/null 2>&1 || container volume create "$VOLUME" >/dev/null
  container run --detach --name "$NAME" \
    --volume "$VOLUME:/var/lib/postgresql/data" \
    --publish "$PORT:5432" \
    --env "POSTGRES_USER=$PGUSER_" \
    --env "POSTGRES_PASSWORD=$PGPASS_" \
    --env "POSTGRES_DB=$PGDB_" \
    --env "PGDATA=/var/lib/postgresql/data/pgdata" \
    "$IMAGE" >/dev/null
  wait_ready
  echo "$NAME up on :$PORT  ($LOCAL_URL)"
}

down() {
  need_runtime
  exists || { echo "$NAME does not exist"; return 0; }
  container stop "$NAME" >/dev/null 2>&1 || true
  container rm "$NAME" >/dev/null 2>&1 || true
  if [ "${1:-}" = "--wipe" ]; then
    assert_local
    container volume rm "$VOLUME" >/dev/null 2>&1 || true
    echo "$NAME removed, volume $VOLUME wiped"
  else
    echo "$NAME removed (volume $VOLUME kept)"
  fi
}

reset() { assert_local; down --wipe; up; }

case "${1:-}" in
  up)     up ;;
  down)   shift; down "${1:-}" ;;
  reset)  reset ;;
  status) need_runtime; container ls --all | grep -E "CONTAINER|$NAME" || echo "$NAME not found" ;;
  logs)   need_runtime; container logs "${2:---follow}" "$NAME" ;;
  psql)   need_runtime; container exec --interactive --tty "$NAME" psql -U "$PGUSER_" -d "$PGDB_" ;;
  url)    echo "$LOCAL_URL" ;;
  *)      echo "usage: db.sh {up|down [--wipe]|reset|status|logs|psql|url}" >&2; exit 2 ;;
esac
