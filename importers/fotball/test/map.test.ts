import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { CATEGORY_SLUGS } from '@hendingar/core/taxonomy';
import { parseIcal, unescapeValue, unfold } from '../src/ical.ts';
import { TEAMS, feedUrl, teamBySlug, teamUrl } from '../src/teams.ts';
import {
	competitionFrom,
	isFailure,
	isHomeMatch,
	mapEvent,
	matchIdFrom,
	toInstant
} from '../src/map.ts';

/**
 * Against committed real feeds. No network, no clock (CLAUDE.md rule 6).
 */
const fixture = (name: string) =>
	readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)), 'utf8');

const stord = teamBySlug('stord-fotball')!;
const bremnes = teamBySlug('bremnes-fotball')!;
const stordFeed = parseIcal(fixture('stord-133860.ics'));
const bremnesFeed = parseIcal(fixture('bremnes-30365.ics'));

describe('unfold', () => {
	it('joins a folded value back together', () => {
		/*
		 * RFC 5545 folds a long line by inserting CRLF and a single space, and neither belongs to
		 * the value — so unfolding removes both. That is why the feed's `Fløy-Flek\n kerøy` is one
		 * club and not two words.
		 *
		 * Reading the file line by line without this truncates values, and LOCATION is what this
		 * importer filters on: a chopped ground silently turns a home match into an away one.
		 */
		expect(unfold('SUMMARY:Fløy-Flek\n kerøy')).toBe('SUMMARY:Fløy-Flekkerøy');
		expect(unfold('A:1\r\nB:2')).toBe('A:1\nB:2');
	});

	it('rejoins the real folded values in the committed feed', () => {
		const folded = stordFeed.find((e) => e.summary?.includes('Fløy-Flekkerøy'));
		expect(folded, 'the fixture must contain a folded value, or this guards nothing').toBeTruthy();
		for (const event of [...stordFeed, ...bremnesFeed]) {
			// A leftover fold shows up as a stray space mid-word or a lone continuation line.
			expect(event.location).not.toMatch(/\n/);
			expect(event.summary).not.toMatch(/\n/);
		}
	});

	it('leaves every real property line alone', () => {
		expect(unfold('A:1\nB:2')).toBe('A:1\nB:2');
	});
});

describe('unescapeValue', () => {
	it('turns the escapes the feed actually uses back into characters', () => {
		expect(unescapeValue('Treningskamper 2026 menn\\, NFF Rogaland')).toBe(
			'Treningskamper 2026 menn, NFF Rogaland'
		);
		expect(unescapeValue('one\\ntwo')).toBe('one\ntwo');
		expect(unescapeValue('a\;b')).toBe('a;b');
	});
});

