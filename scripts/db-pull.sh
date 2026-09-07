#!/usr/bin/env bash
# Copy the deployed database into the local one, instead of re-crawling every source.
#
# `pnpm db:bootstrap` gets realistic local data by running all fifteen importers, which takes
# thirteen minutes and asks fifteen third parties for rows that already exist in the deployed
# database. This asks the database instead. Typical run is under a minute, and no upstream is
# touched at all — which also means it can be run repeatedly without being rude to anyone.
#
# What it is NOT for: the e2e specs. Those must run against the CI seed state, and a pulled
# database makes them fail as pure noise — see `.claude/skills/ship/SKILL.md`. The sequence for
# that is still `db:reset && db:seed && db:sources && consolidate`.
#
# ## "prod"
#
# There is one deployed environment, `rg-hendingar-swc-dev`, and it is the one the live site reads.
# So this pulls from real data that real people can see, read-only, and the script never writes a
# single row to it. The only thing it changes up there is a firewall rule, which it removes again.
set -euo pipefail

RG="${HENDINGAR_RG:-rg-hendingar-swc-dev}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# .env fills in what the environment has not already said, and never overrides it.
#
# That precedence is the opposite of `scripts/db.sh`, and deliberately so. This script's only real
# safety check is that the destination is local, and it reads `DATABASE_URL` to make it — so an
# unconditional `set -a; . .env` silently replaces the value being checked with the one from the
# file, and the guard then passes by inspecting something the caller never asked for. It did: the
# first version of this script accepted an explicitly remote `DATABASE_URL=…azure.com…` and walked
# straight past its own refusal.
#
# It is also what the rest of the repo already does. Node's `--env-file` leaves existing variables
# alone, so every importer and seed script treats the real environment as authoritative; sourcing
# in a subshell here lets bash do the quote handling (a password is allowed to contain `#`) while
# `:=` assigns only what is missing.
env_file="$ROOT/.env"
from_env_file() {
  [ -f "$env_file" ] || return 0
  (
    set -a
    # shellcheck disable=SC1090
    . "$env_file" >/dev/null 2>&1 || true
    set +a
    printf '%s' "${!1:-}"
  )
}
: "${DATABASE_URL:=$(from_env_file DATABASE_URL)}"
: "${POSTGRES_ADMIN_PASSWORD:=$(from_env_file POSTGRES_ADMIN_PASSWORD)}"
: "${DB_CONTAINER_NAME:=$(from_env_file DB_CONTAINER_NAME)}"
: "${DB_USER:=$(from_env_file DB_USER)}"
: "${DB_NAME:=$(from_env_file DB_NAME)}"

NAME="${DB_CONTAINER_NAME:-hendingar-db}"
PGUSER_="${DB_USER:-hendingar}"
PGDB_="${DB_NAME:-hendingar}"
REMOTE_DB="${REMOTE_DB_NAME:-hendingar}"
REMOTE_USER="${REMOTE_DB_USER:-hendingar}"

die() { echo "error: $*" >&2; exit 1; }
step() { printf '\n▸ %s\n' "$*"; }

# ---------------------------------------------------------------------------------------- guards

# The restore runs with --clean --if-exists, which DROPS before it recreates. Pointed at anything
# but a local database that is a data-loss bug, so the destination is checked the same way
# scripts/db.sh checks a wipe: parse the host out and compare it, because a substring match cannot
# tell a local socket from an SSH tunnel.
assert_local_target() {
  [ -n "${DATABASE_URL:-}" ] || die "DATABASE_URL is not set. Run \`pnpm db:up\` first."
  local host
  host=$(printf '%s' "$DATABASE_URL" | sed -E 's|^[a-z]+://[^@]*@||; s|[:/].*$||; s|^\[||; s|\]$||')
  case "$host" in
    localhost | 127.0.0.1 | 0.0.0.0 | ::1) : ;;
    *) die "refusing to restore over DATABASE_URL host '$host': not loopback" ;;
  esac
}

