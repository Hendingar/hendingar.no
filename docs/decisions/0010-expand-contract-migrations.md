# 0010 — Migrations are expand-only, and a test enforces it

**Status:** accepted (2026-09-03)

## Context

`deploy.yml` applies migrations, then deploys the new revision, then waits for it to be healthy.
Between the first and third step the **old** revision is still serving traffic against the **new**
schema.

That ordering is not an accident and cannot simply be reversed: the new revision usually needs the
new column to exist before it starts. But it means a subtractive migration takes the site down —
Drizzle names every column explicitly in its `SELECT`, so a dropped or renamed column makes every
query from the running app fail with `42703 column does not exist`, for the whole rollout window.

Worse is the failure that does not recover on its own. If the migration succeeds and the deploy
then fails, the database is permanently ahead of the code. There is no down-migration, `drizzle-kit`
does not generate one, and Container Apps has no revision revert wired up here. The only way out is
forward, under pressure, with the site down.

This was recorded as the first bullet of issue #6 and left as a discipline to remember. It is now a
test, because a rule enforced by memory is a rule that holds until the day someone is in a hurry —
and the person in a hurry is usually an agent that has never seen the outage.

## Decision

**Every migration must be additive.** Removal happens in a _later_ migration, after a release in
which no deployed code uses the thing any more.

| Want to         | Do this instead                                                                 |
| --------------- | ------------------------------------------------------------------------------- |
| Rename a column | Add the new one, write both, migrate reads, drop the old one in a later release |
| Drop a column   | Stop reading it, release, then drop it                                          |
| Add `NOT NULL`  | Add it nullable with a default, backfill, tighten later                         |
| Change a type   | Add a new column, backfill, switch reads, drop the old one later                |

`packages/core/src/migration-safety.ts` analyses the generated SQL and
`packages/core/test/migration-safety.test.ts` fails `pnpm verify` on anything subtractive. The
deploy runs the same test again before it touches the database, so a migration cannot reach
Postgres by merging past a red check or dispatching by hand. Failing there leaves the database
untouched, which is the one state that is always recoverable.

A genuinely-needed contracting migration is acknowledged by filename in
`packages/core/migrations/contracting.json`, with a written reason. It lives beside the migrations
rather than inside the `.sql` because CLAUDE.md rule 2 forbids hand-editing generated files — and
because an acknowledgement is exactly the kind of claim that should appear in the diff a reviewer
reads, not buried in generated SQL.

## Iterating without breaking what is deployed

- **Deploy runs from `main` only.** `workflow_run` was already pinned to it; `workflow_dispatch`
  accepted any ref, so a branch could be deployed to the environment `hendingar.no` serves by
  picking it from a dropdown. There is now an explicit guard.
- **A branch's migrations never touch Azure.** CI runs them against a throwaway Postgres service
  container, and locally against your own container. Generating a migration on a branch changes
  nothing in production until it merges.
- **`pnpm db:reset` is local-only** and refuses a non-loopback `DATABASE_URL` (ADR 0006).

So the loop is: branch, `pnpm db:generate`, iterate locally, and the schema in Azure moves only
when main does — at which point the change is already known to be additive.

## Consequences

- A rename now takes two releases. That is the cost, and it is the point.
- The checker is string analysis over the emitted SQL, not a database diff. It cannot catch
  everything — a `CREATE UNIQUE INDEX` on data that already violates it will still fail at apply
  time — but it catches every shape that has a name in the table above.
- `DROP INDEX` is allowed: losing an index makes queries slow, not wrong, and a deploy should not
  be blocked for a performance change.

## Alternatives rejected

**Migrate after the new revision is healthy.** Then the new code starts against the old schema and
fails on its first query for the columns it expects — the same outage, moved.

**A second Azure environment for the dev branch.** A real staging tier, and the honest fix for a
larger team. Rejected for now: it doubles a standing Postgres cost on shared sponsorship credits
(ADR 0007) to solve a problem that expand/contract already solves, and an environment nobody keeps
seeded drifts until it stops telling the truth.
