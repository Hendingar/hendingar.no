import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { CATEGORY_SLUGS } from '@hendingar/core/taxonomy';
import { importedEventSchema, isoWithOffset } from '@hendingar/core/validation';
import { CRAWL_DELAY_MS, cleanUrl, createPacer, parseDetail, parseListing } from '../src/api.ts';
import { INSTANCES, instanceBySlug } from '../src/instances.ts';
import {
	DEFAULT_CATEGORY,
	isAllDay,
	isFailure,
	mapCategory,
	mapEvent,
	normaliseDateTime,
	occurrenceId,
	slugifyVenue,
	venueNameFrom
} from '../src/map.ts';

/**
 * Against committed real pages. No network, no clock (CLAUDE.md rule 6).
 *
 * Four fixtures, each earning its place:
 *   - bomlo-aktiviteter.html          the instance we ship: one timed and one whole-day activity
 *   - bomlo-fropakkekveld.html        an activity's own page, the only place a description lives
 *   - ski-hagelag-aktiviteter.html    another hagelag on the same template — proof this is a
 *                                     platform parser, plus winter offsets and a lag that writes
 *                                     a full postal address into the venue name
 *   - vaksdal-aktiviteter-tom.html    a hagelag with nothing on. Must parse as zero events and
 *                                     still be recognised, because "empty" and "the page changed"
 *                                     have to be distinguishable
 */
const fixture = (name: string) =>
	readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)), 'utf8');

const bomloUrl = 'https://bakhagen.hageselskapet.no/hordaland/bomlo/aktiviteter/';
const skiUrl = 'https://bakhagen.hageselskapet.no/akershus/hagelag/ski-hagelag/aktiviteter/';
const vaksdalUrl = 'https://bakhagen.hageselskapet.no/hordaland/vaksdal/aktiviteter/';

const bomlo = parseListing(fixture('bomlo-aktiviteter.html'), bomloUrl);
const ski = parseListing(fixture('ski-hagelag-aktiviteter.html'), skiUrl);
const vaksdal = parseListing(fixture('vaksdal-aktiviteter-tom.html'), vaksdalUrl);
const detail = parseDetail(fixture('bomlo-fropakkekveld.html'));

const instance = instanceBySlug('bomlo-hagelag')!;

/** The one hagelag we ship, as a lag on the same template but somewhere else entirely. */
const skiInstance = { ...instance, slug: 'ski-hagelag', url: skiUrl, venueFallback: 'Ski hagelag' };

