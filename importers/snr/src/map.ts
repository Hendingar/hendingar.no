import { zonedWallClockToInstant } from '@hendingar/core/datetime';
import type { CategorySlug } from '@hendingar/core/taxonomy';
import type { UpstreamCard } from './api.ts';
import { eventUrl, SITE } from './site.ts';

/**
 * Pure mapping: one card → our shape. No I/O, no clock, no randomness.
 */

/**
 * Norwegian month names, both written forms.
 *
 * The cards say "januar" and "mars"; bokmål and nynorsk differ on exactly one of the twelve
 * ("mars" is the same, "oktober" is the same — it is `desember`/`desember` throughout), but the CMS
 * is editable and a hand-typed "Desember" with a capital letter is one mistake away. Matched
 * case-insensitively, and an unknown month is a refusal rather than a guess.
 */
const MONTHS: Record<string, number> = {
	januar: 1,
	februar: 2,
	mars: 3,
	april: 4,
	mai: 5,
	juni: 6,
	juli: 7,
	august: 8,
	september: 9,
	oktober: 10,
	november: 11,
	desember: 12
};

export function monthNumber(name: string): number | null {
	return MONTHS[name.trim().toLowerCase()] ?? null;
}

/**
 * `08:00 - 09:50` → the two wall clocks, or just the first.
 *
 * Both separators appear in the wild on this CMS — a hyphen and an en dash — and the end is
 * optional. Anything that is not a clock is dropped rather than interpreted.
 */
export function clocksFrom(time: string | null): { start: string | null; end: string | null } {
	if (!time) return { start: null, end: null };
	const found = [...time.matchAll(/\b(\d{1,2})[:.](\d{2})\b/g)].map(
		(m) => `${m[1]!.padStart(2, '0')}:${m[2]}`
	);
	return { start: found[0] ?? null, end: found[1] ?? null };
}

/**
 * A næringsråd's programme is meetings, with a conference or a course among them.
 *
 * Read off the title because the card carries no category of its own — the page's own filter only
 * knows "Frukostmøte".
 */
export function mapCategory(title: string): CategorySlug {
	const text = title.toLowerCase();
	if (text.includes('konferanse')) return 'konferanse';
	if (text.includes('kurs') || text.includes('seminar')) return 'kurs';
	return 'mote';
}

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

export type MappedEvent = {
	externalId: string;
	title: string;
	category: CategorySlug;
	startsAt: Date;
	endsAt: Date | null;
	venueName: string | null;
	venueSlug: string | null;
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
		const url = new URL(value.trim());
		return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : null;
	} catch {
		return null;
	}
}

/**
 * The key a card is stored under.
 *
 * The CMS's own id where the card has one — stable across re-timings, which is the whole point.
 * Where it has none (a `mailto:` sign-up rather than a page), the title and the day are the only
 * stable things the card carries, so the key is built from those: `t-<title>-<YYYY-MM-DD>`.
 *
 * Keyed on the DAY and never on the start instant, for the reason `importers/mec` records: moving
 * an event from 14:00 to 15:00 must update the row, not insert a second one beside it and abandon
 * the first. Moving it to another day does insert a new row, which is the cost of a source that
 * publishes no id at all — and the old row ages out of every listing on its own.
 */
export function externalIdFor(card: UpstreamCard, date: string): string {
	if (card.id) return card.id;
	return `t-${slugifyVenue(card.title).slice(0, 60)}-${date}`;
}

export function mapEvent(card: UpstreamCard): MappedEvent | MapFailure {
	const title = card.title.replace(/\s+/g, ' ').trim();
	if (!title) return { externalId: card.id, title: '', problem: 'empty title' };

	const month = monthNumber(card.month);
	if (!month) return { externalId: card.id, title, problem: `unknown month: ${card.month}` };

	const day = Number(card.day);
	if (!Number.isInteger(day) || day < 1 || day > 31) {
		return { externalId: card.id, title, problem: `unusable day: ${card.day}` };
	}

	const { start, end } = clocksFrom(card.time);
	const date = `${card.year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

	/*
	 * Resolved against the zone, never against an offset — because there is no offset to be had.
	 *
	 * The card states a wall clock and nothing else, which is the honest shape for a local calendar:
	 * "08:00" means eight in the morning in Stord whatever the clocks have done since. A fixed
	 * offset would be right for half the year.
	 */
	let startsAt: Date;
	try {
		startsAt = zonedWallClockToInstant(date, start ?? '00:00', SITE.timezone);
	} catch {
		return { externalId: card.id, title, problem: `unusable date: ${date} ${start ?? ''}` };
	}

	let endsAt: Date | null = null;
	if (end) {
		try {
			const candidate = zonedWallClockToInstant(date, end, SITE.timezone);
			// `18:00 - 23:59` is a real card. An end before the start would be a card that wrapped
			// past midnight, which this CMS has no way to express, so it is dropped rather than
			// guessed into the next day.
			endsAt = candidate.getTime() > startsAt.getTime() ? candidate : null;
		} catch {
			endsAt = null;
		}
	}

	const venueName = card.venue?.replace(/\s+/g, ' ').trim() || null;

	return {
		externalId: externalIdFor(card, date),
		title,
		category: mapCategory(title),
		startsAt,
		endsAt,
		venueName,
		venueSlug: venueName ? slugifyVenue(venueName) : null,
		/*
		 * The card's own picture, hotlinked.
		 *
		 * Uploaded by the næringsråd to their CMS, and the site states nothing about its licensing —
		 * an unstated right is not a granted one, so it is recorded unverified, exactly as every
		 * other imported poster is.
		 */
		posterUrl: safeUrl(card.imageUrl),
		posterRightsVerified: false,
		sourceUrl: card.query
			? eventUrl(card.query)
			: `${SITE.origin}/Arrayliste/aktiviteterliste/aktivitetskalender`
	};
}
