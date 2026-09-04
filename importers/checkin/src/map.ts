import type { CategorySlug } from '@hendingar/core/taxonomy';
import { MEDIA_BASE, eventUrl, type CheckinInstance, type UpstreamEvent } from './api.ts';

/**
 * Pure mapping: Checkin's shape → ours. No I/O, no clock, no randomness.
 */

/**
 * Checkin topic name → our taxonomy.
 *
 * Unlike MEC, these topics are real categories and worth mapping: an event tagged `konsert` is
 * music, and saying so is better than filing every event under `anna`. Keyed on the lowercased
 * name because Checkin's topics are free-text per customer, so there is no stable id to key on.
 */
const CATEGORY_BY_TOPIC: Record<string, CategorySlug> = {
	konsert: 'musikk',
	musikk: 'musikk',
	teater: 'teater',
	revy: 'show',
	show: 'show',
	standup: 'stand-up',
	'stand-up': 'stand-up',
	festival: 'festival',
	kurs: 'kurs',
	konferanse: 'konferanse',
	seminar: 'konferanse',
	messe: 'marknad',
	marknad: 'marknad',
	marked: 'marknad',
	utstilling: 'utstilling',
	sport: 'sport',
	idrett: 'sport',
	dans: 'dans',
	quiz: 'anna',
	'mat og drikke': 'mat-og-drikke',
	mat: 'mat-og-drikke',
	litteratur: 'litteratur',
	foredrag: 'mote',
	møte: 'mote'
};

/**
 * Topics that describe *that* something is an event rather than *what kind*.
 *
 * Every Kulleseidkanalen concert carries both `Kulturarrangement` and `konsert`. Taking the first
 * topic would file them all as generic; skipping the generic one finds the useful answer.
 */
const GENERIC_TOPICS = new Set(['kulturarrangement', 'arrangement', 'annet', 'anna', 'diverse']);

export function mapCategory(topics: readonly (string | null | undefined)[]): CategorySlug {
	const named = topics
		.map((t) => t?.trim().toLowerCase())
		.filter((t): t is string => Boolean(t && t.length > 0));

	for (const topic of named) {
		if (GENERIC_TOPICS.has(topic)) continue;
		const hit = CATEGORY_BY_TOPIC[topic];
		if (hit) return hit;
	}
	// A generic topic is still better evidence than nothing, but it only ever means 'anna'.
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

/** `imageUrl` is site-relative; an absolute one is passed through unchanged. */
export function posterUrlFor(imageUrl: string | null | undefined): string | null {
	if (!imageUrl) return null;
	const raw = imageUrl.trim();
	if (!raw) return null;
	if (/^https?:\/\//i.test(raw)) return raw;
	return `${MEDIA_BASE}${raw.startsWith('/') ? '' : '/'}${raw}`;
}

/**
 * Checkin encodes the width in the filename — `image700.jpg` really is 700 pixels wide.
 *
 * 700 is what the payload asks for and it is short of a 434px card on a 2× screen (868). Live
 * requests against `/static/12205/event_228158/` show the resizer answers any width from 500 up
 * (`image500` 500×500, `image1000` 1000×1000, `image1400`, `image2000`) and returns **400 Bad
 * Request** below 500 — so 500 is the floor of this ladder, not a design choice.
 *
 * Sizes are exact, not fitted to a box: a landscape source came back 500×262 and 1000×525.
 */
const POSTER_WIDTHS = [500, 700, 1000] as const;

export type Poster = { url: string | null; srcset: string | null };

/** The poster to link, and every width Checkin will serve it at. */
export function posterFrom(imageUrl: string | null | undefined): Poster {
	const url = posterUrlFor(imageUrl);
	if (!url) return { url: null, srcset: null };

	// Only a Checkin-hosted `imageNNN.ext` is a rendition we can resize. Anything else — an absolute
	// URL on some other host, a filename in another shape — is left exactly as it arrived.
	const match = url.startsWith(`${MEDIA_BASE}/`)
		? /^(.*\/image)\d+(\.(?:jpe?g|png|webp))$/i.exec(url)
		: null;
	if (!match) return { url, srcset: null };

	const sized = (w: number): string => `${match[1]!}${w}${match[2]!}`;

	return {
		url: sized(POSTER_WIDTHS[POSTER_WIDTHS.length - 1]!),
		srcset: POSTER_WIDTHS.map((w) => `${sized(w)} ${w}w`).join(', ')
	};
}

export function mapEvent(
	input: UpstreamEvent,
	instance: CheckinInstance
): MappedEvent | MapFailure {
	const title = input.name.trim();
	const externalId = String(input.id);

	if (!title) return { externalId, title: '', problem: 'empty name' };

	const startsAt = new Date(input.startsAt);
	if (Number.isNaN(startsAt.getTime())) {
		return { externalId, title, problem: `unparseable startsAt: ${input.startsAt}` };
	}

	let endsAt: Date | null = null;
	if (input.endsAt) {
		const parsed = new Date(input.endsAt);
		// Checkin routinely ends a concert at 02:00 the following morning, which is correct and must
		// survive; an end before its start is upstream noise rather than something to store.
		if (!Number.isNaN(parsed.getTime()) && parsed.getTime() > startsAt.getTime()) endsAt = parsed;
	}

	/*
	 * `description` is the human place name ("Kulleseidkanalen Gjestehamn"); `geoDescription` is a
	 * full postal string ("…, Kanalvegen, Finnås, Norge"). The short one is the venue; the long one
	 * belongs to geocoding, which is not this importer's job.
	 */
	const rawVenue = input.geoLocation?.description?.trim() || null;
	const venueName = rawVenue || instance.venueFallback;

	const topics = (input.topicEvent ?? []).map((t) => t?.topic?.name);
	const poster = posterFrom(input.imageUrl);

	return {
		externalId,
		title,
		category: mapCategory(topics),
		startsAt,
		endsAt,
		venueName,
		venueSlug: slugifyVenue(venueName),
		description: input.sellingDescription?.trim() || null,
		// Checkin IS the ticket seller, so the event page is the ticket link.
		ctaUrl: eventUrl(input.id),
		posterUrl: poster.url,
		posterSrcset: poster.srcset,
		posterRightsVerified: instance.posterRightsCleared,
		sourceUrl: eventUrl(input.id)
	};
}
