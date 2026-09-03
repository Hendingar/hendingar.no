import type { CategorySlug } from '@hendingar/core/taxonomy';
import { subTypeList, type UpstreamActivity, type UpstreamDetails } from './api.ts';
import { calendarUrl, type DntAssociation } from './associations.ts';

/**
 * Pure mapping: one DNT activity → our shape. No I/O, no clock, no randomness.
 */

/**
 * DNT's activity types → our taxonomy.
 *
 * These five are the whole national vocabulary, read from the calendar's own `typeFacets` rather
 * than from the handful our two turlag happen to use today.
 *
 * `Fellestur` → `sport` follows the precedent already set in the Fjord Norway importer, where
 * `fjellturer-og-vandring` maps the same way. A guided walk is not a competition, but `sport` is
 * where a reader looking for something to do outdoors will look, and it is the only category in
 * our taxonomy that means "physical activity".
 */
const CATEGORY_BY_MAIN_TYPE: Record<string, CategorySlug> = {
	fellestur: 'sport',
	kurs: 'kurs',
	arrangement: 'anna',
	dugnad: 'anna',
	other: 'anna'
};

/**
 * Subtypes that mean something more specific than their parent type.
 *
 * Only the ones where the subtype genuinely disagrees with `mainType` are listed. A `Brekurs`
 * under `Kurs` is already `kurs`, so repeating the whole subtype vocabulary here would add rows
 * that can never change an answer.
 */
const CATEGORY_BY_SUB_TYPE: Record<string, CategorySlug> = {
	// Filed under Arrangement, but it is a members' meeting.
	medlemsmøte: 'mote',
	// Tours that can be filed under Arrangement or Other depending on who entered them.
	fottur: 'sport',
	skitur: 'sport',
	topptur: 'sport',
	sykkeltur: 'sport',
	padletur: 'sport',
	klatretur: 'sport',
	bretur: 'sport',
	løpetur: 'sport',
	trugetur: 'sport',
	skøytetur: 'sport',
	fiske: 'sport',
	vannaktivitet: 'sport',
	'buldring og klatring': 'sport',
	'kom deg ut-dagen': 'festival'
};

export function mapCategory(
	mainType: string | null | undefined,
	subTypes: string | null | undefined
): CategorySlug {
	for (const sub of subTypeList(subTypes)) {
		const hit = CATEGORY_BY_SUB_TYPE[sub.toLowerCase()];
		if (hit) return hit;
	}
	const key = mainType?.trim().toLowerCase();
	if (!key) return 'anna';
	return CATEGORY_BY_MAIN_TYPE[key] ?? 'anna';
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

const NAMED_ENTITIES: Record<string, string> = {
	nbsp: ' ',
	amp: '&',
	lt: '<',
	gt: '>',
	quot: '"',
	apos: "'",
	oslash: 'ø',
	Oslash: 'Ø',
	aring: 'å',
	Aring: 'Å',
	aelig: 'æ',
	AElig: 'Æ',
	hellip: '…',
	ndash: '–',
	mdash: '—',
	rsquo: '’',
	lsquo: '‘',
	ldquo: '“',
	rdquo: '”'
};

function decodeEntities(value: string): string {
	return value.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (match, body: string) => {
		if (body.startsWith('#')) {
			const code =
				body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : Number(body.slice(1));
			return Number.isFinite(code) && code > 0 ? String.fromCodePoint(code) : match;
		}
		return NAMED_ENTITIES[body] ?? match;
	});
}

/**
 * DNT's rich-text description → plain text.
 *
 * The field is editor HTML — paragraphs, headings, `<br>`, bold, and the occasional link — and we
 * store descriptions as text. Block elements become blank lines rather than disappearing, because
 * these descriptions carry the practical detail ("Frå Fitjar Bedehus … klokka 10.00") and running
 * three paragraphs into one line is how that becomes unreadable.
 */
