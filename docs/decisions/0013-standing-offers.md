# 0013 — A place that is open is not an event that happens

**Status:** accepted (2026-09-06)

## Context

`/hending/338-sunnhordland-escape` sat at the top of "I dag" every single day. It is an escape room
at Sunnhordlandstunet, imported from the Sunnhordland museum feed as **one row running 2023-01-01
to 2027-12-31** — 1825 days, starting at midnight.

It is not a recurring series. `event_series` (ADR 0009) had nothing to do with it. Every listing in
the app groups by `greatest(starts_at, now())` so that a still-running exhibition is filed under the
day a reader can actually go to it — and that rule, meeting a five-year span, files the escape room
under **today, every day, for five years**, above the concerts, wearing a "Pågår no" badge that is
technically true and useless.

The underlying mistake is that two different things share one shape. A concert is an **appointment**:
it happens at a time, and missing it means missing it. An escape room is an **opening**: it is
available, today and tomorrow and in March. A listing sorted by time can only hold the first, so the
second gets given a time it does not have.

Measured against a full `pnpm ingest` — 600 live rows, 24 sources:

| span            | rows | what they are                                              |
| --------------- | ---- | ---------------------------------------------------------- |
| under a day     | 263  | concerts, services, meetings                               |
| no end at all   | 331  | the same, where the source states only a start             |
| 1–3 days        | 4    | a trip to Finse, a football school — real multi-day events |
| 4–30 days       | 1    | an 11-day exhibition                                       |
| over six months | 1    | the escape room                                            |

One row today. But `importers/aktivitetforalle` was already **discarding 943 rows** of the same
shape, with the note: _"materialising those would bury sixty real events under hundreds of gym
sessions."_ The population is suppressed at the importer, not absent from the world.

## Decision

A new column, `events.kind`, with two values: `dated` (the default) and `standing`. Every listing
and every count filters `kind = 'dated'`; `standingOffers` serves the rest, on `/alltid-ope` and in
one band on the front page.

**The rule is the span, and only the span.** `ends_at - starts_at >= 30 days` is standing. The gap
between the longest real event (11 days) and the escape room (1825) is wide enough that the
threshold does not need to be finely judged — thirty days sits in an empty middle.

It also turned out to be the only rule needed. An `aktivitetforalle` `activity` row carries
`event_from` and `event_to` about ten months apart, so the span rule classifies it correctly with no
per-source knowledge at all. **A source that knows it is publishing an opening says so in its
dates.**

**`aktivitetforalle` nevertheless keeps its filter, and that is measured rather than an oversight.**
Importing its `activity` rows was the obvious next step, and it was tried: it admits 806 rows, of
which **112 survive as live standing offers, and most are youth football squads** — "Bremnes G12",
"G13", "G14", "G15", "G16", "G19", "J12", one per age group per season. `/alltid-ope` would have
been fifty training schedules with a museum somewhere in the middle, which is this ADR's own
complaint happening one screen further on. Those rows are real and useful, but they are a club
directory — something you join for a season, not somewhere you can walk into this afternoon — and
they need a page that says so, grouped by club or by venue. That is the follow-up. Until it exists,
moving them from "buried in the day list" to "flooding a different page" is not an improvement.

**Why a generated column rather than a value each importer writes.** Fifteen importers build their
own `values` object. A column each of them has to remember to set is a column the sixteenth forgets,
and the row silently defaults to `dated` and lands back in the middle of the day list — the exact
failure this exists to end. `GENERATED ALWAYS AS (…) STORED` cannot be set wrong, cannot drift from
the data, and reclassifies a row automatically if its dates are corrected upstream. The threshold is
interpolated from `STANDING_SPAN_DAYS` in `src/standing.ts`, so the number has one home in
TypeScript, testable through `classifyEventKind`, rather than being buried in a migration.

**What the rule deliberately does not key on.** Not a midnight start — eleven live rows begin
between 00:00 and 02:00 and are real events. Not category, title or source; each would take
something with it that belongs in the listing.

**Why the section is not inside the day groups.** Showing standing offers at the foot of every day
would keep the repetition this change removes, one screen lower. The escape room is on today, and it
is on every other day too, so saying it once is the honest number of times. Day and weekend pages
get a single quiet line — "Òg ope denne dagen" — because those pages genuinely are answering "what is
on on this date", and a museum is part of that answer as an aside rather than as a card.

## Consequences

- `siteStatus` gains `standingCount`, counted and named separately. `upcomingCount` says "hendingar
  framover" and now means it; a five-year span inside that figure made the site's headline number
  quietly untrue.
- The migration is additive: `ADD COLUMN` plus an index. The generated column classifies existing
  rows on creation, so there is no backfill step and nothing to re-run.
- `migration-safety.ts` gained a carve-out. `add-column-not-null-without-default` fired on this
  migration, and its reasoning — "the running revision has no value to supply" — is the one thing
  that is not true of a generated column: Postgres computes it, and rejects an INSERT that tries to
  set it. The alternative was hand-editing a generated migration (forbidden) or dropping the NOT
  NULL for nothing.
- `getEvent` deliberately does **not** filter on kind, so a standing offer keeps its own page and
  every existing link to it still resolves. `listHearted` does not filter either: it is the reader's
  own saved list, and something vanishing from it would look like data loss.
- A standing offer with a genuine end date drops off when it passes — `standingOffers` filters
  `ends_at >= now()`.

## Alternatives considered

- **A `standing_hint` boolean set by importers that know.** Unnecessary once the fixtures showed the
  sources that know already encode it as a long date range, and it would have been a second way to
  say the same thing.
- **Filtering by span in each listing query.** The threshold would be duplicated across sixteen
  `where` clauses in SQL, and adding the seventeenth listing would mean remembering it again.
- **Dropping these rows, as aktivitetforalle did.** It works, and it is what the code did — but a
  museum and a swimming hall are things a reader wants to know about. The problem was never that
  they are uninteresting, only that they are not events.
- **A `standing` status alongside `published`.** `status` answers "is this visible"; overloading it
  with "what kind of thing is this" is how one column ends up meaning two things.
