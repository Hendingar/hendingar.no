import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { CATEGORY_SLUGS } from '@hendingar/core/taxonomy';
import { importedEventSchema, isoWithOffset } from '@hendingar/core/validation';
import {
	CRAWL_DELAY_MS,
	MAX_PAGES,
	PAGE_SIZE,
	createPacer,
	fetchAll,
	parseDetail,
	parsePage,
	readDescriptionHtml,
	readJsonLdDescription,
	requestBody,
	type UpstreamEvent
} from '../src/api.ts';
import { ORGANISERS, organiserBySlug, organiserUrl } from '../src/organisers.ts';
import {
	ctaFrom,
	isFailure,
	isInCountry,
	isPlausibleEpochSeconds,
	mapCategory,
	mapEvent,
	offsetAgrees,
	originalWidth,
	posterFrom,
	preferDescription,
	cleanEventUrl,
	slugifyVenue,
	venueNameFrom,
	wallClockToInstant
} from '../src/map.ts';

/**
 * Against committed real responses. No network, no clock (CLAUDE.md rule 6).
 *
 * Six fixtures, each earning its place:
 *   - stord-jazzklubb-page0.json    eight concerts: the categories in three different orders and one
 *                                   record in Title Case, a real box-office ticket link, a named
 *                                   hall, and `end_time` repeating `start_time`
 *   - flow-yoga-bomlo-page0.json    a real end time, a bare street address where a venue name should
 *                                   be, and `health-wellness`
 *   - gruo-pub-page0.json           a third organiser on the same endpoint — the platform claim —
 *                                   with a portrait poster and a facebook.com "ticket" link
 *   - sagvag-bygdalag-page0.json    a fourth, with `categories: []` and a `city` that is flatly
 *                                   wrong ("Ølen" for a hall in Sagvåg)
 *   - event-tid-saabye-raknes.html  an event page: `@type: "MusicEvent"`, and a description with
 *                                   allevents.in's "You may also like" block glued to the end of it
 *   - event-flow-yoga-opning.html   another event page, `@type: "Event"`, no promo block
 */
const fixture = (name: string) =>
	readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)), 'utf8');

const json = (name: string): unknown => JSON.parse(fixture(name));

const jazz = parsePage(json('stord-jazzklubb-page0.json'));
const yoga = parsePage(json('flow-yoga-bomlo-page0.json'));
const gruo = parsePage(json('gruo-pub-page0.json'));
const bygdalag = parsePage(json('sagvag-bygdalag-page0.json'));

const jazzOrganiser = organiserBySlug('allevents-stord-jazzklubb')!;
const yogaOrganiser = organiserBySlug('allevents-flow-yoga-bomlo')!;
const gruoOrganiser = organiserBySlug('allevents-gruo-pub')!;
const bygdalagOrganiser = organiserBySlug('allevents-sagvag-bygdalag')!;

const tidDetail = parseDetail(fixture('event-tid-saabye-raknes.html'));
const yogaDetail = parseDetail(fixture('event-flow-yoga-opning.html'));

const byId = (page: { events: UpstreamEvent[] }, id: string) =>
	page.events.find((e) => String(e.event_id) === id)!;

describe('organisers', () => {
	it('is a platform importer: four organisers, one parser, one endpoint', () => {
		expect(ORGANISERS).toHaveLength(4);
		expect(new Set(ORGANISERS.map((o) => o.slug)).size).toBe(4);
		expect(new Set(ORGANISERS.map((o) => o.organiserId)).size).toBe(4);
	});

	it('keeps the `allevents-` slug prefix, which /kjelder groups on', () => {
		for (const o of ORGANISERS) expect(o.slug.startsWith('allevents-')).toBe(true);
	});

	it('percent-encodes a profile path that carries Norwegian letters', () => {
		// The bug this guards: an ASCII-only URL for `sagvåg-bygdalag` 404s, and the profile page is
		// what a reader is sent to from /kjelder.
		expect(organiserUrl(bygdalagOrganiser)).toBe(
			'https://allevents.in/org/sagv%C3%A5g-bygdalag/22762840'
		);
		expect(new URL(organiserUrl(bygdalagOrganiser)).pathname).not.toContain('å');
		for (const o of ORGANISERS) expect(() => new URL(organiserUrl(o))).not.toThrow();
	});

	it('publishes on import, because a pending import is never promoted by anything', () => {
		// Nothing verifies an imported event and ADR 0012 removed the review queue, so `trusted:
		// false` here would mean "collected nightly, shown to nobody, reported healthy". See the
		// `trusted` comment in organisers.ts.
		for (const o of ORGANISERS) expect(o.trusted).toBe(true);
	});
});

