import type { CategorySlug } from '@hendingar/core/taxonomy';
import { eventTypes, type UpstreamEvent } from './api.ts';
import type { HvlCampus } from './campuses.ts';

/**
 * Pure mapping: one HVL calendar row → our shape. No I/O, no clock, no randomness.
 */

/**
 * HVL's event-type tags → our taxonomy.
 *
 * The eight ids are the whole vocabulary, read from the calendar's own filter list rather than
 * from the handful this campus happens to use.
 *
 * `Kulturarrangement` deliberately falls through to `anna`. It means "a cultural event", which is
 * a category of ours only if we guess which one — a concert, a reading and an exhibition are three
 * different answers and the tag does not say. An importer's job is to be right, not to guess.
 */
const CATEGORY_BY_TYPE: Record<string, CategorySlug> = {
	// A public thesis defence, held as a formal academic session.
	disputas: 'konferanse',
	konferanse: 'konferanse',
	// HVL labels this one "Møte/debatt".
	debatt: 'mote',
	styremote: 'mote',
	// "Presentasjon/utstilling".
	presentasjon: 'utstilling',
	// Forskningsdagene is the national research festival, not a single lecture.
	forskingsdagane: 'festival',
	kurs: 'kurs',
	kulturarrangement: 'anna'
};

/** Fold the Norwegian letters so a tag spelt `Styremøte` matches its key. */
function typeKey(id: string): string {
	return id.trim().toLowerCase().replace(/æ/g, 'ae').replace(/ø/g, 'o').replace(/å/g, 'a');
}

export function mapCategory(types: readonly string[]): CategorySlug {
	for (const type of types) {
		const hit = CATEGORY_BY_TYPE[typeKey(type)];
		if (hit) return hit;
	}
	return 'anna';
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
 * Is this event actually happening at the campus, or merely tagged with it?
 *
 * HVL tags an all-institution event with every campus, so the tag means "relevant to Stord" while
 * a reader of this site is asking "can I go". The address is the only field that answers the
 * second question. See the note on `addressPattern` in campuses.ts.
 */
export function isAtCampus(input: UpstreamEvent, campus: HvlCampus): boolean {
	const address = input.adress?.trim();
	if (!address) return false;
	return campus.addressPattern.test(address);
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
	/** The detail page to read a poster from, absolute. Null when the row carries no link. */
	detailUrl: string | null;
};

export type MapFailure = { externalId: string; title: string; problem: string };

export function isFailure(v: MappedEvent | MapFailure): v is MapFailure {
	return 'problem' in v;
}

function safeUrl(value: string | null | undefined, base = 'https://www.hvl.no'): string | null {
	if (!value) return null;
	try {
		const u = new URL(value, base);
		return u.protocol === 'http:' || u.protocol === 'https:' ? u.toString() : null;
	} catch {
		return null;
	}
}

export function mapEvent(
	input: UpstreamEvent,
	campus: HvlCampus,
	poster: string | null
): MappedEvent | MapFailure {
	const title = input.title.trim().replace(/\s+/g, ' ');
	const path = input.url?.trim() || null;

	/*
	 * The page path is the identity.
	 *
	 * It is stable across runs and unique per event, and keying on it means a time correction
	 * upstream updates the row we already hold instead of creating a second copy of the same
	 * lecture. Without a path there is no stable identity at all — inventing one from the title
	 * would duplicate the event the first time somebody fixes a typo — so the row is rejected and
	 * the run reports it rather than silently dropping it.
	 */
	if (!path) return { externalId: title, title, problem: 'no url on the calendar row' };
	if (!title) return { externalId: path, title: '', problem: 'empty title' };

	/*
	 * `startDateTime`, never `startFullDateTime`.
	 *
	 * They look interchangeable and are not. For an 13:15 event the service sends
	 * `startDateTime: 2026-09-03T11:15:00+00:00` — the correct instant — alongside
	 * `startFullDateTime: 2026-09-03T13:15+00:00`, which is the Oslo wall clock with a UTC offset
	 * stamped on it. Parsing the second would move every event two hours later in summer and one
	 * in winter, and would look right in a spot check because the digits match the poster.
	 */
	const startsAt = new Date(input.startDateTime);
	if (Number.isNaN(startsAt.getTime())) {
		return {
			externalId: path,
			title,
			problem: `unparseable startDateTime: ${input.startDateTime}`
		};
	}

	let endsAt: Date | null = null;
	if (input.endDateTime) {
		const parsed = new Date(input.endDateTime);
		if (!Number.isNaN(parsed.getTime()) && parsed.getTime() > startsAt.getTime()) endsAt = parsed;
	}

	const venueName = input.adress?.trim().replace(/\s+/g, ' ') || null;
	const sourceUrl = safeUrl(path) ?? `https://www.hvl.no/kalender/`;

	return {
		externalId: path,
		title,
		category: mapCategory(eventTypes(input)),
		startsAt,
		endsAt,
		venueName,
		venueSlug: venueName ? slugifyVenue(venueName) : null,
		// The month service sends this field always and fills it never. The detail page has prose,
		// but reading it would mean parsing an EPiServer template; the link goes there instead.
		description: input.description?.trim() || null,
		/*
		 * Registration, a Zoom link, a ticket page — whatever the event's own button points at.
		 * We never handle a booking ourselves; see the README non-goals.
		 */
		ctaUrl: safeUrl(input.buttonUrl),
		posterUrl: poster,
		/*
		 * Hotlinked, and recorded as unverified.
		 *
		 * HVL states nothing about reuse of its banner images, and an unstated right is not a
		 * granted one — the same reasoning as the MEC importer, where the venues did agree and it
		 * is recorded because they did.
		 */
		posterRightsVerified: false,
		sourceUrl,
		detailUrl: safeUrl(path)
	};
}
