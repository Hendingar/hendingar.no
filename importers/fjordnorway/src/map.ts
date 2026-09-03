import { zonedWallClockToInstant } from '@hendingar/core/datetime';
import type { CategorySlug } from '@hendingar/core/taxonomy';
import {
	localised,
	localisedSlug,
	type FjordInstance,
	type UpstreamEvent,
	type UpstreamShowing
} from './api.ts';

/**
 * Pure mapping: one showing → our shape. No I/O, no clock, no randomness.
 */

/**
 * Fjord Norway's subcategory slugs → our taxonomy.
 *
 * Keyed on the Norwegian slug rather than the display name: the slug is machine-facing and stable,
 * while `locTitle` is editorial and translated three ways.
 *
 * Their vocabulary is a *tourism* taxonomy, so most of it describes activities rather than events —
 * "sykling", "spa-og-sauna", "utsiktspunkt". Only the ones that can actually be an event on a date
 * are mapped; the rest fall through to `anna`, which is honest for a listing whose subject is
 * things that happen at a time.
 */
const CATEGORY_BY_SLUG: Record<string, CategorySlug> = {
	'teater-og-scenekunst': 'teater',
	musikk: 'musikk',
	festivaler: 'festival',
	lokalmat: 'mat-og-drikke',
	'kunst-og-handverk': 'utstilling',
	'kunst-og-museum': 'utstilling',
	'arkitektur-og-kulturarv': 'utstilling',
	sport: 'sport',
	ski: 'sport',
	sykling: 'sport',
	'fjellturer-og-vandring': 'sport',
	'vannsport-og-padling': 'sport',
	'klatring-juving-og-zipline': 'sport',
	fiske: 'sport',
	'ridning-og-hundekjoring': 'sport',
	yoga: 'kurs',
	'by-sightseeing': 'anna',
	bussturer: 'anna',
	'batturer-og-fjordcruise': 'anna'
};

export function mapCategory(subCategorySlug: string | null): CategorySlug {
	if (!subCategorySlug) return 'anna';
	return CATEGORY_BY_SLUG[subCategorySlug] ?? 'anna';
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
	posterRightsVerified: boolean;
	sourceUrl: string;
};

export type MapFailure = { externalId: string; title: string; problem: string };

export function isFailure(v: MappedEvent | MapFailure): v is MapFailure {
	return 'problem' in v;
}

function safeUrl(value: string | null | undefined): string | null {
	const raw = value?.trim();
	if (!raw) return null;
	try {
		const u = new URL(raw);
		return u.protocol === 'http:' || u.protocol === 'https:' ? u.toString() : null;
	} catch {
		return null;
	}
}

/** "2026-09-04T19:00:00" → ["2026-09-04", "19:00"]. Null for anything else. */
export function splitLocalDateTime(value: string): [string, string] | null {
	const m = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}):(\d{2})/.exec(value.trim());
	return m ? [m[1]!, `${m[2]}:${m[3]}`] : null;
}

export function mapShowing(
	parent: UpstreamEvent,
	showing: UpstreamShowing,
	index: number,
	instance: FjordInstance
): MappedEvent | MapFailure {
	/*
	 * Identity is the event id plus the showing's own key.
	 *
	 * `_key` is Sanity's per-array-item id and is stable, but it is nullable — so the array index is
	 * the fallback. Index alone would be wrong: reordering the showings upstream would silently
	 * reassign every date. Together they are stable in practice and unique by construction.
	 */
	const externalId = `${parent._id}:${showing._key?.trim() || `i${index}`}`;
	const title = localised(parent.locTitle) ?? '';

	if (!title) return { externalId, title: '', problem: 'no title in any language' };

	const raw = showing.fromTime?.trim();
	if (!raw) return { externalId, title, problem: 'showing has no fromTime' };

	const parts = splitLocalDateTime(raw);
	if (!parts) return { externalId, title, problem: `unparseable fromTime: ${raw}` };

	let startsAt: Date;
	try {
		// No offset in the payload, so it is a wall clock and must be resolved in the region's zone.
		startsAt = zonedWallClockToInstant(parts[0], parts[1], instance.timezone);
	} catch (error) {
		return {
			externalId,
			title,
			problem: `unusable fromTime ${raw}: ${error instanceof Error ? error.message : String(error)}`
		};
	}

	let endsAt: Date | null = null;
	const rawEnd = showing.toTime?.trim();
	if (rawEnd) {
		const endParts = splitLocalDateTime(rawEnd);
		if (endParts) {
			const candidate = zonedWallClockToInstant(endParts[0], endParts[1], instance.timezone);
			if (candidate.getTime() > startsAt.getTime()) endsAt = candidate;
		}
	}

	/*
	 * The venue, then the event's own venue, then the place.
	 *
	 * `place` is a destination ("Leirvik på Stord"), not a room — useful when nothing better is
	 * given, but it must not win over a real venue name, or every event in town shares one address
	 * and the map becomes a single pin.
	 */
	const venueName =
		showing.venueName?.trim() ||
		parent.eventInfo?.venueName?.trim() ||
		localised(parent.place?.locTitle) ||
		instance.venueFallback;

	const slug = localisedSlug(parent.locSlug);

	return {
		externalId,
		title,
		category: mapCategory(localisedSlug(parent.subCategory?.locSlug)),
		startsAt,
		endsAt,
		venueName,
		venueSlug: slugifyVenue(venueName),
		description: localised(parent.locShortDescription),
		ctaUrl: safeUrl(showing.bookingUrl),
		posterUrl: safeUrl(parent.cloudinaryImages?.[0]?.image?.secure_url),
		posterRightsVerified: instance.posterRightsCleared,
		sourceUrl: slug ? `${instance.origin}/no/arrangementer/${slug}` : instance.url
	};
}

/** Every showing of every event, flattened. */
export function mapEvents(
	events: readonly UpstreamEvent[],
	instance: FjordInstance
): (MappedEvent | MapFailure)[] {
	const out: (MappedEvent | MapFailure)[] = [];
	for (const parent of events) {
		const showings = parent.eventInfo?.showings ?? [];
		if (showings.length === 0) {
			out.push({
				externalId: parent._id,
				title: localised(parent.locTitle) ?? '',
				problem: 'no showings'
			});
			continue;
		}
		showings.forEach((showing, index) => out.push(mapShowing(parent, showing, index, instance)));
	}
	return out;
}
