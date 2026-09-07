import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { CATEGORY_SLUGS } from '@hendingar/core/taxonomy';
import { INSTANCES, chunkPathFor, extractEvents, instanceBySlug, pageSlugFor } from '../src/api.ts';
import { JsLiteralError, readJsLiteral, readWebpackModuleExports } from '../src/js-literal.ts';
import {
	isFailure,
	mapCategory,
	mapEvents,
	mapTicket,
	posterFrom,
	splitLocalDateTime
} from '../src/map.ts';

/**
 * Against committed real page data. No network (CLAUDE.md rule 6).
 */
const payload = JSON.parse(
	readFileSync(
		fileURLToPath(new URL('./fixtures/stord-kulturprogram.json', import.meta.url)),
		'utf8'
	)
);
const instance = instanceBySlug('stord-kulturhus')!;
const upstream = extractEvents(payload);
const mapped = mapEvents(upstream, instance);

/*
 * Bømlo kulturhus: the same platform on an older Gatsby.
 *
 * Two fixtures rather than one, because reaching its data takes two requests — the programme page,
 * whose preload names a chunk whose filename carries a build hash, and then that chunk. Both are
 * the real files.
 */
const bomloHtml = readFileSync(
	fileURLToPath(new URL('./fixtures/bomlo-kulturprogram.html', import.meta.url)),
	'utf8'
);
const bomloChunk = readFileSync(
	fileURLToPath(new URL('./fixtures/bomlo-kulturprogram-chunk.js', import.meta.url)),
	'utf8'
);
const bomlo = instanceBySlug('bomlo-kulturhus')!;
const bomloUpstream = extractEvents(readWebpackModuleExports(bomloChunk));
const bomloMapped = mapEvents(bomloUpstream, bomlo);

describe('extractEvents', () => {
	it('finds the programme inside Gatsby page data', () => {
		expect(upstream.length).toBeGreaterThan(40);
	});

	it('matches the block on shape, not on its component name', () => {
		// A rename upstream must not silently return zero events: the name is a label, the `events`
		// array is the contract.
		const renamed = structuredClone(payload);
		for (const block of renamed.result.pageContext.blocks) block.component = 'cw-component-renamed';
		expect(extractEvents(renamed).length).toBe(upstream.length);
	});

	it('throws when the programme block is gone, rather than importing nothing', () => {
		const stripped = structuredClone(payload);
		stripped.result.pageContext.blocks = [
			{ component: 'cw-component-cover', data: { title: 'x' } }
		];
		expect(() => extractEvents(stripped)).toThrow(/no programme block/);
	});

	it('throws on page data of an unexpected shape', () => {
		expect(() => extractEvents({ nope: true })).toThrow(/unexpected page-data shape/);
	});
});

describe('mapEvents', () => {
	it('maps every showing without failures', () => {
		expect(mapped.filter(isFailure)).toEqual([]);
	});

	it('imports one row per showing, not one per programme entry', () => {
		/*
		 * The whole reason tickets are expanded. Public swimming runs fourteen times and a reading
		 * circle monthly; importing the parent entry would collapse those into a single row whose
		 * date moved every time the importer ran.
		 */
		expect(mapped.length).toBeGreaterThan(upstream.length);
		const withMany = upstream.filter((e) => (e.tickets?.length ?? 0) > 1);
		expect(withMany.length, 'the fixture should contain a repeating event').toBeGreaterThan(0);
	});

	it('gives every showing its own stable id', () => {
		const ids = mapped.filter((m) => !isFailure(m)).map((m) => !isFailure(m) && m.externalId);
		expect(new Set(ids).size).toBe(ids.length);
	});

	it('keeps each showing in its own room', () => {
		const venues = new Set(
			mapped.filter((m) => !isFailure(m)).map((m) => (!isFailure(m) ? m.venueName : ''))
		);
		// Biblioteket, Storsalen, Osvald Pub, Symjehallen… one address for all of them would make
		// the map useless later.
		expect(venues.size).toBeGreaterThan(3);
	});

	it('falls back to the parent start when a programme entry has no showings yet', () => {
		// A concert announced before ticket sale opens looks exactly like this, and dropping it
		// would hide next season.
		const parent = { ...upstream[0]!, tickets: [], begin: '2027-03-01 19:00:00', id: 'no-tickets' };
		const out = mapEvents([parent], instance);
		expect(out).toHaveLength(1);
		expect(isFailure(out[0]!)).toBe(false);
	});

	it('rejects an entry with neither showings nor a start', () => {
		const parent = { ...upstream[0]!, tickets: [], begin: null, id: 'empty' };
		const out = mapEvents([parent], instance);
		expect(isFailure(out[0]!)).toBe(true);
	});
});

