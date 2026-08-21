# 0003 — Drizzle for schema, types and migrations

**Status:** accepted (2026-08-21)

## Context

Issue #1 left this open: "Drizzle or Kysely — pick one and write down why". The criterion is the
same as everywhere else in this repo: which option makes drift impossible rather than merely
unlikely.

## Decision

**Drizzle ORM** against PostgreSQL. `packages/core/src/schema.ts` is the single definition of the
database, and row types are inferred from it via `$inferSelect` / `$inferInsert`. Migrations are
generated with `pnpm db:generate` and committed as reviewable SQL.

## Consequences

- **No codegen step between schema and types.** The schema is TypeScript; the types _are_ the
  schema, inferred. There is no generated file that can be stale, and therefore no state where the
  types compile but describe a database that no longer exists.
- Migrations are plain SQL, reviewable in a PR. Generated — never hand-edited (see `CLAUDE.md`).
- Good PostGIS support, which matters because the map is not optional here (0005).
- Small runtime, close to SQL, so what you read is what executes.

Rejected:

- **Prisma** — a separate schema DSL and a real codegen step, so schema and client can desync
  between edits. Historically the weaker geo story, which is disqualifying given the map.
- **Kysely** — an excellent query builder, but types are either hand-maintained or generated _from_
  the database, meaning the definition of truth lives outside the repo. That is the exact drift
  class this decision exists to remove.

## How we'd know we were wrong

If migration generation starts producing destructive or wrong SQL for our schema changes often
enough that we stop trusting it, the value proposition is gone — at that point prefer hand-written
migrations with Drizzle retained purely as a typed query layer.
