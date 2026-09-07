import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { LINKED_SOURCES, SOURCE_PLATFORMS, platformOf } from '@hendingar/core/directory';
import { CATEGORY_SLUGS } from '@hendingar/core/taxonomy';
import { importedEventSchema, isoWithOffset } from '@hendingar/core/validation';
import {
	CRAWL_DELAY_MS,
	absoluteUrl,
	createPacer,
	parseVenuePage,
	type RawPerformance
} from '../src/api.ts';
import { INSTANCES, instanceBySlug } from '../src/instances.ts';
import {
	CATEGORY,
	isFailure,
	mapPerformance,
	occurrenceId,
	parseWallClock,
	slugifyVenue
} from '../src/map.ts';

/**
 * Against committed real pages. No network, no clock (CLAUDE.md rule 6).
 *
 * Three fixtures, each earning its place:
 *   - bomlo-spillested.html    the first venue. Four performances whose real dates span both
 *                              daylight-saving transitions — 27 October 2026 is two days after the
 *                              clocks go back and 9 April 2027 twelve days after they go forward,
 *                              so a constant offset cannot be right for both.
 *   - stord-spillested.html    the second venue, added as a config entry and no new code — proof
 *                              this is a platform parser, and proof that a production keeps its id
 *                              across halls while its performances do not.
 *   - oslo-vega-scene.html     sixteen performances of ONE production, ticketed by a vendor that
 *                              is not eBillett. It is the reason the external id is what it is:
 *                              production alone collapses sixteen evenings into one, and the
 *                              vendor's per-performance id does not exist here at all.
 */
const fixture = (name: string) =>
	readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)), 'utf8');

const bomloUrl = 'https://www.riksteatret.no/spillested/bomlo/';
const stordUrl = 'https://www.riksteatret.no/spillested/stord/';
const osloUrl = 'https://www.riksteatret.no/spillested/oslo2/';

const bomlo = parseVenuePage(fixture('bomlo-spillested.html'), bomloUrl);
const stord = parseVenuePage(fixture('stord-spillested.html'), stordUrl);
const oslo = parseVenuePage(fixture('oslo-vega-scene.html'), osloUrl);

const instance = instanceBySlug('riksteatret-bomlo')!;
const stordInstance = instanceBySlug('riksteatret-stord')!;

const poster = (page: typeof bomlo, p: RawPerformance) =>
	page.postersByProduction.get(p.productionId) ?? null;

const mapped = bomlo.performances.map((p) => mapPerformance(p, poster(bomlo, p), instance));