describe('times', () => {
	it('splits the payload format', () => {
		expect(splitLocalDateTime('2026-09-03 11:00:00')).toEqual(['2026-09-03', '11:00']);
		expect(splitLocalDateTime('nope')).toBeNull();
	});

	it('resolves a summer wall clock in the venue zone', () => {
		const m = mapTicket(
			upstream[0]!,
			{ id: 't1', date: '2026-09-03 11:00:00', location: null, link: null },
			instance
		);
		if (isFailure(m)) throw new Error('should have mapped');
		expect(m.startsAt.toISOString()).toBe('2026-09-03T09:00:00.000Z');
	});

	it('resolves a winter wall clock an hour differently', () => {
		// CET, not CEST. A single-pass offset lookup lands on the wrong side near the boundary.
		const m = mapTicket(
			upstream[0]!,
			{ id: 't2', date: '2026-12-16 19:00:00', location: null, link: null },
			instance
		);
		if (isFailure(m)) throw new Error('should have mapped');
		expect(m.startsAt.toISOString()).toBe('2026-12-16T18:00:00.000Z');
	});
});

describe('links', () => {
	it('points the reader at the programme page, not the checkout', () => {
		const m = mapped.find((x) => !isFailure(x) && x.sourceUrl.includes('stord.kulturhus.no'));
		expect(m, 'a showing should link back to the venue').toBeTruthy();
		// We are an index, not a box office: the ticket link is the CTA, the event page is the source.
		if (m && !isFailure(m)) expect(m.sourceUrl).not.toMatch(/checkout\./);
	});

	it('keeps the ticket link as the call to action where there is one', () => {
		const withCta = mapped.filter((m) => !isFailure(m) && m.ctaUrl);
		expect(withCta.length).toBeGreaterThan(0);
	});
});

describe('mapCategory', () => {
	it('honours the venue’s own category names', () => {
		expect(mapCategory('Konsert')).toBe('musikk');
		expect(mapCategory('Standup')).toBe('stand-up');
		expect(mapCategory('Litteratur')).toBe('litteratur');
		expect(mapCategory('Musikal')).toBe('teater');
	});

	it('reads a swim session as sport, not as a performance', () => {
		expect(mapCategory('Offentleg bading')).toBe('sport');
	});

	it('reads Falturiltu as the festival it is', () => {
		expect(mapCategory('Falturiltu')).toBe('festival');
	});

	it('falls back to anna for an unknown or missing category', () => {
		expect(mapCategory('Noko heilt nytt')).toBe('anna');
		expect(mapCategory(null)).toBe('anna');
	});

	it('only ever returns a slug that exists in the taxonomy', () => {
		for (const e of upstream) expect(CATEGORY_SLUGS).toContain(mapCategory(e.category));
	});

	it('maps most of the fixture to something better than anna', () => {
		const cats = mapped
			.filter((m) => !isFailure(m))
			.map((m) => (!isFailure(m) ? m.category : 'anna'));
		const anna = cats.filter((c) => c === 'anna').length;
		expect(anna / cats.length, 'the venue names its categories; we should use them').toBeLessThan(
			0.2
		);
	});
});

