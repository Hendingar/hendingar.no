# hendingar.no

**Open-source event aggregation for local communities across Europe.**

Every community has vibrant local events — pub concerts, theatre, farm tours, kulturhus
gatherings, workshops, meetups. Finding them means trawling a dozen Facebook pages,
Instagram accounts and scattered websites. hendingar.no aims to be the single, open place
those events live.

Crowdsourced, geotagged, free forever. Think Lu.ma without the payments, the ads, or the
lock-in — community-owned infrastructure for public-good information.

> **Status:** early development. Not ready for production use.
> Dev site: https://dev.hendingar.no · Started February 2026

## What it does

- **Aggregates local events** — one searchable, geotagged listing instead of a dozen silos
- **Shows its work** — [`/datasamling`](https://ca-hendingar-dev.whitewave-5f5b53f5.swedencentral.azurecontainerapps.io/datasamling)
  is a public status board: every source, how it is collected, how often, and what the last run did
- **Accepts submissions from anyone** — no account required to add an event
- **Lets anyone improve an event that is already there** — a photograph for a row that has no
  poster, a second source, a ticket link. Gaps only: nothing already on an event is overwritten,
  every contribution is recorded field by field, and contributors are credited beside the
  calendars ([ADR 0014](docs/decisions/0014-event-enrichment.md))
- **Verifies submissions with an agent pipeline** — see below
- **Shows events on a map** — find what's happening near you
- **Exports openly** — RSS and iCal per location, so your calendar app is a first-class client
- **Keeps data in the EU** — GDPR by architecture, not by policy page

## What it does not do

Scope discipline is a feature. hendingar.no is deliberately **not**:

- **A ticketing or payments platform** — no checkout, no fees, no rent extraction. Link out to
  wherever tickets actually live.
- **A social network** — no follows, no feeds, no engagement metrics, no notifications designed
  to pull you back in.
- **An ad platform** — no ads and no data sales, ever. There _is_ one analytics tracker: a
  [d8a](https://d8a.tech) collector, so we can tell whether anybody is reading this and whether it
  sends them anywhere. It runs **cookieless** — we deny `analytics_storage` before the tracker
  starts, so it writes nothing to your browser and cannot recognise you on a second visit. No
  Google-owned script runs in the page, nothing follows you to another site, and there is no
  advertising profile — but a third party does receive a page view and an IP, and saying "no
  tracking" while that is true would be a lie.

  Six events, and this is the whole list (`app/src/lib/analytics.ts`):

  | Event             | What it carries                                                      |
  | ----------------- | -------------------------------------------------------------------- |
  | `page_view`       | the page's URL and title                                             |
  | `view_event`      | event id, category, source, how many days ahead                      |
  | `select_content`  | event id, category, which listing it was opened from                 |
  | `click`           | the **host** a link went to, and whether it was a ticket or a source |
  | `add_to_calendar` | event id                                                             |
  | `submit_result`   | how it was sent in, and which of the five outcomes                   |

  Every parameter is a fact about the _event_, never about the reader. No search terms, no filter
  choices, no scroll depth, no time on page, nothing joinable back to a person. Those are the
  engagement metrics named two bullets up, and a non-goal is only worth having if it holds when it
  is inconvenient.

  **Automated browsers are not counted, and are not blocked either.** A month of the dashboard,
  filtered to the United States, was 501 page views of headless Chrome out of cloud datacentres,
  in sessions exactly an hour long. The site still serves every one of those requests — an event
  index that turns crawlers away has failed at its job — but reporting them makes the numbers
  answer a different question from the one they are for. The filter is client-side and honest
  about its limits (`isAutomatedBrowser`): a scraper that patches `navigator.webdriver` still gets
  counted, and nothing running in the page can do anything about that.

- **A walled garden** — accounts stay optional, and everything is exportable. Leaving is easy
  by design.

## Agentic verification

Open submission invites spam, duplicates and junk. Rather than gate contributions behind accounts,
every incoming event runs through six checks before it goes live. Four are **rules** — code with
the same answer every time. Two ask a **language model**, because they need judgement:

| Check          | How              | What it asks                                                  |
| -------------- | ---------------- | ------------------------------------------------------------- |
| Plausibility   | model            | Is this a real event, or spam / a test / an ad?               |
| Duplicate      | rule + shortlist | Does it already exist, across venue, time and title variants? |
| Normalisation  | rule             | Are time, place and required fields present and well-formed?  |
| Coverage       | rule             | Is it in a municipality we publish?                           |
| Categorisation | model            | Does the category match the content?                          |
| Corroboration  | rule             | Can it be confirmed against a cited source?                   |

**Coverage is the newest, and it exists because we got it wrong.** A concert in Grieghallen, Bergen
was submitted, passed every check — correctly; it is a real, well-formed, correctly categorised
concert — and went live on a calendar for Sunnhordland, because not one of the five questions was
"where is this". It has three answers rather than two: a covered place publishes, a different
municipality is refused, and _nothing stated_ is a question sent back to the sender rather than a
refusal, because most people leave the kommune box empty and their events are local anyway. See
[ADR 0015](docs/decisions/0015-coverage-area.md).

A unanimous confident pass publishes immediately. Everything else is decided the same moment, with
one of five outcomes — `approved`, `duplicate`, `shady`, `declined` or `contributed` — because there
is no queue and nobody in it. The person who sent it in is the one who can fix it: they see which
check stopped it and why, and can correct it in `/kø` and send it again. A submission nobody comes
back to is deleted after 48 hours, and revising it starts that clock over.

**A duplicate is an invitation, not a refusal.** The events we already hold are mostly imported, and
imported rows are thin — no poster, one citation, a deliberately vague category, because copying
what a calendar publishes is honest and guessing at what it does not is not. So when a submission
turns out to be about an event we have, the sender is offered the useful answer instead of the
door: their poster, source link, ticket link, end time or description fills whatever that row is
missing, they are credited on it, and no second listing appears. Only gaps are filled — a field
that holds something keeps it — which is what makes it safe to let an anonymous browser write to a
live page at all. See [ADR 0014](docs/decisions/0014-event-enrichment.md).

Nothing is deleted on a model's say-so _while it can still be corrected_: a rejected submission is
stored as rejected, so a wrong call is recoverable and repeat spam has something to match against.
See [ADR 0012](docs/decisions/0012-no-review-queue.md).

Every check's verdict, confidence and reasoning is stored and shown to the submitter, in Nynorsk.
The reasoning is the product, not a debug log.

**Two ways to submit.** Upload an image — a poster on a noticeboard, a screenshot of a Facebook
event, an advert in the paper — and we read the event out of it and hand you a filled-in
suggestion. You review and correct it before anything is sent, and the image is downscaled in your
browser, stripped of location data, read once and never stored. Or fill the form in yourself; it
works without JavaScript.

Extraction is transcription, not writing, so it is pinned as close to deterministic as the API
allows: temperature 0, a fixed seed, and a strict JSON schema. Two people photographing the same
poster should get the same suggestion.

**No API keys anywhere.** The one service that calls a model runs on its own managed identity
against an account with key authentication disabled. See
[ADR 0008](docs/decisions/0008-verification-service.md).

## Status

| Phase               |            |                                                                                           |
| ------------------- | ---------- | ----------------------------------------------------------------------------------------- |
| **1 — Hello World** | ✅ Done    | SvelteKit + TypeScript, serverless on Scaleway, PostgreSQL, Woodpecker CI/CD              |
| **2 — MVP**         | 🚧 Now     | Submission form, listing + map view, search & filtering, categories, agentic verification |
| **3 — Community**   | ⏳ Planned | Optional accounts, moderation tooling, RSS/iCal, notifications                            |

Coverage today: **Stord, Bømlo and Fitjar** — the three municipalities in
`packages/core/src/coverage.ts`, which is what the coverage check enforces and the only thing that
decides where a submission can be. Bergen and Haugalandet were once written here as pilot regions
and were never covered by a source or a check; saying so cost a real submitter their event. Outward
from Sunnhordland, then across the EU — one municipality at a time, each added to that list.

### Under consideration

Two areas we may build, on one condition — never as a commercial offering:

- **Organiser tooling** — attendee lists, check-in, capacity and seating. Useful to the volunteer
  running a village concert; only worth building if it stays free for everyone.
- **Event visibility** — curation, editorial picks, highlighting what a community cares about.

The line is not _whether_ these exist but _how they are obtained_: earned or given, never bought.
No pay-to-rank, no sponsored placement, no paid tier that unlocks them. If a feature only makes
sense with a price attached, it doesn't belong here.

## Tech stack

**App:** SvelteKit (TypeScript, strict) · remote functions for all client↔server calls · UnoCSS ·
open-source mapping (MapLibre-class, still undecided)
**Data:** PostgreSQL + PostGIS · Drizzle for schema, types and migrations · Zod validation shared
between the app and the importers
**Infra:** Azure Container Apps (scales to zero) · Azure Database for PostgreSQL Flexible Server ·
Azure Container Registry · Bicep · GitHub Actions with OIDC — no stored cloud credentials

Chosen for cost, independence and — unusually — for how quickly the codebase can tell you that
you're wrong, since much of this is built with coding agents. One command (`pnpm verify`) is the
whole truth; types cross every boundary; each fact has exactly one source. The reasoning behind each
choice is in [`docs/decisions/`](docs/decisions/).

Infrastructure for development is sponsored by **Nordlo**.

## Development

Requires Node.js 22+, pnpm 11+, and Apple's [`container`](https://github.com/apple/container)
(`brew install container`) for the local database — no Docker.

```bash
git clone https://github.com/Hendingar/hendingar.no
cd hendingar.no
pnpm install

pnpm db:up          # starts Postgres+PostGIS, and creates .env on first run
pnpm db:migrate
pnpm db:seed        # a couple of events to look at

pnpm dev            # http://localhost:5173
pnpm verify         # typecheck, lint, test — run this before opening a PR
```

Postgres listens on **5433**, not 5432, because 5432 is so often already taken and the collision
shows up as a baffling authentication error against someone else's database.

Useful: `pnpm db:psql`, `pnpm db:logs`, `pnpm db:reset` (wipes and re-migrates; refuses to run
against anything that isn't localhost).

Architectural decisions are recorded in [`docs/decisions/`](docs/decisions/) — worth a skim before
proposing a change to the stack. `CLAUDE.md` is the working contract for both humans and agents.

## Contributing

This is a community project and contributions are welcome — code, docs, design, bug reports,
or event data for your own region.

Priority areas for Phase 2: submission form and validation, map view with clustering, search
and filter UI, event detail pages, and the moderation queue.

Start here: **[CONTRIBUTING.md](CONTRIBUTING.md)**

Know a local calendar we should be importing from? That's the single most useful thing you can
contribute — see **[docs/event-sources.md](docs/event-sources.md)** and open a
[source request](https://github.com/Hendingar/hendingar.no/issues/new?template=event-source.yml).

## Why these choices

**Why open source?** Local event information is public-good infrastructure. It shouldn't be
controlled by for-profit platforms that optimise for engagement over community value.

**Why EU-hosted?** Your data should sit under strong privacy law, not a transfer agreement.

**Why no payments?** Events bring people together. That shouldn't be a toll booth.

**Why crowdsourced?** Local communities know their events best. We build the platform; you
bring the knowledge.

## License

[GNU AGPL-3.0](LICENSE). Copyleft that reaches across the network: run a modified
hendingar.no as a service and you must publish your changes. The platform stays
community-owned by construction.

---

_hendingar_ = "events" in Norwegian — nynorsk, to be precise. 🇳🇴
