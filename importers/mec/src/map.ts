import type { CategorySlug } from '@hendingar/core/taxonomy';
import type { UpstreamEvent } from './api.ts';
import type { MecInstance } from './instances.ts';

/**
 * Pure mapping: MEC JSON-LD → our shape. No I/O, no clock, no randomness.
 */

/**
 * Everything imports as `anna`.
 *
 * This is deliberate, not laziness. MEC has an `mec_category` taxonomy, but on the sites we read
 * it does not hold categories: Bømlo folkebibliotek uses it for audience (Barn / Ungdom / Vaksne)
 * and none of its hundred events carries a term at all, while Moster Amfi uses it for month names.
 * Mapping either onto our taxonomy would be inventing a fact the source never stated.
 *
 * Categorisation is a judgement call, and this repo already has a place for those: the
 * verification service, working on structured data with a human reviewing anything uncertain
 * (ADR 0004, ADR 0008). An importer's job is to be right, not to guess.
 */
export const DEFAULT_CATEGORY: CategorySlug = 'anna';

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
	posterRightsVerified: boolean;
	sourceUrl: string;
};

export type MapFailure = { externalId: string; title: string; problem: string };

function safeUrl(value: string | null | undefined): string | null {
	if (!value) return null;
	try {
		const u = new URL(value);
		return u.protocol === 'http:' || u.protocol === 'https:' ? u.toString() : null;
	} catch {
		return null;
	}
}

/**
 * One occurrence's identity.
 *
 * MEC gives every occurrence of a repeating event the same post id and the same URL — twelve
 * events on one page came from five posts. Keying on the post alone would collapse a weekly
 * chess night into a single row that moves every day; keying on the URL alone has the same
 * problem. Post id plus the start instant is stable across runs and unique per occurrence.
 *
 * The instant is used in its UTC form so that a source switching how it writes offsets cannot
 * silently create a second copy of an event we already hold.
 */
export function occurrenceId(postId: string, startsAt: Date): string {
	return `${postId}@${startsAt.toISOString()}`;
}

export function mapEvent(
	input: UpstreamEvent,
	postId: string | null,
	instance: MecInstance
): MappedEvent | MapFailure {
	const title = input.name.trim();
	const startsAt = new Date(input.startDate);

	if (Number.isNaN(startsAt.getTime())) {
		return {
			externalId: postId ?? title,
			title,
			problem: `unparseable startDate: ${input.startDate}`
		};
	}
	if (!title) {
		return { externalId: postId ?? '', title: '', problem: 'empty title' };
	}
	/*
	 * Without a post id there is no stable identity, and inventing one from the title would
	 * duplicate the event the first time someone fixes a typo upstream. Rejecting is the honest
	 * outcome, and the run reports it rather than silently dropping the row.
	 */
	if (!postId) {
		return { externalId: title, title, problem: 'no data-event-id found for this event URL' };
	}

	let endsAt: Date | null = null;
	if (input.endDate) {
		const parsed = new Date(input.endDate);
		if (!Number.isNaN(parsed.getTime()) && parsed.getTime() > startsAt.getTime()) endsAt = parsed;
	}

	// Single-venue sites leave `location.name` empty because every event is held in the same place.
	const rawVenue = input.location?.name?.trim() || null;
	const venueName = rawVenue || instance.venueFallback;

	const sourceUrl = safeUrl(input.url) ?? instance.url;

	return {
		externalId: occurrenceId(postId, startsAt),
		title,
		category: DEFAULT_CATEGORY,
		startsAt,
		endsAt,
		venueName,
		venueSlug: slugifyVenue(venueName),
		description: input.description?.trim() || null,
		ctaUrl: safeUrl(input.offers?.url),
		/*
		 * Hotlinked from the site's own media library, never copied onto our infrastructure.
		 *
		 * MEC itself states nothing about image rights, so this cannot be read from the page — it
		 * comes from the instance config, which records whether that particular venue has agreed.
		 * An unstated right is still not a granted one; a stated one is.
		 */
		posterUrl: safeUrl(input.image),
		posterRightsVerified: instance.posterRightsCleared,
		sourceUrl
	};
}

export function isFailure(v: MappedEvent | MapFailure): v is MapFailure {
	return 'problem' in v;
}