describe('parsePage', () => {
	it('reads all eight of the jazz club’s upcoming concerts', () => {
		expect(jazz.events).toHaveLength(8);
		expect(jazz.rejected).toEqual([]);
	});

	it('reads the same shape off three other organisers, so this is one parser', () => {
		expect(yoga.events).toHaveLength(1);
		expect(gruo.events).toHaveLength(1);
		expect(bygdalag.events).toHaveLength(1);
		expect([...yoga.rejected, ...gruo.rejected, ...bygdalag.rejected]).toEqual([]);
	});

	it('throws on an envelope that says it failed, rather than importing nothing quietly', () => {
		// The endpoint answers HTTP 200 with `error` set in the body, so the status code is not the
		// signal and a run that ignored this would report a successful import of zero events.
		expect(() => parsePage({ error: 1, message: 'Invalid organizer', data: [] })).toThrow(
			/error 1: Invalid organizer/
		);
	});

	it('throws on a response that is not the response at all', () => {
		expect(() => parsePage({ nope: true })).toThrow(/unexpected get_events response/);
	});

	it('rejects one malformed record without losing the rest of the page', () => {
		const good = jazz.events[0]!;
		const parsed = parsePage({ error: 0, data: [good, { event_id: '1', eventname: 'no start' }] });
		expect(parsed.events).toHaveLength(1);
		expect(parsed.rejected).toHaveLength(1);
		expect(parsed.rejected[0]).toContain('start_time');
	});

	it('accepts `spam`/`draft` as the strings the API actually sends', () => {
		expect(jazz.events.every((e) => e.spam === '0' && e.draft === '0')).toBe(true);
	});
});

describe('requestBody', () => {
	it('asks for upcoming events only, zero-based', () => {
		expect(requestBody(jazzOrganiser, 0, PAGE_SIZE)).toEqual({
			organizer_id: 13511894,
			past: 0,
			page: 0,
			count: PAGE_SIZE,
			city: 0,
			past_events_filter: 1
		});
	});
});

describe('fetchAll', () => {
	const pageOf = (n: number) => ({
		error: 0,
		data: Array.from({ length: n }, (_, i) => ({ ...jazz.events[0]!, event_id: `${n}-${i}` }))
	});

	it('stops on the first short page', async () => {
		const asked: number[] = [];
		const read = async (_: unknown, page: number) => {
			asked.push(page);
			return page === 0 ? pageOf(PAGE_SIZE) : pageOf(3);
		};
		const parsed = await fetchAll(jazzOrganiser, read, async () => {});
		expect(asked).toEqual([0, 1]);
		expect(parsed.events).toHaveLength(PAGE_SIZE + 3);
	});

	it('makes one request when the organiser fits on one page', async () => {
		const asked: number[] = [];
		const read = async (_: unknown, page: number) => {
			asked.push(page);
			return json('stord-jazzklubb-page0.json');
		};
		await fetchAll(jazzOrganiser, read, async () => {});
		expect(asked).toEqual([0]);
	});

	it('will not walk a global directory by accident', async () => {
		// Without the ceiling a full page every time is an infinite crawl of allevents.in.
		let calls = 0;
		const read = async () => {
			calls += 1;
			return pageOf(PAGE_SIZE);
		};
		await fetchAll(jazzOrganiser, read, async () => {});
		expect(calls).toBe(MAX_PAGES);
	});

	it('paces every request but the first', async () => {
		const waits: number[] = [];
		const pace = createPacer(async (ms) => {
			waits.push(ms);
		});
		const read = async (_: unknown, page: number) => (page === 0 ? pageOf(PAGE_SIZE) : pageOf(1));
		await fetchAll(jazzOrganiser, read, pace);
		expect(waits).toEqual([CRAWL_DELAY_MS]);
	});
});

