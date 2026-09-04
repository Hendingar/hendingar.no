import type { CategorySlug } from '@hendingar/core/taxonomy';
import { CATEGORY_SLUGS } from '@hendingar/core/taxonomy';
import { SOURCE, type UpstreamEvent } from './api.ts';

/**
 * Pure mapping: upstream shape → our shape. No I/O, no clock, no randomness — so it is fully
 * testable against committed fixtures, and a wrong import is reproducible rather than a mystery.
 */

/**
 * Innocode category id → our taxonomy. Keyed by id rather than name because the ids are stable
 * while the display names are editorial and localised.
 */
const CATEGORY_BY_ID: Record<number, CategorySlug> = {
	641: 'sport',
	642: 'musikk',
	643: 'konferanse',
	644: 'mote',
	645: 'utstilling',
	646: 'festival',
	647: 'mat-og-drikke',
	648: 'anna',
	649: 'dans',
	650: 'teater',
	651: 'show',
	652: 'stand-up',
	653: 'litteratur',
	654: 'kurs',
	655: 'marknad',
	1988: 'kyrkjeliv'
};

/** Fallback for ids we have never seen — matched on the localised name, then on 'anna'. */
const CATEGORY_BY_NAME: Record<string, CategorySlug> = {
	musikk: 'musikk',
	teater: 'teater',
	utstilling: 'utstilling',
	sport: 'sport',
	møte: 'mote',
	mote: 'mote',
	kyrkjeliv: 'kyrkjeliv',
	festival: 'festival',
	litteratur: 'litteratur',
	'stand-up': 'stand-up',
	show: 'show',
	'mat og drikke': 'mat-og-drikke',
	dans: 'dans',
	'marknad/shopping': 'marknad',
	konferanse: 'konferanse',
	kurs: 'kurs',
	andre: 'anna'
};

export function mapCategory(id: number | null, name: string | null): CategorySlug {
	if (id != null && CATEGORY_BY_ID[id]) return CATEGORY_BY_ID[id];
	if (name) {
		const hit = CATEGORY_BY_NAME[name.trim().toLowerCase()];
		if (hit) return hit;
	}
	return 'anna';
}

/** Every slug we map to must exist in the taxonomy — asserted by a test, not by hope. */
export const MAPPED_SLUGS: readonly CategorySlug[] = [
	...new Set([...Object.values(CATEGORY_BY_ID), ...Object.values(CATEGORY_BY_NAME)])
];

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
	organizerName: string | null;
	organizerSlug: string | null;
	ctaUrl: string | null;
	posterUrl: string | null;
	posterSrcset: string | null;
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
 * The resize boxes behind the `s_` / `m_` / `l_` filename prefixes, measured against the CDN.
 *
 * A 1200×960 poster comes back as 300×240, 500×400 and 800×640; a 804×994 one as 243×300, 404×500
 * and 647×800. So the number is the LONGEST side, not the width — the descriptor below is exact
 * for a landscape poster and up to 25% optimistic for a portrait one. That direction is the safe
 * one: an optimistic descriptor makes the browser reach for one step larger than it strictly
 * needs, where a pessimistic one would hand it a file too small for the slot.
 */
const POSTER_BOXES = [
	{ prefix: 's_', box: 300 },
	{ prefix: 'm_', box: 500 },
	{ prefix: 'l_', box: 800 }
] as const;

export type Poster = { url: string | null; srcset: string | null };

/**
 * Every size the CDN holds of one poster, as a URL to link and a candidate list to render.
 *
 * `posterUrls` arrives as `[s_, m_, l_, original]` and we read the prefix rather than the index:
 * the order is undocumented, and picking `[0]` is exactly how this importer spent its first
 * release hotlinking the 300px thumbnail into a card that occupies up to 434 CSS pixels.
 *
 * The unprefixed original is what we store as the poster — it is what `og:image`, the JSON-LD and
 * the event page use, and a 300px preview is below what Facebook will render. It is deliberately
 * NOT in the candidate list: its dimensions are only knowable per event, and the upstream
 * `posterWidth`/`posterHeight` describe the uploaded file rather than this one (a `cropped_poster`
 * declared 675×1200 and is served at 972×812). A width descriptor we cannot verify would make the
 * browser download the largest file on a phone showing an 88px thumbnail.
 */
