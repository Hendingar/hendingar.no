import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { CATEGORY_SLUGS } from '@hendingar/core/taxonomy';
import { instantToZonedWallClock } from '@hendingar/core/datetime';
import { parseActivity, parseCards, parseGroupPage, type UpstreamCard } from '../src/api.ts';
import { GROUPS, type EfGroup } from '../src/groups.ts';
import {
	CATEGORY,
	isFailure,
	isOwnActivity,
	mapActivity,
	municipalityOf,
	parseClock,
	parseDaySpan,
	toTimes
} from '../src/map.ts';

/**
 * Against committed real responses, fetched once on 2026-10-05. No network, no clock (CLAUDE.md
 * rule 6).
 *
 * Stord's group page and its one activity are the case this importer exists for. The rest are
 * other groups' pages, chosen for shape: Oslo's empty list, Lillehammer's list carrying two other
 * groups' activities, Ringsaker's overnight trip (a two-day span), and Bergen's musical (no AI
 * notice on its image, and a place outside the area we cover). The anonymous CSRF token in the two
 * group pages is replaced with a placeholder; nothing reads it.
 */
const fixture = (name: string) =>
	readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)), 'utf8');

const stord: EfGroup = GROUPS[0]!;

const stordPage = parseGroupPage(fixture('group-51-stord.html'));
const fiskeoppdrett = parseActivity(fixture('activity-10075.html'));

function cardFor(id: string, cards: readonly UpstreamCard[]): UpstreamCard {
	const card = cards.find((c) => c.activityId === id);
	if (!card) throw new Error(`no card ${id} in the fixture`);
	return card;
}

describe('the group list', () => {
	it('reads Stord’s one card and its page count off the group page', () => {
		expect(stordPage.pageCount).toBe(1);
		expect(stordPage.rejected).toEqual([]);
		expect(stordPage.cards).toEqual([
			{
				activityId: '10075',
				title: 'Stordgruppa inviterer til visning på Engesund fiskeoppdrett lørdag 24.oktober 2026',
				dateText: '24. October 2026',
				groups: ['Stord']
			}
		]);
	});

	it('reads the fragment the pager fetches the same way', () => {
		expect(parseCards(fixture('upcoming-51-page-1.html')).cards).toEqual(stordPage.cards);
	});

	it('takes an empty group as one empty page, not as a redesign', () => {
		// Oslo, measured: no pager at all, and "No upcoming activities found" in the container.
		expect(parseGroupPage(fixture('group-9-oslo.html'))).toEqual({
			cards: [],
			rejected: [],
			pageCount: 1
		});
	});

	it('throws when the list is gone, rather than importing nothing', () => {
		/*
		 * A redesign must fail loudly. Zero events would be reported as a clean run on
		 * /datasamling, which is exactly the silent stop that page exists to make visible.
		 */
		expect(() => parseGroupPage('<html><body>Stord</body></html>')).toThrow(/upcoming/);
	});

	it('imports only the group’s own activities, not the ones its list recommends', () => {
		// Lillehammer's list, on the day: one Hamar outing and one Ringsaker trip, none its own.
		const { cards } = parseCards(fixture('upcoming-18-lillehammer-page-1.html'));
		expect(cards.map((c) => c.groups)).toEqual([['Hamar'], ['Ringsaker']]);
		const lillehammer: EfGroup = { ...stord, badge: 'Lillehammer' };
		expect(cards.filter((c) => isOwnActivity(c, lillehammer))).toEqual([]);
		expect(cards.filter((c) => isOwnActivity(c, { ...stord, badge: 'Ringsaker' }))).toHaveLength(1);
		expect(isOwnActivity(cardFor('10075', stordPage.cards), stord)).toBe(true);
	});
});