describe('posterFrom', () => {
	const listing =
		'https://mff.dx.no/116112.jpg?w=370&h=250&fit=crop&fit=crop&crop=faces,top&crop=faces,top&auto=compress';

	it('asks imgix for a size a card can actually use', () => {
		// 370px is the venue's own listing-strip rendition. A card is up to 434 CSS pixels wide, so
		// on a 2× screen that is less than half the pixels it paints.
		const poster = posterFrom(listing);
		expect(poster.url).toContain('w=1200');
		expect(poster.srcset?.split(', ')).toHaveLength(4);
		expect(poster.srcset).toContain('400w');
		expect(poster.srcset).toContain('1200w');
	});

	it("keeps the venue's crop, scaling height with width", () => {
		// `crop=faces,top` only means anything against an aspect. Dropping `h` would hand us the
		// uncropped picture and throw away someone's decision about where the faces are.
		const poster = posterFrom(listing);
		for (const candidate of poster.srcset!.split(', ')) {
			const url = new URL(candidate.split(' ')[0]!);
			const w = Number(url.searchParams.get('w'));
			const h = Number(url.searchParams.get('h'));
			expect(h).toBe(Math.round((w * 250) / 370));
			expect(url.searchParams.get('crop')).toBe('faces,top');
		}
	});

	it('collapses the duplicated parameters upstream sends', () => {
		const url = new URL(posterFrom(listing).url!);
		expect(url.searchParams.getAll('fit')).toEqual(['crop']);
		expect(url.searchParams.getAll('crop')).toEqual(['faces,top']);
	});

	it('lets imgix negotiate a modern format', () => {
		expect(new URL(posterFrom(listing).url!).searchParams.get('auto')).toBe('compress,format');
	});

	it('leaves a signed rendition alone, because the signature covers the size', () => {
		// Editing `w` on a signed imgix URL returns `sig_invalid`, not a bigger picture — measured
		// against Billetto's, which are locked this way.
		const poster = posterFrom(`${listing}&s=824b60d9c334c733f70399e212fd8f7b`);
		expect(poster.srcset).toBeNull();
		expect(poster.url).toContain('w=370');
		expect(poster.url).toContain('s=824b60d9c334c733f70399e212fd8f7b');
	});

	it('passes through anything that is not a rendition we understand', () => {
		expect(posterFrom('https://example.com/a.jpg')).toEqual({
			url: 'https://example.com/a.jpg',
			srcset: null
		});
		// The payload also carries unresolved templates, which are not URLs at all.
		expect(posterFrom('@assets[type=first_image].url?w=370')).toEqual({ url: null, srcset: null });
		expect(posterFrom(null)).toEqual({ url: null, srcset: null });
	});

	it('gives every poster in the fixture a candidate list', () => {
		const withPoster = mapped.filter((m) => !isFailure(m) && m.posterUrl);
		expect(withPoster.length).toBeGreaterThan(10);
		for (const m of withPoster) {
			if (isFailure(m)) continue;
			expect(m.posterUrl).toContain('w=1200');
			expect(m.posterSrcset).toContain('1200w');
		}
	});
});