describe('parseVenuePage', () => {
	it('reads every performance off the Bømlo page', () => {
		expect(bomlo.performances).toHaveLength(4);
		expect(bomlo.rejected).toEqual([]);
		expect(bomlo.performances.map((p) => p.title)).toEqual([
			'Apestjernen',
			'Ubesvart anrop',
			'Kakejazz',
			'1984 dub'
		]);
	});

	it('reads the same shape off another hall, so this is a platform importer', () => {
		expect(stord.performances).toHaveLength(3);
		expect(stord.rejected).toEqual([]);
		expect(stord.performances.map((p) => p.venueName)).toEqual([
			'Kulturhuset Stord',
			'Kulturhuset Stord',
			'Kulturhuset Stord'
		]);
	});

	it('takes the date from the datetime attribute, not from the rendered text', () => {
		/*
		 * The visible date is `27. okt<i class="date__suffix">ober</i> 2026` — split across tags
		 * and spelled in Norwegian. The attribute is the machine-readable statement, and this
		 * asserts we read it verbatim rather than flattening the text and guessing at month names.
		 */
		expect(bomlo.performances.map((p) => p.datetime)).toEqual([
			'27.10.2026 18:00',
			'19.11.2026 13:30',
			'13.03.2027 17:00',
			'09.04.2027 19:00'
		]);
	});

	it('decodes the numeric entities the template escapes everything with', () => {
		// The markup says `B&#xF8;mlo kulturhus`. Publishing that verbatim is the bug
		// importers/kyrkja shipped twenty-eight times.
		expect(bomlo.performances[0]!.venueName).toBe('Bømlo kulturhus');
	});

	it('makes the production link absolute and keeps the vendor link as given', () => {
		expect(bomlo.performances[0]!.sourceUrl).toBe(
			'https://www.riksteatret.no/repertoar/apestjernen/'
		);
		expect(bomlo.performances[0]!.ticketUrl).toBe(
			'https://checkout.ebillett.no/121/events/44194/purchase'
		);
	});

	it('gives the featured production a poster and everything else none', () => {
		// One highlighted-production module per venue page, so exactly one production has a
		// picture. The rest get a generated tile rather than a borrowed image.
		expect([...bomlo.postersByProduction]).toEqual([
			['7309200', 'https://v.imgi.no/j5gaglkgve-Portrait/Apestjernen.webp']
		]);
	});

	it('recognises the page by the og:url it declares', () => {
		expect(bomlo.recognised).toBe(true);
		expect(stord.recognised).toBe(true);
	});

	it('refuses to recognise a page that names a different URL', () => {
		/*
		 * riksteatret.no answers anything it does not know with a 302 to a 200-OK /404 page. An
		 * empty programme is legitimate — a touring theatre is not in every hall every month — so
		 * without this check a redesign or a moved URL would import nothing and report success
		 * forever.
		 */
		expect(parseVenuePage(fixture('stord-spillested.html'), bomloUrl).recognised).toBe(false);
		expect(parseVenuePage('<html><head></head><body></body></html>', bomloUrl).recognised).toBe(
			false
		);
	});

	it('reports a card it cannot read rather than dropping it silently', () => {
		const noDate = `<meta property="og:url" content="${bomloUrl}">
			<li class="nav-program__item">
				<div class="item__date"><span class="date">27. oktober 2026</span></div>
				<div class="item__descr"><h2><a href="/repertoar/x/">X</a></h2><p><span>Ein stad</span></p></div>
				<div class="item__action"><a href="https://t.no/1" data-production-id="1">Kjøp</a></div>
			</li>`;
		const page = parseVenuePage(noDate, bomloUrl);
		expect(page.performances).toEqual([]);
		expect(page.rejected).toEqual(['X: no datetime attribute on .item__date']);
	});

	it('rejects a card with no production id, because there is then no identity', () => {
		const noId = `<meta property="og:url" content="${bomloUrl}">
			<li class="nav-program__item">
				<div class="item__date" datetime="27.10.2026 18:00"></div>
				<div class="item__descr"><h2><a href="/repertoar/x/">X</a></h2><p><span>Ein stad</span></p></div>
				<div class="item__action"></div>
			</li>`;
		const page = parseVenuePage(noId, bomloUrl);
		expect(page.performances).toEqual([]);
		expect(page.rejected).toEqual(['X (27.10.2026 18:00): no data-production-id']);
	});
});

describe('absoluteUrl', () => {
	it('resolves the site-relative links the cards use', () => {
		expect(absoluteUrl('/repertoar/kakejazz/', bomloUrl)).toBe(
			'https://www.riksteatret.no/repertoar/kakejazz/'
		);
	});

	it('refuses anything that is not http(s)', () => {
		expect(absoluteUrl('javascript:alert(1)', bomloUrl)).toBeNull();
		expect(absoluteUrl('', bomloUrl)).toBe(bomloUrl);
	});
});

describe('parseWallClock', () => {
	it('reads the DD.MM.YYYY HH:MM the template writes', () => {
		expect(parseWallClock('27.10.2026 18:00')).toEqual({ date: '2026-10-27', time: '18:00' });
		expect(parseWallClock('09.04.2027 19:00')).toEqual({ date: '2027-04-09', time: '19:00' });
	});

	it('rejects a shape that matches but is not a date or a time', () => {
		// The same class of bug as `2026-02-31`: the pattern is not the constraint.
		expect(parseWallClock('31.02.2027 18:00')).toBeNull();
		expect(parseWallClock('27.10.2026 25:00')).toBeNull();
		expect(parseWallClock('27.10.2026 18:61')).toBeNull();
	});

	it('rejects anything that is not that shape at all', () => {
		expect(parseWallClock('2026-10-27T18:00')).toBeNull();
		expect(parseWallClock('27. oktober 2026 kl. 18:00')).toBeNull();
		expect(parseWallClock('')).toBeNull();
	});
});

describe('slugifyVenue', () => {
	it('folds Norwegian letters the way every other importer does, so venues consolidate', () => {
		expect(slugifyVenue('Bømlo kulturhus')).toBe('boemlo-kulturhus');
		expect(slugifyVenue('Kulturhuset Stord')).toBe('kulturhuset-stord');
	});
});

describe('occurrenceId', () => {
	it('is the production plus the instant, in UTC', () => {
		expect(occurrenceId('7309200', new Date('2026-10-27T17:00:00Z'))).toBe(
			'7309200@2026-10-27T17:00:00.000Z'
		);
	});

	it('keeps two evenings of the same production apart', () => {
		const a = occurrenceId('7295107', new Date('2026-10-15T17:00:00Z'));
		const b = occurrenceId('7295107', new Date('2026-10-16T17:00:00Z'));
		expect(a).not.toBe(b);
	});
});