describe('mapCategory', () => {
	it('folds case, because the source does not', () => {
		expect(mapCategory(['Concerts', 'Music', 'Entertainment'])).toBe('musikk');
		expect(mapCategory(['concerts', 'music', 'entertainment'])).toBe('musikk');
	});

	it('ignores `entertainment`, which rides along on nearly every record', () => {
		// Taking the source's first entry would file this concert under `anna`.
		expect(mapCategory(['entertainment', 'music'])).toBe('musikk');
		expect(mapCategory(['entertainment'])).toBe('anna');
	});

	it('prefers music to festivals, because a concert at a festival is still a concert', () => {
		expect(mapCategory(['festivals', 'music', 'entertainment'])).toBe('musikk');
		expect(mapCategory(['festivals'])).toBe('festival');
	});

	it('prefers music to art', () => {
		expect(mapCategory(['music', 'entertainment', 'art'])).toBe('musikk');
		expect(mapCategory(['art'])).toBe('utstilling');
	});

	it('reads a yoga class as a course', () => {
		expect(mapCategory(['health-wellness'])).toBe('kurs');
	});

	it('answers `anna` for a record with no categories at all', () => {
		// Sagvåg Bygdalag's "Spøt og Drøs" arrives with an empty list. Guessing "mote" from the title
		// would be inventing a fact — see ADR 0004.
		expect(bygdalag.events[0]!.categories).toEqual([]);
		expect(mapCategory([])).toBe('anna');
		expect(mapCategory(null)).toBe('anna');
		expect(mapCategory(undefined)).toBe('anna');
	});

	it('answers `anna` for a vocabulary we have never seen', () => {
		expect(mapCategory(['quidditch'])).toBe('anna');
	});

	it('only ever answers with a slug that exists in the taxonomy', () => {
		const every = [...jazz.events, ...yoga.events, ...gruo.events, ...bygdalag.events].map((e) =>
			mapCategory(e.categories)
		);
		for (const slug of every) expect(CATEGORY_SLUGS).toContain(slug);
	});
});

describe('isInCountry', () => {
	it('accepts Norway, however it is spelled', () => {
		for (const value of ['Norway', 'Norge', 'Noreg', 'NO', 'norway']) {
			expect(isInCountry(value)).toBe(true);
		}
	});

	it('rejects a members’ trip abroad', () => {
		expect(isInCountry('Denmark')).toBe(false);
		expect(isInCountry('Sweden')).toBe(false);
	});

	it('accepts a blank country rather than losing a real event to a missing field', () => {
		expect(isInCountry('')).toBe(true);
		expect(isInCountry(null)).toBe(true);
		expect(isInCountry(undefined)).toBe(true);
	});
});

describe('venueNameFrom', () => {
	it('keeps a real hall name', () => {
		expect(venueNameFrom('Stord Kulturhus', 'Hamnegata 1, 5411 Leirvik, Norge', 'x')).toBe(
			'Stord Kulturhus'
		);
	});

	it('falls back to the organiser when the source repeated the street address', () => {
		// Three of the four organisers do this. `hollundsdalen-49` as a venue slug would never
		// consolidate against the same place named plainly by another source.
		expect(
			venueNameFrom(
				'Hollundsdalen 49, 5430 Bremnes, Norway',
				'Hollundsdalen 49, 5430 Svortland, Norge',
				'Flow Yoga Bømlo'
			)
		).toBe('Flow Yoga Bømlo');
		expect(
			venueNameFrom('Sagvågsbrekko 7', 'Sagvågsbrekko 7, 5410 Sagvåg, Norge', 'Sagvåg Bygdalag')
		).toBe('Sagvåg Bygdalag');
	});

	it('drops everything after the first comma', () => {
		expect(venueNameFrom('Stord Hotell, Sæ 43, 5417 Stord', 'Sæ 43, 5417 Stord', 'x')).toBe(
			'Stord Hotell'
		);
	});

	it('falls back on an empty or one-character place', () => {
		expect(venueNameFrom('', null, 'Gruo Pub')).toBe('Gruo Pub');
		expect(venueNameFrom(null, null, 'Gruo Pub')).toBe('Gruo Pub');
		expect(venueNameFrom('X', null, 'Gruo Pub')).toBe('Gruo Pub');
	});
});

describe('slugifyVenue', () => {
	it('folds Norwegian letters the same way every other importer does', () => {
		expect(slugifyVenue('Sagvåg Bygdalag')).toBe('sagvaag-bygdalag');
		expect(slugifyVenue('Flow Yoga Bømlo')).toBe('flow-yoga-boemlo');
		expect(slugifyVenue('Stord Kulturhus')).toBe('stord-kulturhus');
	});
});