describe('instances', () => {
	it('has unique slugs', () => {
		const slugs = INSTANCES.map((i) => i.slug);
		expect(new Set(slugs).size).toBe(slugs.length);
	});

	it('says how each site serves its page data', () => {
		// Declared rather than sniffed: a site changing Gatsby major should be a failing run and a
		// line of config, not a silent switch to a different parser.
		for (const i of INSTANCES) expect(['json', 'chunk']).toContain(i.pageData);
	});

	it('has an absolute https endpoint and origin per instance', () => {
		for (const i of INSTANCES) {
			expect(i.endpoint).toMatch(/^https:\/\//);
			expect(i.url).toMatch(/^https:\/\//);
			expect(i.origin).toMatch(/^https:\/\/[^/]+$/);
		}
	});

	it('covers Bømlo kulturhus without a new importer', () => {
		expect(INSTANCES.map((i) => i.slug)).toContain('bomlo-kulturhus');
	});
});

/*
 * ---------------------------------------------------------------------------------------------
 * The older Gatsby: Bømlo kulturhus.
 *
 * Stord serves its programme as JSON. Bømlo serves the same programme as a webpack chunk holding
 * an object *literal* — unquoted keys, single-quoted strings, `!0` and `!1` for the booleans —
 * which `JSON.parse` rejects at character two. Reading it rather than running it is the whole
 * point of `js-literal.ts`, so these assert the awkward parts against the real file.
 * ---------------------------------------------------------------------------------------------
 */
describe('readJsLiteral', () => {
	it('reads the constructs JSON does not have', () => {
		expect(readJsLiteral('{a:1,b:"x",c:!0,d:!1,e:null,f:[1,2]}')).toEqual({
			a: 1,
			b: 'x',
			c: true,
			d: false,
			e: null,
			f: [1, 2]
		});
	});

	it('keeps the quote styles apart', () => {
		// The fixture holds `<style>` blocks in single-quoted strings with double quotes inside
		// them, and Nynorsk apostrophes inside double-quoted ones. A regex confuses the two.
		expect(readJsLiteral(`{a:'he said "hi"',b:"it's here",c:'a\\'b'}`)).toEqual({
			a: 'he said "hi"',
			b: "it's here",
			c: "a'b"
		});
	});

	it('reads escapes, including the ones a minifier writes', () => {
		expect(readJsLiteral('{a:"l\\nb",b:"\\u00e5",c:"\\t",d:"a\\\\b"}')).toEqual({
			a: 'l\nb',
			b: 'å',
			c: '\t',
			d: 'a\\b'
		});
	});

	it('accepts a trailing comma, because minifiers emit them', () => {
		expect(readJsLiteral('{a:1,}')).toEqual({ a: 1 });
		expect(readJsLiteral('[1,]')).toEqual([1]);
	});

	/*
	 * Strict on purpose, and this is the important half.
	 *
	 * A reader that skipped what it did not understand would return *part* of a programme, and a
	 * partial programme is indistinguishable from a venue that cancelled half its events. Every
	 * one of these throws instead.
	 */
	it('refuses anything outside the grammar rather than returning part of the data', () => {
		for (const bad of [
			'{a:function(){}}',
			'{a:()=>1}',
			'{a:`x`}',
			'{a:undefined}',
			'{a:void 0}',
			'{a:new Date()}',
			'[1,,2]',
			'{a:"unterminated',
			'{a:1',
			'{a 1}'
		]) {
			expect(() => readJsLiteral(bad), bad).toThrow();
		}
	});

	it('says where it gave up, so a broken chunk can be looked at', () => {
		try {
			readJsLiteral('{a:1,b:function(){}}');
			throw new Error('should have thrown');
		} catch (error) {
			expect(error).toBeInstanceOf(JsLiteralError);
			expect((error as Error).message).toMatch(/unsupported token function/);
		}
	});

	it('does not evaluate what it reads', () => {
		// If this were `eval`, the getter would run and the property would come back as 1. It is
		// read as a key called `get` followed by something the grammar refuses.
		expect(() => readJsLiteral('{get a(){return 1}}')).toThrow();
	});
});

describe('readWebpackModuleExports', () => {
	it('anchors on the exports assignment, not on the first brace', () => {
		// The chunk opens `webpackJsonp([id],{1030:function(e,t){e.exports={…` — the first brace is
		// webpack's module map and the second a function body. Neither is the payload.
		const payload = readWebpackModuleExports(bomloChunk);
		expect(payload).toHaveProperty('pathContext');
	});

	it('throws when there is no module payload at all', () => {
		expect(() => readWebpackModuleExports('webpackJsonp([1],{});')).toThrow(JsLiteralError);
	});
});

describe('chunkPathFor', () => {
	it('finds the hashed chunk the page preloads', () => {
		// The hash changes on every rebuild, so this can never be configuration.
		expect(chunkPathFor(bomloHtml, 'kulturprogram')).toMatch(
			/^\/path---kulturprogram-[0-9a-f]{8,}\.js$/
		);
	});

	it('keeps the leading slash, because the chunk is served from the site root', () => {
		/*
		 * The first live run 404'd on exactly this. The programme is at `/kulturprogram/` and the
		 * chunk at `/path---kulturprogram-….js`, so a bare filename resolved against the page URL
		 * asks for `/kulturprogram/path---kulturprogram-….js`, which does not exist.
		 */
		const href = chunkPathFor(bomloHtml, 'kulturprogram')!;
		expect(new URL(href, bomlo.origin).toString()).toBe(`${bomlo.origin}${href}`);
		expect(new URL(href, bomlo.origin).pathname.startsWith('/kulturprogram/')).toBe(false);
	});

	it('is null for a page the HTML does not preload', () => {
		expect(chunkPathFor(bomloHtml, 'ingen-slik-side')).toBeNull();
	});

	it('derives the page name from the endpoint', () => {
		expect(pageSlugFor(bomlo)).toBe('kulturprogram');
	});
});

describe('the Bømlo programme', () => {
	it('reads the same event shape out of the chunk', () => {
		// The argument for this being a config entry rather than a fourteenth importer: once the
		// wrapper is off, there is nothing site-specific left.
		expect(bomloUpstream.length).toBeGreaterThan(20);
		for (const event of bomloUpstream) {
			expect(typeof event.title).toBe('string');
			expect(event.title.trim()).not.toBe('');
		}
	});

	it('reads the programme, not the template that produced it', () => {
		/*
		 * The programme block carries `events` twice: the array of productions, and — one level
		 * down under `bindings` — the template that generated it, an object with the very same key
		 * name whose values are strings like "@title" and "@begin".
		 *
		 * `z.array(eventSchema)` is what tells them apart, which is the argument for validating the
		 * shape rather than reaching for a key by name.
		 */
		const payload = readWebpackModuleExports(bomloChunk) as {
			pathContext: { blocks: { data: { events?: unknown; bindings?: { events?: unknown } } }[] };
		};
		const programme = payload.pathContext.blocks.find((b) => Array.isArray(b.data.events))!;
		expect(programme.data.bindings?.events).toBeTypeOf('object');
		expect(Array.isArray(programme.data.bindings?.events)).toBe(false);

		expect(bomloUpstream.length).toBe((programme.data.events as unknown[]).length);
	});

	it('matches the block on shape, not on its component name', () => {
		// Same guarantee the JSON path has: the component name is a label, the `events` array is
		// the contract, so a rename upstream must not silently return nothing.
		const renamed = readWebpackModuleExports(bomloChunk) as {
			pathContext: { blocks: { component?: string | null }[] };
		};
		for (const block of renamed.pathContext.blocks) block.component = 'cw-component-renamed';
		expect(extractEvents(renamed).length).toBe(bomloUpstream.length);
	});

	it('maps every showing without failures', () => {
		expect(bomloMapped.filter(isFailure)).toEqual([]);
		expect(bomloMapped.length).toBeGreaterThanOrEqual(bomloUpstream.length);
	});

	it('resolves the naive wall clock in the venue zone', () => {
		// The payload states "2026-09-10 19:00:00" with no offset anywhere. 19:00 in Oslo in
		// September is 17:00Z; read in the server's zone it would be whatever CI happens to run in.
		const quiz = bomloMapped.find((m) => !isFailure(m) && m.title === 'TorsdagsQuiz');
		expect(quiz && !isFailure(quiz)).toBe(true);
		if (!quiz || isFailure(quiz)) return;
		expect(quiz.startsAt.toISOString()).toBe('2026-09-10T17:00:00.000Z');
	});

	it('keeps the end time this site states', () => {
		// Stord's payload has no `end` at all; Bømlo's has one on every showing. Using it where it
		// exists is not the same as inventing one where it does not — see `mapTicket`.
		const withEnd = bomloMapped.filter((m) => !isFailure(m) && m.endsAt);
		expect(withEnd.length).toBe(bomloMapped.length);

		const stordWithEnd = mapped.filter((m) => !isFailure(m) && m.endsAt);
		expect(stordWithEnd.length).toBe(0);
	});

	it('drops an end that is not after the start rather than storing it', () => {
		const parent = bomloUpstream[0]!;
		const ticket = { ...parent.tickets![0]!, end: parent.tickets![0]!.date };
		const result = mapTicket(parent, ticket, bomlo);
		if (isFailure(result)) throw new Error(result.problem);
		expect(result.endsAt).toBeNull();
	});

	it('uses the room as the venue, and the culture house when there is none', () => {
		const rooms = new Set(
			bomloMapped.filter((m) => !isFailure(m)).map((m) => (isFailure(m) ? '' : m.venueName))
		);
		expect(rooms.has('Storsalen')).toBe(true);
		expect(rooms.has('Kulturhuskafeen')).toBe(true);
	});

	it('maps the category names this venue actually uses', () => {
		/*
		 * Bømlo writes them in the plural and in compounds where Stord writes singulars, and
		 * nineteen of its twenty-four productions were landing in `anna` on that alone. These are
		 * editorial categories a programme editor chose; dropping them throws away a fact.
		 */
		expect(mapCategory('Konserter')).toBe('musikk');
		expect(mapCategory('Teater/revy')).toBe('teater');
		expect(mapCategory('Foredrag/konferanser')).toBe('mote');
		expect(mapCategory('QUIZ')).toBe('mote');

		const uncategorised = bomloUpstream.filter((e) => mapCategory(e.category) === 'anna');
		expect(uncategorised).toEqual([]);
	});

	it('sends a reader to the programme page, never to the checkout', () => {
		// We are an index, not a box office. The ticket link is the CTA; the source is the event.
		for (const m of bomloMapped) {
			if (isFailure(m)) continue;
			expect(m.sourceUrl).toContain('bomlokulturhus.no');
			expect(m.sourceUrl).not.toContain('checkout.ebillett.no');
		}
	});

	it('gives each showing of a repeating event its own identity', () => {
		const ids = bomloMapped
			.filter((m) => !isFailure(m))
			.map((m) => (isFailure(m) ? '' : m.externalId));
		expect(new Set(ids).size).toBe(ids.length);
		// TorsdagsQuiz runs twice off one production, which is the reason the identity is the
		// showing's ticket id and not the production's.
		expect(bomloMapped.length).toBeGreaterThan(bomloUpstream.length);
	});
});