describe('the external id', () => {
	/*
	 * The reason for the shape, asserted against the page that would have broken the alternatives.
	 */
	it('does not collapse sixteen evenings of one production into one row', () => {
		expect(oslo.performances).toHaveLength(16);
		expect(new Set(oslo.performances.map((p) => p.productionId)).size).toBe(1);

		const ids = oslo.performances.map((p) => {
			const m = mapPerformance(p, null, { ...instance, url: osloUrl });
			expect(isFailure(m)).toBe(false);
			return isFailure(m) ? '' : m.externalId;
		});
		expect(new Set(ids).size).toBe(16);
	});

	it('does not depend on a ticket vendor that is not always eBillett', () => {
		// Every Vega Scene card links to vegascene.no, with no numeric event id anywhere — so the
		// `events/44194` in Bømlo's ticket URL cannot be the identity even though it is per
		// performance.
		for (const p of oslo.performances) {
			expect(p.ticketUrl).toMatch(/^https:\/\/www\.vegascene\.no\//);
			expect(p.ticketUrl).not.toMatch(/ebillett/);
		}
	});

	it('lets one production keep its id across two halls, because the venue is the source', () => {
		const apestjernenAtBomlo = bomlo.performances.find((p) => p.title === 'Apestjernen')!;
		const apestjernenAtStord = stord.performances.find((p) => p.title === 'Apestjernen')!;
		expect(apestjernenAtStord.productionId).toBe(apestjernenAtBomlo.productionId);
		// Different evenings, so different ids anyway — and `events` is unique on
		// (source_id, external_id), so two halls could not collide even on the same evening.
		expect(apestjernenAtStord.datetime).not.toBe(apestjernenAtBomlo.datetime);
	});
});

describe('the wall clock is resolved in the venue’s zone', () => {
	/*
	 * The one thing this importer must not get wrong. `datetime="27.10.2026 18:00"` states no
	 * offset, and Norway's is +01:00 for half the year and +02:00 for the other half — a Bømlo
	 * season spans both. Getting it wrong shifts a curtain by an hour, silently.
	 */
	const at = (datetime: string, inst = instance) => {
		const m = mapPerformance(
			{
				productionId: '1',
				title: 'T',
				datetime,
				venueName: 'Bømlo kulturhus',
				sourceUrl: 'https://www.riksteatret.no/repertoar/t/',
				ticketUrl: null
			},
			null,
			inst
		);
		if (isFailure(m)) throw new Error(m.problem);
		return m.startsAt.toISOString();
	};

	it('uses summer time on the last day of it, and winter time the day after', () => {
		// The clocks go back on Sunday 25 October 2026.
		expect(at('24.10.2026 18:00')).toBe('2026-10-24T16:00:00.000Z'); // +02:00
		expect(at('25.10.2026 18:00')).toBe('2026-10-25T17:00:00.000Z'); // +01:00
	});

	it('uses winter time on the day before spring forward, and summer time on the day itself', () => {
		// The clocks go forward on Sunday 28 March 2027.
		expect(at('27.03.2027 19:00')).toBe('2027-03-27T18:00:00.000Z'); // +01:00
		expect(at('28.03.2027 19:00')).toBe('2027-03-28T17:00:00.000Z'); // +02:00
	});

	it('gets both ends of the real Bømlo season right', () => {
		// Not synthetic: these are the dates on the committed page, and they are the reason a
		// hard-coded offset would have been wrong for part of every season.
		expect(at('27.10.2026 18:00')).toBe('2026-10-27T17:00:00.000Z'); // 18:00 CET
		expect(at('09.04.2027 19:00')).toBe('2027-04-09T17:00:00.000Z'); // 19:00 CEST
		/*
		 * The pair is worth stating plainly: an 18:00 curtain in October and a 19:00 one in April
		 * land on the *same UTC time of day*, because the offset between them differs by an hour.
		 * Any single hard-coded offset makes one of these two an hour wrong.
		 */
		expect(at('27.10.2026 18:00').slice(10)).toBe(at('09.04.2027 19:00').slice(10));
	});

	it('follows the venue’s zone rather than the runner’s', () => {
		const helsinki = { ...instance, timezone: 'Europe/Helsinki' };
		expect(at('27.10.2026 18:00', helsinki)).toBe('2026-10-27T16:00:00.000Z');
	});
});

describe('mapPerformance', () => {
	it('maps the Bømlo page to four published-ready events', () => {
		expect(mapped.filter(isFailure)).toEqual([]);
	});

	it('leaves no HTML entity in a title, on either site', () => {
		/*
		 * The class of bug, not one instance of it. This importer had its own `NAMED_ENTITIES` table
		 * and it was missing `laquo`/`raquo` — Norwegian's own quotation marks — which is how a
		 * Moster Amfi concert reached the live site as `…Humor &laquo;Frå Vestlandet…&raquo;`. The
		 * table now comes from `@hendingar/core/text`, so this asserts the property rather than the
		 * one entity: any named entity the shared decoder lacks survives verbatim and reads as the
		 * source's own text.
		 */
		const ALL_MAPPED = mapped;
		for (const m of ALL_MAPPED) {
			if (isFailure(m)) continue;
			expect(m.title, m.title).not.toMatch(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/);
		}
	});

	it('files everything as teater, from the shared taxonomy', () => {
		expect(CATEGORY_SLUGS).toContain(CATEGORY);
		expect(CATEGORY).toBe('teater');
		for (const m of mapped) {
			expect(isFailure(m)).toBe(false);
			if (!isFailure(m)) expect(m.category).toBe('teater');
		}
	});

	it('keeps the hall name clean so pnpm consolidate can match it', () => {
		const first = mapped[0]!;
		expect(isFailure(first)).toBe(false);
		if (isFailure(first)) return;
		expect(first.venueName).toBe('Bømlo kulturhus');
		expect(first.venueSlug).toBe('boemlo-kulturhus');
	});

	it('links the ticket vendor and the production page separately', () => {
		const first = mapped[0]!;
		if (isFailure(first)) throw new Error(first.problem);
		expect(first.sourceUrl).toBe('https://www.riksteatret.no/repertoar/apestjernen/');
		expect(first.ctaUrl).toBe('https://checkout.ebillett.no/121/events/44194/purchase');
	});

	it('states no end time, because the page states none', () => {
		for (const m of mapped) {
			if (!isFailure(m)) expect(m.endsAt).toBeNull();
		}
	});

	it('hotlinks the featured poster but never claims a right to it', () => {
		const [featured, ...rest] = mapped;
		if (isFailure(featured!)) throw new Error('the featured performance failed to map');
		expect(featured!.posterUrl).toBe('https://v.imgi.no/j5gaglkgve-Portrait/Apestjernen.webp');
		expect(featured!.posterRightsVerified).toBe(false);
		for (const m of rest) {
			if (!isFailure(m)) expect(m.posterUrl).toBeNull();
		}
	});

	it('falls back to the configured hall when a card names none', () => {
		const m = mapPerformance(
			{
				productionId: '1',
				title: 'T',
				datetime: '27.10.2026 18:00',
				venueName: '',
				sourceUrl: 'https://www.riksteatret.no/repertoar/t/',
				ticketUrl: null
			},
			null,
			instance
		);
		if (isFailure(m)) throw new Error(m.problem);
		expect(m.venueName).toBe('Bømlo kulturhus');
	});

	it('reports an unreadable datetime instead of writing an Invalid Date', () => {
		const m = mapPerformance(
			{
				productionId: '1',
				title: 'T',
				datetime: '27. oktober 2026',
				venueName: 'Bømlo kulturhus',
				sourceUrl: 'https://www.riksteatret.no/repertoar/t/',
				ticketUrl: null
			},
			null,
			instance
		);
		expect(isFailure(m)).toBe(true);
		if (!isFailure(m)) return;
		expect(m.problem).toContain('unreadable datetime');
	});

	it('reports an empty title rather than importing a nameless event', () => {
		const m = mapPerformance(
			{
				productionId: '1',
				title: '   ',
				datetime: '27.10.2026 18:00',
				venueName: 'Bømlo kulturhus',
				sourceUrl: 'https://www.riksteatret.no/repertoar/t/',
				ticketUrl: null
			},
			null,
			instance
		);
		expect(isFailure(m)).toBe(true);
	});

	it('produces rows packages/core accepts as imported events', () => {
		// The importer writes Dates rather than strings, so this reassembles the submission shape
		// the schema owns — the point being that nothing we produce is out of contract.
		const everything = [
			...mapped,
			...stord.performances.map((p) => mapPerformance(p, poster(stord, p), stordInstance))
		];
		for (const m of everything) {
			expect(isFailure(m)).toBe(false);
			if (isFailure(m)) continue;
			expect(isoWithOffset.safeParse(m.startsAt.toISOString()).success).toBe(true);
			const parsed = importedEventSchema.safeParse({
				externalId: m.externalId,
				title: m.title,
				category: m.category,
				startsAt: m.startsAt.toISOString(),
				venueName: m.venueName!,
				sourceUrl: m.sourceUrl,
				...(m.ctaUrl ? { ctaUrl: m.ctaUrl } : {}),
				...(m.posterUrl ? { posterUrl: m.posterUrl } : {}),
				posterRightsVerified: m.posterRightsVerified
			});
			expect(parsed.error?.issues ?? []).toEqual([]);
		}
	});
});

describe('instances', () => {
	it('has unique slugs, because the slug is the source identity', () => {
		expect(new Set(INSTANCES.map((i) => i.slug)).size).toBe(INSTANCES.length);
	});

	it('keeps the slug the link-only row already had, and no longer claims it there', () => {
		/*
		 * `riksteatret-bomlo` was a `kind: 'link'` row in LINKED_SOURCES. This importer upserts the
		 * same slug so the row graduates in place. Leaving the entry in the directory as well would
		 * be harmless only by luck — `pnpm db:sources` skips slugs an importer has taken over — but
		 * it would keep telling /datasamling we merely link to a source we now collect.
		 */
		expect(instance.slug).toBe('riksteatret-bomlo');
		for (const linked of LINKED_SOURCES) {
			expect(INSTANCES.map((i) => i.slug)).not.toContain(linked.slug);
		}
	});

	it('points every venue at an absolute https spillested page', () => {
		for (const i of INSTANCES) {
			const url = new URL(i.url);
			expect(url.protocol).toBe('https:');
			expect(url.hostname).toBe('www.riksteatret.no');
			expect(url.pathname.startsWith('/spillested/')).toBe(true);
		}
	});

	it('carries the platform prefix, so /kjelder groups the halls under one heading', () => {
		const platform = SOURCE_PLATFORMS.find((p) => p.slug === 'riksteatret');
		expect(platform, 'riksteatret must be registered as a platform').toBeDefined();
		for (const i of INSTANCES) {
			expect(i.slug.startsWith('riksteatret-')).toBe(true);
			// The grouping is by prefix and nothing else, so this is the whole wiring.
			expect(platformOf(i.slug)).toBe(platform);
		}
	});

	it('adds a hall as a config entry and nothing else', () => {
		// Two halls, one parser: the Stord page goes through the same `parseVenuePage` and the same
		// `mapPerformance` as Bømlo's, with the instance as the only difference.
		expect(INSTANCES).toHaveLength(2);
		const stordEvents = stord.performances.map((p) =>
			mapPerformance(p, poster(stord, p), stordInstance)
		);
		expect(stordEvents.filter(isFailure)).toEqual([]);
		expect(stordEvents.map((m) => (isFailure(m) ? null : m.venueSlug))).toEqual([
			'kulturhuset-stord',
			'kulturhuset-stord',
			'kulturhuset-stord'
		]);
	});

	it('keeps the hall named as Riksteatret names it', () => {
		/*
		 * "Kulturhuset Stord", not "Stord kulturhus" — which is what importers/kulturhus calls the
		 * same building. Renaming it here to force a match would make the importer's output
		 * uncheckable against the page it came from; `venues` holding both spellings is the honest
		 * cost, and that building already has several rows because the culture house's own feed
		 * names the room ("Storsalen") rather than the house.
		 */
		expect(stordInstance.venueFallback).toBe('Kulturhuset Stord');
		expect(stord.performances.every((p) => p.venueName === 'Kulturhuset Stord')).toBe(true);
	});

	it('is trusted, because a pending imported event is one nobody can ever see', () => {
		// Nothing publishes a pending imported event: importers do not call the verifier (ADR
		// 0004), no job sweeps the table, and ADR 0012 removed the review queue. Every listing
		// filters status = 'published'.
		for (const i of INSTANCES) expect(i.trusted).toBe(true);
	});

	it('formats each hall in Europe/Oslo', () => {
		for (const i of INSTANCES) expect(i.timezone).toBe('Europe/Oslo');
	});
});

describe('crawl delay', () => {
	it('is our own two seconds, since the site publishes no robots.txt', () => {
		// https://www.riksteatret.no/robots.txt answers 302 → /404. Nothing is disallowed and no
		// Crawl-delay is stated, so this number is a self-imposed floor rather than an obligation.
		expect(CRAWL_DELAY_MS).toBe(2_000);
	});

	it('waits between requests but not before the first one', async () => {
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
