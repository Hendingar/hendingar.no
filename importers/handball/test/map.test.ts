import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { formatEventTime } from '@hendingar/core/datetime';
import { parseHandballMatch } from '@hendingar/core/handball';
import { platformOf } from '@hendingar/core/directory';
import { parseSchedule, seasonIdFrom, type RawMatch } from '../src/api.ts';
import { TEAMS, scheduleUrl, teamBySlug } from '../src/teams.ts';
import {
	clockFrom,
	describe as describeMatch,
	isFailure,
	isGoingAhead,
	isHomeMatch,
	isUnscheduled,
	mapEvent,
	type MappedEvent
} from '../src/map.ts';

/**
 * Against committed real responses. No network, no clock (CLAUDE.md rule 6).
 *
 * The team-page fixtures are cut down to the one element that names the season: the whole page
 * also embeds the squad with birth dates, which has no business in a public repository.
 */
const read = (name: string) =>
	readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)), 'utf8');

const menn = teamBySlug('handball-stord-menn')!;
const kvinner = teamBySlug('handball-stord-kvinner')!;
const mennSchedule = parseSchedule(JSON.parse(read('terminliste-854678.json')));
const kvinnerSchedule = parseSchedule(JSON.parse(read('terminliste-225155.json')));

function mapped(match: RawMatch, team = menn): MappedEvent {
	const result = mapEvent(match, team);
	if (isFailure(result)) throw new Error(result.problem);
	return result;
}

const byId = (id: number) => mennSchedule.matches.find((m) => m.matchId === id)!;

describe('teams', () => {
	it('are grouped under the handball platform on /kjelder', () => {
		for (const team of TEAMS) expect(platformOf(team.slug)?.slug).toBe('handball');
	});

	it('have unique slugs and team ids', () => {
		expect(new Set(TEAMS.map((t) => t.slug)).size).toBe(TEAMS.length);
		expect(new Set(TEAMS.map((t) => t.teamId)).size).toBe(TEAMS.length);
	});
});

describe('seasonIdFrom', () => {
	it('reads the season the team page hands its schedule widget', () => {
		expect(seasonIdFrom(read('lag-854678.html'), menn)).toBe(201068);
		expect(seasonIdFrom(read('lag-225155.html'), kvinner)).toBe(201068);
		expect(scheduleUrl(menn, 201068)).toBe(
			'https://www.handball.no/api/AjaxData/TerminListeForTeam?id=854678&seasonId=201068'
		);
	});

	it('does not take another team’s season, or invent one', () => {
		expect(seasonIdFrom(read('lag-854678.html'), kvinner)).toBeNull();
		expect(seasonIdFrom('<html></html>', menn)).toBeNull();
	});
});

describe('parseSchedule', () => {
	it('validates every row of both committed seasons', () => {
		expect(mennSchedule.rejected).toEqual([]);
		expect(kvinnerSchedule.rejected).toEqual([]);
		expect(mennSchedule.matches).toHaveLength(23);
		expect(kvinnerSchedule.matches).toHaveLength(22);
	});

	it('reports a row that changed shape instead of losing the season', () => {
		const parsed = parseSchedule({ matches: [{ matchId: 'x' }, ...mennSchedule.matches] });
		expect(parsed.rejected).toHaveLength(1);
		expect(parsed.matches).toHaveLength(23);
	});

	it('refuses a body that is not a schedule', () => {
		expect(() => parseSchedule({ title: 'Method Not Allowed', status: 405 })).toThrow();
	});
});

describe('isHomeMatch', () => {
	it('keeps the home matches by team id, in both seasons', () => {
		expect(mennSchedule.matches.filter((m) => isHomeMatch(m, menn))).toHaveLength(12);
		expect(kvinnerSchedule.matches.filter((m) => isHomeMatch(m, kvinner))).toHaveLength(11);
	});

	it('every home match is at Stordhallen, and no away match is', () => {
		for (const [schedule, team] of [
			[mennSchedule, menn],
			[kvinnerSchedule, kvinner]
		] as const) {
			for (const m of schedule.matches) {
				if (m.venueUnitId == null) continue;
				expect(m.venueUnitId === team.homeVenueUnitId).toBe(isHomeMatch(m, team));
			}
		}
	});
});

