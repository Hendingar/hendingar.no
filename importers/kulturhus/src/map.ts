import { zonedWallClockToInstant } from '@hendingar/core/datetime';
import type { CategorySlug } from '@hendingar/core/taxonomy';
import type { KulturhusInstance, UpstreamEvent, UpstreamTicket } from './api.ts';

/**
 * Pure mapping: one showing → our shape. No I/O, no clock, no randomness.
 */

/**
 * The venue's own category names → our taxonomy.
 *
 * Worth mapping properly, unlike MEC's: these are real editorial categories a programme editor
 * chose, and Stord's 55 entries span thirteen of them. Filing a stand-up show under `anna` when
 * the venue has said "Standup" would be throwing away a fact.
 */
const CATEGORY_BY_NAME: Record<string, CategorySlug> = {
	konsert: 'musikk',
	musikk: 'musikk',
	standup: 'stand-up',
	'stand-up': 'stand-up',
	litteratur: 'litteratur',
	teater: 'teater',
	// A musical is staged drama with songs; `teater` is closer than `show` or `musikk`.
	musikal: 'teater',
	show: 'show',
	scenemønstring: 'show',
	revy: 'show',
	dans: 'dans',
	// A talk is a gathering people attend, which is what our `mote` covers.
	føredrag: 'mote',
	foredrag: 'mote',
	møte: 'mote',
	kurs: 'kurs',
	konferanse: 'konferanse',
	utstilling: 'utstilling',
	film: 'show',
	kino: 'show',
	// Public swimming sessions — an activity you turn up and do, not a performance you watch.
	'offentleg bading': 'sport',
	'offentlig bading': 'sport',
	sport: 'sport',
	idrett: 'sport',
	// Falturiltu is Stord's nynorsk children's-literature festival: a festival, not a book talk.
	falturiltu: 'festival',
	festival: 'festival',
	'mat og drikke': 'mat-og-drikke',
	marknad: 'marknad',
	kyrkjeliv: 'kyrkjeliv'
};

export function mapCategory(name: string | null | undefined): CategorySlug {
	const key = name?.trim().toLowerCase();
	if (!key) return 'anna';
	return CATEGORY_BY_NAME[key] ?? 'anna';
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
	posterSrcset: string | null;
	posterRightsVerified: boolean;
	sourceUrl: string;
};

export type MapFailure = { externalId: string; title: string; problem: string };

export function isFailure(v: MappedEvent | MapFailure): v is MapFailure {
	return 'problem' in v;
}

function safeUrl(value: string | null | undefined, base?: string): string | null {
	const raw = value?.trim();
	if (!raw) return null;
	try {
		const u = base ? new URL(raw, base) : new URL(raw);
		return u.protocol === 'http:' || u.protocol === 'https:' ? u.toString() : null;
	} catch {
		return null;
	}
}

/**
 * The card is at most 434 CSS pixels wide and the event page at most 832, so this ladder covers
 * both to 2× without asking a third party's resizer for sizes nobody displays.
 */
const POSTER_WIDTHS = [400, 600, 800, 1200] as const;

export type Poster = { url: string | null; srcset: string | null };

/**
 * The venue's imgix rendition, at sizes we actually display.
 *
 * The payload hands us a rendition the site itself uses in a listing strip: `?w=370&h=250&fit=crop
 * &crop=faces,top&auto=compress`. 370 pixels is roughly a third of what a card needs on a 2×
 * screen, and the parameters are unsigned — imgix will serve any size we ask for, which a live
 * request confirmed (1200×750, 49 KB).
 *
 * Three things are deliberate:
 *
 * - **A signed rendition is left exactly as it arrived.** `s=` covers the query string, so editing
 *   `w` returns `sig_invalid` rather than a bigger picture. Billetto's images are locked this way
 *   and there is nothing to be done about it; none of the Kulturhus ones are today, but the guard
 *   costs a line and the failure mode is every poster on the site 403ing.
 * - **The editorial crop is preserved.** `w` and `h` are scaled together so `crop=faces,top` keeps
 *   framing what the venue framed. Dropping `h` would give us the uncropped picture and quietly
 *   throw away someone's decision about where the faces are.
 * - **`auto=compress,format`**, upgraded from `auto=compress`: imgix then negotiates WebP or AVIF
 *   with the browser, which is the cheapest resolution we will ever buy.
 *
 * A URL without a `w` is not a rendition we understand, so it is passed through untouched.
 */
