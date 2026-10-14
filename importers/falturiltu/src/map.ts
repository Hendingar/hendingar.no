import { zonedWallClockToInstant } from '@hendingar/core/datetime';
import type { CategorySlug } from '@hendingar/core/taxonomy';
import { excerptText, type Card, type Item } from './api.ts';
import { SITE } from './site.ts';

/**
 * Pure mapping: one programme card (and its REST item, if any) → our shape.
 * No I/O, no clock, no randomness.
 */

export type MappedEvent = {
	externalId: string;
	title: string;
	category: CategorySlug;
	startsAt: Date;
	venueName: string | null;
	venueSlug: string | null;
	description: string | null;
	ctaUrl: string | null;
	sourceUrl: string;
};

export type MapFailure = { externalId: string; title: string; problem: string };

/** Not an error: a card that is something to buy rather than somewhere to be. */
export type Skip = { externalId: string; title: string; skip: string };

export function isFailure(v: MappedEvent | MapFailure | Skip): v is MapFailure {
	return 'problem' in v;
}

export function isSkip(v: MappedEvent | MapFailure | Skip): v is Skip {
	return 'skip' in v;
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

/** `program_item_cat` 23 is "Seminar". Everything else is the festival's own programme. */
const SEMINAR = 23;

export function mapCategory(item: Item | undefined): CategorySlug {
	return item?.program_item_cat.includes(SEMINAR) ? 'konferanse' : 'festival';
}

/** The path segment of the event's own page — the WordPress slug, stable across edits. */
export function slugOf(link: string): string {
	return link.replace(/\/+$/, '').split('/').pop() ?? link;
}

const DATE = /^(\d{4}-\d{2}-\d{2})(?:\s+(\d{1,2}):(\d{2}))?$/;
const CLOCK = /^(\d{1,2})[:.](\d{2})$/;

/**
 * When it starts, resolved against the venue's zone.
 *
 * The card states the moment twice: `<time datetime="2026-11-05 9:50">` and the "9:50" printed
 * beside it. Neither carries an offset, so both are wall clocks — and the printed one is what a
 * reader acts on, so it wins where they disagree (CLAUDE.md, "A source's stated offset is not
 * evidence"). On today's programme they agree on all sixteen timed cards.
 *
 * Returns the date alone when the card has no clock: that is the festival pass, which is valid
 * for the whole week and is not an event.
 */
export function startOf(card: Card): { date: string; instant: Date | null } | null {
	const stamp = DATE.exec(card.datetime);
	if (!stamp?.[1]) return null;
	const date = stamp[1];
	const shown = card.clock ? CLOCK.exec(card.clock) : null;
	const hour = shown?.[1] ?? stamp[2];
	const minute = shown?.[2] ?? stamp[3];
	if (hour === undefined || minute === undefined) return { date, instant: null };
	return {
		date,
		instant: zonedWallClockToInstant(date, `${hour.padStart(2, '0')}:${minute}`, SITE.timezone)
	};
}

export function mapCard(card: Card, item: Item | undefined): MappedEvent | MapFailure | Skip {
	const slug = slugOf(card.link);
	const title = card.title;
	const start = startOf(card);
	if (!start) return { externalId: slug, title, problem: `unusable datetime: ${card.datetime}` };
	if (!start.instant)
		return { externalId: slug, title, skip: 'no clock time (a pass, not an event)' };

	const venueName = card.venue;
	return {
		/*
		 * Keyed on the day, not the instant (CLAUDE.md): a corrected clock then updates the row in
		 * place instead of abandoning it and inserting a second.
		 */
		externalId: `${slug}@${start.date}`,
		title,
		category: mapCategory(item),
		startsAt: start.instant,
		venueName,
		venueSlug: venueName ? slugifyVenue(venueName) : null,
		description: excerptText(item),
		ctaUrl: card.ticketUrl,
		sourceUrl: card.link
	};
}
