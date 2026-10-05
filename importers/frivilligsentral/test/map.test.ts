import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { classifyEventKind } from '@hendingar/core/standing';
import { CATEGORY_SLUGS } from '@hendingar/core/taxonomy';
import { addDays } from '@hendingar/core/datetime';
import { parseListing, type ListingPage, type UpstreamItem } from '../src/api.ts';
import { SITES, listingUrl, siteBySlug } from '../src/sites.ts';
import {
	MAX_BREAK_DAYS,
	classifyCadence,
	mapListing,
	parseHeading,
	resolveDate,
	seriesKey
} from '../src/map.ts';

/**
 * Against the committed real page. No network, no clock (CLAUDE.md rule 6).
 */
const html = readFileSync(
	fileURLToPath(new URL('./fixtures/stord-kalender.html', import.meta.url)),
	'utf8'
);
const site = siteBySlug('stord-frivilligsentral')!;
const page = parseListing(html);
const mapped = mapListing(page, site);

const WEEKDAY_NB = ['Mandag', 'Tirsdag', 'Onsdag', 'Torsdag', 'Fredag', 'Lørdag', 'Søndag'];
const MONTH_NB = [
	'Januar',
	'Februar',
	'Mars',
	'April',
	'Mai',
	'Juni',
	'Juli',
	'August',
	'September',
	'Oktober',
	'November',
	'Desember'
];

/** An item exactly as `parseListing` would read it off the page for this date. */
function item(date: string, heading: string, place: string | null, pageYear = 2026): UpstreamItem {
	const [y, m, d] = date.split('-').map(Number);
	const weekday = (new Date(Date.UTC(y!, m! - 1, d!, 12)).getUTCDay() + 6) % 7;
	return {
		weekday: WEEKDAY_NB[weekday]!,
		day: d!,
		month: MONTH_NB[m! - 1]!,
		year: y === pageYear ? null : y!,
		heading,
		place,
		href: `/hendelse?x&Id=${date.replaceAll('-', '')}`
	};
}

/** Every `step` days from `start`, `count` times. */
function every(start: string, step: number, count: number): string[] {
	return Array.from({ length: count }, (_, i) => addDays(start, i * step));
}

function listing(items: UpstreamItem[], year = 2026): ListingPage {
	return { year, items, rejected: [] };
}

describe('SITES', () => {
	it('has unique slugs', () => {
		expect(new Set(SITES.map((s) => s.slug)).size).toBe(SITES.length);
	});
});

describe('parseListing', () => {
	it('reads every item the "Kommende" view shows', () => {
		expect(page.items).toHaveLength(674);
		expect(page.rejected).toEqual([]);
	});

	it('takes the current year from the footer, and the others from the item', () => {
		// The year is not a heading between groups: it is a fourth line on the item, printed only
		// when it is not the current year — and the footer is where the page says which that is.
		expect(page.year).toBe(2026);
		expect(page.items[0]).toEqual({
			weekday: 'Tirsdag',
			day: 6,
			month: 'Oktober',
			year: null,
			heading: '11.00 - 13.30: Eldretreff Buneset',
			place: 'Buneset 9',
			href: '/hendelse?eldretreff-buneset&Id=2286445'
		});
		expect(page.items.at(-1)).toMatchObject({ day: 14, month: 'August', year: 2030 });
		const years = new Set(page.items.map((i) => i.year));
		expect([...years]).toEqual([null, 2027, 2028, 2029, 2030]);
	});

	it('reads an item whose date block is hidden as a repeat of the one above', () => {
		// Second item on 6 October: its date block is `display:none`, and still in the markup.
		expect(page.items[1]).toMatchObject({
			weekday: 'Tirsdag',
			day: 6,
			month: 'Oktober',
			heading: '14.00 - 15.30: Middagsservering',
			place: 'Leirvikstova'
		});
	});

	it('refuses a page that is not the calendar', () => {
		expect(() => parseListing('<html><body>Vedlikehald</body></html>')).toThrow(/Kommende/);
		const noFooter = html.replace(/\d{4}\s*©/, '©');
		expect(() => parseListing(noFooter)).toThrow(/copyright year/);
	});
});