describe('cleanEventUrl', () => {
	it('percent-encodes the organiser’s own letters', () => {
		// This is why nothing here regexes slugs out of the HTML: an ASCII-only pattern finds none of
		// these.
		expect(cleanEventUrl('https://allevents.in/events/vi-opnar-dørene-flow-yoga/2000')).toBe(
			'https://allevents.in/events/vi-opnar-d%C3%B8rene-flow-yoga/2000'
		);
	});

	it('leaves an already-encoded path alone', () => {
		expect(cleanEventUrl('https://allevents.in/%C3%98len/spot-og-dros/2000')).toBe(
			'https://allevents.in/%C3%98len/spot-og-dros/2000'
		);
	});

	it('strips the ?ref= that robots.txt disallows', () => {
		expect(cleanEventUrl('https://allevents.in/events/x/1?ref=organizer-new#top')).toBe(
			'https://allevents.in/events/x/1'
		);
	});

	it('refuses anything that is not http(s)', () => {
		expect(cleanEventUrl('javascript:alert(1)')).toBeNull();
		expect(cleanEventUrl('not a url')).toBeNull();
		expect(cleanEventUrl(null)).toBeNull();
	});
});

describe('ctaFrom', () => {
	it('keeps a real box office', () => {
		expect(ctaFrom('https://checkout.ebillett.no/169/events/92828/purchase/setup?kanal=dxf')).toBe(
			'https://checkout.ebillett.no/169/events/92828/purchase/setup?kanal=dxf'
		);
	});

	it('drops a facebook.com "ticket" link', () => {
		// Three of the four organisers get `http://facebook.com/<event id>` here. Following it lands
		// a reader on a login wall, and building on Facebook is the dependency this project exists
		// to escape.
		expect(ctaFrom('http://facebook.com/200030582324630')).toBeNull();
		expect(ctaFrom('https://www.facebook.com/events/123')).toBeNull();
		expect(ctaFrom('https://m.facebook.com/events/123')).toBeNull();
		expect(ctaFrom('https://fb.me/e/abc')).toBeNull();
		expect(ctaFrom('https://www.instagram.com/p/abc/')).toBeNull();
	});

	it('drops an allevents.in link, which is already the sourceUrl', () => {
		expect(ctaFrom('https://allevents.in/events/x/1')).toBeNull();
	});

	it('does not mistake a host that merely ends in the same letters', () => {
		expect(ctaFrom('https://notfacebook.com/x')).toBe('https://notfacebook.com/x');
	});
});

describe('posterFrom', () => {
	const banner = jazz.events[0]!.banner_url!;

	it('asks their unsigned imgproxy for sizes we display, not their 500×250 grid crop', () => {
		const poster = posterFrom(banner);
		expect(poster.url).toContain('rs:fit:1200:0');
		expect(poster.srcset).toContain(' 400w');
		expect(poster.srcset).toContain(' 1200w');
		expect(poster.srcset).not.toContain('rs:fill');
	});

	it('caps the ladder at the original width, so no candidate is a lie', () => {
		// imgproxy will not enlarge, so a 1200w candidate for an 800px original is an 800px image
		// the browser was told is 1200.
		const small = banner.replace(/\/[^/]+\.avif$/, `/${tokenFor('w600')}.avif`);
		const poster = posterFrom(small);
		expect(poster.srcset).toContain(' 400w');
		expect(poster.srcset).toContain(' 600w');
		expect(poster.srcset).not.toContain(' 800w');
		expect(poster.srcset).not.toContain(' 1200w');
	});

	it('reads the original width out of the token', () => {
		const token = banner.split('/').pop()!.replace('.avif', '');
		expect(originalWidth(token)).toBe(1200);
		expect(originalWidth('not-base64-at-all')).toBeNull();
	});

	it('throws away allevents.in’s synthesised title card', () => {
		// `thumb_url` is a generated rectangle with the title printed on it. It is not in the schema
		// at all — the raw payload carries one for every event and none of them is a poster — and a
		// generate-image URL arriving anywhere else is discarded too.
		expect(fixture('stord-jazzklubb-page0.json')).toContain(
			'dyn-image.allevents.in\\/generate-image'
		);
		expect(
			posterFrom('https://dyn-image.allevents.in/generate-image?v=4&title=X&date=01+Jan')
		).toEqual({ url: null, srcset: null });
	});

	it('passes an unrecognised rendition through untouched, with no srcset', () => {
		expect(posterFrom('https://example.com/poster.jpg')).toEqual({
			url: 'https://example.com/poster.jpg',
			srcset: null
		});
	});

	it('is null for no banner at all', () => {
		expect(posterFrom(null)).toEqual({ url: null, srcset: null });
		expect(posterFrom('')).toEqual({ url: null, srcset: null });
	});
});

