#!/usr/bin/env bash
#
# One Superset workspace = one git worktree = one database and one set of ports.
#
# Three things collide when several worktrees share this machine, and all three have already cost
# real time here:
#
#   1. The database. `scripts/db.sh` defaults to the container `hendingar-db` and the volume
#      `hendingar-pgdata`, and those names are global to the runtime — so `pnpm db:reset` in any
#      worktree destroys every other session's data. It happened twice on 2026-09-06.
#   2. The dev server on :5173 and Playwright's preview on :4173. Two workspaces running the app,
#      or the e2e suite, silently test each other's code.
#   3. `pnpm`. PATH has 9.x, package.json pins 11.20.0, and there is no corepack — a bare
#      `pnpm install` offers to delete every workspace's node_modules and, non-interactively,
#      answers itself.
#
# So the first thing this does is give the worktree its own names and its own ports, written into
# .env, which is where db.sh, vite, the importer CLIs and playwright.config.ts all read them.
#
# Idempotent: re-running it keeps the ports it already handed out and re-seeds over itself.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root"

say() { printf '\n▸ %s\n' "$*"; }
die() { printf '\nerror: %s\n' "$*" >&2; exit 1; }

PNPM_VERSION=11.20.0

# --------------------------------------------------------------------------------------------
# 1. The pinned pnpm, on PATH — including for the nested `pnpm --filter …` inside package.json
#    scripts, which would otherwise resolve to Homebrew's 9.x.
# --------------------------------------------------------------------------------------------
if [ "$(pnpm --version 2>/dev/null || echo none)" != "$PNPM_VERSION" ]; then
	say "resolving pnpm@$PNPM_VERSION (PATH has $(pnpm --version 2>/dev/null || echo 'no pnpm'))"
	pnpm_bin="$(npx --yes --package "pnpm@$PNPM_VERSION" -c 'command -v pnpm')" \
		|| die "could not resolve pnpm@$PNPM_VERSION"
	PATH="$(dirname "$pnpm_bin"):$PATH"
	export PATH
fi

# --------------------------------------------------------------------------------------------
# 2. This worktree's identity: a slug, a database container, three free ports. Written to .env.
# --------------------------------------------------------------------------------------------
if [ ! -f .env ]; then
	main_env="$(git rev-parse --git-common-dir)/../.env"
	if [ -f "$main_env" ]; then
		cp "$main_env" .env
		say "copied .env from the main checkout (its DB settings are overwritten below)"
	else
		cp .env.example .env
		say "created .env from .env.example"
	fi
fi

python3 - "$root" <<'PY'
import hashlib, json, os, re, socket, subprocess, sys

root = sys.argv[1]
path = os.path.join(root, '.env')
text = open(path).read()


def get(key):
	m = re.search(rf'^{key}=(.*)$', text, re.M)
	return m.group(1).strip() if m else None


digest = hashlib.sha256(root.encode()).hexdigest()
leaf = re.sub(r'[^a-z0-9]+', '-', os.path.basename(root).lower()).strip('-')[:16] or 'ws'

# WORKSPACE_SLUG is the marker that this .env has been through here before. Without it every
# value in the file is somebody else's — a copy of the main checkout's — and must be replaced.
configured = get('WORKSPACE_SLUG') is not None
slug = get('WORKSPACE_SLUG') or f'{leaf}-{digest[:6]}'
container = f'hendingar-db-{slug}'

# Ports published by any other hendingar container, running or stopped: a stopped container holds
# no socket but still fails to start if its port has been handed to someone else meanwhile.
taken = set()
try:
	out = subprocess.run(
		['container', 'ls', '--all', '--format', 'json'],
		capture_output=True, text=True, timeout=30,
	).stdout
	for entry in json.loads(out or '[]'):
		cfg = entry.get('configuration', entry)
		if cfg.get('id') == container:
			continue
		for published in cfg.get('publishedPorts', []):
			taken.add(int(published['hostPort']))
except Exception:
	pass  # no runtime yet, or a format change — the socket probe below still applies


def free(port):
	if port in taken:
		return False
	# Bind on 0.0.0.0, because the container runtime publishes there; then connect on loopback,
	# because a bind test alone can pass against a socket held with SO_REUSEADDR.
	with socket.socket() as s:
		try:
			s.bind(('', port))
		except OSError:
			return False
	with socket.socket() as s:
		s.settimeout(0.2)
		return s.connect_ex(('127.0.0.1', port)) != 0


def pick(key, base, span, offset):
	current = get(key)
	if configured and current and current.isdigit():
		return int(current)  # never move a port this worktree already uses
	start = int(digest[offset:offset + 4], 16) % span
	for i in range(span):
		port = base + (start + i) % span
		if free(port):
			return port
	raise SystemExit(f'no free port for {key} in {base}..{base + span}')