describe('parseHeading', () => {
	it('splits the times from the title, as wall clocks', () => {
		expect(parseHeading('11.00 - 13.30: Eldretreff Buneset')).toEqual({
			from: '11:00',
			to: '13:30',
			title: 'Eldretreff Buneset'
		});
		expect(parseHeading('9.15: Kaffi')).toEqual({ from: '09:15', to: null, title: 'Kaffi' });
	});

	it('reports a heading with no time, or an impossible one', () => {
		expect(parseHeading('Eldretreff Buneset')).toHaveProperty('problem');
		expect(parseHeading('25.00 - 26.00: Natt')).toHaveProperty('problem');
	});
});

describe('resolveDate', () => {
	it('uses the page year when the item states none, and the weekday to check it', () => {
		const tuesday = item('2026-10-06', 'x', null);
		expect(resolveDate(tuesday, 2026)).toEqual({ date: '2026-10-06', weekday: 2 });
		// The same item read with the wrong current year lands on a Wednesday, and says so.
		const wrong = resolveDate(tuesday, 2027);
		expect(wrong).toHaveProperty('problem');
		expect('problem' in wrong && wrong.problem).toMatch(/2027-10-06 is a onsdag/);
	});

	it('refuses a date that does not exist', () => {
		expect(resolveDate({ ...item('2026-11-30', 'x', null), day: 31 }, 2026)).toHaveProperty(
			'problem'
		);
	});
});

describe('classifyCadence', () => {
	it('calls seven-day gaps weekly', () => {
		expect(classifyCadence(every('2026-10-06', 7, 20))).toBe('weekly');
	});

	it('allows the weeks a weekly activity skips for holidays', () => {
		// Autumn term, a Christmas break of three weeks, spring term, a summer break of eight.
		const autumn = every('2026-10-06', 7, 11);
		const spring = every('2027-01-05', 7, 22);
		const next = every(addDays(spring.at(-1)!, MAX_BREAK_DAYS), 7, 10);
		expect(classifyCadence([...autumn, ...spring, ...next])).toBe('weekly');
	});

	it('rejects fortnightly, rather than calling it weekly or guessing its parity', () => {
		const result = classifyCadence(every('2026-10-06', 14, 12));
		expect(result).toEqual({ problem: 'irregular gaps between dates (14d×11)' });
	});

	it('rejects a break longer than a summer', () => {
		const a = every('2026-10-06', 7, 10);
		const b = every(addDays(a.at(-1)!, 63), 7, 30);
		expect(classifyCadence([...a, ...b])).toHaveProperty('problem');
	});

	it('rejects a slot that skips too many weeks to be weekly', () => {
		// Every other week with the odd single week between: half the gaps are seven days.
		const dates = ['2026-10-06', '2026-10-13', '2026-10-27', '2026-11-03', '2026-11-17'];
		expect(classifyCadence(dates)).toHaveProperty('problem');
	});
});

