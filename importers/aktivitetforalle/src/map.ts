import { zonedWallClockToInstant } from '@hendingar/core/datetime';
import type { CategorySlug } from '@hendingar/core/taxonomy';
import { orNull, type FilterVocabulary, type UpstreamEvent } from './api.ts';
import { eventUrl, listingUrl, type AfaSite } from './sites.ts';

/**
 * Pure mapping: one portal row → our shape. No I/O, no clock, no randomness.
 */

/**
 * The portal's category vocabulary → our taxonomy.
 *
 * Keyed on the filter's NAME rather than its id: the ids are per-site database keys, and the same
 * category carries a different number on the next municipality's portal, while the vocabulary
 * itself is shared by the platform. Names that describe an audience or a facility rather than a
 * kind of event fall through to `anna`.
 */
const CATEGORY_BY_NAME: Record<string, CategorySlug> = {
	musikk: 'musikk',
	konsert: 'musikk',
	teater: 'teater',
	underholdning: 'show',
	utstilling: 'utstilling',
	kunst: 'utstilling',
	idrett: 'sport',
	'fysisk aktivitet/friluftsliv': 'sport',
	'stemne/cup/turnering': 'sport',
	konkurranse: 'sport',
	'mat & drikke': 'mat-og-drikke',
	'kurs & konferanse': 'kurs',
	kurs: 'kurs',
	dans: 'dans',
	marknad: 'marknad',
	livssyn: 'kyrkjeliv',
	litteratur: 'litteratur',
	'samfunn & politikk': 'mote',
	foredrag: 'mote',
	festival: 'festival',
	feiring: 'festival'
};

export function mapCategory(
	filterIds: readonly string[],
	vocabulary: FilterVocabulary
): CategorySlug {
	for (const id of filterIds) {
		const filter = vocabulary.get(id);
		if (filter?.type !== 'category') continue;
		const hit = CATEGORY_BY_NAME[filter.name.trim().toLowerCase()];
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
 * Is this a dated event, or a standing offer?
 *
 * The portal holds both, and only the first belongs in a what's-on listing. `activity` rows are
 * things like "Aqua gym, every Tuesday and Thursday, August to June" — a year-long weekly pattern
 * with a season as its date range. Materialising those would bury sixty real events under hundreds
 * of gym sessions.
 *
 * Filtering on `event_type` rather than on the audience tags the portal's own URL uses. Those tags
 * happen to correlate — ids 81–85 sit on `arrangement` rows and 38–42 on `activity` rows — but the
 * correlation is not the rule: **fifty-six of the hundred and twenty-two public events carry no
 * audience tag at all**, and they include Sigvart Dagsland, Riksteatret and Teater Vestland. A
 * filter built on the tags silently drops half the programme, and the better half.
 */
export function isPublishableEvent(input: UpstreamEvent, timeZone: string): boolean {
	if (orNull(input.event_status) !== 'public') return false;
	if (orNull(input.event_type) !== 'arrangement') return false;
	/*
	 * And it must say when.
	 *
	 * One public event — "Rema Cup 2026" — carries an end time and no start, which is a gap in the
	 * portal's own record rather than a change in its shape. Checking it here rather than letting
	 * `mapEvent` reject it keeps `rejected` meaning "the source moved": an event with no start
	 * cannot be placed on a day, so there is nothing to list and nothing to report as broken.
	 */
	return toInstant(orNull(input.event_from), timeZone) !== null;
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

function safeUrl(value: string | null): string | null {
	if (!value) return null;
	try {
		const u = new URL(value);
		return u.protocol === 'http:' || u.protocol === 'https:' ? u.toString() : null;
	} catch {
		return null;
	}
}

/**
 * "2026-09-18 19:00:00" → an instant.
 *
 * There is no offset anywhere in the payload, so the string is a wall clock in the municipality's
 * own zone and has to be resolved against it. Handing it to `new Date()` would read it as the
 * *server's* local time — correct on a laptop in Norway, an hour or two wrong in CI, which is the
 * kind of bug that only shows up in production.
 */
export function toInstant(value: string | null, timeZone: string): Date | null {
	if (!value) return null;
	const match = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})/.exec(value.trim());
	if (!match) return null;
	try {
		return zonedWallClockToInstant(match[1]!, match[2]!, timeZone);
	} catch {
		return null;
	}
}

export function mapEvent(
	input: UpstreamEvent,
	site: AfaSite,
	vocabulary: FilterVocabulary,
	locations: Map<string, string>
): MappedEvent | MapFailure {
	const externalId = String(input.event_id);
	const title = input.event_title.trim().replace(/\s+/g, ' ');

	if (!title) return { externalId, title: '', problem: 'empty title' };

	const startsAt = toInstant(orNull(input.event_from), site.timezone);
	if (!startsAt) {
		return { externalId, title, problem: `unusable event_from: ${input.event_from}` };
	}

	const endsAtRaw = toInstant(orNull(input.event_to), site.timezone);
	const endsAt = endsAtRaw && endsAtRaw.getTime() > startsAt.getTime() ? endsAtRaw : null;

	/*
	 * A venue is named one of two ways, and the row says which: `custom` puts the name inline,
	 * `location` points at a row in /api/v1/locations. Reading only the inline field would leave
	 * forty-four of the hundred and twenty-two events with no place at all.
	 */
	const venueName =
		orNull(input.event_location_custom_title) ??
		(input.event_location_id != null
			? (locations.get(String(input.event_location_id)) ?? null)
			: null);

	const thumbnail = input.event_thumbnail;
	const poster =
		thumbnail && thumbnail.upload_public !== false ? safeUrl(orNull(thumbnail.upload_url)) : null;

	const filterIds = (input.event_filter_ids ?? []).map(String);

	return {
		externalId,
		title,
		category: mapCategory(filterIds, vocabulary),
		startsAt,
		endsAt,
		venueName,
		venueSlug: venueName ? slugifyVenue(venueName) : null,
		description: orNull(input.event_description) ?? orNull(input.event_summary),
		ctaUrl: safeUrl(orNull(input.event_ticket_link)),
		posterUrl: poster,
		/*
		 * Hotlinked, and recorded as unverified.
		 *
		 * The images are uploaded by whichever organisation registered the event, and the portal
		 * states nothing about their licensing. An unstated right is not a granted one — the same
		 * reasoning as the MEC importer, where the venues did agree and it is recorded because
		 * they did.
		 */
		posterRightsVerified: false,
		/*
		 * The event's own page. Verified in a browser rather than assumed: the route is rendered
		 * client-side, so an archived id returns HTTP 200 with a shell and only becomes "Ikkje
		 * funne" once the script runs. Every id we import is `public`, which is exactly the set
		 * whose pages resolve.
		 */
		sourceUrl: eventUrl(site, externalId) || listingUrl(site)
	};
}
