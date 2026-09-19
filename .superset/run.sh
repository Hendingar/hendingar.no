#!/usr/bin/env bash
#
# The dev server, on this worktree's own port, against this worktree's own database.
#
# --strictPort on purpose: vite's default is to walk up to the next free port, which is how you end
# up reading another workspace's site and believing it is yours.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root"

env_get() { sed -nE "s/^$1=(.*)$/\1/p" .env | tail -1; }
port="$(env_get DEV_PORT)"
port="${port:-5173}"

# A stopped container after a reboot otherwise surfaces as a connection error from deep inside
# drizzle; db.sh up is a no-op when it is already running.
./scripts/db.sh up >/dev/null

echo "hendingar.no → http://localhost:$port"
cd app
exec ./node_modules/.bin/vite dev --port "$port" --strictPort