assert_local_target
# Exported so `pnpm db:migrate` below is demonstrably run against the value just checked, rather
# than re-reading .env and possibly resolving something else.
export DATABASE_URL
command -v az >/dev/null 2>&1 || die "the Azure CLI is not installed. brew install azure-cli"
command -v container >/dev/null 2>&1 || die "Apple's \`container\` CLI is not installed. brew install container"
az account show >/dev/null 2>&1 || die "not signed in to Azure. Run: az login"
container ls --format json 2>/dev/null | grep -q "\"$NAME\"" ||
  die "the local database is not running. Run: pnpm db:up"

# The one secret this needs, and the one thing that cannot be derived.
#
# It is a GitHub Actions secret (infra/BOOTSTRAP.md) and secrets there are write-only, so there is
# nothing to fetch — whoever deployed the server has it. Entra ID auth would remove the need for it
# entirely and is the better answer, but `activeDirectoryAuth` is Disabled on the server today, so
# the admin password is the only way in. Read from the environment or .env; never a prompt that
# ends up in shell history, and never written anywhere by this script.
if [ -z "${POSTGRES_ADMIN_PASSWORD:-}" ]; then
  cat >&2 <<'EOF'
error: POSTGRES_ADMIN_PASSWORD is not set.

It is the Postgres admin password for the deployed server — the same value held as the
POSTGRES_ADMIN_PASSWORD GitHub Actions secret. Actions secrets cannot be read back, so it has to
come from whoever deployed the server.

Put it in .env (which is gitignored) or export it for one run:

  POSTGRES_ADMIN_PASSWORD='…' pnpm db:pull
EOF
  exit 1
fi

# ------------------------------------------------------------------------------------ the server

step "Resolving the deployed server in $RG"
FQDN=$(az postgres flexible-server list --resource-group "$RG" \
  --query "[0].fullyQualifiedDomainName" -o tsv)
[ -n "$FQDN" ] || die "no Postgres flexible server in $RG"
SERVER="${FQDN%%.*}"
echo "  $FQDN"

# ---------------------------------------------------------------------------------- the firewall

# The server's firewall allows Azure services only, and a laptop is not one — the same problem
# .github/workflows/ingest.yml solves for its runner, solved the same way.
RULE="db-pull-$(whoami)-$$"
RULE=$(printf '%s' "$RULE" | tr -c 'A-Za-z0-9-' '-')

close_firewall() {
  # Deleting our own rule, then sweeping any db-pull-* left behind by a run that was killed.
  #
  # A trap does not survive SIGKILL, so the sweep is not belt-and-braces: without it a laptop's
  # address stays allowed against the database after one `kill -9`, and home IP addresses are
  # recycled. ingest.yml keeps a separate always() step for exactly this reason.
  az postgres flexible-server firewall-rule delete --resource-group "$RG" \
    --server-name "$SERVER" --name "$RULE" --yes >/dev/null 2>&1 || true
  local stale
  stale=$(az postgres flexible-server firewall-rule list --resource-group "$RG" \
    --server-name "$SERVER" --query "[?starts_with(name,'db-pull-')].name" -o tsv 2>/dev/null || true)
  for rule in $stale; do
    az postgres flexible-server firewall-rule delete --resource-group "$RG" \
      --server-name "$SERVER" --name "$rule" --yes >/dev/null 2>&1 || true
    echo "  swept a leftover rule: $rule"
  done
}
trap close_firewall EXIT