export function posterFrom(image: string | null | undefined): Poster {
	const url = safeUrl(image);
	if (!url) return { url: null, srcset: null };

	const source = new URL(url);
	if (source.searchParams.has('s')) return { url, srcset: null };

	// `set`, so the payload's duplicated `fit=crop&fit=crop&crop=faces,top&crop=faces,top` collapses
	// to one of each rather than being carried into every candidate.
	const params = new URLSearchParams();
	for (const [key, value] of source.searchParams) params.set(key, value);

	const width = Number(params.get('w'));
	if (!Number.isFinite(width) || width <= 0) return { url, srcset: null };
	const height = Number(params.get('h'));
	const ratio = Number.isFinite(height) && height > 0 ? height / width : null;
	params.set('auto', 'compress,format');

	const at = (w: number): string => {
		const query = new URLSearchParams(params);
		query.set('w', String(w));
		if (ratio !== null) query.set('h', String(Math.round(w * ratio)));
		return `${source.origin}${source.pathname}?${query.toString()}`;
	};

	return {
		url: at(POSTER_WIDTHS[POSTER_WIDTHS.length - 1]!),
		srcset: POSTER_WIDTHS.map((w) => `${at(w)} ${w}w`).join(', ')
	};
}

/** "2026-09-03 11:00:00" → ["2026-09-03", "11:00"]. Null for anything else. */
export function splitLocalDateTime(value: string): [string, string] | null {
	const m = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}):(\d{2})/.exec(value.trim());
	return m ? [m[1]!, `${m[2]}:${m[3]}`] : null;
}

/**
 * One showing becomes one event.
 *
 * `parent` carries the title, category, image and detail-page link; `ticket` carries the date,
 * the room and the ticket link. The ticket's id is the identity: it is stable per showing, which
 * the parent's id is not.
 */
export function mapTicket(
	parent: UpstreamEvent,
	ticket: UpstreamTicket,
	instance: KulturhusInstance
): MappedEvent | MapFailure {
	const externalId = ticket.id.trim();
	const title = parent.title.trim();

	if (!externalId) return { externalId: '', title, problem: 'a showing with no id' };
	if (!title) return { externalId, title: '', problem: 'empty title' };

	const parts = splitLocalDateTime(ticket.date);
	if (!parts) {
		return { externalId, title, problem: `unparseable date: ${ticket.date}` };
	}

	let startsAt: Date;
	try {
		/*
		 * A wall clock with no zone, so it goes through the venue's own. Constructing a Date from
		 * "2026-09-03 11:00:00" would use the server's zone — wrong outside Norway and wrong twice
		 * a year inside it.
		 */
		startsAt = zonedWallClockToInstant(parts[0], parts[1], instance.timezone);
	} catch (error) {
		return {
			externalId,
			title,
			problem: `unusable date ${ticket.date}: ${error instanceof Error ? error.message : String(error)}`
		};
	}

	const venueName = ticket.location?.trim() || instance.venueFallback;
	const poster = posterFrom(parent.image);

	return {
		externalId,
		title,
		category: mapCategory(parent.category),
		startsAt,
		// The payload states a start and never an end. A guessed duration is invented data.
		endsAt: null,
		venueName,
		venueSlug: slugifyVenue(venueName),
		description: parent.description?.trim() || null,
		ctaUrl: safeUrl(ticket.link),
		posterUrl: poster.url,
		posterSrcset: poster.srcset,
		posterRightsVerified: instance.posterRightsCleared,
		// The event's own page when it has one, so a reader lands on the programme rather than in a
		// checkout — we are an index, not a box office.
		sourceUrl: safeUrl(parent.link, instance.origin) ?? instance.url
	};
}

/** Every showing of every event, flattened. */
export function mapEvents(
	events: readonly UpstreamEvent[],
	instance: KulturhusInstance
): (MappedEvent | MapFailure)[] {
	const out: (MappedEvent | MapFailure)[] = [];
	for (const parent of events) {
		const tickets = parent.tickets ?? [];
		if (tickets.length === 0) {
			/*
			 * No showings listed. `begin` still says when it starts, so the event is real and
			 * importable — a programme entry with its ticket sale not yet open looks exactly like
			 * this, and dropping it would hide next season's concerts.
			 */
			if (!parent.begin) {
				out.push({
					externalId: parent.id,
					title: parent.title,
					problem: 'no showings and no begin'
				});
				continue;
			}
			out.push(
				mapTicket(
					parent,
					{ id: parent.id, date: parent.begin, location: null, link: null },
					instance
				)
			);
			continue;
		}
		for (const ticket of tickets) out.push(mapTicket(parent, ticket, instance));
	}
	return out;
}