describe('parseActivity', () => {
	it('reads the Information box a reader sees', () => {
		expect(fiskeoppdrett).toMatchObject({
			activityId: '10075',
			dateLines: ['24. October 2026', '11:30 - 13:45'],
			address: 'Fitjarsjøen 2',
			latitude: 59.9178175,
			longitude: 5.3138485,
			imageIsAiGenerated: true
		});
		expect(fiskeoppdrett.descriptionHtml).toContain('Oppmøte:');
	});

	it('throws on a page that is not an activity', () => {
		expect(() => parseActivity('<html><head></head><body></body></html>')).toThrow(
			/unexpected activity page/
		);
	});
});

describe('dates and clocks', () => {
	it('reads one day and a span, including one across new year', () => {
		expect(parseDaySpan('24. October 2026')).toEqual({
			startDate: '2026-10-24',
			endDate: '2026-10-24'
		});
		expect(parseDaySpan('16. October\n   - 17. October 2026')).toEqual({
			startDate: '2026-10-16',
			endDate: '2026-10-17'
		});
		expect(parseDaySpan('30. December - 2. January 2027')).toEqual({
			startDate: '2026-12-30',
			endDate: '2027-01-02'
		});
	});

	it('refuses what it has not seen rather than guessing', () => {
		expect(parseDaySpan('24. October')).toBeNull();
		expect(parseDaySpan('31. February 2026')).toBeNull();
		expect(parseDaySpan('24. Oktober 2026')).toBeNull();
		expect(parseDaySpan('til hausten')).toBeNull();
	});

	it('tells a missing clock from an unreadable one', () => {
		expect(parseClock('11:30 - 13:45 ')).toEqual({ start: '11:30', end: '13:45' });
		expect(parseClock('9.00')).toEqual({ start: '09:00', end: null });
		expect(parseClock('')).toBeNull();
		expect(parseClock(undefined)).toBeNull();
		expect(parseClock('etter skulen')).toBeUndefined();
		expect(parseClock('25:00')).toBeUndefined();
	});

	it('resolves the visible clock in Oslo, which is CEST in October before the change', () => {
		/*
		 * 24 October 2026 is the Saturday before the clocks go back (25 October), so 11:30 is
		 * +02:00. A fixed +01:00 "Norway" offset would put the meeting an hour late on exactly the
		 * weekend it is most likely to be wrong.
		 */
		const t = toTimes(
			{ startDate: '2026-10-24', endDate: '2026-10-24' },
			{ start: '11:30', end: '13:45' },
			'Europe/Oslo'
		);
		expect(t.startsAt.toISOString()).toBe('2026-10-24T09:30:00.000Z');
		expect(t.endsAt?.toISOString()).toBe('2026-10-24T11:45:00.000Z');
		expect(t.timeStated).toBe(true);
	});

	it('keeps a date with no clock as the whole day, never as an invented hour', () => {
		const t = toTimes({ startDate: '2026-11-07', endDate: '2026-11-07' }, null, 'Europe/Oslo');
		expect(instantToZonedWallClock(t.startsAt, 'Europe/Oslo')).toEqual({
			date: '2026-11-07',
			time: '00:00'
		});
		expect(t.endsAt?.toISOString()).toBe('2026-11-07T22:59:59.000Z');
		expect(t.timeStated).toBe(false);
	});
});

describe('municipalityOf', () => {
	it('puts Stord’s fish-farm visit in Fitjar, not in Stord', () => {
		expect(municipalityOf(fiskeoppdrett.address, fiskeoppdrett.title)).toBe('Fitjar');
	});

	it('writes nothing when two are named, or none', () => {
		expect(municipalityOf('Leirvik', 'Tur til Engesund')).toBeNull();
		expect(municipalityOf('åsane kulturhus', 'Carrie - the musical')).toBeNull();
		expect(municipalityOf(null, 'Kino')).toBeNull();
	});
});