describe('mapListing, on the committed page', () => {
	it('groups 674 occurrences into exactly four weekly activities', () => {
		expect(mapped.failures).toEqual([]);
		expect(mapped.occurrences).toBe(674);
		expect(mapped.standing).toBe(4);
		expect(mapped.dated).toBe(0);
		expect(
			mapped.rows.map((r) => ({
				externalId: r.externalId,
				title: r.title,
				venue: r.venueName,
				hours: r.weeklyHours
			}))
		).toEqual([
			{
				externalId: 'eldretreff-buneset@buneset-9',
				title: 'Eldretreff Buneset',
				venue: 'Buneset 9',
				hours: { cadence: 'weekly', slots: [{ weekday: 2, from: '11:00', to: '13:30' }] }
			},
			{
				externalId: 'middagsservering@leirvikstova',
				title: 'Middagsservering',
				venue: 'Leirvikstova',
				hours: { cadence: 'weekly', slots: [{ weekday: 2, from: '14:00', to: '15:30' }] }
			},
			{
				externalId: 'eldretreff-paa-leirvikstova@bandadalsplassen-3',
				title: 'Eldretreff på Leirvikstova',
				venue: 'Bandadalsplassen 3',
				hours: { cadence: 'weekly', slots: [{ weekday: 3, from: '11:00', to: '13:30' }] }
			},
			{
				externalId: 'seniordata@leirvikstova',
				title: 'Seniordata',
				venue: 'Leirvikstova',
				hours: { cadence: 'weekly', slots: [{ weekday: 4, from: '11:00', to: '13:00' }] }
			}
		]);
	});

	it('runs each from its first occurrence to its last, resolved in Oslo time', () => {
		const buneset = mapped.rows.find((r) => r.title === 'Eldretreff Buneset')!;
		// 6 Oct 2026 11:00 is summer time (+02:00); 13 Aug 2030 13:30 likewise.
		expect(buneset.startsAt.toISOString()).toBe('2026-10-06T09:00:00.000Z');
		expect(buneset.endsAt?.toISOString()).toBe('2030-08-13T11:30:00.000Z');
		const seniordata = mapped.rows.find((r) => r.title === 'Seniordata')!;
		expect(seniordata.startsAt.toISOString()).toBe('2026-10-08T09:00:00.000Z');
		expect(seniordata.endsAt?.toISOString()).toBe('2029-05-03T11:00:00.000Z');
	});

	it('classifies every row standing, so none can land in a day list', () => {
		for (const row of mapped.rows) {
			expect(classifyEventKind(row.startsAt, row.endsAt)).toBe('standing');
		}
	});

	it('keeps the timetable a wall clock across the clock change', () => {
		// A winter Tuesday is 10:00Z and a summer one 09:00Z, and the timetable says 11:00 for both:
		// it is never resolved to an instant, so there is no offset in it to get wrong.
		const winter = mapListing(
			listing([
				item('2027-01-05', '11.00 - 13.30: Eldretreff Buneset', 'Buneset 9'),
				...every('2027-01-12', 7, 8).map((d) =>
					item(d, '11.00 - 13.30: Eldretreff Buneset', 'Buneset 9')
				)
			]),
			site
		);
		const row = winter.rows[0]!;
		expect(row.startsAt.toISOString()).toBe('2027-01-05T10:00:00.000Z');
		expect(row.weeklyHours?.slots).toEqual([{ weekday: 2, from: '11:00', to: '13:30' }]);
	});

	it('names the organiser and the place, links the listing, and uses the taxonomy', () => {
		for (const row of mapped.rows) {
			expect(row.organizerName).toBe('Stord Frivilligsentral');
			expect(row.sourceUrl).toBe(listingUrl(site));
			expect(CATEGORY_SLUGS).toContain(row.category);
		}
		expect(mapped.rows.find((r) => r.venueName === 'Buneset 9')?.venueStreet).toBe('Buneset 9');
		expect(mapped.rows.find((r) => r.venueName === 'Leirvikstova')?.venueStreet).toBeNull();
	});

	it('keeps every key when a week passes', () => {
		// The "Kommende" view drops what has passed. The keys must not move with it, or every week
		// would insert four new rows and abandon four old ones.
		const nextWeek = mapListing({ ...page, items: page.items.slice(4) }, site);
		expect(nextWeek.rows.map((r) => r.externalId)).toEqual(mapped.rows.map((r) => r.externalId));
		expect(nextWeek.rows[0]!.startsAt.toISOString()).toBe('2026-10-13T09:00:00.000Z');
	});
});

