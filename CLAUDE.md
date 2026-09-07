# hendingar.no — agent contract

Open-source event aggregation for local communities. Read `README.md` for what this product is and
[what it deliberately is not](README.md#what-it-does-not-do) — the non-goals are binding, not
aspirational.

## The one command

```bash
pnpm verify        # typecheck (incl. svelte-check) → lint → test. Exits non-zero on any failure.
```

`pnpm verify` does not see `services/verifier` — it is Python. For that:

```bash
cd services/verifier && ruff check . && ruff format --check . && pytest -q
```

**Run it before claiming a task is done.** If it passes, you are done; if it fails, you are not.
Nothing else is evidence — not "it looks right", not a passing subset of tests.

```bash
pnpm db:bootstrap  # up + migrate + seed + ingest. A database that looks like production
pnpm dev           # http://localhost:5173
pnpm test:e2e      # Playwright, headless
pnpm db:psql       # a shell in the database
pnpm db:reset      # wipe and re-migrate (local only; it refuses otherwise)
pnpm ingest        # fetch every source — RUN THIS AFTER ANY RESET
```

**`db:seed` gives sixteen events; `pnpm ingest` gives a hundred.** The seed is deliberately
representative — several days, several categories, and six events carrying a poster — because day
grouping and thumbnails are not observable without them, and the listing e2e specs assert both.
Posters in the seed are a local same-origin file: a seed that hotlinked the source's CDN would
make the browser specs depend on a third party's uptime.

**A seed-only database misreports the product, and it does so quietly.** It holds one source, so
`/datasamling` lists a single collected row and the front page's coverage line says "1 kjelde";
almost nothing has a poster, so the listing fills with generated tiles. Both look exactly like a
regression in code that is in fact fine — this has already been reported as one. `pnpm db:reset`
now prints what to run next, and `pnpm db:bootstrap` gets the whole picture in one command.

## Shipping

Every change lands as **one branch → one PR → merged on green → branch deleted**, and merging
without asking is authorised. The `ship` skill (`.claude/skills/ship/SKILL.md`) is that workflow
written down, including the two things that have actually gone wrong: branching off an unmerged
branch, which conflicts against everything the parent touched once it squash-merges, and running
the e2e specs against a database CI does not use.

Deploy and ingest are not yours to trigger. Deploy runs on merge to `main`; ingest runs on a daily
cron against the live database. **A deploy ships code, not data** — a newly merged importer imports
nothing until the next scheduled run.

## Layout

```
app/                SvelteKit — UI and *.remote.ts server functions
packages/core/      THE source of truth: Drizzle schema, migrations, Zod schemas, taxonomy
importers/          Deterministic source importers (see docs/event-sources.md)
services/verifier/  Python. The ONLY place a language model is called (ADR 0008)
infra/              Bicep. main = platform, app/verifier = the two Container Apps
docs/decisions/     ADRs — read before re-opening a settled question
```

This is a **fullstack monolith on purpose**. See `docs/decisions/0001-fullstack-monolith.md`.
Don't propose splitting the frontend from the backend; the reasoning is recorded there.

## Where things go

There was no component directory and no stated rule, so the landing page grew to 660 lines and the
event card was written twice. The convention now:

```
app/src/lib/
  components/            reusable across routes — EventCard, EventList, SiteFooter
  components/landing/    single-use sections owned by `/`
  content/               copy as named, typed data — not string arrays inside layout code
  styles/brand.css       tokens AND cross-route primitives (.btn, .display--*, .fineprint)
  server/                server-only. Never importable from the client
  events.remote.ts       the one client↔server boundary
app/e2e/                 Playwright specs

app/src/lib/components/submit/   single-use sections owned by `/send-inn`
app/src/lib/submit.remote.ts     the submission boundary — photo, form, verification

app/src/lib/components/hendingar/  single-use sections owned by `/hendingar`
app/src/lib/listing-url.ts         filters ↔ URL. The page, the tokens and the suggestions all
                                   compose addresses through it, so they cannot disagree

services/verifier/src/verifier/
  llm.py                   Entra token → AsyncOpenAI. Rebuilt per call; the credential is reused
  extract.py               the vision call. Nynorsk prompt, strict json_schema
  crop.py                  the small vision call: where to cut a thumbnail, or nothing
  verify.py                the five checks. Rules and model calls deliberately mixed
  app.py                   FastAPI. create_app(config, factory) so tests inject a stub
  tests/test_contract.py   asserts the check names still match packages/core

importers/<source>/      one deterministic importer per source, or per *platform*:
                         `mec/` reads every Modern Events Calendar site from one parser, with
                         the sites as data in src/instances.ts. Adding one is a config entry.
  src/api.ts               upstream schema + paginator. Validates every response
  src/map.ts               PURE upstream -> our shape. No I/O, no clock, no randomness
  src/ingest.ts            orchestration, upsert, and the ingest_runs row
  test/fixtures/           committed real responses. No test touches the network
```

**Every importer run writes an `ingest_runs` row**, including failures. That table is what
`/datasamling` renders — the page can only say a source is collected because a run says so. If you
add an importer, record its runs the same way or it will be invisible when it silently stops.

**A package under `importers/` IS the registration.** `pnpm ingest` is
`pnpm -r --filter "./importers/*" --no-bail ingest`, and the workflow runs that one command — so a
new importer needs no entry in `package.json` and no step in `.github/workflows/ingest.yml`. It
needs an `ingest` script, and `/kjelder` groups it automatically if its source slug carries a
platform prefix (`platformOf` in `packages/core/src/directory.ts`).

`--no-bail` is deliberate: the chain used to be `a && b && c`, so one rate-limited upstream stopped
every importer after it and six healthy sources silently did not run. Each source now reports its
own row and a failure costs only itself.

A style rule used by more than one route belongs in `brand.css`, not in a route's `<style>`.
Scoped in a component, the next agent cannot see it and writes a second one.

## Rules

1. **`packages/core` is the only place** schema, taxonomy and validation live. If you find yourself
   redefining a category list or an event shape in `app/` or `importers/`, import it instead.
2. **Never hand-edit generated migrations, and keep every migration additive.** Change
   `packages/core/src/schema.ts`, then `pnpm db:generate` **and `pnpm db:migrate`**. A hand-edited
   migration desynchronises schema from database silently — and generating without applying breaks
   writes to that table immediately, because Drizzle names the new column in its INSERT. That
   failure surfaces somewhere unrelated (a form that no longer returns a result), so it costs more
   to diagnose than to avoid.

   Migrations run **before** the new revision is healthy, so the old code meets the new schema.
   Dropping, renaming or tightening anything takes the site down for the rollout window, and a
   migration that succeeds before a failing deploy leaves the database permanently ahead of the
   code with nothing to roll back to. Remove things in a _later_ release, once nothing deployed
   reads them. `pnpm verify` fails on a subtractive migration — see
   [ADR 0010](docs/decisions/0010-expand-contract-migrations.md).

3. **`services/verifier` is the only place a model runs.** No model SDK in `app/` or
   `importers/`, and no API keys anywhere — the service authenticates to Azure with a managed
   identity. Importers are `fetch → parse → validate → upsert`, deterministic and replayable;
   verification happens later, on already-structured data, and anything uncertain is reported back
   to whoever sent it in so they can correct it (ADR 0012). See `docs/decisions/0004-deterministic-importers.md` and
   `docs/decisions/0008-verification-service.md`.
4. **No `any`, no `as` escape hatches.** If a type is fighting you, the type is telling you
   something. `as unknown as T` in a PR is a red flag, not a fix.
5. **No barrel files.** No `index.ts` that only re-exports. They defeat grep, which is how both
   humans and agents find things here. Import from the defining module.
6. **Tests are hermetic.** No network, no wall-clock dependence, no ordering dependence. Importer
   tests run against committed fixtures. A flaky test is worse than no test: it makes failure
   ambiguous, and ambiguous failure breaks the whole loop this repo is built around.
7. **Server-only code stays server-only.** Database access lives behind `*.remote.ts` or
   `$lib/server/**`. If a secret or a `pg` import can reach the client bundle, that's a bug.
8. **Verification failing must never mean submission failing.** `verifyEvent` does not throw; an
   unavailable verifier produces `recommendation: 'review'`, and the event is stored, declined, and
   shown to its sender in `/kø` so they can try again. It is never silently published, and never
   lost — but it is deleted after 48 hours if nobody comes back to it (ADR 0012).
   The same applies to the photo shortcut: it is hidden when `VERIFIER_URL` is unset, never shown
   as a button that cannot work.

## Client↔server: remote functions

We use SvelteKit **remote functions** (`query` / `form` / `command` in `*.remote.ts`), validated
with Zod. The validator _is_ the wire type — there are no hand-written request/response types and
there should never be a hand-written `fetch` to our own API.

These are **experimental**, enabled in `app/vite.config.ts` (there is no `svelte.config.js` — this
is SvelteKit `3.0.0-next`, where config moved into the `sveltekit()` Vite plugin). That is
deliberate and the exit path is documented — read `docs/decisions/0002-remote-functions.md` before
changing it.

## Svelte MCP

`.mcp.json` gives you the official Svelte MCP server, and `.claude/` carries the official Svelte
skills plus a `svelte-file-editor` subagent. Both were generated by `sv add ai-tools` — regenerate
rather than hand-editing them.

The tool instructions live in @AGENTS.md — imported here so there is one copy, not two.

> Alternatives to the committed stdio server: the remote server at `https://mcp.svelte.dev/mcp`, or
> the full Claude Code plugin (`/plugin marketplace add sveltejs/ai-tools`, then
> `/plugin install svelte`).

## Framework specifics worth knowing

This scaffold is on **SvelteKit `3.0.0-next`**, which differs from most training data and most blog
posts. Concretely:

- **There is no `svelte.config.js`.** Config lives in the `sveltekit()` plugin in `app/vite.config.ts`.
- **`$lib` does not exist here.** There is a `#lib` subpath mapping, but it only works for
  **assets** (`import favicon from '#lib/assets/favicon.svg'`). It cannot address TypeScript
  modules: `moduleResolution` is `bundler` and `rewriteRelativeImportExtensions` is on, so an
  extensionless `#lib/x` doesn't resolve and a non-relative `#lib/x.ts` is a hard error. **Use
  relative imports for code** (`./server/db`, `../lib/events.remote`) — which is what the scaffold
  itself does.
- **`$env/*` does not exist here.** Environment variables are declared in `app/src/env.ts` via
  `defineEnvVars`, with a Standard Schema validator, and imported from `$app/env/private` (or
  `$app/env/public`). They are validated at startup, so a bad `DATABASE_URL` fails by name
  immediately. Adding a variable means editing `src/env.ts` — nothing reads `process.env` directly.
- `app/src/lib/index.ts` must stay empty. It exists only to back the bare `#lib` specifier — do not
  grow it into a barrel (rule 5).
- Unit tests are split into two vitest projects: `server` (node) and `client` (real browser via
  Playwright). `pnpm verify` runs only `server`, to stay hermetic and fast. Component tests are
  `*.svelte.spec.ts` and run under `pnpm test:unit`.

When in doubt about Svelte 5 or SvelteKit API, use the MCP `list-sections` / `get-documentation`
tools rather than recalling — this area has changed recently and confidently-wrong is the failure
mode here.

### Data must reach the server-rendered HTML

**Use top-level `await` in `<script>`, never a query's `.loading` flag.** A remote query's
`loading` is always true during SSR, and a `<svelte:boundary>` `pending` snippet renders whenever
the boundary is first created — which on the server is always. Both put a placeholder in the HTML
and ship zero data, which on an event-discovery site means crawlers and no-JS visitors see
"Lastar…" and nothing else. `await` at the top of the script suspends the component so SvelteKit
waits for it. Put a boundary with only a `failed` snippet around the component if you need an
error path.

### A server-rendered form is live before it is hydrated

A remote form is real HTML and submits without JavaScript, so people can type into it from the
moment the markup lands. Hydration then spreads the form's field state back over every input —
`{...f.title.as('text')}` carries a `value` — and that state knows nothing about what is already in
the boxes, so it **erases everything typed in the gap**, silently.

The gap is unavoidable: SvelteKit hydrates from a dynamic `import()`, which runs after `load`.
Measured at 20ms idle and 320ms with the machine busy. It cost four e2e specs a week of ambiguous
failures — Playwright types the instant `page.goto` resolves, which is `load`, which is before
hydration — and it costs a real visitor on a slow phone their first sentence.

`app/src/lib/typed-before-hydration.ts` is the fix: read what the rendered form holds from the
component's `<script>`, which runs before that component's template is hydrated, and put it back.
**Any new remote form needs the same treatment**, and the same goes for anything else that reads a
value out of state on mount and writes it to an input.

### Never call `toLocaleString` directly

Use `formatEventTime` from `@hendingar/core/datetime`. Two reasons, both measured:

- **`nn-NO` does not exist in browser ICU.** Node resolves it; Chromium returns `[]` from
  `supportedLocalesOf` and silently falls back to the _visitor's_ locale, so an English browser
  renders `9/12/2026` for 12 September. Server and client then disagree on the same row.
- **A `timestamptz` is an instant, not a wall clock.** Always format with the venue's `timezone`.
  Assuming Oslo renders a 20:00 Helsinki concert as 19:00.

### A source's stated offset is not evidence

`2026-09-07T18:00:00+02:00` looks like a fact and is a claim. Modern Events Calendar adds the
site's offset to the wall clock and then also writes the offset it just added, so Bømlo
folkebibliotek's 16:00 Pokémontreff published as an 18:00 event — on the page, in the JSON-LD, and
in the `.ics` people put in their calendars. Nothing was malformed and nothing failed; the number
was simply two hours out, for months. `importers/allevents` found the same class of bug in an
"epoch" that was really a wall clock.

So when an importer reads a time, **cross-check it against something the source shows a human** —
the clock rendered on the card, a `time_display` string, the event's own page — and prefer that
where they disagree. Then resolve the wall clock against the venue's IANA zone with
`zonedWallClockToInstant`, never against the offset in the string: an offset is a fact about one
moment, a zone is a fact about a place, and only the second is still true after the clocks change.

**And never key an importer's `external_id` on the start instant.** Correcting a time then changes
the key, which inserts a second row and abandons the first — still published, still wrong, and
beyond the reach of every later run. Key on the day (`<upstream id>@2026-09-07`) so a re-timed
event updates in place. `importers/mec` carries the full story in `src/map.ts`.

### A component rule on a bare element beats brand.css

Svelte rewrites `input { … }` to `input.svelte-hash { … }` — specificity (0,1,1), which outranks a
shared single-class utility like `.visually-hidden` at (0,1,0). A component that styles an element
type therefore silently overrides `brand.css` for every such element inside it, including ones it
never meant to touch. This gave two visually-hidden radios `inline-size: 100%` and pushed
`/send-inn` 25px past the viewport at 320px. **Select on a wrapper class** (`.field input`), not on
the element type.

### Display type is sized in `cqw`, never `vw`

A shared `vw` step overflowed the hero on desktop and clipped the CTA at 320px — the same bug at
both ends. Size display text against its own container. `ch` does not constrain an expanded face.

## Conventions

- TypeScript `strict`. Tabs, single quotes, 100 columns (`pnpm format`).
- **Styling: tokens in `app/src/lib/styles/brand.css`**, consumed as CSS custom properties. No
  colour literals in components. UnoCSS is still listed in the README as intended, but is not
  installed — the design is bespoke poster layout that utility classes wouldn't shorten, so it was
  not worth the machinery yet. Read `docs/brand.md` before touching visual design; it records the
  measured contrast ratios, why display type is sized in `cqw` rather than `vw`, and the rule that
  rotated text is decorative only.
- Timestamps: store `timestamptz`, which records an **instant** — it does not retain the source's
  written offset, and cannot. `2026-09-12T20:00:00+02:00` and `18:00Z` are the same row. That is
  correct, but it means the wall-clock time a user should see is only recoverable with a timezone:
  keep one on the venue (`Europe/Oslo` for the pilot) and format with it. Never format an event
  time in the server's or browser's local zone — that silently shifts concerts by an hour.
- Every imported event keeps a link to its source. We are an index, not a replacement.
