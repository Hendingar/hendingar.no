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
make the browser specs depend on a third party's uptime. It is still not production volume, so
`pnpm db:bootstrap` exists to get the full picture in one command; after a `db:reset`, run
`pnpm ingest`.

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

services/verifier/src/verifier/
  llm.py                   Entra token → AsyncOpenAI. Rebuilt per call; the credential is reused
  extract.py               the vision call. Nynorsk prompt, strict json_schema
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

A style rule used by more than one route belongs in `brand.css`, not in a route's `<style>`.
Scoped in a component, the next agent cannot see it and writes a second one.

## Rules

1. **`packages/core` is the only place** schema, taxonomy and validation live. If you find yourself
   redefining a category list or an event shape in `app/` or `importers/`, import it instead.
2. **Never hand-edit generated migrations.** Change `packages/core/src/schema.ts`, then
   `pnpm db:generate` **and `pnpm db:migrate`**. A hand-edited migration desynchronises schema from
   database silently — and generating without applying breaks writes to that table immediately,
   because Drizzle names the new column in its INSERT. That failure surfaces somewhere unrelated
   (a form that no longer returns a result), so it costs more to diagnose than to avoid.
3. **`services/verifier` is the only place a model runs.** No model SDK in `app/` or
   `importers/`, and no API keys anywhere — the service authenticates to Azure with a managed
   identity. Importers are `fetch → parse → validate → upsert`, deterministic and replayable;
   verification happens later, on already-structured data, with a human reviewing anything
   uncertain. See `docs/decisions/0004-deterministic-importers.md` and
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
   unavailable verifier produces `recommendation: 'review'` and the event is stored for a human.
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

### Never call `toLocaleString` directly

Use `formatEventTime` from `@hendingar/core/datetime`. Two reasons, both measured:

- **`nn-NO` does not exist in browser ICU.** Node resolves it; Chromium returns `[]` from
  `supportedLocalesOf` and silently falls back to the _visitor's_ locale, so an English browser
  renders `9/12/2026` for 12 September. Server and client then disagree on the same row.
- **A `timestamptz` is an instant, not a wall clock.** Always format with the venue's `timezone`.
  Assuming Oslo renders a 20:00 Helsinki concert as 19:00.

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
