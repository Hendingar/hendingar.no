import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { CATEGORY_SLUGS } from '@hendingar/core/taxonomy';
import {
	INSTANCES,
	extractEvents,
	extractNextData,
	instanceBySlug,
	localised,
	localisedSlug
} from '../src/api.ts';
import {
	isFailure,
	mapCategory,
	mapEvents,
	mapShowing,
	posterFrom,
	splitLocalDateTime
} from '../src/map.ts';

/**
 * Against the committed real page. No network (CLAUDE.md rule 6).
 */
const page = readFileSync(
	fileURLToPath(new URL('./fixtures/sunnhordland.html', import.meta.url)),
	'utf8'
);
const instance = instanceBySlug('fjordnorway-sunnhordland')!;
const upstream = extractEvents(extractNextData(page));
const mapped = mapEvents(upstream, instance);

describe('extractNextData', () => {
	it('finds the Next.js payload the markup is built from', () => {
		expect(upstream.length).toBeGreaterThan(10);
	});

	it('throws when the script is gone rather than importing nothing', () => {
		expect(() => extractNextData('<html><body>nothing</body></html>')).toThrow(/no __NEXT_DATA__/);
	});

	it('throws on a payload whose shape moved', () => {
		expect(() => extractEvents({ props: { pageProps: {} } })).toThrow(/unexpected __NEXT_DATA__/);
	});
});

describe('localised', () => {
	it('prefers Norwegian', () => {
		expect(localised({ no: 'Konsert', en: 'Concert' })).toBe('Konsert');
	});

	it('treats an empty string as absent, because that is how the payload says "untranslated"', () => {
		// `{ en: "", no: "Bård Tufte…" }` is real. Reading `en` first would give a blank title.
		expect(localised({ en: '', no: 'Bård Tufte Johansen' })).toBe('Bård Tufte Johansen');
	});

	it('falls back to any language that says something', () => {
		expect(localised({ no: '', de: 'Weihnachtskonzert' })).toBe('Weihnachtskonzert');
	});

	it('ignores the _type key Sanity adds', () => {
		expect(localised({ _type: 'LocaleString', no: 'Teater' })).toBe('Teater');
	});

	it('is null for nothing usable', () => {
		expect(localised(null)).toBeNull();
		expect(localised({ no: '   ' })).toBeNull();
	});
});

describe('localisedSlug', () => {
	it('reads the nested slug object', () => {
		expect(localisedSlug({ no: { current: 'teater-og-scenekunst' } })).toBe('teater-og-scenekunst');
	});

	it('is null when absent', () => {
		expect(localisedSlug(null)).toBeNull();
		expect(localisedSlug({ no: {} })).toBeNull();
	});
});

