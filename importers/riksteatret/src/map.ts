import { isCalendarDate, zonedWallClockToInstant } from '@hendingar/core/datetime';
import type { CategorySlug } from '@hendingar/core/taxonomy';
import type { RawPerformance } from './api.ts';
import type { RiksteatretInstance } from './instances.ts';

/**
 * Pure mapping: a Riksteatret programme card → our shape. No I/O, no clock, no randomness.
 */

/**
 * Everything Riksteatret plays is `teater`.
 *
 * A fact about the source rather than a guess about the event, which is the only kind of default
 * ADR 0004 allows: Riksteatret is the *national touring theatre*, its `/repertoar/` is stage
 * productions and nothing else, and the page we read is that repertoire filtered to one hall.
 * There is no taxonomy on the page to read a finer answer from, and inventing one from the title
 * is the guessing the verification service exists to do properly, later, on structured data.
 *
 * The same argument `importers/kyrkja` makes for `kyrkjeliv` and `importers/bakhagen` for `mote`.
 * Imported from `@hendingar/core/taxonomy` — never spelled out again here (CLAUDE.md rule 1).
 */
export const CATEGORY: CategorySlug = 'teater';

/**
 * `DD.MM.YYYY HH:MM` → the calendar date and wall clock it states.
 *
 * **This is a wall clock with no offset, and it must not be treated as an instant.** The template
 * writes `27.10.2026 18:00` and says nothing about which side of a daylight-saving boundary that
 * is on. Norway keeps CET/CEST, and one Bømlo season spans 27 October 2026 (two days after the
 * clocks go back, so +01:00) to 9 April 2027 (twelve days after they go forward, so +02:00). A
 * hand-rolled `+01:00` — or a `new Date('2026-10-27T18:00')` resolved in whatever zone the runner
 * happens to be in — is therefore wrong for part of every season, silently, by an hour.
 *
 * So this function deliberately returns *strings*, and `mapPerformance` hands them to
 * `zonedWallClockToInstant` with the venue's zone. Nothing here builds a `Date`.
 *
 * Returns null for anything that is not a real date and time, so a template change becomes a
 * reported rejection rather than an `Invalid Date` written to the database.
 */
const WALL_CLOCK = /^(\d{2})\.(\d{2})\.(\d{4})\s+(\d{2}):(\d{2})$/;

export function parseWallClock(value: string): { date: string; time: string } | null {
	const match = WALL_CLOCK.exec(value.trim());
	if (!match) return null;
	const [, day, month, year, hour, minute] = match;
	const date = `${year}-${month}-${day}`;
	// `31.02.2027` matches the shape and is not a day; `25:00` matches and is not a time.
	if (!isCalendarDate(date)) return null;
	if (Number(hour) > 23 || Number(minute) > 59) return null;
	return { date, time: `${hour}:${minute}` };
}

export function slugifyVenue(name: string): string {
	return name
		.toLowerCase()
		.replace(/æ/g, 'ae')
		.replace(/ø/g, 'oe')
		.replace(/å/g, 'aa')
		.normalize('NFD')
		.replace(/[̀-ͯ]/g, '')
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, 120);
}

/**
 * One performance's identity.
 *
 * The card offers two ids and **neither one alone is a performance**:
 *
 *   - `data-production-id` identifies the *production*. Apestjernen is `7309200` at Bømlo and
 *     `7309200` at Stord, and Vega Scene plays production `7295107` on sixteen different evenings
 *     — all sixteen cards carry the same number. Keying on it alone would collapse a run into one
 *     row that jumps date every time the earliest evening passes.
 *   - the ticket link's `events/44194` is per performance, but it is the *vendor's* id, and the
 *     vendor is not always eBillett: every Vega Scene card links to `vegascene.no/teater/…`
 *     instead, with no numeric event id anywhere. An identity that exists only when a particular
 *     ticket system is involved is not an identity.
 *
 * So: production plus the start instant, the same shape `importers/mec` and `importers/bakhagen`
 * settled on. The venue is not part of it because the venue is the *source* — `events` is unique
 * on `(source_id, external_id)`, so Bømlo's Apestjernen and Stord's cannot collide even though
 * they share a production id.
 *
 * The instant is used in its UTC form, so a template that starts writing the date differently
 * cannot silently create a second copy of an event we already hold.
 *
 * The cost runs the other way: a performance that is *moved* upstream arrives as a new row and
 * leaves the old one behind. That is the trade both sibling importers made — a duplicate is
 * visible and correctable, a series quietly collapsed into one drifting row is neither.
 */