describe('mapActivity', () => {
	it('maps Stord’s 24 October visit as the page shows it', () => {
		const mapped = mapActivity(cardFor('10075', stordPage.cards), fiskeoppdrett, stord);
		if (isFailure(mapped)) throw new Error(mapped.problem);

		expect(mapped).toMatchObject({
			externalId: '10075@2026-10-24',
			title: 'Stordgruppa inviterer til visning på Engesund fiskeoppdrett lørdag 24.oktober 2026',
			category: 'anna',
			timeStated: true,
			venueName: 'Fitjarsjøen 2',
			venueSlug: 'fitjarsjoeen-2',
			venueAddress: 'Fitjarsjøen 2',
			municipality: 'Fitjar',
			latitude: 59.9178175,
			longitude: 5.3138485,
			// The page labels its image AI generated; a card cannot carry that notice.
			posterUrl: null,
			posterRightsVerified: false,
			sourceUrl: 'https://www.enestaaendefamilier.no/en/activity/10075/'
		});
		expect(instantToZonedWallClock(mapped.startsAt, 'Europe/Oslo')).toEqual({
			date: '2026-10-24',
			time: '11:30'
		});
		expect(instantToZonedWallClock(mapped.endsAt!, 'Europe/Oslo')).toEqual({
			date: '2026-10-24',
			time: '13:45'
		});
		// The cross-check, in the organisers' own words: the clock in the box is the one in the text.
		expect(mapped.description).toContain('Lørdag 24.oktober kl.11.30.');
		expect(mapped.description).toContain('Oppmøte: Kl 11.30');
		expect(mapped.description).not.toMatch(/<[a-z]/);
	});

	it('spans an overnight trip from the first day’s clock to the last day’s', () => {
		const lillehammer = parseCards(fixture('upcoming-18-lillehammer-page-1.html')).cards;
		const ringsaker: EfGroup = { ...stord, badge: 'Ringsaker' };
		const mapped = mapActivity(
			cardFor('10147', lillehammer),
			parseActivity(fixture('activity-10147.html')),
			ringsaker
		);
		if (isFailure(mapped)) throw new Error(mapped.problem);
		expect(mapped.externalId).toBe('10147@2026-10-16');
		expect(mapped.startsAt.toISOString()).toBe('2026-10-16T15:00:00.000Z');
		expect(mapped.endsAt?.toISOString()).toBe('2026-10-17T14:00:00.000Z');
		expect(mapped.municipality).toBeNull();
		// No AI notice on this page, so its featured image is the poster.
		expect(mapped.posterUrl).toMatch(/^https:\/\/enestaaende01\.blob\.core\.windows\.net\//);
	});

	it('names no municipality for a place outside the three', () => {
		const bergen = parseActivity(fixture('activity-10144.html'));
		const card: UpstreamCard = {
			activityId: '10144',
			title: bergen.title,
			dateText: '24. October 2026',
			groups: ['Bergen']
		};
		const mapped = mapActivity(card, bergen, { ...stord, badge: 'Bergen' });
		if (isFailure(mapped)) throw new Error(mapped.problem);
		expect(mapped.municipality).toBeNull();
		/*
		 * The title says "kl. 14:00" and the box "13:00 - 16:00" — the curtain and the meeting
		 * time. The box is what the page states as the activity's time, so it is what we keep.
		 */
		expect(instantToZonedWallClock(mapped.startsAt, 'Europe/Oslo').time).toBe('13:00');
	});

	it('refuses a card and a page that disagree about the day', () => {
		const card = { ...cardFor('10075', stordPage.cards), dateText: '25. October 2026' };
		const mapped = mapActivity(card, fiskeoppdrett, stord);
		expect(isFailure(mapped) && mapped.problem).toMatch(/the card says/);
	});

	it('refuses a clock it cannot read rather than dropping to midnight', () => {
		const page = { ...fiskeoppdrett, dateLines: ['24. October 2026', 'etter middag'] };
		const mapped = mapActivity(cardFor('10075', stordPage.cards), page, stord);
		expect(isFailure(mapped) && mapped.problem).toMatch(/unreadable clock/);
	});

	it('only ever writes a category the taxonomy has', () => {
		expect(CATEGORY_SLUGS).toContain(CATEGORY);
	});
});