describe('mapEvents', () => {
	it('maps the fixture with no failures beyond events that list no showing', () => {
		const failures = mapped.filter(isFailure);
		for (const f of failures) {
			if (isFailure(f)) expect(f.problem).toBe('no showings');
		}
	});

	it('imports one row per showing', () => {
		const ok = mapped.filter((m) => !isFailure(m));
		expect(ok.length).toBeGreaterThan(upstream.length - 5);
		const multi = upstream.filter((e) => (e.eventInfo?.showings?.length ?? 0) > 1);
		expect(multi.length, 'the fixture should contain a multi-day event').toBeGreaterThan(0);
	});

	it('gives every showing a stable, unique id', () => {
		const ids = mapped.filter((m) => !isFailure(m)).map((m) => (!isFailure(m) ? m.externalId : ''));
		expect(new Set(ids).size).toBe(ids.length);
		// Event id plus the showing's own key — index alone would reassign every date if the
		// showings were reordered upstream.
		for (const id of ids) expect(id).toMatch(/.+:.+/);
	});

	it('resolves the wall clock in the region zone', () => {
		const parent = upstream.find((e) =>
			(e.eventInfo?.showings ?? []).some((s) => s.fromTime?.startsWith('2026-09-04T19:00'))
		);
		expect(parent, 'fixture should hold the 4 September 19:00 show').toBeTruthy();
		const showing = parent!.eventInfo!.showings!.find((s) =>
			s.fromTime?.startsWith('2026-09-04T19:00')
		)!;
		const m = mapShowing(parent!, showing, 0, instance);
		if (isFailure(m)) throw new Error('should have mapped');
		// 19:00 CEST is 17:00Z.
		expect(m.startsAt.toISOString()).toBe('2026-09-04T17:00:00.000Z');
	});

	it('prefers a real venue over the destination name', () => {
		/*
		 * `place` is a destination — "Leirvik på Stord" — not a room. Letting it win over
		 * `venueName` would put every event in town at one address and collapse the map to a single
		 * pin.
		 */
		const withVenue = mapped.find((m) => !isFailure(m) && m.venueName === 'Stord Kulturhus');
		expect(withVenue, 'a showing naming a venue should keep it').toBeTruthy();
	});

	it('claims no poster rights, because the photographs are not ours to license', () => {
		for (const m of mapped) {
			if (isFailure(m)) continue;
			expect(m.posterRightsVerified).toBe(false);
		}
	});

	it('links to the event on the tourism site, not to a booking checkout', () => {
		for (const m of mapped) {
			if (isFailure(m)) continue;
			expect(m.sourceUrl).toMatch(/^https:\/\/www\.fjordnorway\.com\/no\/arrangementer\//);
		}
	});

	it('rejects a showing with no start time', () => {
		const parent = upstream[0]!;
		const m = mapShowing(parent, { fromTime: null, _key: 'k' }, 0, instance);
		expect(isFailure(m)).toBe(true);
	});
});

describe('mapCategory', () => {
	it('maps the tourism taxonomy onto ours where it lines up', () => {
		expect(mapCategory('teater-og-scenekunst')).toBe('teater');
		expect(mapCategory('musikk')).toBe('musikk');
		expect(mapCategory('lokalmat')).toBe('mat-og-drikke');
		expect(mapCategory('festivaler')).toBe('festival');
	});

	it('falls back to anna for a tourism category that is not an event kind', () => {
		// Their vocabulary describes activities — "utsiktspunkt", "spa-og-sauna" — most of which are
		// not things that happen at a time.
		expect(mapCategory('utsiktspunkt')).toBe('anna');
		expect(mapCategory(null)).toBe('anna');
	});

	it('only ever returns a slug that exists in the taxonomy', () => {
		for (const e of upstream) {
			expect(CATEGORY_SLUGS).toContain(mapCategory(localisedSlug(e.subCategory?.locSlug)));
		}
	});
});

describe('times', () => {
	it('splits the payload format', () => {
		expect(splitLocalDateTime('2026-09-04T19:00:00')).toEqual(['2026-09-04', '19:00']);
		expect(splitLocalDateTime('later')).toBeNull();
	});
});

describe('posterFrom', () => {
	const original = 'https://res.cloudinary.com/djew0njor/image/upload/v1624441788/MSUJg8.jpg';

	it('resizes instead of shipping the original whole', () => {
		// Measured: this asset is 1500×1077 at 765 KB untransformed, and 94 KB at w_800 — for a tile
		// that is at most 434 CSS pixels wide.
		const poster = posterFrom(original);
		expect(poster.url).toBe(
			'https://res.cloudinary.com/djew0njor/image/upload/w_1200,c_limit,q_auto,f_auto/v1624441788/MSUJg8.jpg'
		);
		expect(poster.srcset?.split(', ')).toHaveLength(4);
		expect(poster.srcset).toContain('w_400,c_limit,q_auto,f_auto');
		expect(poster.srcset).toContain(' 400w');
	});

	it('never upscales, so a small original stays small under a large descriptor', () => {
		for (const candidate of posterFrom(original).srcset!.split(', ')) {
			expect(candidate).toContain('c_limit');
		}
	});

	it('leaves a URL that is not a Cloudinary delivery URL untouched', () => {
		// Inserting a transformation segment into something else is a 404 on every poster.
		expect(posterFrom('https://example.com/a.jpg')).toEqual({
			url: 'https://example.com/a.jpg',
			srcset: null
		});
		expect(posterFrom(null)).toEqual({ url: null, srcset: null });
	});

	it('gives every poster in the fixture a candidate list', () => {
		const withPoster = mapped.filter((m) => !isFailure(m) && m.posterUrl);
		expect(withPoster.length).toBeGreaterThan(5);
		for (const m of withPoster) {
			if (isFailure(m)) continue;
			expect(m.posterUrl).toContain('w_1200,c_limit,q_auto,f_auto');
			expect(m.posterSrcset).toContain('1200w');
		}
	});
});

describe('instances', () => {
	it('has unique slugs', () => {
		const slugs = INSTANCES.map((i) => i.slug);
		expect(new Set(slugs).size).toBe(slugs.length);
	});
});