/** A token whose decoded original URL claims the given rendition, for the cap test above. */
function tokenFor(rendition: string): string {
	const original = `https://cdn-az.allevents.in/events8/banners/abc-rimg-${rendition}-h400-dc080808-gmir?v=1`;
	return Buffer.from(original, 'utf8').toString('base64url');
}

describe('isPlausibleEpochSeconds', () => {
	it('accepts the times the four organisers actually publish', () => {
		for (const e of [...jazz.events, ...yoga.events, ...gruo.events, ...bygdalag.events]) {
			expect(isPlausibleEpochSeconds(e.start_time)).toBe(true);
		}
	});

	it('catches a milliseconds/seconds mix-up and a missing value', () => {
		expect(isPlausibleEpochSeconds(1789844400000)).toBe(false);
		expect(isPlausibleEpochSeconds(0)).toBe(false);
		expect(isPlausibleEpochSeconds(Number.NaN)).toBe(false);
	});
});

describe('wallClockToInstant', () => {
	/**
	 * The whole reason this function exists, checked against the source contradicting itself.
	 *
	 * `start_time: 1789844400` reads as `2026-09-19T19:00:00Z` if you treat it as an epoch. The same
	 * record's `start_time_display` says "07:00 pm" and the event's own page says
	 * `"2026-09-19T19:00:00+02:00"` — 17:00Z. Nineteen hundred is a wall clock, and taking the
	 * integer at face value publishes the concert two hours late.
	 */
	it('is not an epoch: 19:00 in Oslo, not 19:00 UTC', () => {
		expect(new Date(1789844400 * 1000).toISOString()).toBe('2026-09-19T19:00:00.000Z');
		expect(wallClockToInstant(1789844400, 'Europe/Oslo')!.toISOString()).toBe(
			'2026-09-19T17:00:00.000Z'
		);
	});

	it('crosses the DST boundary the way only a zone can', () => {
		// 24 October 2026 is still CEST (+02:00); 7 November is CET (+01:00). A fixed offset read off
		// one record would be wrong for the other, which is why the venue's IANA zone is used.
		expect(wallClockToInstant(1792872000, 'Europe/Oslo')!.toISOString()).toBe(
			'2026-10-24T18:00:00.000Z'
		);
		expect(wallClockToInstant(1794078000, 'Europe/Oslo')!.toISOString()).toBe(
			'2026-11-07T18:00:00.000Z'
		);
	});

	it('is null for a value that cannot be a wall clock', () => {
		expect(wallClockToInstant(0, 'Europe/Oslo')).toBeNull();
		expect(wallClockToInstant(1789844400000, 'Europe/Oslo')).toBeNull();
	});

	it('agrees with the event page’s own JSON-LD, an independent statement of the same time', () => {
		// Two things the site says about the same concert, produced by different code paths. If they
		// ever stop agreeing, the encoding above has changed — and this fails loudly rather than
		// every event shifting by an hour in silence.
		for (const [file, id, page] of [
			['event-tid-saabye-raknes.html', '200030422418051', jazz],
			['event-flow-yoga-opning.html', '200030582324630', yoga]
		] as const) {
			const startDate = /"startDate":"([^"]+)"/.exec(fixture(file))![1]!;
			const fromApi = wallClockToInstant(byId(page, id).start_time, 'Europe/Oslo')!;
			expect(fromApi.toISOString()).toBe(new Date(startDate).toISOString());
		}
	});
});

describe('offsetAgrees', () => {
	const sept = new Date('2026-09-19T17:00:00Z');

	it('accepts the offset the record states for Oslo in September', () => {
		expect(offsetAgrees('+02:00', sept, 'Europe/Oslo')).toBe(true);
	});

	it('accepts the winter offset in winter, and only in winter', () => {
		expect(offsetAgrees('+01:00', new Date('2026-11-07T18:00:00Z'), 'Europe/Oslo')).toBe(true);
		expect(offsetAgrees('+02:00', new Date('2026-11-07T18:00:00Z'), 'Europe/Oslo')).toBe(false);
	});

	it('catches an event held in another zone entirely', () => {
		// A summer course in Reykjavík comes back as +00:00 and would otherwise be read as Oslo time.
		expect(offsetAgrees('+00:00', sept, 'Europe/Oslo')).toBe(false);
	});

	it('accepts a missing or unreadable offset rather than losing the event', () => {
		expect(offsetAgrees(null, sept, 'Europe/Oslo')).toBe(true);
		expect(offsetAgrees('', sept, 'Europe/Oslo')).toBe(true);
		expect(offsetAgrees('CEST', sept, 'Europe/Oslo')).toBe(true);
	});

	it('agrees with every record the four organisers actually publish', () => {
		for (const e of [...jazz.events, ...yoga.events, ...gruo.events, ...bygdalag.events]) {
			const instant = wallClockToInstant(e.start_time, 'Europe/Oslo')!;
			expect(offsetAgrees(e.timezone, instant, 'Europe/Oslo')).toBe(true);
		}
	});
});