describe('parseListing', () => {
	it('reads both activities off the Bømlo page', () => {
		expect(bomlo.events).toHaveLength(2);
		expect(bomlo.rejected).toEqual([]);
		expect(bomlo.events.map((e) => e.title)).toEqual(['Frøpakkekveld', 'Fermeteringskurs']);
	});

	it('reads the same shape off another hagelag, so this is a platform importer', () => {
		expect(ski.events).toHaveLength(3);
		expect(ski.rejected).toEqual([]);
	});

	it('ignores the ld+json on the page, which describes the listing and not the events', () => {
		/*
		 * The only application/ld+json block on a listing is an `Article` — "Aktiviteter i
		 * Hageselskapet Bømlo". Trusting it would import one bogus row and miss every real
		 * activity, which is exactly the trap this parser exists to walk past.
		 */
		expect(fixture('bomlo-aktiviteter.html')).toContain('"@type": "Article"');
		expect(bomlo.events.every((e) => e.title !== 'Aktiviteter i Hageselskapet Bømlo')).toBe(true);
	});

	it('takes the article id from the camelCase attribute', () => {
		expect(bomlo.events.map((e) => e.articleId)).toEqual(['11596', '11597']);
	});

	it('reads the id whatever case the attribute arrives in', () => {
		// HTML attribute names are case-insensitive, and anything that normalises the document —
		// a browser, a DOM parser, a rewriting proxy — hands back `data-articleid`.
		const lowered = fixture('bomlo-aktiviteter.html').replaceAll(
			'data-articleId',
			'data-articleid'
		);
		const reparsed = parseListing(lowered, bomloUrl);
		expect(reparsed.events.map((e) => e.articleId)).toEqual(['11596', '11597']);
	});

	it('keeps the two datetime shapes exactly as the page wrote them', () => {
		// Normalising belongs to map.ts. The parser must not quietly repair its input, or the
		// inconsistency this importer has to handle stops being visible in a test.
		expect(bomlo.events[0]!.startDateTime).toBe('2026-09-18T18:00+02:00');
		expect(bomlo.events[1]!.endDateTime).toBe('2026-10-06T23:59:59+02:00');
	});

	it('builds a source URL without the query that 403s', () => {
		/*
		 * The card's own href carries `?instance=0`. Requesting that redirects to
		 * `…&cpbotguard=1`, which answers `403 Forbidden for non-conforming clients`; the same
		 * path without a query answers 200. Verified with curl before this importer was written.
		 */
		for (const event of [...bomlo.events, ...ski.events]) {
			expect(event.sourceUrl).not.toContain('?');
			expect(event.sourceUrl).not.toContain('#');
			expect(event.sourceUrl.startsWith('https://bakhagen.hageselskapet.no/')).toBe(true);
		}
		expect(bomlo.events[0]!.sourceUrl).toBe(
			'https://bakhagen.hageselskapet.no/hordaland/bomlo/aktiviteter/fropakkekveld-5'
		);
	});

	it('reads the place and the printed clock', () => {
		expect(bomlo.events[0]!.location).toBe('Bømlo Folkebibliotek');
		expect(bomlo.events[0]!.clockLabel).toBe('18:00');
		expect(bomlo.events[1]!.clockLabel).toBe('(heldags)');
	});

	it('recognises a hagelag page that simply has nothing on', () => {
		// The template drops the whole activity list rather than rendering an empty one, so zero
		// events is a normal state and must not read as a broken page.
		expect(vaksdal.events).toEqual([]);
		expect(vaksdal.rejected).toEqual([]);
		expect(vaksdal.recognised).toBe(true);
	});

	it('stops recognising a page that is no longer the one we asked for', () => {
		expect(bomlo.recognised).toBe(true);
		expect(parseListing('<html><body>Log in to continue</body></html>', bomloUrl).recognised).toBe(
			false
		);
		// The right template, but somebody else's page: the intro Article names its own URL.
		expect(parseListing(fixture('ski-hagelag-aktiviteter.html'), bomloUrl).recognised).toBe(false);
	});

	it('reports a card it cannot identify rather than inventing an id for it', () => {
		const broken = fixture('bomlo-aktiviteter.html').replace('data-articleId="11596"', '');
		const reparsed = parseListing(broken, bomloUrl);
		expect(reparsed.events).toHaveLength(1);
		expect(reparsed.rejected).toEqual(['an activity card with no data-articleId']);
	});
});

describe('cleanUrl', () => {
	it('strips the query and the fragment, keeping the path', () => {
		expect(cleanUrl('https://x.no/a/b?instance=0#article', bomloUrl)).toBe('https://x.no/a/b');
	});

	it('resolves a relative href against the page', () => {
		expect(cleanUrl('fropakkekveld-5?instance=0', bomloUrl)).toBe(`${bomloUrl}fropakkekveld-5`);
	});

	it('refuses a scheme that is not http(s)', () => {
		expect(cleanUrl('javascript:alert(1)', bomloUrl)).toBeNull();
		expect(cleanUrl('not a url at all', 'also not a url')).toBeNull();
	});
});

describe('parseDetail', () => {
	it('finds the Event block on an activity page', () => {
		expect(detail?.name).toBe('Frøpakkekveld');
		expect(detail?.description).toContain('frøpakkekveld på Bømlo Folkebibliotek');
	});

	it('returns null when there is no Event block, so a description is optional', () => {
		// A listing page's only block is an Article. The importer must degrade, not throw.
		expect(parseDetail(fixture('bomlo-aktiviteter.html'))).toBeNull();
		expect(
			parseDetail('<html><script type="application/ld+json">{oops</script></html>')
		).toBeNull();
	});
});

