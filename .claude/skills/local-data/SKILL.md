---
name: local-data
description: Choosing what is in the local database, and getting it there. Use when local data is missing, stale or wrong for the job — before running the site, before the e2e specs, after a reset, or when tempted to run every importer to get a realistic listing. Covers `pnpm db:pull` (copy the deployed database), the CI seed state, and when a full ingest is actually required.
---

# What should be in the local database

Three states, and picking the wrong one wastes either thirteen minutes or an afternoon of
debugging specs that were never going to pass.

| You are about to                     | You want                | Cost      |
| ------------------------------------ | ----------------------- | --------- |
| Run the site (`pnpm dev`), look at a | **the deployed data** — | under a   |
| listing, check a rendering change    | `pnpm db:pull`          | minute    |
| Run `pnpm test:e2e`                  | **the CI seed state**   | ~20s      |
| Change an importer and prove it works| **that one importer**   | its own   |
|                                      |                         | run       |

## Realistic data: `pnpm db:pull`

Copies the deployed database into the local one.

```bash
pnpm db:up          # if it is not already running
pnpm db:pull
```

This is the default answer whenever local data is empty or stale. It replaced the habit of
reaching for `pnpm db:bootstrap`, which gets the same rows by running all fifteen importers —
thirteen minutes, and fifteen third parties asked for data that already exists in a database we
own. A pull is read-only against the deployment, touches no upstream, and can be repeated.

**It needs two things**, and says so clearly if either is missing:

- `az login` — the server's firewall allows Azure services only, so the script opens a rule for
  your public IP and removes it again on exit. It also sweeps any `db-pull-*` rule a killed run
  left behind, because a trap does not survive `kill -9` and home IP addresses get recycled.
- `POSTGRES_ADMIN_PASSWORD` — in `.env` (gitignored) or exported for one run. It is the
  `POSTGRES_ADMIN_PASSWORD` GitHub Actions secret, and Actions secrets cannot be read back, so it
  has to come from whoever deployed the server. Entra ID auth would remove the need for it, but
  `activeDirectoryAuth` is `Disabled` on the server today.

**Two browser bearer tokens are rewritten on the way in**, not copied.
`events.submitter_client_id` is described in `packages/core/src/schema.ts` as "a 122-bit random
value acting as a bearer token" and the only thing standing between a submission and a stranger
editing it; `event_hearts.client_id` is the same browser-generated id. They are replaced with a
derived value, so counts and the one-heart-per-browser index still behave while nothing on the
laptop can authenticate as a real visitor. Everything else arrives as it is — there are no names,
emails or addresses in this schema to worry about.

**Migrations run afterwards, automatically.** The dump carries the *deployed* schema, which is
behind local whenever this branch adds a migration. Without that step the app meets a database
missing the column it was just taught to read, and the failure surfaces somewhere unrelated
(CLAUDE.md rule 2).

## The e2e specs: the CI seed state, and nothing else

```bash
pnpm db:reset && pnpm db:seed && pnpm db:sources && pnpm consolidate && pnpm test:e2e
```

All four steps, every time. `db:sources` registers the link-only sources and `consolidate` marks
cross-source duplicates; without them a handful of specs fail while passing on a laptop where
someone ran them by hand.

**A pulled or ingested database makes these specs fail as pure noise** — the assertions are written
against known seed rows. Never run the specs against `db:pull` output and then go hunting for the
regression.

`pnpm db:pull` afterwards to get realistic data back.

### `DATABASE_URL` has to be exported for the e2e run

`app/playwright.config.ts` falls back to port **5432** when `DATABASE_URL` is absent from the
environment, while `.env` puts the local database on **5433**. The symptom is every spec failing
at once, with an `AggregateError` in the web server output that names nothing. Export it:

```bash
export DATABASE_URL="$(./scripts/db.sh url)"
```

Called directly, not through `pnpm db:url` — pnpm echoes the command it is running even under
`-s`, so command substitution would capture that line too.

## When a full ingest is genuinely the answer

Only when the importer *is* the thing under test. Then run that one:

```bash
pnpm --filter @hendingar/importer-<name> ingest --dry-run   # map and count
pnpm --filter @hendingar/importer-<name> ingest
```

`pnpm ingest` (all of them) and `pnpm db:bootstrap` are for a first-time setup or for proving a new
importer is registered — not for refilling a database, which is what `db:pull` is for.

**`--dry-run` is not read-only.** Every importer calls `upsertSource` before the dry-run branch, so
it writes the `sources` row (including flipping `active`) and only skips the run row and the events.
To inspect mapping with no writes at all, call the importer's `map.ts` directly.

## Do not reach for the deployed ingest

`gh workflow run ingest.yml` writes to the live database and is not a way to get local data. It is
for making the deployment collect something now — a newly merged importer, or a source whose last
run failed. Deploy and ingest are not ours to trigger on a whim (CLAUDE.md, Shipping).