describe('parseDetail', () => {
	it('reads the organiser’s full text, not the 250-character JSON-LD stub', () => {
		expect(tidDetail.description).toContain('Eit unikt samarbeid');
		// The JSON-LD copy stops mid-sentence here; the div carries the whole thing.
		expect(tidDetail.description!.length).toBeGreaterThan(1500);
		expect(tidDetail.description).toContain('Lars Saabye Christensen – poesi, lesing');
	});

	it('stops before allevents.in’s "You may also like" block', () => {
		// That block sits inside the very same div and links to three other concerts. Importing it
		// would put a list of other events in this event's description.
		expect(fixture('event-tid-saabye-raknes.html')).toContain('You may also like the following');
		expect(tidDetail.description).not.toContain('You may also like');
		expect(tidDetail.description).not.toContain('Helge Lien Trio');
	});

	it('keeps paragraph breaks, which the event page splits on', () => {
		expect(yogaDetail.description).toContain('\n\n');
		expect(yogaDetail.description).not.toContain('\n\n\n');
		expect(yogaDetail.description!.split('\n\n').length).toBeGreaterThan(3);
	});

	it('decodes entities rather than publishing them', () => {
		for (const d of [tidDetail.description, yogaDetail.description]) {
			expect(d).not.toMatch(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/);
		}
	});

	it('falls back to the JSON-LD when the template changes under us', () => {
		const withoutDiv = fixture('event-tid-saabye-raknes.html').replaceAll(
			'event-description-html',
			'event-description-renamed'
		);
		expect(readDescriptionHtml(withoutDiv)).toBeNull();
		expect(parseDetail(withoutDiv).description).toContain('Eit unikt samarbeid');
	});

	it('finds the JSON-LD event whether @type is a subtype or not', () => {
		// The jazz concert is `MusicEvent` and the yoga opening is a bare `Event`. A check for the
		// literal "Event" finds one of the two.
		expect(fixture('event-tid-saabye-raknes.html')).toContain('"@type":"MusicEvent"');
		expect(fixture('event-flow-yoga-opning.html')).toContain('"@type":"Event"');
		expect(readJsonLdDescription(fixture('event-tid-saabye-raknes.html'))).toBeTruthy();
		expect(readJsonLdDescription(fixture('event-flow-yoga-opning.html'))).toBeTruthy();
	});

	it('is null, not a throw, for a page with neither', () => {
		expect(parseDetail('<html><body>nothing here</body></html>').description).toBeNull();
	});

	it('says which of the two descriptions it got', () => {
		// The flag `preferDescription` reads. A full page is not truncated; the stripped variant
		// allevents.in serves at random falls back to the stub and says so.
		expect(tidDetail.truncated).toBe(false);
		expect(yogaDetail.truncated).toBe(false);

		const stripped = fixture('event-tid-saabye-raknes.html').replaceAll(
			'event-description-html',
			'event-description-renamed'
		);
		expect(parseDetail(stripped).truncated).toBe(true);
	});
});

describe('preferDescription', () => {
	const full = 'A'.repeat(2000);
	const stub = 'A'.repeat(250);

	it('keeps what we hold when the page failed to load', () => {
		// Two of eight jazz pages 500'd on one afternoon's second run; without this the run "updated"
		// both of them to null and the next run put the text back.
		expect(preferDescription(full, null, { failed: true, truncated: false })).toBe(full);
	});

	it('refuses to downgrade a full description to upstream’s stub', () => {
		// Same URL, three fetches: two full pages and one 163 KB variant with no description div.
		// Without this the field flip-flops nightly and every flip is reported as a change.
		expect(preferDescription(full, stub, { failed: false, truncated: true })).toBe(full);
	});

	it('accepts the stub when we hold nothing better', () => {
		expect(preferDescription(null, stub, { failed: false, truncated: true })).toBe(stub);
	});

	it('accepts a complete description even when it is shorter', () => {
		// An organiser who cuts their own blurb down should see it cut down here.
		expect(preferDescription(full, 'Kort.', { failed: false, truncated: false })).toBe('Kort.');
	});

	it('clears the field when a page loads and genuinely has no description', () => {
		expect(preferDescription(full, null, { failed: false, truncated: false })).toBeNull();
	});

	it('is stable: applying it twice changes nothing', () => {
		const once = preferDescription(full, stub, { failed: false, truncated: true });
		const twice = preferDescription(once, stub, { failed: false, truncated: true });
		expect(twice).toBe(once);
	});
});