describe('normaliseDateTime', () => {
	it('fills in the seconds the timed cards omit', () => {
		expect(normaliseDateTime('2026-09-18T18:00+02:00')).toBe('2026-09-18T18:00:00+02:00');
	});

	it('leaves a timestamp that already has seconds alone', () => {
		expect(normaliseDateTime('2026-10-06T23:59:59+02:00')).toBe('2026-10-06T23:59:59+02:00');
	});

	it('accepts an offset written without its colon, and writes it back with one', () => {
		expect(normaliseDateTime('2026-11-03T19:00+0100')).toBe('2026-11-03T19:00:00+01:00');
	});

	it('keeps Z as Z', () => {
		expect(normaliseDateTime('2026-11-03T18:00:00Z')).toBe('2026-11-03T18:00:00Z');
	});

	it('never rewrites the offset the source wrote', () => {
		// CLAUDE.md and the starts_at comment in schema.ts: a source's +01:00 is evidence of the
		// wall clock the organiser meant, and folding it to UTC throws that away.
		expect(normaliseDateTime('2026-11-03T19:00+01:00')).toContain('+01:00');
		expect(normaliseDateTime('2026-09-18T18:00+02:00')).toContain('+02:00');
	});

	it('produces something packages/core will accept', () => {
		for (const raw of [...bomlo.events, ...ski.events]) {
			const normalised = normaliseDateTime(raw.startDateTime);
			expect(normalised).not.toBeNull();
			expect(isoWithOffset.safeParse(normalised).success).toBe(true);
			// And the unnormalised form is exactly what core rejects — which is why this exists.
			if (!raw.startDateTime.includes(':00+') && !raw.startDateTime.includes(':59+')) {
				expect(isoWithOffset.safeParse(raw.startDateTime).success).toBe(false);
			}
		}
	});

	it('returns null for anything it cannot read, rather than an Invalid Date', () => {
		expect(normaliseDateTime('2026-09-18T18:00')).toBeNull(); // no offset at all
		expect(normaliseDateTime('18.09.2026 18:00')).toBeNull();
		expect(normaliseDateTime('')).toBeNull();
	});
});

describe('isAllDay', () => {
	it('reads the structural encoding: local midnight to local 23:59:59', () => {
		expect(isAllDay('2026-10-06T00:00:00+02:00', '2026-10-06T23:59:59+02:00', null)).toBe(true);
	});

	it('reads the printed label too, so a template rewrite cannot hide it', () => {
		expect(isAllDay('2026-10-06T09:00:00+02:00', null, '(heldags)')).toBe(true);
	});

	it('is false for an ordinary evening', () => {
		expect(isAllDay('2026-09-18T18:00:00+02:00', '2026-09-18T20:00:00+02:00', '18:00')).toBe(false);
	});

	it('is false when the card prints no clock at all', () => {
		// Absence of a clock is not a statement that the activity runs all day.
		expect(isAllDay('2026-09-18T18:00:00+02:00', null, null)).toBe(false);
	});

	it('agrees with the two real Bømlo cards', () => {
		const [timed, wholeDay] = bomlo.events;
		const forCard = (e: (typeof bomlo.events)[number]) =>
			isAllDay(
				normaliseDateTime(e.startDateTime)!,
				e.endDateTime ? normaliseDateTime(e.endDateTime) : null,
				e.clockLabel
			);
		expect(forCard(timed!)).toBe(false);
		expect(forCard(wholeDay!)).toBe(true);
	});
});

describe('mapCategory', () => {
	it('files a course as a course, including as the end of a compound', () => {
		expect(mapCategory('Fermeteringskurs')).toBe('kurs');
		expect(mapCategory('Kurs i beskjæring av frukttre')).toBe('kurs');
		expect(mapCategory('Kurskveld om jord')).toBe('kurs');
	});

	it('does not mistake ekskursjon for a course', () => {
		// `kurs` sits in the middle of it, which is why the rule is on whole words and compound
		// ends rather than a substring search.
		expect(mapCategory('Ekskursjon til Rosendal')).toBe(DEFAULT_CATEGORY);
	});

	it('files a plant market as a market, in either written form', () => {
		expect(mapCategory('Planteloppemarknad')).toBe('marknad');
		expect(mapCategory('Hagedag og planteloppemarked')).toBe('marknad');
		expect(mapCategory('Basar på bedehuset')).toBe('marknad');
	});

	it('leaves every other hagelag evening on the default', () => {
		for (const title of [
			'Frøpakkekveld',
			'Årsmøte i Hageselskapet Bømlo',
			'Hagevandring',
			'Foredrag med Claus Dalby',
			'Temakveld om jord og gjødsel',
			'Medlemskveld'
		]) {
			expect(mapCategory(title)).toBe('mote');
		}
	});

	it('only ever answers with a slug the taxonomy has', () => {
		for (const raw of [...bomlo.events, ...ski.events]) {
			expect(CATEGORY_SLUGS).toContain(mapCategory(raw.title));
		}
	});
});