describe('mapListing, on shapes the page has not shown yet', () => {
	const weekly = every('2026-10-06', 7, 12).map((d) =>
		item(d, '11.00 - 13.30: Eldretreff Buneset', 'Buneset 9')
	);

	it('rejects a series whose gaps are not weekly, by name, and imports nothing of it', () => {
		const fortnightly = every('2026-10-08', 14, 8).map((d) =>
			item(d, '18.00 - 20.00: Strikkekafé', 'Leirvikstova')
		);
		const result = mapListing(listing([...weekly, ...fortnightly]), site);
		expect(result.rows.map((r) => r.title)).toEqual(['Eldretreff Buneset']);
		expect(result.failures).toEqual([
			{
				externalId: 'strikkekafe@leirvikstova',
				title: 'Strikkekafé',
				problem: 'torsdag 18:00–20:00: irregular gaps between dates (14d×7)'
			}
		]);
	});

	it('imports a one-off as a dated event, keyed on its day', () => {
		const result = mapListing(
			listing([...weekly, item('2026-12-15', '17.00 - 20.00: Julemiddag', 'Leirvikstova')]),
			site
		);
		const julemiddag = result.rows.find((r) => r.title === 'Julemiddag')!;
		expect(julemiddag).toMatchObject({
			externalId: 'julemiddag@leirvikstova@2026-12-15',
			weeklyHours: null,
			sourceUrl: 'https://stord.frivilligsentral.no/hendelse?x&Id=20261215'
		});
		expect(julemiddag.startsAt.toISOString()).toBe('2026-12-15T16:00:00.000Z');
		expect(classifyEventKind(julemiddag.startsAt, julemiddag.endsAt)).toBe('dated');
		expect(result.standing).toBe(1);
		expect(result.dated).toBe(1);
	});

	it('imports a short course as dated events, not a standing row', () => {
		const course = every('2026-10-07', 7, 3).map((d) =>
			item(d, '18.00 - 20.00: Mobilkurs', 'Leirvikstova')
		);
		const result = mapListing(listing(course), site);
		expect(result.standing).toBe(0);
		expect(result.rows.map((r) => r.externalId)).toEqual([
			'mobilkurs@leirvikstova@2026-10-07',
			'mobilkurs@leirvikstova@2026-10-14',
			'mobilkurs@leirvikstova@2026-10-21'
		]);
	});

	it('leaves a re-timed week as its own dated event beside the weekly row', () => {
		const special = item('2026-12-22', '12.00 - 15.00: Eldretreff Buneset', 'Buneset 9');
		const result = mapListing(listing([...weekly, special]), site);
		expect(result.rows.map((r) => [r.externalId, r.weeklyHours?.cadence ?? 'dated'])).toEqual([
			['eldretreff-buneset@buneset-9', 'weekly'],
			['eldretreff-buneset@buneset-9@2026-12-22', 'dated']
		]);
	});

	it('puts two weekly days of one activity on one row', () => {
		const tue = every('2026-10-06', 7, 10).map((d) => item(d, '18.00 - 19.00: Trim', 'Hallen'));
		const thu = every('2026-10-08', 7, 10).map((d) => item(d, '18.00 - 19.00: Trim', 'Hallen'));
		const result = mapListing(listing([...thu, ...tue]), site);
		expect(result.rows).toHaveLength(1);
		expect(result.rows[0]!.weeklyHours?.slots.map((s) => s.weekday)).toEqual([2, 4]);
		expect(result.rows[0]!.startsAt.toISOString()).toBe('2026-10-06T16:00:00.000Z');
	});

	it('reports an item whose printed weekday contradicts its date', () => {
		const lying = {
			...item('2026-10-06', '11.00 - 13.30: Eldretreff Buneset', 'Buneset 9'),
			weekday: 'Fredag'
		};
		const result = mapListing(listing([lying]), site);
		expect(result.rows).toEqual([]);
		expect(result.failures[0]?.problem).toMatch(/is a tysdag, the page says Fredag/);
	});
});

describe('seriesKey', () => {
	it('is title and place, and never a time', () => {
		expect(seriesKey('Eldretreff på Leirvikstova', 'Bandadalsplassen 3')).toBe(
			'eldretreff-paa-leirvikstova@bandadalsplassen-3'
		);
		expect(seriesKey('Seniordata', null)).toBe('seniordata');
	});
});
