import { coveredMunicipalitiesIn, type CoveredMunicipality } from '@hendingar/core/coverage';
import { zonedWallClockToInstant } from '@hendingar/core/datetime';
import { slugify } from '@hendingar/core/slug';
import type { CategorySlug } from '@hendingar/core/taxonomy';
import { plainText } from '@hendingar/core/text';
import type { UpstreamActivity, UpstreamCard } from './api.ts';
import { activityUrl, type EfGroup } from './groups.ts';

/**
 * Pure mapping: one card and its activity page → our shape. No I/O, no clock, no randomness.
 */

export type MappedEvent = {
	externalId: string;
	title: string;
	category: CategorySlug;
	startsAt: Date;
	endsAt: Date | null;
	/** False when the page gives a date and no clock. See `toTimes`. */
	timeStated: boolean;
	venueName: string | null;
	venueSlug: string | null;
	venueAddress: string | null;
	/** Only ever one of ours, and only when the page names exactly one. See `municipalityOf`. */
	municipality: CoveredMunicipality | null;
	latitude: number | null;
	longitude: number | null;
	description: string | null;
	posterUrl: string | null;
	posterRightsVerified: boolean;
	sourceUrl: string;
};

export type MapFailure = { externalId: string; title: string; problem: string };

export function isFailure(v: MappedEvent | MapFailure): v is MapFailure {
	return 'problem' in v;
}

/**
 * Every activity is `anna`.
 *
 * What these have in common is who they are for — families with one parent mostly on their own —
 * not what happens: a fish-farm visit, a cinema trip, a hobby workshop, ice bathing, the group's
 * own plan for 2026. That is an audience, and the platform importers already settled what an
 * audience label becomes: `importers/aktivitetforalle` and `importers/mec` let "Barn", "Familie"
 * and the like fall through to `anna` rather than to the nearest wrong slug. Reading the kind of
 * outing off a free-text title would be guessing, and there is no category field to read instead.
 */
export const CATEGORY: CategorySlug = 'anna';

/* -------------------------------------------------------------------------------------------- */
/* Dates and times                                                                                */
/* -------------------------------------------------------------------------------------------- */

/** English, because the activity pages exist only under `/en/` — see `groups.ts`. */
const MONTHS: Record<string, number> = {
	january: 1,
	february: 2,
	march: 3,
	april: 4,
	may: 5,
	june: 6,
	july: 7,
	august: 8,
	september: 9,
	october: 10,
	november: 11,
	december: 12
};

export type DaySpan = { startDate: string; endDate: string };

function isoDate(year: number, month: number, day: number): string | null {
	const stamp = new Date(Date.UTC(year, month - 1, day));
	// 31. February rolls over into March; a date the calendar does not have is not a date.
	if (stamp.getUTCMonth() !== month - 1 || stamp.getUTCDate() !== day) return null;
	return stamp.toISOString().slice(0, 10);
}

/**
 * "24. October 2026" → one day. "16. October - 17. October 2026" → two.
 *
 * The span form writes the year once, at the end; a start month after the end month is the turn
 * of a year ("30. December - 2. January 2027"), so the start belongs to the year before. Anything
 * else is `null` — a shape we have not seen is a rejected row on the run, not a guess.
 */
export function parseDaySpan(text: string): DaySpan | null {
	const t = text.replace(/\s+/g, ' ').trim();
	const span =
		/^(\d{1,2})\. ([A-Za-z]+)(?: (\d{4}))?(?: ?[-–] ?(\d{1,2})\. ([A-Za-z]+) (\d{4}))?$/.exec(t);
	if (!span) return null;
	const [, d1, m1, y1, d2, m2, y2] = span;
	const startMonth = MONTHS[m1?.toLowerCase() ?? ''];
	if (!startMonth) return null;

	if (!d2) {
		if (!y1) return null;
		const day = isoDate(Number(y1), startMonth, Number(d1));
		return day ? { startDate: day, endDate: day } : null;
	}

	const endMonth = MONTHS[m2?.toLowerCase() ?? ''];
	if (!endMonth) return null;
	const endYear = Number(y2);
	const startYear = y1 ? Number(y1) : startMonth > endMonth ? endYear - 1 : endYear;
	const startDate = isoDate(startYear, startMonth, Number(d1));
	const endDate = isoDate(endYear, endMonth, Number(d2));
	if (!startDate || !endDate || endDate < startDate) return null;
	return { startDate, endDate };
}