describe('venueNameFrom', () => {
	it('keeps a plain venue name whole', () => {
		expect(venueNameFrom('Bømlo Folkebibliotek')).toBe('Bømlo Folkebibliotek');
	});

	it('drops the postal address some hagelag write into the same field', () => {
		expect(venueNameFrom('Ski Menighetshus, Rådhussvingen 1, 1400 Ski')).toBe('Ski Menighetshus');
	});

	it('is empty for an empty field, so the instance fallback can take over', () => {
		expect(venueNameFrom('')).toBe('');
	});
});

describe('slugifyVenue', () => {
	it('folds Norwegian letters rather than dropping them', () => {
		expect(slugifyVenue('Bømlo Folkebibliotek')).toBe('boemlo-folkebibliotek');
		expect(slugifyVenue('«Det gule huset»')).toBe('det-gule-huset');
	});
});

describe('occurrenceId', () => {
	it('is stable for the same activity and instant', () => {
		const a = occurrenceId('11596', new Date('2026-09-18T18:00:00+02:00'));
		const b = occurrenceId('11596', new Date('2026-09-18T16:00:00Z'));
		expect(a).toBe(b);
	});

	it('separates two occurrences of one activity', () => {
		expect(occurrenceId('11596', new Date('2026-09-18T18:00:00+02:00'))).not.toBe(
			occurrenceId('11596', new Date('2026-09-25T18:00:00+02:00'))
		);
	});
});

