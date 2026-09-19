#!/usr/bin/env bash
#
# Deleting a workspace deletes its database with it. Without this, every workspace leaves behind a
# running Postgres and a volume that nothing will ever look at again — there is an orphaned
# `hendingar-pgdata-sendinn` on this machine from exactly that.
#
# It only ever touches the container named in THIS worktree's .env, and refuses the shared
# defaults, so a workspace that was never set up (or was set up by the old stub config) cannot
# take down the database the main checkout is using.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root"

[ -f .env ] || { echo 'no .env — nothing to tear down'; exit 0; }

env_get() { sed -nE "s/^$1=(.*)$/\1/p" .env | tail -1; }
name="$(env_get DB_CONTAINER_NAME)"
volume="$(env_get DB_VOLUME)"

case "$name" in
	'' | hendingar-db)
		echo "refusing to tear down '${name:-<unset>}': that is the shared default, not this worktree's"
		exit 0
		;;
esac

case "$volume" in
	'' | hendingar-pgdata)
		echo "refusing to wipe '${volume:-<unset>}': that is the shared default, not this worktree's"
		exit 0
		;;
esac

echo "removing $name and $volume"
./scripts/db.sh down --wipe
