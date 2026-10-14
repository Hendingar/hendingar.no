# 0024 — hendingar.no is a read-only MCP server at `/mcp`

**Status:** accepted (2026-10-14)
**Builds on:** [ADR 0001](0001-fullstack-monolith.md) (the condition for a public API), [ADR 0002](0002-remote-functions.md) (`+server.ts` is for external consumers)
**Bounded by:** [ADR 0018](0018-kurator.md) and [ADR 0022](0022-haugen-jev.md) — nothing a script can reach may spend money

## Context

People increasingly ask an assistant rather than a website: "kva skjer på Stord i helga?" Asked
of a general model, that question gets a guess, a stale web result, or an invented concert. The
answer exists — it is this site's listing — but the only ways for an assistant to reach it were to
scrape the HTML or to read the JSON-LD on one event page at a time.

The README already promises "everything is exportable" and that "an event index that turns
crawlers away has failed at its job". The Model Context Protocol is how assistants (Claude,
ChatGPT, Cursor, VS Code and others) are told what a service offers and call it. Supporting it is
the same promise, made to the clients people now actually use.

## Decision

**`https://hendingar.no/mcp` is a stateless, unauthenticated, read-only MCP server**, served by
the existing app (`app/src/routes/mcp/+server.ts`) with the official v2 SDK
(`@modelcontextprotocol/server`). It speaks the 2026-07-28 protocol and, through the SDK's
stateless fallback, every 2025 revision.

### Read-only, permanently

Fifteen tools, every one of them a read the site already serves by GET: search, one event in
full, a day, a weekend, an ISO week, counts per day, what is next, standing offers, weekly
activities, the kurator's stored picks, the popular lists, name resolution, categories, sources,
and an `about`. Three resources (`hendingar://event/{id}`, `…/categories`, `…/about`) and two
prompts (`kva-skjer`, `planlegg-helga`).

There is no submission tool, and there will not be one. Submitting runs the verifier — two model
calls per event — and every protection around that (the per-address limits, the site-wide model
budget, the sender reviewing their own verdict in `/ko`) assumes a person at a form. An assistant
that wants to add an event sends its user to `/send-inn`. The same goes for hearts and views:
they are counts of what _readers_ did, and a model calling a tool is not one.

**Read-only by construction, not by a flag.** The tools reach the database through one object,
`liveCatalogue` (`app/src/lib/server/mcp/catalogue.ts`), whose entries are the site's own remote
`query` functions — so an assistant and a reader get the same rows through the same predicates.
`contract.spec.ts` fails if any MCP module imports a remote module that writes, the verifier,
Jev, or `curateToday`, or if any tool stops declaring `readOnlyHint: true`.

### No model call is reachable

The kurator's picks are read from their table, never computed. `askPile` is not exposed, even
behind its budget: the assistant on the other end is already a language model, and a few plain
text searches give it everything Jev would. That keeps this endpoint free to run, which is what
lets it be open.

### No authentication

There is nothing to protect but capacity. Every answer is already public, and there is no write.
A key would add a signup — an account in all but name, which the README rules out — for no gain.
Capacity is bounded by an `mcp` policy in `limits.ts` (60 calls a minute per network, on top of
the 120-a-minute floor every POST already meets) and by the input caps the core schemas already
carry. CORS is open (`*`), because there is no cookie to steal and browser-based clients cannot
connect without it. SvelteKit's CSRF check does not apply: it refuses cross-origin _form_
content types, and MCP is JSON.

### The contract is the tool list

ADR 0001 said that a stable public API needs "a generated, checked-in contract and a CI job that
fails when it drifts". Here the contract is:

- the input schemas, which are the `packages/core` Zod schemas the pages already validate with
  (rule 1), annotated with `.describe()` and never redefined;
- the output schema, `packages/core/src/public-event.ts`, with one mapper (`toPublicEvent`) that
  every tool returns through;
- `contract.spec.ts`, which pins the tool, resource and prompt names and fails on any rename,
  addition or removal.

This does not trigger 0001's "extract a service" clause. The server is a thin adapter over
queries the monolith already owns, and it needs nothing a separate service would add.

### What every answer carries, and what it never does