export function occurrenceId(productionId: string, startsAt: Date): string {
	return `${productionId}@${startsAt.toISOString()}`;
}

export type MappedEvent = {
	externalId: string;
	title: string;
	category: CategorySlug;
	startsAt: Date;
	endsAt: Date | null;
	venueName: string | null;
	venueSlug: string | null;
	description: string | null;
	ctaUrl: string | null;
	posterUrl: string | null;
	posterRightsVerified: boolean;
	sourceUrl: string;
};

export type MapFailure = { externalId: string; title: string; problem: string };

export function isFailure(v: MappedEvent | MapFailure): v is MapFailure {
	return 'problem' in v;
}

export function mapPerformance(
	input: RawPerformance,
	poster: string | null,
	instance: RiksteatretInstance
): MappedEvent | MapFailure {
	const title = input.title.trim();
	if (!title) {
		return { externalId: input.productionId, title: '', problem: 'empty title' };
	}

	const wallClock = parseWallClock(input.datetime);
	if (!wallClock) {
		return {
			externalId: input.productionId,
			title,
			problem: `unreadable datetime: ${input.datetime}`
		};
	}

	/*
	 * The wall clock resolved in the venue's zone — the whole point of this importer's date
	 * handling. `zonedWallClockToInstant` looks up the zone's offset *at that moment* and
	 * re-checks it, so 27 October 2026 comes back as 17:00Z (CET, +01:00) and 9 April 2027 as
	 * 17:00Z for a 19:00 curtain (CEST, +02:00). Assuming a constant offset gets one of those
	 * two wrong whichever constant you pick.
	 */
	const startsAt = zonedWallClockToInstant(wallClock.date, wallClock.time, instance.timezone);
	if (Number.isNaN(startsAt.getTime())) {
		return {
			externalId: input.productionId,
			title,
			problem: `unresolvable datetime: ${input.datetime} in ${instance.timezone}`
		};
	}

	const venueName = input.venueName.trim() || instance.venueFallback;

	return {
		externalId: occurrenceId(input.productionId, startsAt),
		title,
		category: CATEGORY,
		startsAt,
		/*
		 * The page states no end. A theatre programme prints the curtain and leaves the running
		 * time to the production page, which does not state it either — so null, rather than a
		 * guessed two hours that would be wrong for a children's show and for a Shakespeare alike.
		 */
		endsAt: null,
		venueName,
		venueSlug: slugifyVenue(venueName),
		/*
		 * No description anywhere to take. The card carries only a title, a hall and a clock; the
		 * production's own `/repertoar/` page ships an *empty* `<meta name="description">` and no
		 * JSON-LD, so a detail fetch per production would buy a null at the cost of a request. The
		 * `.item__preview` note some cards carry ("Vega scenes priser gjelder") is a ticketing
		 * remark rather than a description of the play, and is left where it is.
		 */
		description: null,
		ctaUrl: input.ticketUrl,
		/*
		 * Hotlinked from Riksteatret's own image host, never copied onto our infrastructure — and
		 * only for the production the venue page features, because that is the only one it shows a
		 * picture of. Every other performance gets null and a generated tile.
		 */
		posterUrl: poster,
		/*
		 * Recorded as unverified. Riksteatret states nothing about reuse of its production
		 * photography, and an unstated right is not a granted one — the same call
		 * `importers/billetto` and `importers/dnt` make.
		 */
		posterRightsVerified: false,
		sourceUrl: input.sourceUrl
	};
}