step "Opening the firewall for this machine"
MY_IP=$(curl -fsS https://api.ipify.org)
[ -n "$MY_IP" ] || die "could not determine this machine's public IP"
az postgres flexible-server firewall-rule create --resource-group "$RG" \
  --server-name "$SERVER" --name "$RULE" \
  --start-ip-address "$MY_IP" --end-ip-address "$MY_IP" >/dev/null
echo "  $MY_IP allowed as $RULE (removed when this script exits)"

# ------------------------------------------------------------------------------- dump and restore

# Both run INSIDE the local database container, and that is deliberate.
#
# pg_dump refuses a server newer than itself, the deployed server is 17, and nobody should have to
# keep a matching client on their laptop to get test data. The container is already running PG17
# tooling and can reach both the internet and its own socket. Passing the password with `-e` also
# keeps it out of the host's process list, where a URL argument would sit in plain sight.
DUMP=/tmp/hendingar-pull.dump

step "Dumping the deployed database"
container exec -e PGPASSWORD="$POSTGRES_ADMIN_PASSWORD" -e PGSSLMODE=require "$NAME" \
  pg_dump \
  --host="$FQDN" --username="$REMOTE_USER" --dbname="$REMOTE_DB" \
  --format=custom --no-owner --no-privileges --file="$DUMP"
echo "  $(container exec "$NAME" sh -c "du -h $DUMP | cut -f1") dumped"

step "Restoring it over the local database"
# `--clean --if-exists` so a pull is repeatable rather than colliding with what is already here.
# pg_restore reports non-fatal noise (an extension it may not drop) on its own exit code, so the
# output is kept and only a genuine failure is fatal.
if ! container exec "$NAME" pg_restore \
  --username="$PGUSER_" --dbname="$PGDB_" \
  --clean --if-exists --no-owner --no-privileges "$DUMP" 2>/tmp/hendingar-restore.err; then
  if grep -qiE 'FATAL|could not connect|out of memory' /tmp/hendingar-restore.err; then
    cat /tmp/hendingar-restore.err >&2
    die "pg_restore failed"
  fi
  echo "  pg_restore reported non-fatal warnings:"
  sed 's/^/    /' /tmp/hendingar-restore.err | head -5
fi
container exec "$NAME" rm -f "$DUMP"
rm -f /tmp/hendingar-restore.err

# ----------------------------------------------------------------------------------------- scrub

# The two columns that are other people's credentials, not their data.
#
# `events.submitter_client_id` is described in packages/core/src/schema.ts as "a 122-bit random
# value acting as a bearer token" and "the only thing standing between a submission and a stranger
# editing it". `event_hearts.client_id` is the same browser-generated id. Copying live ones onto a
# laptop puts a bearer token in a place nobody is protecting, for no benefit — local development
# cannot be somebody else's browser anyway.
#
# Rewritten rather than nulled, so the shape of the data survives: the hearts unique index still
# means one heart per browser, /poppis still counts the same distinct browsers, and /ko still has
# rows to render. What it loses is the ability to authenticate as anyone, which is the point.
step "Scrubbing browser bearer tokens"
container exec -i "$NAME" psql --username="$PGUSER_" --dbname="$PGDB_" -q -v ON_ERROR_STOP=1 <<'SQL'
UPDATE events
   SET submitter_client_id = 'pulled-' || md5(submitter_client_id)
 WHERE submitter_client_id IS NOT NULL;
UPDATE event_hearts
   SET client_id = 'pulled-' || md5(client_id);
SQL
echo "  events.submitter_client_id and event_hearts.client_id rewritten"

# --------------------------------------------------------------------------------------- migrate

# The dump carries the DEPLOYED schema, which is behind local whenever there is an unmerged
# migration on this branch — so without this the app meets a database missing the column it was
# just taught to read, and the failure surfaces somewhere unrelated (CLAUDE.md rule 2).
#
# Safe because migrations here are additive by policy (ADR 0010): applying newer ones to older data
# adds, it does not rewrite.
step "Applying any migrations newer than the deployment"
(cd "$ROOT" && pnpm db:migrate)

# ---------------------------------------------------------------------------------------- report

step "What landed"
container exec -i "$NAME" psql --username="$PGUSER_" --dbname="$PGDB_" -q <<'SQL'
SELECT 'sources' AS table, count(*) FROM sources
UNION ALL SELECT 'events', count(*) FROM events
UNION ALL SELECT 'venues', count(*) FROM venues
UNION ALL SELECT 'upcoming events', count(*) FROM events WHERE starts_at >= now()
UNION ALL SELECT 'with a poster', count(*) FROM events WHERE poster_url IS NOT NULL
UNION ALL SELECT 'ingest runs', count(*) FROM ingest_runs
ORDER BY 1;
SQL

printf '\n✓ local database now mirrors %s\n' "$FQDN"
printf '  Run the site:            pnpm dev\n'
printf '  Before the e2e specs:    pnpm db:reset && pnpm db:seed && pnpm db:sources && pnpm consolidate\n'
