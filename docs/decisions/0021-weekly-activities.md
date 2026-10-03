# 0021 — A weekly activity is one standing row with a timetable

**Status:** accepted (2026-10-02). Takes up the follow-up ADR 0013 left open.

## Context

Bømlo's Aktivitet for Alle portal publishes two kinds of row. `arrangement` is a dated event and
has been imported since the importer was written. `activity` is a club, choir or group that meets
every week: "Bremnes G12, tysdag og onsdag 18:00–19:30, laurdag 11:30–13:00, januar til desember".
On 2026-10-02 it held 135 public activities, 119 of them still running, from 23 organisers.

They had been deliberately dropped twice:

1. **As dated events** they would bury sixty real events under hundreds of training sessions.
2. **As standing offers** (ADR 0013) they made `/alltid-ope` fifty football squads with a museum in
   the middle. ADR 0013 measured that, refused it, and named what was missing: "a page that says
   so, grouped by club or by venue."

ADR 0009's `event_series` looks like the obvious home for something that repeats, and is not one. It
materialises a series into one `events` row per occurrence _so that_ occurrences appear in the day
lists. Here, that is exactly the problem: 119 activities meeting two or three times a week would add
several hundred rows to every week of the listing.

## Decision

**One `events` row per activity, `standing` by its own dates, carrying its timetable in a new
`events.weekly_hours` jsonb column.** The timetable is shown and never expanded into dates.

- **Its shape** is `{ cadence, slots: [{ weekday, from, to }] }` and lives in
  `packages/core/src/weekly-hours.ts` with a Zod schema and a pure Nynorsk formatter. Times are wall
  clocks ("18:00"), because they are only displayed. Nothing turns them into instants, so there is
  no offset to get wrong.
- **Cadence is part of it**, because a timetable without one is wrong. Twenty activities are
  fortnightly or monthly: "Gudsteneste Bremnes kyrkje" is _partalsveker_. A bare "Sundag 11:00"
  would send someone to a locked church half the time. The labels are the ones the portal prints. An
  unset interval means "Kvar veke", because that is what the portal's own page renders for it
  (checked in a browser). An interval we have no word for is a rejected row, never a quiet default.
- **Who runs it** comes from `/api/v1/organizers`, read by its public `organizer_title`, into the
  existing `organizers` table. `event_organizer_name` is empty on every activity, and the registry
  name is sometimes the private person who opened the account.
- **What `weekly_hours` is not null means:** this row is an activity and not a place.
  `standingOffers` and the site's standing count take `weekly_hours IS NULL`, so the front-page
  band, the "Òg ope denne dagen" line and "N stader som alltid er opne" stay about places.
  `weeklyActivities` serves the rest, grouped by organiser, to a "Faste aktivitetar" section below
  the places on `/alltid-ope`.
- **The importer only takes an activity that classifies `standing` and states a timetable.** The
  span check makes it impossible for an activity to land in a day list at midnight on its first day.
  The timetable check leaves three rows, "badebursdag" among them, with the source: they repeat
  without saying when, so they give a reader nothing to turn up to.

**Why grouped by organiser, not venue.** Organisers are what people search with their eyes: a parent
knows their child's club. Venues mix clubs, and Sentralidrettsanlegget hosts every Bremnes squad
plus the drill club. Grouping by organiser turns 116 rows into 22 names on a fold each. That is the
"club directory" ADR 0013 asked for, and it is closed by default, so the page opens on places.

**Why rows, not cards.** Every activity would have shown the same generated tile, and the thing a
reader needs is the timetable, which a card has no room for.

## Consequences

- An activity's page shows its timetable and the season's last day in place of a start time, and
  names its organiser.
- The migration is one `ADD COLUMN`, nullable, so it is additive (ADR 0010).
- The arrangement rows now get an organiser too, from the same lookup.
- **Not done:** the JSON-LD and the "Legg i kalenderen" export still describe an activity the way
  they describe every standing row, as one event spanning its season. An `eventSchedule` in the
  JSON-LD and an RRULE in the `.ics` are the natural next step, and both can be built from
  `weekly_hours` without changing it.
- Another source that publishes timetables can fill the same column, and its rows land in the same
  section with no change to the page.

## How we'd know we were wrong

If readers want "what can my eight-year-old do on a Tuesday" more than "what does Bremnes IL run",
the grouping should be by weekday. The timetable is already structured for that.

## Addendum (2026-10-03): read by day first, by club second

The first version shipped as twenty-two closed folds, one per organiser. They were correct and
complete, and gave a visitor no reason to open any of them: every fold looked the same, and none
answered the question people arrive with, which is "kva kan eg bli med på i dag?", not "which clubs
exist".

So `/alltid-ope` now leads with a **day lens**: a count for today, a seven-day strip with a count per
day, an age filter, and that day's activities by time. The clubs follow as poster cards, each with a
strip of seven pips for the days it meets. The places come last.

- **A weekday means its next date, today included**, and `slotsOn` decides per date. That is what
  makes the cadence honest: a fortnightly service shows on the Sunday it meets and not on the one
  it doesn't. A strip of weekdays with no dates could not say that, and would have shown it every
  week with a chip asking the reader to work it out.
- **The age filter uses the range the source states** (`events.age_from`/`age_to`, 112 of 135
  activities have one) and matches on overlap. Overlap is the club's own claim: a 16–100 group is
  open to a sixteen-year-old. A mockup guessed audience from titles; that was never going to hold.
- **Every control is a link** (`?dag=onsdag&for=born`), so the lens works without JavaScript,
  survives a reload, is in the server-rendered HTML, and can be sent to someone. The page reads the
  parameters from `page.url` on the server, in line with CLAUDE.md's rule against placeholders.
- **"I dag" is the venue's date, computed on the server** and sent with the rows, so the page and
  its hydration agree. The view logic is pure and runs on both sides, which is why it sorts with
  its own comparator and not `Intl.Collator('nb')`: browser and Node ICU ship different locales.
- **Clubs are ordered by size**, unlike the places. Here the count is information, and the biggest
  club is the one most readers are looking for.
