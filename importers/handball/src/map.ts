import { zonedWallClockToInstant } from '@hendingar/core/datetime';
import { handballTitle } from '@hendingar/core/handball';
import type { CategorySlug } from '@hendingar/core/taxonomy';
import type { RawMatch } from './api.ts';
import { matchUrl, type HandballTeam } from './teams.ts';

/**
 * Pure mapping: one schedule row → our shape. No I/O, no clock, no randomness.
 */

export const CATEGORY: CategorySlug = 'sport';

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

/**
 * A home match, by the schedule's own team id.
 *
 * Unlike NFF's calendar, this feed says which side is at home as a number, so nothing is inferred
 * from a ground or from the order of names. The away matches — Bergen, Oslo, Florø — are a
 * Sunnhordland listing's business only in the sense that the team is away from it.
 */
export function isHomeMatch(match: RawMatch, team: HandballTeam): boolean {
	return match.homeTeamId === team.teamId;
}

/**
 * Listed upstream as a match that is going ahead.
 *
 * A cancelled or postponed match stays in the schedule with a flag, so it is not mapped — and
 * because the run then does not see it, the gone-upstream sweep takes it out of the listing. A
 * postponed match that gets a new date comes back under the same `matchId` and is restored and
 * re-timed in place.
 */
export function isGoingAhead(match: RawMatch): boolean {
	return !match.cancelled && !match.postponed;
}

/**
 * A match the schedule lists without a time yet — the last round of a season, typically.
 *
 * Not a failure: nothing changed shape, the time is simply not set. Counted apart from `rejected`
 * so that number keeps meaning "the source moved", and still counted as listed, so the sweep does
 * not take a match out of the listing for not having a time it never had.
 */
export function isUnscheduled(match: RawMatch): boolean {
	return match.matchStartTime == null;
}

/**
 * `1600` → `"16:00"`, or null for anything that is not a time of day.
 *
 * The schedule writes the start as an integer wall clock — `1400`, `930` for half past nine. It is
 * not an instant and carries no offset, so there is nothing for it to have got wrong in the way
 * CLAUDE.md warns about; it is resolved against the hall's zone like any other wall clock. And it
 * was checked against what handball.no shows a human: the team page prints "16:00" beside Stord –
 * Ros on 17.10.2026, the row the schedule gives as `1600`.
 */
export function clockFrom(value: number | null | undefined): string | null {
	if (value == null || !Number.isInteger(value) || value < 0) return null;
	const hours = Math.floor(value / 100);
	const minutes = value % 100;
	if (hours > 23 || minutes > 59) return null;
	return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

/** The short name, which is the one on the scoreboard — "BSI", not "Bsi - Bergen Studentidrettslag". */
function sideName(short: string | null | undefined, full: string): string {
	const trimmed = short?.trim();
	return trimmed || full.trim();
}

/**
 * What the card cannot say: the competition and round, and where to watch.
 *
 * "2. divisjon menn - 03, runde 1" is the line a reader does not otherwise get. The stream is
 * named because about half the home matches are on one, which is worth knowing for somebody who
 * cannot be in the hall; it is the provider's own name for it, not a link we vouch for.
 */
export function describe(match: RawMatch): string | null {
	const competition = match.tournamentName?.replace(/\s+/g, ' ').trim();
	const round = match.roundName?.trim();
	const stream = match.matchStream?.streamText?.trim();
	const first = [competition, round?.toLowerCase()].filter(Boolean).join(', ');
	// Sentences, not lines: the event page renders a description as one paragraph.
	const parts = [first ? `${first}.` : null, stream ? `Direktesending: ${stream}.` : null];
	const text = parts.filter(Boolean).join(' ');
	return text || null;
}

export type MappedEvent = {
	externalId: string;
	title: string;
	category: CategorySlug;
	startsAt: Date;
	endsAt: Date | null;
	venueName: string;
	venueSlug: string;
	description: string | null;
	ctaUrl: null;
	posterUrl: null;
	posterRightsVerified: false;
	sourceUrl: string;
};

export type MapFailure = { externalId: string; title: string; problem: string };

export function isFailure(v: MappedEvent | MapFailure): v is MapFailure {
	return 'problem' in v;
}

export function mapEvent(match: RawMatch, team: HandballTeam): MappedEvent | MapFailure {
	/*
	 * Keyed on handball.no's match id — never on the start, which CLAUDE.md is clear about: a
	 * re-timed match must update its row rather than insert a second one.
	 */
	const externalId = String(match.matchId);
	const title = handballTitle(
		team.club,
		sideName(match.awayTeamShortName, match.awayTeamName),
		team.team
	);

	const date = match.matchDate.slice(0, 10);
	const start = clockFrom(match.matchStartTime);
	if (!start) return { externalId, title, problem: `no start time (${match.matchStartTime})` };

	let startsAt: Date;
	try {
		startsAt = zonedWallClockToInstant(date, start, team.timezone);
	} catch {
		return { externalId, title, problem: `unusable date ${date} ${start}` };
	}

	const end = clockFrom(match.matchEndTime);
	const endRaw = end ? zonedWallClockToInstant(date, end, team.timezone) : null;
	const endsAt = endRaw && endRaw.getTime() > startsAt.getTime() ? endRaw : null;

	/*
	 * The usual hall by our spelling, so one hall is one venue row; anywhere else by the
	 * schedule's. "Stordhallen nye" is handball.no's name for the hall, and the "nye" is theirs
	 * to tell apart a hall that no longer exists.
	 */
	const venueName =
		match.venueUnitId === team.homeVenueUnitId
			? team.venueName
			: match.venueUnitName?.trim() || team.venueName;

	const url = matchUrl(match.matchId);
	return {
		externalId,
		title,
		category: CATEGORY,
		startsAt,
		endsAt,
		venueName,
		venueSlug: slugifyVenue(venueName),
		description: describe(match),
		/*
		 * No call to action. The event page labels this link "Billettar", and handball.no's match
		 * page sells none — the source link already takes a reader there, which is what it is for.
		 */
		ctaUrl: null,
		// The schedule carries no images, so there is nothing to have rights over.
		posterUrl: null,
		posterRightsVerified: false,
		sourceUrl: url
	};
}