db_port = pick('DB_PORT', 5400, 200, 6)
dev_port = pick('DEV_PORT', 5700, 200, 10)
e2e_port = pick('E2E_PORT', 4200, 200, 14)

updates = {
	'WORKSPACE_SLUG': slug,
	# hendingar-* is not cosmetic: scripts/db.sh refuses to wipe a volume named anything else.
	'DB_CONTAINER_NAME': container,
	'DB_VOLUME': f'hendingar-pgdata-{slug}',
	'DB_PORT': str(db_port),
	'DB_USER': 'hendingar',
	'DB_PASSWORD': 'hendingar',
	'DB_NAME': 'hendingar',
	# 127.0.0.1, not localhost — see the note at the top of .env.example about Node and ::1.
	'DATABASE_URL': f'postgres://hendingar:hendingar@127.0.0.1:{db_port}/hendingar',
	'DEV_PORT': str(dev_port),
	'E2E_PORT': str(e2e_port),
}

appended = []
for key, value in updates.items():
	line = f'{key}={value}'
	if re.search(rf'^{key}=.*$', text, re.M):
		text = re.sub(rf'^{key}=.*$', line, text, count=1, flags=re.M)
	else:
		appended.append(line)

if appended:
	text = text.rstrip('\n') + (
		'\n\n'
		'# --- this worktree, written by .superset/setup.sh ---------------------------------\n'
		'# Its own database container, volume and ports, so a reset here cannot reach another\n'
		'# worktree. Delete WORKSPACE_SLUG to have setup.sh hand out a fresh set.\n'
		+ '\n'.join(appended) + '\n'
	)

open(path, 'w').write(text)
PY

env_get() { sed -nE "s/^$1=(.*)$/\1/p" .env | tail -1; }
slug="$(env_get WORKSPACE_SLUG)"
db_port="$(env_get DB_PORT)"
dev_port="$(env_get DEV_PORT)"
e2e_port="$(env_get E2E_PORT)"
say "workspace $slug — db :$db_port, dev :$dev_port, e2e :$e2e_port"

# --------------------------------------------------------------------------------------------
# 3. Dependencies. Frozen, deliberately: app pins @sveltejs/kit to the `next` tag, so an
#    unfrozen install floats the framework into whatever the branch was actually about.
# --------------------------------------------------------------------------------------------
say 'installing dependencies'
#
# --config.confirmModulesPurge=false: a worktree whose node_modules was written by the pnpm 9 on
# PATH has a layout pnpm 11 cannot read, and pnpm stops to ask before re-creating it — which with
# no TTY means the whole setup fails. Answering it here is safe in a way that the bare
# `pnpm install` this repo warns about is not: node_modules is derived state belonging to this
# worktree alone, the pnpm doing the purge is the pinned one, and --frozen-lockfile means the
# lockfile cannot be rewritten on the way through.
pnpm install --frozen-lockfile --config.confirmModulesPurge=false || die "$(
	cat <<-'MSG'
		pnpm install --frozen-lockfile failed.

		Usually this means package.json and pnpm-lock.yaml disagree on this branch. Fix it
		deliberately rather than letting an unfrozen install rewrite the lockfile:
		    npx --yes pnpm@11.20.0 install --lockfile-only
		and review the diff before committing it.

		If the lockfile itself looks churned — the `overrides:` block gone, hundreds of
		`(supports-color@7.2.0)` suffixes dropped — that is pnpm 9 having rewritten it. Restore
		it with `git checkout -- pnpm-lock.yaml` rather than installing on top of it.
	MSG
)"

# --------------------------------------------------------------------------------------------
# 4. The database: this worktree's own container, migrated, in the state CI seeds.
# --------------------------------------------------------------------------------------------
say 'starting the database'
./scripts/db.sh up

say 'migrating and seeding'
pnpm run db:migrate
pnpm run db:seed
pnpm run db:sources
pnpm run consolidate

cat <<EOF

  Workspace ready — $slug

    pnpm dev            http://localhost:$dev_port   (or use Superset's run button)
    pnpm db:psql        a shell in this worktree's own database
    pnpm test:e2e       on :$e2e_port, isolated from the other worktrees

  The database holds the SEED. That is what the e2e specs assert against, and it is not what the
  product looks like — /datasamling will under-report its coverage and the listing will be mostly
  generated tiles. For the real picture:

    pnpm db:pull        copy the deployed database (needs az login)
    pnpm ingest         fetch all fifteen sources the slow way (~13 min)

EOF
