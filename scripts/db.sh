#!/usr/bin/env bash
# Local Postgres for development, on Apple's `container` runtime (not Docker).
#
# There is no `container compose`, so this script is the compose file. Keep it boring.
set -euo pipefail

# The port (and the rest) come from .env, so this script and the app agree about which database
# "the database" means.
#
# Without this the defaults below applied whenever DB_PORT was not already exported, which put the
# container on 5433 — a port other local stacks commonly hold. The symptom is not a clear conflict
# but `bind(...): Address already in use` from deep inside the container runtime, which reads like
# a broken volume or a stuck container and sends you looking in the wrong place entirely.
env_file="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/.env"
if [ -f "$env_file" ]; then
  # `set -a` exports what the file assigns; the subshell keeps its `set +a` from leaking.
  set -a
  # shellcheck disable=SC1090
  . "$env_file"
  set +a
fi

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

# `reset` and `down --wipe` destroy data. Two guards, because the obvious one is not enough.
assert_local() {
  # 1. The volume we are about to delete must be OURS. The wipe targets $VOLUME, but the old
  #    version of this check inspected DATABASE_URL — a different thing entirely, so
  #    `DB_VOLUME=other-project-pgdata ./scripts/db.sh reset` sailed straight through and destroyed
  #    an unrelated project's database.
  case "$VOLUME" in
    hendingar-*) : ;;
    *) die "refusing to delete volume '$VOLUME': not a hendingar-* volume" ;;
  esac

  # 2. If DATABASE_URL is set, it must resolve to a loopback host. A substring match cannot tell a
  #    local socket from an SSH tunnel, so parse the host and compare it explicitly. This still
  #    cannot detect `ssh -L 5433:prod:5432` — nothing local can — which is why guard 1 exists and
  #    why the wipe only ever removes a hendingar-* volume.
  if [ -n "${DATABASE_URL:-}" ]; then
    local host
    host=$(printf '%s' "$DATABASE_URL" | sed -E 's|^[a-z]+://[^@]*@||; s|[:/].*$||; s|^\[||; s|\]$||')
    case "$host" in
      localhost|127.0.0.1|0.0.0.0|::1) : ;;
      *) die "refusing to destroy data: DATABASE_URL host '$host' is not loopback" ;;
    esac
  fi
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
  local wipe="${1:-}"

  # The wipe must happen even when the container is already gone: a volume outlives its container,
  # so returning early here made `db:down` followed by `db:reset` silently reuse the old data —
  # migrations then no-op and you debug a state you thought you had destroyed.
  if exists; then
    container stop "$NAME" >/dev/null 2>&1 || true
    container rm "$NAME" >/dev/null 2>&1 || true
    echo "$NAME removed"
  else
    echo "$NAME does not exist"
  fi

  if [ "$wipe" = "--wipe" ]; then
    assert_local
    if container volume inspect "$VOLUME" >/dev/null 2>&1; then
      container volume rm "$VOLUME" >/dev/null 2>&1 || true
      echo "volume $VOLUME wiped"
    else
      echo "volume $VOLUME did not exist"
    fi
  else
    echo "volume $VOLUME kept"
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
