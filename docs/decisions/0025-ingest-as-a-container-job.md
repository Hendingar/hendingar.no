# 0025 — The nightly collection is a Container Apps job, not a GitHub Actions cron

**Status:** accepted (2026-10-21)
**Builds on:** [ADR 0004](0004-deterministic-importers.md) (importers), [ADR 0018](0018-kurator.md) (the app makes the model call)

## Context

Every importer ran from `.github/workflows/ingest.yml` on a `cron: '0 5 * * *'`. Three things about
that runner cost real time:

- **It sat outside Azure.** The Postgres firewall admits Azure services only, so every night began
  by opening a rule for the runner's public IP and ended by closing it — with a sweep for rules a
  killed run had leaked, because a leaked rule lets a recycled GitHub IP at the database.
- **GitHub's cron is not a clock.** The 05:00 run fired between 11:00 and 12:50 UTC through October,
  which is exactly when merges deploy. On 2026-10-13 the DNT importer ran two minutes before the
  deploy added the column it reads, and both DNT sources failed. `await-migrations` exists because
  of it.
- **A failed night was an email.** On 2026-10-21 Fitjar kommune timed out, 24 of 25 importers were
  fine, and the only record of the night as a whole was a red run in Actions. A night that never
  ran at all left no record anywhere.

## Decision

**The night is one command, `pnpm ingest:job`, and an Azure Container Apps job runs it.**

- `packages/core/scripts/ingest-job.ts` holds the order — await migrations, every importer,
  expire, consolidate, the kurator — and what a failure costs. It writes an `ingest_jobs` row that
  `/datasamling` reads (PR #218). Whatever schedules it is a one-liner.
- `infra/ingest.bicep` is a `Microsoft.App/jobs` resource in the app's environment, on the same
  identity and the same database secret as the app, built from `Dockerfile.ingest`. The deploy
  builds that image and updates the job after it migrates, so the job's code is never ahead of the
  schema.
- `.github/workflows/ingest.yml` survives only as a button: it starts the job and follows it.

**Not a cron inside the app.** A night takes ten minutes of four parallel importers. Inside the web
process it would compete with visitors for a quarter of a CPU, die with every deploy's revision
swap, and run twice the moment the app scales to two replicas.

**The kurator is still asked over HTTP**, at the app's public URL. The job could reach the internal
verifier directly, but ADR 0018's reasoning was about where the model call lives, not about the
network, and the app is still where it lives.

## Consequences

- No firewall rules, no runner IP, no sweep. The job connects the way the app does.
- The schedule fires on the minute. `await-migrations` stays as a cheap guard rather than a
  workaround.
- `/datasamling` says when the last night ran, how it went, and when the next one is late. That
  replaces the email, and it also covers the case the email never could.
- **There is no dry run in production any more.** It was only ever a mapping check, and
  `pnpm db:pull && pnpm ingest --dry-run` does that against a copy.
- A run started by hand is recorded with trigger `schedule`: overriding one environment variable
  on a job start replaces the whole container definition, secret references included.

## How we'd know we were wrong

A night that takes longer than the job's one-hour timeout, which `/datasamling` reports as
interrupted. Or a cost on the bill that is not pennies: the job is consumption-billed, roughly ten
minutes of one CPU a day.