describe('clockFrom', () => {
	it('reads the integer wall clock', () => {
		expect(clockFrom(1600)).toBe('16:00');
		expect(clockFrom(930)).toBe('09:30');
		expect(clockFrom(0)).toBe('00:00');
	});

	it('refuses what is not a time of day', () => {
		expect(clockFrom(null)).toBeNull();
		expect(clockFrom(2460)).toBeNull();
		expect(clockFrom(1275)).toBeNull();
		expect(clockFrom(-1)).toBeNull();
	});
});

describe('mapEvent', () => {
	it('maps Stord – Ros as the clock handball.no prints beside it', () => {
		const event = mapped(byId(8386260));
		expect(event.externalId).toBe('8386260');
		expect(event.title).toBe('Handball: Stord - Ros (menn)');
		// The team page shows "16:00" for this match on 17.10.2026; CEST, so 14:00Z.
		expect(event.startsAt.toISOString()).toBe('2026-10-17T14:00:00.000Z');
		expect(event.endsAt?.toISOString()).toBe('2026-10-17T15:15:00.000Z');
		expect(formatEventTime(event.startsAt, 'Europe/Oslo')).toContain('16:00');
		expect(event.venueName).toBe('Stordhallen');
		expect(event.venueSlug).toBe('stordhallen');
		expect(event.sourceUrl).toBe('https://www.handball.no/system/kamper/kamp/?matchid=8386260');
		expect(event.ctaUrl).toBeNull();
		expect(event.category).toBe('sport');
	});

	it('resolves a winter match against winter time, not the offset of the day it was read', () => {
		// 7 February 2027 is CET: 14:00 in Stord is 13:00Z.
		const event = mapped(mennSchedule.matches.find((m) => m.matchDate.startsWith('2027-02-07'))!);
		expect(event.startsAt.toISOString()).toBe('2027-02-07T13:00:00.000Z');
	});

	it('names the opponent by its short name, the one on the scoreboard', () => {
		expect(mapped(byId(8386228)).title).toBe('Handball: Stord - BSI (menn)');
	});

	it('writes a title the card reads back as the same match', () => {
		for (const [schedule, team] of [
			[mennSchedule, menn],
			[kvinnerSchedule, kvinner]
		] as const) {
			for (const m of schedule.matches.filter((x) => isHomeMatch(x, team) && !isUnscheduled(x))) {
				const parsed = parseHandballMatch(mapped(m, team).title);
				expect(parsed?.home.club).toBe('Stord');
				expect(parsed?.team).toBe(team.team);
			}
		}
	});

	it('describes the competition, the round and the stream', () => {
		expect(describeMatch(byId(8386260))).toBe(
			'2. divisjon menn - 03, runde 5. Direktesending: MyGame.'
		);
		expect(describeMatch(byId(8448768))).toBe('NM Senior menn, runde 2.');
	});

	it('keys on the match id, so a re-timed match updates in place', () => {
		const match = byId(8386260);
		const moved = mapped({ ...match, matchStartTime: 1800, matchDate: '2026-10-18T00:00:00' });
		expect(moved.externalId).toBe(mapped(match).externalId);
	});

	it('keeps the hall the schedule names when a home match is moved', () => {
		const moved = mapped({ ...byId(8386260), venueUnitId: 1, venueUnitName: 'Fitjarhallen' });
		expect(moved.venueName).toBe('Fitjarhallen');
	});
});

describe('the matches a run sets aside', () => {
	it('has one home match without a time yet, which is not a failure', () => {
		const pending = kvinnerSchedule.matches.filter(
			(m) => isHomeMatch(m, kvinner) && isUnscheduled(m)
		);
		expect(pending.map((m) => m.matchDate.slice(0, 10))).toEqual(['2027-04-10']);
	});

	it('does not import a cancelled or postponed match', () => {
		const match = byId(8386260);
		expect(isGoingAhead(match)).toBe(true);
		expect(isGoingAhead({ ...match, cancelled: true })).toBe(false);
		expect(isGoingAhead({ ...match, postponed: true })).toBe(false);
	});
});
