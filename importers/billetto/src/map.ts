import type { CategorySlug } from '@hendingar/core/taxonomy';
import type { UpstreamEvent } from './api.ts';
import { organiserUrl, type BillettoOrganiser } from './organisers.ts';

/**
 * Pure mapping: one Billetto hit → our shape. No I/O, no clock, no randomness.
 */

/**
 * Billetto's `type` → our taxonomy. Consulted first, because it is the more specific of the two.
 *
 * A record carries both a broad `category` (music, performing_arts) and a narrower `type` (concert,
 * party, seminar). "music/party" and "music/concert" are different evenings, and the second field
 * is the one that says which.
 */
const CATEGORY_BY_TYPE: Record<string, CategorySlug> = {
	concert: 'musikk',
	party: 'dans',
	festival: 'festival',
	seminar: 'konferanse',
	conference: 'konferanse',
	class_training: 'kurs',
	dinner: 'mat-og-drikke',
	screening: 'show',
	race: 'sport',
	game: 'sport',
	tradeshow: 'marknad',
	meeting: 'mote',
	convention: 'konferanse'
};

/** The broad category, for a record whose type says nothing useful. */
const CATEGORY_BY_CATEGORY: Record<string, CategorySlug> = {
	music: 'musikk',
	performing_arts: 'teater',
	food_drink: 'mat-og-drikke',
	sports: 'sport',
	seasonal: 'festival',
	community: 'mote',
	religion: 'kyrkjeliv',
	school: 'kurs',
	business: 'konferanse'
};

export function mapCategory(
	type: string | null | undefined,
	category: string | null | undefined
): CategorySlug {
	const byType = type ? CATEGORY_BY_TYPE[type.trim().toLowerCase()] : undefined;
	if (byType) return byType;
	const byCategory = category ? CATEGORY_BY_CATEGORY[category.trim().toLowerCase()] : undefined;
	return byCategory ?? 'anna';
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
	municipality: string | null;
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
	if (!value) return null;
	try {
		const u = new URL(value);
		return u.protocol === 'http:' || u.protocol === 'https:' ? u.toString() : null;
	} catch {
		return null;
	}
}

/**
 * Billetto's descriptions are marketing prose, several hundred words of it.
 *
 * Kept, but trimmed at a sentence boundary: a card and an event page want what the thing is, not
 * the full band biography. Cutting mid-word would look like a bug; cutting at a full stop reads as
 * an excerpt, which is what it is.
 */
export const MAX_DESCRIPTION = 600;

export function trimDescription(value: string | null | undefined): string | null {
	const text = value?.replace(/\s+/g, ' ').trim();
	if (!text) return null;
	if (text.length <= MAX_DESCRIPTION) return text;

	const cut = text.slice(0, MAX_DESCRIPTION);
	const lastStop = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? '));
	return lastStop > MAX_DESCRIPTION * 0.5 ? cut.slice(0, lastStop + 1) : `${cut.trimEnd()}…`;
}

export function mapEvent(
	input: UpstreamEvent,
	organiser: BillettoOrganiser
): MappedEvent | MapFailure {
	const externalId = String(input.id);
	const title = input.name.trim().replace(/\s+/g, ' ');

	if (!title) return { externalId, title: '', problem: 'empty title' };
	if (input.state && input.state !== 'published') {
		return { externalId, title, problem: `not published upstream (${input.state})` };
	}

	/*
	 * Epoch seconds to an instant, ignoring the record's own `time_zone`.
	 *
	 * Billetto reports `Europe/Paris` for an event in Bømlo. It happens not to matter — the two
	 * share an offset — which is precisely why it should not be trusted: the day a source ships an
	 * event outside CET, believing that field would move it by hours.
	 */
	const startsAt = new Date(input.start_time * 1000);
	if (Number.isNaN(startsAt.getTime())) {
		return { externalId, title, problem: `unusable start_time: ${input.start_time}` };
	}

	let endsAt: Date | null = null;
	if (input.end_time) {
		const parsed = new Date(input.end_time * 1000);
		if (!Number.isNaN(parsed.getTime()) && parsed.getTime() > startsAt.getTime()) endsAt = parsed;
	}

	const venueName = input.venue_name?.trim() || input.location?.trim() || null;

	return {
		externalId,
		title,
		category: mapCategory(input.type, input.category),
		startsAt,
		endsAt,
		venueName,
		venueSlug: venueName ? slugifyVenue(venueName) : null,
		municipality: input.city?.trim() || null,
		description: trimDescription(input.description ?? input.short_description),
		/*
		 * The ticket page, which is also the source page — Billetto is where you buy, and we never
		 * sell. See the README non-goals.
		 */
		ctaUrl: safeUrl(input.url),
		/*
		 * Hotlinked from Billetto's image CDN, at whatever size they signed.
		 *
		 * The URL carries an imgix signature covering its `w` and `h`, so the 640×360 they generate
		 * cannot be requested larger without invalidating it. Worth knowing before anyone tries.
		 *
		 * Tried, and measured: the signed URL serves 640×360 (45 KB); the same URL at `w=1280`, or
		 * with `dpr=2` appended, or with the query stripped entirely, all answer **403 sig_invalid**.
		 * The `rect=0,0,1920,1080` in the query says the master is 1920×1080 — we simply cannot ask
		 * for it. So Billetto is the one source with no `posterSrcset` and no way to earn one: 640
		 * covers a 4-column desktop card at 2× (618 needed) and falls short of the 868 a 2-column
		 * layout wants. Nothing to fix here short of Billetto signing a larger rendition.
		 */
		posterUrl: safeUrl(input.image),
		/*
		 * Recorded as unverified. The image belongs to whoever set up the ticket page, and Billetto
		 * states nothing about reuse — an unstated right is not a granted one.
		 */
		posterRightsVerified: false,
		sourceUrl: safeUrl(input.url) ?? organiserUrl(organiser)
	};
}