Each event comes with its address on hendingar.no, an `.ics` link, and every source that reported
it — we are an index, not a replacement. Times come twice: ISO 8601 with the venue's own offset,
and as the wall clock a person reads, so an assistant has nothing to convert and nothing to get
wrong. No hearts, views or rank appear in any payload, the same rule as ADR 0018, and
`popular_events` says in its description that it measures attention, not quality.

### How it should look is said beside the data

Every list result carries, after its JSON, a one-line presentation hint (group by day, title
linked to `url`, an add-to-calendar link to `icsUrl`, the ticket link, the source), and one
`resource_link` per event pointing at `hendingar://event/{id}`. `get_event` and `weekend_picks`
carry their own hint. The server instructions say it too, but instructions are read once at
connect: the first real conversation through Claude had `url`, `icsUrl` and `posterUrl` for every
event and used none of them. A line read with the data is what changed that. `contract.spec.ts`
pins the hints' presence.

### Cards, where the client can draw them (MCP Apps)

The tools that answer a whole question in one call — `weekend_events`, `events_on_date`,
`week_events`, `upcoming_events` — and `show_events` (a selection the assistant made, at most
twelve) name a view: `ui://hendingar/events.html`, an MCP App the client draws inline as cards —
the site's own thumbnails, the day headings, and buttons to add an event to the calendar, open its
tickets, or ask the assistant for more. `search_events` deliberately does not: an assistant runs
four or five searches to answer one question, and a widget per search would fill the chat with
half-relevant cards.

At first only `show_events` had the view, and the first real conversation never called it. Asked
what was on at the weekend, Claude called `weekend_events`, got 62 rows and wrote them out as a
list; a twelve-card picker did not look like the tool for an overview. The view now accepts any
of these results (`viewResultSchema`: a listing row, or a full record), so the call the model
already makes is the one that draws.

- **The view is Svelte, built into one inline page.** `server/mcp/view-plugin.ts` runs a nested
  Vite build of `src/lib/mcp-view/` (reusing `EventThumb` and `brand.css`) and hands the server the
  HTML as a string. No script or style is loaded from anywhere, so the frame's CSP need only name
  image origins: ours, Wikimedia's (the church paintings), and the CDNs the listed posters are
  hot-linked from, read from the database when the resource is read.
- **It fetches nothing and navigates nowhere.** The host delivers the tool result; every link is
  opened by asking the host (`ui/open-link`); "Fortel meir" asks the assistant (`ui/message`). The
  result is parsed with `showEventsResultSchema` from core, the same schema the server writes it with.
- A client without MCP Apps gets the same events as JSON and a hint, and loses nothing.

### Nothing is logged

Not the tool, not its arguments, not the search words. The README's "no search terms" applies to
an assistant exactly as it does to a reader, and no view is recorded for an event a model reads.

## Consequences

- `/ki` explains how to connect, in Nynorsk, and the footer links to it.
- A tool rename is a breaking change for everybody who has connected. Add a new name beside the
  old one, and remove the old one in a later release, the same expand-then-contract rhythm
  ADR 0010 gives migrations.
- `pnpm verify` runs the contract test. `app/e2e/mcp.e2e.ts` covers the route: the cross-origin
  POST, the CORS preflight, the 405 on GET, and every tool against the seed.
- **Open:** the event data has no stated reuse licence. Code is AGPL-3.0; the rows we collect are
  other people's calendars, linked back. A machine interface makes that question more pressing,
  not new. It needs its own decision (likely CC BY 4.0 for what we write ourselves, with
  third-party facts attributed to their sources) and is deliberately not settled here.

## How we'd know we were wrong

- **The limit bites real use.** If `/mcp` 429s show up from addresses that are clearly one
  assistant answering one person, raise the `mcp` policy. It bounds load, not a bill.
- **Assistants misquote us anyway.** If answers keep dropping the link or the source, the
  instructions are not enough. Put the attribution in the text content itself, not only in a field.
- **Someone needs to write through it.** A contribution path for organisers (fill an empty field
  on their own event, ADR 0014) is the only write worth considering. It would need an identity
  the site does not have, so it would be a new ADR, not an edit to this one.
