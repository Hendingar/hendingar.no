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
- **Accepts submissions from anyone** — no account required to add an event
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
- **An ad platform** — no ads, no tracking, no data sales. Ever.
- **A walled garden** — accounts stay optional, and everything is exportable. Leaving is easy
  by design.

## Agentic verification

Open submission invites spam, duplicates and junk. Rather than gate contributions behind
accounts, incoming events run through an agent pipeline before they go live:

| Check          | What it does                                                        |
| -------------- | ------------------------------------------------------------------- |
| Plausibility   | Is this a real event, or spam / a test / an ad?                     |
| Deduplication  | Match against existing events across venue, time and title variants |
| Normalisation  | Resolve dates, times and recurrence into structured form            |
| Geocoding      | Turn a venue name into coordinates; flag when it can't be placed    |
| Categorisation | Assign category and tags (concert, theatre, kulturhus, sports, …)   |
| Corroboration  | Look for the event at its cited source URL                          |

High-confidence events publish immediately. Anything uncertain goes to a human moderation
queue — the agent triages, people decide. Verification status is visible on every event, and
the agent's reasoning is auditable rather than a black box.

## Status

| Phase               |            |                                                                                           |
| ------------------- | ---------- | ----------------------------------------------------------------------------------------- |
| **1 — Hello World** | ✅ Done    | SvelteKit + TypeScript, serverless on Scaleway, PostgreSQL, Woodpecker CI/CD              |
| **2 — MVP**         | 🚧 Now     | Submission form, listing + map view, search & filtering, categories, agentic verification |
| **3 — Community**   | ⏳ Planned | Optional accounts, moderation tooling, RSS/iCal, notifications                            |

Pilot region: Norway — Bergen, Haugalandet, Sunnhordland — then outward across the EU.

### Under consideration

Two areas we may build, on one condition — never as a commercial offering:

- **Organiser tooling** — attendee lists, check-in, capacity and seating. Useful to the volunteer
  running a village concert; only worth building if it stays free for everyone.
- **Event visibility** — curation, editorial picks, highlighting what a community cares about.

The line is not _whether_ these exist but _how they are obtained_: earned or given, never bought.
No pay-to-rank, no sponsored placement, no paid tier that unlocks them. If a feature only makes
sense with a price attached, it doesn't belong here.

## Tech stack

**App:** SvelteKit 2.x (TypeScript) · UnoCSS · open-source mapping (MapLibre-class, TBD)
**Infra:** Scaleway Serverless Containers · Serverless SQL (PostgreSQL) · OpenTofu · Woodpecker CI

Chosen for cost and independence: serverless keeps a community project running on
pay-per-use, EU hosting keeps data under GDPR, and minimal dependencies keep it
maintainable by volunteers.

## Development

Requires Node.js 20+, pnpm 8+, Docker Desktop, and OpenTofu for infrastructure work.

```bash
git clone https://github.com/Hendingar/hendingar.no
cd hendingar.no/app
pnpm install

cp .env.local.example .env.local   # then set DATABASE_URL
pnpm dev                           # http://localhost:5173
```

Infrastructure deploys via `source .env.scaleway && ./infrautils/deploy-infra.sh`.
See `spec.md` for the full deployment guide.

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
