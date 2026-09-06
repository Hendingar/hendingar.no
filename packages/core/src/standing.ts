/**
 * Two kinds of row: an appointment, and an opening.
 *
 * A concert happens at a time — miss it and it is gone. An escape room is simply open: today,
 * tomorrow, and in March. Until now both were `events` rows with a `starts_at`, and every listing
 * sorts by that column, so a thing with no meaningful time was given one and sorted to the top of
 * every single day.
 *
 * The row that forced this: "Sunnhordland Escape" from the Sunnhordland museum feed, one row
 * running 2023-01-01 to 2027-12-31 — 1825 days. `greatest(starts_at, now())` files it under TODAY,
 * every day, for five years. It is not a recurring series; it is not an event at all.
 *
 * ## Why the span, and only the span
 *
 * Measured against a full `pnpm ingest` — 600 live rows across 24 sources:
 *
 * | span            | rows | what they are                                            |
 * | --------------- | ---- | -------------------------------------------------------- |
 * | under a day     |  263 | concerts, services, meetings — an appointment             |
 * | no end at all   |  331 | the same, where the source states only a start            |
 * | 1–3 days        |    4 | a trip to Finse, a football school — real multi-day events |
 * | 4–30 days       |    1 | an 11-day exhibition — still an event                     |
 * | over six months |    1 | the escape room                                           |
 *
 * The gap between 11 days and 1825 is wide enough that the threshold does not need to be
 * finely judged: thirty days sits in an empty middle.
 *
 * It also turned out to be the ONLY rule needed. `aktivitetforalle` distinguishes `arrangement`
 * from `activity` itself and used to discard the second — "aqua gym, every Tuesday and Thursday,
 * August to June" — but those rows carry `event_from` and `event_to` ten months apart, so the span
 * rule already classifies them correctly with no per-source knowledge. A source that knows it is
 * publishing an opening says so in its dates.
 *
 * ## What this deliberately does NOT key on
 *
 * - **A midnight start.** Eleven live rows begin between 00:00 and 02:00 and are real events.
 * - **Category, title, or source.** Every one of those would take something with it that belongs
 *   in the listing.
 *
 * The threshold lives here as one constant, and `schema.ts` interpolates it into the generated
 * column so the database and this module cannot disagree. See
 * docs/decisions/0013-standing-offers.md.
 */

/** Span at which a row stops being an event and becomes a place that is open. */
export const STANDING_SPAN_DAYS = 30;

export const EVENT_KINDS = ['dated', 'standing'] as const;
export type EventKind = (typeof EVENT_KINDS)[number];

/**
 * Which kind a row is, from its own dates.
 *
 * Pure, and the same rule the generated column applies — this exists for tests and for anywhere
 * the app reasons about a row it is holding rather than one it is selecting.
 *
 * A row with no end is `dated`: the source stated when it begins and nothing more, which is the
 * ordinary shape of a concert, not of an opening.
 */
export function classifyEventKind(startsAt: Date, endsAt: Date | null | undefined): EventKind {
	if (!endsAt) return 'dated';
	const days = (endsAt.getTime() - startsAt.getTime()) / 86_400_000;
	return days >= STANDING_SPAN_DAYS ? 'standing' : 'dated';
}