describe('parseIcal', () => {
	it('reads every fixture in the committed feeds', () => {
		expect(stordFeed).toHaveLength(32);
		expect(bremnesFeed).toHaveLength(23);
	});

	it('reads the properties we depend on, on every event', () => {
		for (const event of [...stordFeed, ...bremnesFeed]) {
			expect(event.uid).toMatch(/^[0-9a-f-]{36}$/);
			expect(event.summary).toBeTruthy();
			expect(event.location).toBeTruthy();
			expect(event.start?.value).toMatch(/^\d{8}T\d{6}$/);
			// A named zone, not an offset. That is what makes the season's DST change survivable.
			expect(event.start?.tzid).toBe('Europe/Oslo');
		}
	});

	it('splits on the property colon, not on one inside a value', () => {
		// Every URL contains "https://" — a naive split on the first colon would lose the value.
		for (const event of stordFeed) {
			expect(event.url).toMatch(/^https:\/\/www\.fotball\.no\//);
		}
	});
});

describe('isHomeMatch', () => {
	it('keeps the home fixtures and drops the travelling', () => {
		const home = stordFeed.filter((e) => isHomeMatch(e, stord));
		expect(home).toHaveLength(13);
		expect(stordFeed.length - home.length).toBe(19);
		for (const event of home) expect(event.location).toMatch(/stord stadion/i);
	});

	it('matches a ground the feed spells without spaces', () => {
		// The feed writes "ScaleAQ Stadion" where a person writes "Scale AQ stadion".
		const home = bremnesFeed.filter((e) => isHomeMatch(e, bremnes));
		expect(home).toHaveLength(12);
		expect(isHomeMatch({ ...blank, location: 'Scale AQ Stadion' }, bremnes)).toBe(true);
		expect(isHomeMatch({ ...blank, location: 'ScaleAQ Stadion' }, bremnes)).toBe(true);
	});

	it('drops a fixture with no venue rather than assuming it is at home', () => {
		expect(isHomeMatch({ ...blank, location: null }, stord)).toBe(false);
		expect(isHomeMatch({ ...blank, location: '  ' }, stord)).toBe(false);
	});

	it('does not confuse one club’s ground for another’s', () => {
		for (const event of bremnesFeed) expect(isHomeMatch(event, stord)).toBe(false);
		for (const event of stordFeed) expect(isHomeMatch(event, bremnes)).toBe(false);
	});
});

const blank = {
	uid: 'u',
	summary: 's',
	description: null,
	location: null,
	url: null,
	start: null,
	end: null
};

describe('toInstant', () => {
	it('resolves the wall clock against the named zone, on both sides of the DST change', () => {
		// Same wall clock, different offsets — which is exactly what a fixed offset gets wrong.
		expect(
			toInstant({ value: '20260321T140000', tzid: 'Europe/Oslo' }, 'Europe/Oslo')!.toISOString()
		).toBe('2026-03-21T13:00:00.000Z');
		expect(
			toInstant({ value: '20260721T140000', tzid: 'Europe/Oslo' }, 'Europe/Oslo')!.toISOString()
		).toBe('2026-07-21T12:00:00.000Z');
	});

	it('handles the UTC form, which this feed does not use but a fixed one might', () => {
		expect(
			toInstant({ value: '20260321T140000Z', tzid: 'UTC' }, 'Europe/Oslo')!.toISOString()
		).toBe('2026-03-21T14:00:00.000Z');
	});

	it('returns null rather than an Invalid Date', () => {
		expect(toInstant(null, 'Europe/Oslo')).toBeNull();
		expect(toInstant({ value: 'neste vår', tzid: null }, 'Europe/Oslo')).toBeNull();
	});
});

describe('mapEvent', () => {
	const home = [
		...stordFeed.filter((e) => isHomeMatch(e, stord)).map((e) => [e, stord] as const),
		...bremnesFeed.filter((e) => isHomeMatch(e, bremnes)).map((e) => [e, bremnes] as const)
	];

	it('maps every home fixture without a rejection', () => {
		expect(home).toHaveLength(25);
		for (const [event, team] of home) {
			const mapped = mapEvent(event, team);
			expect(isFailure(mapped) ? mapped.problem : null).toBeNull();
		}
	});

	it('stores the ground from config, so one venue cannot become two', () => {
		for (const [event, team] of home) {
			const mapped = mapEvent(event, team);
			if (isFailure(mapped)) continue;
			expect(mapped.venueName).toBe(team.venueName);
			expect(mapped.category).toBe('sport');
			expect(CATEGORY_SLUGS).toContain(mapped.category);
		}
	});

	it('gives every home fixture a distinct, stable id', () => {
		const ids = home.map(([e, t]) => {
			const m = mapEvent(e, t);
			return isFailure(m) ? null : m.externalId;
		});
		expect(new Set(ids).size).toBe(ids.length);
	});

	it('links to the match page the feed itself points at', () => {
		const [event, team] = home[0]!;
		const mapped = mapEvent(event, team);
		if (isFailure(mapped)) throw new Error(mapped.problem);
		expect(mapped.sourceUrl).toMatch(/fotball\.no\/fotballdata\/kamp\/\?fiksId=\d+/);
		expect(mapped.externalId).toMatch(/^\d+$/);
	});

	it('rejects a fixture with no UID rather than keying on the title', () => {
		// Two clubs can meet twice in a season; the title alone is not an identity.
		const mapped = mapEvent(
			{ ...blank, uid: null, start: { value: '20260321T140000', tzid: 'Europe/Oslo' } },
			stord
		);
		expect(isFailure(mapped)).toBe(true);
	});

	it('rejects an unusable start', () => {
		expect(isFailure(mapEvent({ ...blank, start: null }, stord))).toBe(true);
	});
});

describe('matchIdFrom', () => {
	it('reads the fiksId out of a match URL', () => {
		expect(matchIdFrom('https://www.fotball.no/fotballdata/kamp/?fiksId=9009376')).toBe('9009376');
		expect(matchIdFrom('https://www.fotball.no/fotballdata/kamp/')).toBeNull();
		expect(matchIdFrom(null)).toBeNull();
	});
});

describe('competitionFrom', () => {
	it('keeps the competition line and drops the repetition below it', () => {
		/*
		 * The rest of DESCRIPTION repeats the fixture, the ground and the kick-off — all of which
		 * the card already shows in structured form.
		 */
		expect(
			competitionFrom(
				'Menn NM-kvalifisering 2026/2027 (runde 1)\n\nBremnes - Varegg\nScaleAQ Stadion lørdag'
			)
		).toBe('Menn NM-kvalifisering 2026/2027 (runde 1)');
		expect(competitionFrom(null)).toBeNull();
	});

	it('produces a competition for every real home fixture', () => {
		for (const event of stordFeed.filter((e) => isHomeMatch(e, stord))) {
			expect(competitionFrom(event.description)).toBeTruthy();
		}
	});
});

describe('teams', () => {
	it('gives every team a distinct slug and fiksId', () => {
		expect(new Set(TEAMS.map((t) => t.slug)).size).toBe(TEAMS.length);
		expect(new Set(TEAMS.map((t) => t.fiksId)).size).toBe(TEAMS.length);
	});

	it('builds the feed URL, never a page URL, as the endpoint', () => {
		expect(feedUrl(stord)).toBe(
			'https://www.fotball.no/footballapi/Calendar/GetCalendar?teamId=133860'
		);
		expect(teamUrl(bremnes)).toContain('fiksId=30365');
	});
});
