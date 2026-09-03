import { zonedWallClockToInstant } from '@hendingar/core/datetime';
import type { CategorySlug } from '@hendingar/core/taxonomy';
import type { IcalEvent } from './ical.ts';
import { teamUrl, type FotballTeam } from './teams.ts';

/**
 * Pure mapping: one VEVENT → our shape. No I/O, no clock, no randomness.
 */

/** Every fixture is a match. The feed carries nothing else. */
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
 * Is this a home match?
 *
 * A team's calendar is its whole season, home and away, and a listing for Sunnhordland has no
 * business advertising a Tuesday night in Nesttun. Matched on the ground rather than on which side
 * of the SUMMARY the team's name falls: the dash in "A - B" also appears inside club names
 * (Fløy-Flekkerøy), so splitting on it is a guess where the venue is a fact.
 */
export function isHomeMatch(event: IcalEvent, team: FotballTeam): boolean {
	const location = event.location?.replace(/\s+/g, ' ').trim();
	if (!location) return false;
	return team.homeGround.test(location);
}

/**
 * `20260321T140000` + `Europe/Oslo` → an instant.
 *
 * The feed names a zone rather than an offset, which is the correct way round and the reason this
 * cannot be `new Date(value)`. A fixture in March and one in July have different offsets from the
 * same zone, and the season crosses the change twice.
 */
export function toInstant(stamp: IcalEvent['start'], fallbackZone: string): Date | null {
	if (!stamp) return null;
	const match = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})/.exec(stamp.value);
	if (!match) return null;
	const [, y, mo, d, h, mi] = match;
	if (stamp.tzid === 'UTC' || stamp.value.endsWith('Z')) {
		return new Date(`${y}-${mo}-${d}T${h}:${mi}:00Z`);
	}
	try {
		return zonedWallClockToInstant(`${y}-${mo}-${d}`, `${h}:${mi}`, stamp.tzid ?? fallbackZone);
	} catch {
		return null;
	}
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
	ctaUrl: string | null;
	posterUrl: string | null;
	posterRightsVerified: boolean;
	sourceUrl: string;
};

export type MapFailure = { externalId: string; title: string; problem: string };

export function isFailure(v: MappedEvent | MapFailure): v is MapFailure {
	return 'problem' in v;
}

function safeUrl(value: string | null): string | null {
	if (!value) return null;
	try {
		const u = new URL(value);
		return u.protocol === 'http:' || u.protocol === 'https:' ? u.toString() : null;
	} catch {
		return null;
	}
}

/**
 * The competition and round, which the feed puts on the first line of DESCRIPTION.
 *
 * The rest repeats the fixture, the ground and the kick-off — all of which we already hold in
 * structured form, and all of which would read as duplication under a card that says the same
 * thing. "Menn NM-kvalifisering 2026/2027 (runde 1)" is the part a reader does not otherwise get.
 */
export function competitionFrom(description: string | null): string | null {
	if (!description) return null;
	const first = description.split('\n')[0]?.trim();
	return first || null;
}

/**
 * The match id, read out of the VEVENT's `URL`.
 *
 * **Not the UID.** NFF mints a fresh random UID on every request — three fetches of the same feed
 * a minute apart return three different sets — which makes the one property iCalendar reserves for
 * identity useless here, and actively dangerous: keying on it re-imports the whole season as new
 * events every single day. It cost two duplicate runs to notice, and it was only noticed because
 * running the ingest twice is a habit.
 *
 * `fiksId` is NFF's own match number. It is stable across fetches, unique per fixture, and it is
 * what the feed's own link points at.
 */
export function matchIdFrom(url: string | null): string | null {
	if (!url) return null;
	return /[?&]fiksId=(\d+)/i.exec(url)?.[1] ?? null;
}

export function mapEvent(event: IcalEvent, team: FotballTeam): MappedEvent | MapFailure {
	const title = event.summary?.replace(/\s+/g, ' ').trim() ?? '';
	const externalId = matchIdFrom(event.url) ?? '';

	if (!externalId) {
		return { externalId: title, title, problem: 'no fiksId in the VEVENT URL' };
	}
	if (!title) return { externalId, title: '', problem: 'no SUMMARY on the VEVENT' };

	const startsAt = toInstant(event.start, team.timezone);
	if (!startsAt) return { externalId, title, problem: `unusable DTSTART: ${event.start?.value}` };

	const endRaw = toInstant(event.end, team.timezone);
	const endsAt = endRaw && endRaw.getTime() > startsAt.getTime() ? endRaw : null;

	return {
		externalId,
		title,
		category: CATEGORY,
		startsAt,
		endsAt,
		/*
		 * From config, not from the feed.
		 *
		 * Every home fixture is at the same ground, and taking the feed's spelling would create a
		 * second venue row the day NFF writes "Stord Stadion" with a capital S — splitting one
		 * ground into two places on a map that has not been built yet.
		 */
		venueName: team.venueName,
		venueSlug: slugifyVenue(team.venueName),
		description: competitionFrom(event.description),
		/*
		 * The match page on fotball.no, which the feed itself links to. We do not fetch it — see
		 * the robots.txt note in teams.ts — but pointing a reader at it is what an index does.
		 */
		ctaUrl: safeUrl(event.url),
		// The feed carries no images, so there is nothing to have rights over.
		posterUrl: null,
		posterRightsVerified: false,
		sourceUrl: safeUrl(event.url) ?? teamUrl(team)
	};
}