describe('mapEvent', () => {
	const tid = mapEvent(byId(jazz, '200030422418051'), tidDetail, jazzOrganiser);
	const opening = mapEvent(yoga.events[0]!, yogaDetail, yogaOrganiser);
	const valdHeks = mapEvent(gruo.events[0]!, null, gruoOrganiser);
	const spot = mapEvent(bygdalag.events[0]!, null, bygdalagOrganiser);

	it('maps the jazz concert', () => {
		expect(isFailure(tid)).toBe(false);
		if (isFailure(tid)) return;
		expect(tid.externalId).toBe('200030422418051');
		expect(tid.title).toBe('TID – Lars Saabye Christensen/Steinar Raknes med band');
		expect(tid.category).toBe('musikk');
		expect(tid.venueName).toBe('Stord Kulturhus');
		expect(tid.venueSlug).toBe('stord-kulturhus');
		expect(tid.ctaUrl).toContain('checkout.ebillett.no');
		expect(tid.sourceUrl).toBe(
			'https://allevents.in/events/tid-lars-saabye-christensen-steinar-raknes-med-band/200030422418051'
		);
	});

	it('reads the start as an instant, and 19:00 in Oslo is what the organiser meant', () => {
		if (isFailure(tid)) throw new Error('mapped as a failure');
		// The organiser page's own JSON-LD says only "2026-09-19" — no time at all — which is why the
		// JSON endpoint is read instead; and that endpoint's integer is a wall clock rather than an
		// epoch, which is why it is converted. Both traps land on this one assertion.
		expect(tid.startsAt.toISOString()).toBe('2026-09-19T17:00:00.000Z');
		expect(
			tid.startsAt.toLocaleString('en-GB', { timeZone: 'Europe/Oslo', timeStyle: 'short' })
		).toBe('19:00');
	});

	it('does not turn `end_time === start_time` into a zero-length event', () => {
		if (isFailure(tid)) throw new Error('mapped as a failure');
		expect(byId(jazz, '200030422418051').end_time).toBe(byId(jazz, '200030422418051').start_time);
		expect(tid.endsAt).toBeNull();
	});

	it('keeps a real end time', () => {
		if (isFailure(opening)) throw new Error('mapped as a failure');
		expect(opening.endsAt?.toISOString()).toBe('2026-09-13T12:00:00.000Z');
		expect(opening.endsAt!.getTime()).toBeGreaterThan(opening.startsAt.getTime());
	});

	it('uses the organiser as the venue when the source gave an address', () => {
		if (isFailure(opening) || isFailure(valdHeks) || isFailure(spot)) {
			throw new Error('mapped as a failure');
		}
		expect(opening.venueName).toBe('Flow Yoga Bømlo');
		expect(valdHeks.venueName).toBe('Gruo Pub');
		expect(spot.venueName).toBe('Sagvåg Bygdalag');
	});

	it('drops a facebook.com CTA and keeps allevents.in as the link', () => {
		if (isFailure(valdHeks)) throw new Error('mapped as a failure');
		expect(gruo.events[0]!.ticket_url).toContain('facebook.com');
		expect(valdHeks.ctaUrl).toBeNull();
		expect(valdHeks.sourceUrl).toContain('allevents.in');
	});

	it('survives a detail page that never loaded', () => {
		if (isFailure(valdHeks)) throw new Error('mapped as a failure');
		// A 500 on one event's page costs a description, never the event or its seven siblings.
		expect(valdHeks.description).toBeNull();
		expect(valdHeks.title).toContain('VALD HEKS');
		expect(valdHeks.startsAt.toISOString()).toBe('2026-09-19T20:00:00.000Z');
	});

	it('never claims rights over a mirrored poster', () => {
		for (const m of [tid, opening, valdHeks, spot]) {
			if (isFailure(m)) continue;
			expect(m.posterRightsVerified).toBe(false);
		}
	});

	it('refuses a record that is not published upstream', () => {
		const raw = byId(jazz, '200030422418051');
		for (const [field, value] of [
			['status', 'DRAFT'],
			['spam', '1'],
			['draft', '1']
		] as const) {
			const result = mapEvent({ ...raw, [field]: value }, null, jazzOrganiser);
			expect(isFailure(result)).toBe(true);
		}
	});

	it('refuses an event held abroad', () => {
		const raw = byId(jazz, '200030422418051');
		const abroad = mapEvent(
			{ ...raw, venue: { ...raw.venue, country: 'Denmark' } },
			null,
			jazzOrganiser
		);
		expect(isFailure(abroad)).toBe(true);
		if (isFailure(abroad)) expect(abroad.problem).toContain('Denmark');
	});

	it('refuses a record whose stated offset is not the venue’s zone', () => {
		const raw = byId(jazz, '200030422418051');
		const elsewhere = mapEvent({ ...raw, timezone: '+00:00' }, null, jazzOrganiser);
		expect(isFailure(elsewhere)).toBe(true);
		if (isFailure(elsewhere)) expect(elsewhere.problem).toContain('Europe/Oslo');
	});

	it('refuses an unusable start rather than writing 1970 to starts_at', () => {
		const raw = byId(jazz, '200030422418051');
		expect(isFailure(mapEvent({ ...raw, start_time: 0 }, null, jazzOrganiser))).toBe(true);
		expect(isFailure(mapEvent({ ...raw, start_time: 1789844400000 }, null, jazzOrganiser))).toBe(
			true
		);
	});

	it('refuses a title that did not survive the mirror', () => {
		const raw = byId(jazz, '200030422418051');
		expect(isFailure(mapEvent({ ...raw, eventname: '  ' }, null, jazzOrganiser))).toBe(true);
		expect(isFailure(mapEvent({ ...raw, eventname: 'X' }, null, jazzOrganiser))).toBe(true);
	});

	it('produces something packages/core will accept, for every organiser', () => {
		// The contract every importer must satisfy, checked against the schema itself rather than
		// against a copy of its rules (CLAUDE.md rule 1).
		const all = [
			...jazz.events.map((e) => mapEvent(e, tidDetail, jazzOrganiser)),
			...yoga.events.map((e) => mapEvent(e, yogaDetail, yogaOrganiser)),
			...gruo.events.map((e) => mapEvent(e, null, gruoOrganiser)),
			...bygdalag.events.map((e) => mapEvent(e, null, bygdalagOrganiser))
		];
		expect(all).toHaveLength(11);
		expect(all.filter(isFailure)).toEqual([]);

		for (const m of all) {
			if (isFailure(m)) continue;
			const parsed = importedEventSchema.safeParse({
				externalId: m.externalId,
				title: m.title,
				category: m.category,
				startsAt: m.startsAt.toISOString(),
				...(m.endsAt ? { endsAt: m.endsAt.toISOString() } : {}),
				venueName: m.venueName,
				...(m.description ? { description: m.description.slice(0, 5000) } : {}),
				...(m.ctaUrl ? { ctaUrl: m.ctaUrl } : {}),
				...(m.posterUrl ? { posterUrl: m.posterUrl } : {}),
				sourceUrl: m.sourceUrl,
				posterRightsVerified: m.posterRightsVerified
			});
			expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
			// An ISO instant with an explicit offset, which is what `starts_at` is written from.
			expect(isoWithOffset.safeParse(m.startsAt.toISOString()).success).toBe(true);
		}
	});

	it('is deterministic — the same input maps to the same output twice', () => {
		const once = mapEvent(byId(jazz, '200030422416737'), tidDetail, jazzOrganiser);
		const twice = mapEvent(byId(jazz, '200030422416737'), tidDetail, jazzOrganiser);
		expect(JSON.stringify(once)).toBe(JSON.stringify(twice));
	});
});

describe('the venue address', () => {
	it('is parsed out of the single street line, or left absent', () => {
		/*
		 * allevents.in writes the whole address on one line and inconsistently — sometimes the
		 * street first, sometimes the venue's name first, sometimes a county and a country and no
		 * address at all. Anything we cannot name is dropped rather than guessed.
		 */
		const all = jazz.events.map((e) => mapEvent(e, null, jazzOrganiser));
		for (const m of all) {
			if (isFailure(m)) continue;
			if (m.venueAddress.street !== null) {
				expect(m.venueAddress.street).toMatch(/\d/);
				expect(m.venueAddress.street).not.toMatch(/Norway|Norge|Hordaland/);
			}
			if (m.venueAddress.postalCode) expect(m.venueAddress.postalCode).toMatch(/^\d{4}$/);
		}
	});
});
