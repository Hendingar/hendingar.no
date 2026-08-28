# 0009 — Recurring events are materialised, not expanded on read

**Status:** accepted (2026-08-28)

## Context

Posters state recurrence, not dates: "TORSDAGER KL 12–17", "quiz kvar tysdag", "første måndag i
månaden". Two separate things forced the issue:

1. **The extraction hallucinated.** With nowhere in the schema to record "every Thursday", the
   vision model put a concrete date in `date` — and picked the wrong weekday (today's, a Friday).
   Measured in `services/verifier/evals/cases/komle-vertshuset`. A schema that cannot express what
   the image says forces a guess.
2. **The form was a dead end.** Extraction correctly returned a null date for a recurring poster,
   `date` was required, so a poster that read perfectly could not be submitted at all.

And it is not only a submission concern: Det skjer Sunnhordland already sends `recurrent`,
`frequency`, `interval` and `occurrenceDays`, and the importer discards all four — so a recurring
exhibition is imported as its first occurrence and the rest are invisible.

## Decision

A series is one `event_series` row holding the rule, plus **one ordinary `events` row per
occurrence** inside a rolling horizon (`HORIZON_WEEKS = 26`).

**Why materialise rather than expand at query time.** Every listing in the app is
`starts_at >= now() ORDER BY starts_at`, grouped by calendar day at the venue. Expanding a rule on
read would mean every one of those queries UNIONs generated rows, losing the index and the day
grouping, and the same for deduplication, verification, the map and the iCal feed. Materialising
means an occurrence is an ordinary event that happens to have siblings, and _not one listing query
changes_. The cost is a top-up job and N rows per series; the alternative is rewriting every read
path.

`uniqueIndex(series_id, starts_at)` makes topping up idempotent, and `materialised_through` lets an
open-ended series extend without re-expanding what exists.

**Why a constrained rule rather than RFC 5545 RRULE.** `toRRule` emits RRULE for the iCal feed, but
we never parse it. Accepting arbitrary RRULE means accepting `BYSETPOS`, `EXDATE` and patterns we
can neither describe in one Nynorsk phrase nor let a submitter verify on a form. The rule covers
what community posters actually say: daily, weekly on given weekdays, monthly on the nth weekday,
with an interval and an optional end date.

**Why a wall clock and a zone, not an instant.** The series stores `start_time` as `HH:MM` plus a
timezone. "Torsdager kl 12" is 12:00 local on both sides of a DST change, which is an hour apart in
UTC — storing an instant and adding seven days per occurrence is the classic way to get this wrong.
Expansion resolves each occurrence through `zonedWallClockToInstant`. Verified in the database:
22 October is stored 10:00Z and 29 October 11:00Z, both 12:00 in Oslo.

## Consequences

- A weekly series is ~27 rows. Deleting or editing one means touching all of them, so `series_id`
  cascades on delete.
- Open-ended series need a scheduled top-up, or they quietly stop 26 weeks out. **Not built yet** —
  until it is, a series has a horizon and no renewal.
- `expandRecurrence` is pure and takes its window as arguments, so it runs unchanged in the browser
  (to fill the first date after extraction) and on the server (to write occurrences), and its tests
  need no fake timers.
- A rule matching no dates is rejected at submit rather than stored as an empty series.

## Alternatives considered

- **One row plus a rule, expanded on read** — rejected above; it moves the cost into every query.
- **A generated `occurrences` table separate from `events`** — the same rewrite of every read path,
  with an extra join.
- **Storing an RRULE string and using a library** — less code, but it accepts far more than we can
  render or let a person verify, and the residual work (expansion in the venue's zone) stays ours.