describe('mapEvent', () => {
	const mapped = bomlo.events.map((e) => mapEvent(e, null, instance));

	it('maps every Bømlo activity without failures', () => {
		expect(mapped.filter(isFailure)).toEqual([]);
	});

	it('maps every Ski activity without failures, on the same code path', () => {
		expect(ski.events.map((e) => mapEvent(e, null, skiInstance)).filter(isFailure)).toEqual([]);
	});

	it('keeps the instant the source published', () => {
		const first = mapped[0]!;
		expect(isFailure(first)).toBe(false);
		if (isFailure(first)) return;
		expect(first.startsAt.toISOString()).toBe('2026-09-18T16:00:00.000Z');
		expect(first.endsAt?.toISOString()).toBe('2026-09-18T18:00:00.000Z');
	});

	it('resolves a winter date at +01:00, not at the summer offset', () => {
		const winter = ski.events.find((e) => e.startDateTime.includes('+01:00'))!;
		const result = mapEvent(winter, null, skiInstance);
		expect(isFailure(result)).toBe(false);
		if (isFailure(result)) return;
		expect(result.startsAt.toISOString()).toBe('2026-11-03T18:00:00.000Z');
	});

	it('stores a whole-day activity as the source states it, midnight to 23:59:59', () => {
		/*
		 * The deliberate decision, guarded so it cannot drift: we neither invent a start hour nor
		 * drop the activity. Local midnight plus local 23:59:59 the same day is the source's own
		 * unambiguous encoding of "all day", and it is recoverable later by the UI.
		 */
		const wholeDay = mapped[1]!;
		expect(isFailure(wholeDay)).toBe(false);
		if (isFailure(wholeDay)) return;
		expect(wholeDay.startsAt.toISOString()).toBe('2026-10-05T22:00:00.000Z'); // 06.10 00:00 +02
		expect(wholeDay.endsAt?.toISOString()).toBe('2026-10-06T21:59:59.000Z'); // 06.10 23:59:59
	});

	it('takes the description from the activity page when there is one', () => {
		const withDetail = mapEvent(bomlo.events[0]!, detail, instance);
		expect(isFailure(withDetail)).toBe(false);
		if (isFailure(withDetail)) return;
		expect(withDetail.description).toContain('frøpakkekveld');
	});

	it('survives a detail page it could not read', () => {
		const first = mapped[0]!;
		expect(isFailure(first)).toBe(false);
		if (isFailure(first)) return;
		expect(first.description).toBeNull();
		expect(first.title).toBe('Frøpakkekveld');
	});

	it('falls back to the hagelag when a card names no place', () => {
		const nowhere = { ...bomlo.events[0]!, location: '' };
		const result = mapEvent(nowhere, null, instance);
		expect(isFailure(result)).toBe(false);
		if (isFailure(result)) return;
		expect(result.venueName).toBe(instance.venueFallback);
	});

	it('claims no poster and no poster rights, because there is no image to claim', () => {
		for (const m of mapped) {
			if (isFailure(m)) continue;
			expect(m.posterUrl).toBeNull();
			expect(m.posterRightsVerified).toBe(false);
		}
	});

	it('rejects an unreadable start rather than writing an Invalid Date', () => {
		const broken = { ...bomlo.events[0]!, startDateTime: '18. september kl 18' };
		const result = mapEvent(broken, null, instance);
		expect(isFailure(result)).toBe(true);
		if (!isFailure(result)) return;
		expect(result.problem).toContain('unreadable startDate');
	});

	it('drops an end that is not after the start', () => {
		const backwards = { ...bomlo.events[0]!, endDateTime: '2026-09-18T17:00+02:00' };
		const result = mapEvent(backwards, null, instance);
		expect(isFailure(result)).toBe(false);
		if (isFailure(result)) return;
		expect(result.endsAt).toBeNull();
	});

	it('produces rows packages/core accepts as imported events', () => {
		// The importer writes Dates rather than strings, so this reassembles the submission shape
		// the schema owns — the point being that nothing we produce is out of contract.
		for (const m of [...mapped, ...ski.events.map((e) => mapEvent(e, detail, skiInstance))]) {
			expect(isFailure(m)).toBe(false);
			if (isFailure(m)) continue;
			const candidate = {
				externalId: m.externalId,
				title: m.title,
				category: m.category,
				startsAt: m.startsAt.toISOString(),
				endsAt: m.endsAt?.toISOString(),
				venueName: m.venueName!,
				sourceUrl: m.sourceUrl,
				...(m.description ? { description: m.description } : {})
			};
			const parsed = importedEventSchema.safeParse(candidate);
			expect(parsed.error?.issues ?? []).toEqual([]);
		}
	});
});

describe('instances', () => {
	it('has unique slugs, because the slug is the source identity', () => {
		expect(new Set(INSTANCES.map((i) => i.slug)).size).toBe(INSTANCES.length);
	});

	it('points every hagelag at an absolute https aktiviteter page', () => {
		for (const i of INSTANCES) {
			const url = new URL(i.url);
			expect(url.protocol).toBe('https:');
			expect(url.hostname).toBe('bakhagen.hageselskapet.no');
			expect(url.pathname.endsWith('/aktiviteter/')).toBe(true);
		}
	});

	it('either has a real icon URL or none at all, never a guessed path', () => {
		for (const i of INSTANCES) {
			if (i.iconUrl === null) continue;
			expect(i.iconUrl.startsWith('https://')).toBe(true);
			// Bakhagen serves assets through getfile.php and has nothing at /favicon.ico, so a
			// conventional guess would be a broken image on every source row.
			expect(i.iconUrl).not.toMatch(/\/favicon\.ico$/);
		}
	});
});

describe('crawl delay', () => {
	it('is the five seconds robots.txt asks for', () => {
		expect(CRAWL_DELAY_MS).toBe(5_000);
	});

	it('waits between requests but not before the first one', async () => {
		// A delay is *between* requests: making the very first call wait five seconds would add a
		// pointless five seconds to every scheduled run without being any politer.
		const waited: number[] = [];
		const pace = createPacer(async (ms) => {
			waited.push(ms);
		});
		await pace();
		expect(waited).toEqual([]);
		await pace();
		await pace();
		expect(waited).toEqual([CRAWL_DELAY_MS, CRAWL_DELAY_MS]);
	});
});