export type Clock = { start: string; end: string | null };

/**
 * "11:30 - 13:45" → both ends; "11:30" → a start. Blank → `null`, which means no clock, and is
 * not the same as a malformed one: `undefined` is returned for text that is there and unreadable.
 */
export function parseClock(text: string | undefined): Clock | null | undefined {
	const t = (text ?? '').replace(/\s+/g, ' ').trim();
	if (!t) return null;
	const clock = /^(\d{1,2})[:.](\d{2})(?: ?[-–] ?(\d{1,2})[:.](\d{2}))?$/.exec(t);
	if (!clock) return undefined;
	const [, h1, n1, h2, n2] = clock;
	const hhmm = (h: string, m: string) =>
		Number(h) < 24 && Number(m) < 60 ? `${h.padStart(2, '0')}:${m}` : null;
	const start = hhmm(h1 ?? '', n1 ?? '');
	if (!start) return undefined;
	if (h2 === undefined || n2 === undefined) return { start, end: null };
	const end = hhmm(h2, n2);
	return end ? { start, end } : undefined;
}

/**
 * The instants, resolved from the wall clock the page shows, in the venue's zone.
 *
 * There is no offset anywhere on the page to believe or to doubt — no JSON-LD, no `datetime`
 * attribute — so the visible clock is the only statement of a time the source makes, and
 * `zonedWallClockToInstant` is how a wall clock becomes an instant that stays right across the
 * change to winter time. It was still checked against the organisers' prose, because that is the
 * second thing a human reads: Stord's 24 October visit says "11:30 - 13:45" in the box, and "kl.
 * 11.30" twice in the text ("Oppmøte: Kl 11.30 i Engesund sine lokaler").
 *
 * A span's clock belongs to its two ends: Ringsaker's overnight trip reads "17:00 - 16:00" under
 * "16. October - 17. October", which is 17:00 on the first day to 16:00 on the second.
 *
 * **No clock is not midnight.** A page that gives only a date keeps the whole-day encoding
 * `importers/tec` and `importers/bakhagen` settled on — local 00:00 to local 23:59:59 — rather
 * than an invented start hour on a site people use to decide when to turn up. `timeStated: false`
 * names it.
 */
export function toTimes(
	span: DaySpan,
	clock: Clock | null,
	timeZone: string
): { startsAt: Date; endsAt: Date | null; timeStated: boolean } {
	if (!clock) {
		return {
			startsAt: zonedWallClockToInstant(span.startDate, '00:00', timeZone),
			endsAt: new Date(zonedWallClockToInstant(span.endDate, '23:59', timeZone).getTime() + 59_000),
			timeStated: false
		};
	}
	const startsAt = zonedWallClockToInstant(span.startDate, clock.start, timeZone);
	const end = clock.end ? zonedWallClockToInstant(span.endDate, clock.end, timeZone) : null;
	// An end before the start is a typo upstream, and "ends whenever" is what the UI already shows
	// for an event whose duration nobody stated.
	const endsAt = end && end.getTime() > startsAt.getTime() ? end : null;
	return { startsAt, endsAt, timeStated: true };
}

/* -------------------------------------------------------------------------------------------- */
/* Place                                                                                          */
/* -------------------------------------------------------------------------------------------- */

/**
 * The municipality, when the page names exactly one of ours.
 *
 * Not the group's. The Stord group runs its 24 October activity in Fitjar — the fish farm at
 * Engesund — and assuming every Stord activity is in Stord would file it under the wrong
 * municipality on every surface that reads `venues.municipality`.
 *
 * Read from the address and the title, through `coveredMunicipalitiesIn`, so a place word means
 * here what it means to the coverage check. The address "Fitjarsjøen 2" is a street and names
 * nothing; the title names Engesund, which `COVERED_PLACES` puts in Fitjar. That is a municipality
 * by name, which is why writing it is not the post-town mistake the other importers refuse: their
 * `5410 Sagvåg` is a postal area, and this is the place list's answer about one.
 *
 * Not the description. Its text says "Engesund sine lokaler i Fitjar sentrum" and, a sentence
 * later, the bus "frå Leirvik sentrum" — Stord — which is how a long text names two places for
 * one event. Two names, or none, is `null`.
 */