export function posterFrom(urls: readonly string[]): Poster {
	const byPrefix = new Map<string, string>();
	let original: string | null = null;

	for (const raw of urls) {
		const url = safeUrl(raw);
		if (!url) continue;
		const name = new URL(url).pathname.split('/').pop() ?? '';
		const prefix = /^([sml]_)/.exec(name)?.[1];
		if (prefix) byPrefix.set(prefix, url);
		else original ??= url;
	}

	const candidates = POSTER_BOXES.flatMap(({ prefix, box }) => {
		const url = byPrefix.get(prefix);
		return url ? [`${url} ${box}w`] : [];
	});

	return {
		url: original ?? byPrefix.get('l_') ?? byPrefix.get('m_') ?? byPrefix.get('s_') ?? null,
		// One candidate is not a choice — leave it null and let the app render a plain `src`.
		srcset: candidates.length > 1 ? candidates.join(', ') : null
	};
}

export function mapEvent(input: UpstreamEvent): MappedEvent | MapFailure {
	// Upstream marks editorial state on the record; anything not approved is not ours to publish.
	if (input.status !== 'approved') {
		return { externalId: String(input.id), title: input.title, problem: `status=${input.status}` };
	}

	const startsAt = new Date(input.eventTime);
	if (Number.isNaN(startsAt.getTime())) {
		return {
			externalId: String(input.id),
			title: input.title,
			problem: `unparseable eventTime: ${input.eventTime}`
		};
	}

	let endsAt: Date | null = null;
	if (input.eventEndTime) {
		const parsed = new Date(input.eventEndTime);
		// A bad end time must not discard an otherwise good event, and an end before its start is
		// upstream noise rather than something to store.
		if (!Number.isNaN(parsed.getTime()) && parsed.getTime() > startsAt.getTime()) endsAt = parsed;
	}

	const title = input.title.trim();
	if (!title) {
		return { externalId: String(input.id), title: '', problem: 'empty title' };
	}

	/*
	 * Some upstream records repeat the title in `location` ("Busstur til Bergen Blomstersjov" as
	 * both). That is not a venue, and showing it renders the same string twice in a card. Treat it
	 * as unknown rather than storing a fake place, which would also pollute the venue table and
	 * hand the geocoder something unplaceable.
	 */
	const rawVenue = input.location?.trim() || null;
	const venueName = rawVenue && rawVenue.toLowerCase() !== title.toLowerCase() ? rawVenue : null;

	const poster = posterFrom(input.posterUrls);

	return {
		externalId: String(input.id),
		title,
		category: mapCategory(input.categoryId, input.categoryName),
		startsAt,
		endsAt,
		venueName,
		venueSlug: venueName ? slugifyVenue(venueName) : null,
		organizerName: input.organizerName?.trim() || null,
		organizerSlug: input.organizerSlug?.trim() || null,
		ctaUrl: safeUrl(input.ctaUrl),
		/*
		 * We store the poster URL and hotlink it from the source's own CDN — we never copy the file
		 * onto our infrastructure.
		 *
		 * Rights come from `SOURCE`, not from the response. `imageRightsVerified` is false on every
		 * record this API returns, which means the publisher does not populate the field rather
		 * than that permission is absent — so reading it understated a permission we actually hold
		 * from Innocode / Polaris. The agreement is the fact; the field is noise.
		 */
		posterUrl: poster.url,
		posterSrcset: poster.srcset,
		posterRightsVerified: SOURCE.posterRightsCleared,
		sourceUrl: `https://detskjer.sunnhordland.no/events/${input.eventSlug}`
	};
}

export function isFailure(v: MappedEvent | MapFailure): v is MapFailure {
	return 'problem' in v;
}

/** Guard for the taxonomy assertion in tests. */
export const TAXONOMY = CATEGORY_SLUGS;
