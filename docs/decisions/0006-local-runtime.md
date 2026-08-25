# 0006 — Apple `container` for the local database, not Docker

**Status:** accepted (2026-08-25)

## Context

Local development needs Postgres. The reflexive answer is Docker Desktop and a `docker-compose.yml`,
which is what this repo shipped initially.

Docker Desktop is not installed on the machines this is developed on, and its licensing is awkward
for a project that intends to be contributor-friendly. Apple's
[`container`](https://github.com/apple/container) runs Linux containers on Apple Silicon in
lightweight VMs, ships via Homebrew, and on macOS 26 gives each container a routable IP.

## Decision

Local Postgres runs on Apple `container`, driven by `scripts/db.sh`. The compose file is gone.

```bash
pnpm db:up      # start (creates .env on first run)
pnpm db:migrate
pnpm db:seed
pnpm db:reset   # wipe + re-migrate
pnpm db:psql
```

Image: `imresamu/postgis:17-3.5`. Port **5433**.

## Consequences

- **There is no `container compose`.** `scripts/db.sh` is the compose file. That is a deliberate
  trade: a ~90-line shell script instead of a declarative file, in exchange for no Docker dependency.
  Keep it boring; if it grows a second service it is worth revisiting.
- **Port 5433, not 5432.** 5432 is very often already held by another project, and the collision
  surfaces as `28P01 auth_failed` against a _different_ database — one of the more confusing failure
  modes available. Using a non-default port costs nothing and removes the whole class.
- **PostGIS image is not the official one.** `postgis/postgis` publishes an arm64 manifest whose
  `variant: v8` this runtime rejects. `imresamu/postgis` is the community arm64 build and works;
  it is a third-party image, which is a supply-chain consideration worth revisiting if this ever
  hosts anything sensitive.
- `db.sh reset` refuses to run unless `DATABASE_URL` points at localhost. An agent with a staging
  URL exported should not be able to destroy real data by running a documented command.
- **CI is unaffected** — it runs on Linux and needs no local container runtime. Nothing in the
  verify path touches a database.

## How we'd know we were wrong

If contributors on Linux or Intel Macs can't get started, the script needs a Docker/Podman fallback
path — the commands are close enough that a runtime shim is cheap. Or if a second service (Redis,
a tile server) arrives and the script starts growing orchestration logic, that's the signal to
adopt something declarative.