export function municipalityOf(address: string | null, title: string): CoveredMunicipality | null {
	const named = [...coveredMunicipalitiesIn(address), ...coveredMunicipalitiesIn(title)];
	const distinct = [...new Set(named)];
	return distinct.length === 1 ? (distinct[0] ?? null) : null;
}

/* -------------------------------------------------------------------------------------------- */
/* The event                                                                                      */
/* -------------------------------------------------------------------------------------------- */

/** Does this card belong to the group we are reading, rather than one it recommends? */
export function isOwnActivity(card: UpstreamCard, group: EfGroup): boolean {
	return card.groups.some((name) => name.toLowerCase() === group.badge.toLowerCase());
}

export function mapActivity(
	card: UpstreamCard,
	activity: UpstreamActivity,
	group: EfGroup
): MappedEvent | MapFailure {
	const title = activity.title.replace(/\s+/g, ' ').trim();
	const failure = (problem: string): MapFailure => ({
		externalId: activity.activityId,
		title,
		problem
	});

	if (activity.activityId !== card.activityId) {
		return failure(`the card links ${card.activityId} and the page is ${activity.activityId}`);
	}

	const span = parseDaySpan(activity.dateLines[0] ?? '');
	if (!span) return failure(`unreadable date: ${activity.dateLines[0]}`);

	/*
	 * The card and the page print the date separately, and must agree. Both are the same database
	 * field today; the day they are not, one of them is stale, and importing either would be
	 * picking.
	 */
	const cardSpan = parseDaySpan(card.dateText);
	if (!cardSpan || cardSpan.startDate !== span.startDate || cardSpan.endDate !== span.endDate) {
		return failure(`the card says ${card.dateText} and the page ${activity.dateLines[0]}`);
	}

	const clock = parseClock(activity.dateLines[1]);
	if (clock === undefined) return failure(`unreadable clock: ${activity.dateLines[1]}`);

	const { startsAt, endsAt, timeStated } = toTimes(span, clock, group.timezone);

	const address = activity.address?.replace(/\s+/g, ' ').trim() || null;

	return {
		/*
		 * Keyed on the day, never on the instant — CLAUDE.md, and `importers/mec` for the story. A
		 * corrected clock then updates the row in place instead of inserting a second one and
		 * stranding the first, still published and still wrong.
		 */
		externalId: `${activity.activityId}@${span.startDate}`,
		title,
		category: CATEGORY,
		startsAt,
		endsAt,
		timeStated,
		/*
		 * The address is the venue's name, because it is all the page calls the place. The prose
		 * says "Engesund sine lokaler", but lifting a venue name out of a paragraph is the reading
		 * this importer refuses everywhere else.
		 */
		venueName: address,
		venueSlug: address ? slugify(address) || null : null,
		venueAddress: address,
		municipality: municipalityOf(address, title),
		/*
		 * The organisers' own pin, from the map on the page — the source's assertion about its own
		 * event, the same standing `importers/luma` gives the coordinate an organiser picked. Fitjar
		 * sentrum is where this one lands, which is a second, independent agreement with the
		 * municipality read off the title.
		 */
		latitude: activity.latitude,
		longitude: activity.longitude,
		description: plainText(activity.descriptionHtml),
		/*
		 * Not an image the page itself labels "This image is AI generated."
		 *
		 * The site prints that notice under the picture, and a listing card has nowhere to carry
		 * it, so showing the picture here would strip the disclosure the organisers chose to make —
		 * a fish farm on a card that looks like a photograph of the one you will visit. Without
		 * the notice it is the activity's own featured image, hotlinked from the site's storage
		 * like every other source's poster, and unverified for rights like all of them.
		 */
		posterUrl: activity.imageIsAiGenerated ? null : activity.imageUrl,
		posterRightsVerified: false,
		sourceUrl: activityUrl(activity.activityId)
	};
}