export function htmlToText(html: string | null | undefined): string | null {
	if (!html) return null;
	const text = decodeEntities(
		html
			.replace(/<\s*(script|style)[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, '')
			.replace(/<\s*br\s*\/?\s*>/gi, '\n')
			.replace(/<\s*\/\s*(p|div|h[1-6]|li|tr|blockquote)\s*>/gi, '\n\n')
			.replace(/<\s*li[^>]*>/gi, '• ')
			.replace(/<[^>]+>/g, '')
	)
		// Collapse runs of spaces but keep the line structure the block tags just created.
		.replace(/[^\S\n]+/g, ' ')
		.replace(/ ?\n ?/g, '\n')
		.replace(/\n{3,}/g, '\n\n')
		.trim();
	return text || null;
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
	/** DNT says this trip is off. The ingest keeps it out of listings — see ingest.ts. */
	cancelled: boolean;
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
 * The placeholder DNT renders when a trip has no photo of its own.
 *
 * It is a decorative brand pattern, not a picture of anything — importing it would fill the
 * listing with identical tiles that look like content and carry none. Our own generated tile is
 * both more informative and more honest, so a trip without a photo gets no poster at all.
 */
export const PLACEHOLDER_IMAGE = '/images/pattern.svg';

export function posterFor(imageUrl: string | null | undefined): string | null {
	if (!imageUrl || imageUrl.trim() === PLACEHOLDER_IMAGE) return null;
	return safeUrl(imageUrl);
}

export function mapActivity(
	input: UpstreamActivity,
	details: UpstreamDetails | null,
	association: DntAssociation
): MappedEvent | MapFailure {
	const externalId = String(input.id);
	const title = input.pageTitle.trim().replace(/\s+/g, ' ');
	const vm = input.activityViewModel;

	if (!title) return { externalId, title: '', problem: 'empty title' };
	if (!vm) return { externalId, title, problem: 'no activityViewModel' };

	const startsAt = new Date(vm.start);
	if (Number.isNaN(startsAt.getTime())) {
		return { externalId, title, problem: `unparseable start: ${vm.start}` };
	}

	let endsAt: Date | null = null;
	if (vm.end) {
		const parsed = new Date(vm.end);
		// DNT writes end == start when the organiser left the duration blank.
		if (!Number.isNaN(parsed.getTime()) && parsed.getTime() > startsAt.getTime()) endsAt = parsed;
	}

	const venueName = vm.eventLocation?.trim().replace(/\s+/g, ' ') || null;

	return {
		externalId,
		title,
		category: mapCategory(vm.mainType, vm.subTypes),
		startsAt,
		endsAt,
		venueName,
		venueSlug: venueName ? slugifyVenue(venueName) : null,
		description: htmlToText(details?.description),
		/*
		 * The sign-up page, which is what DNT's own "Mer informasjon og påmelding" button opens.
		 * We never sell or handle a booking ourselves — see the README non-goals.
		 */
		ctaUrl: safeUrl(details?.utUrl),
		posterUrl: posterFor(vm.imageUrl),
		/*
		 * Hotlinked, and recorded as unverified.
		 *
		 * These photos are uploaded by the volunteer who registered the trip, and DNT states
		 * nothing about their licensing anywhere in the API or on the page. An unstated right is
		 * not a granted one — the same reasoning as the `posterRightsCleared` flag in the MEC
		 * importer, where the venues did agree and it is recorded because they did.
		 */
		posterRightsVerified: false,
		/*
		 * The turlag's calendar page, not a page for this one activity.
		 *
		 * DNT does mint a per-activity EPiServer URL, and it is in the API response — but every
		 * one of them returns 500, because the calendar never navigates to them. A card opens a
		 * modal instead, so the address bar never changes and nobody upstream notices the pages
		 * are broken. Linking there would send readers to an error page; linking to the calendar
		 * sends them to where the activity is actually published. The sign-up link in `ctaUrl` is
		 * the per-activity destination DNT itself offers.
		 */
		sourceUrl: calendarUrl(association),
		cancelled: vm.isCancelled === true
	};
}
