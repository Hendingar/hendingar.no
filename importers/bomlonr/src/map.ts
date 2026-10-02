import type { CategorySlug } from '@hendingar/core/taxonomy';
import type { UpstreamEvent } from './api.ts';
import { eventUrl, SITE } from './site.ts';

/**
 * Pure mapping: one listing row → our shape. No I/O, no clock, no randomness.
 */

export type MappedEvent = {
	externalId: string;
	title: string;
	category: CategorySlug;
	startsAt: Date;
	endsAt: Date | null;
	venueName: string | null;
	venueSlug: string | null;
	organizerName: string | null;
	organizerSlug: string | null;
	description: string | null;
	sourceUrl: string;
};

export type MapFailure = { externalId: string; title: string; problem: string };

export function isFailure(v: MappedEvent | MapFailure): v is MapFailure {
	return 'problem' in v;
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

/**
 * The instant, straight from the stamp.
 *
 * No zone resolution here, and that is the unusual part: this source publishes real UTC instants
 * rather than a wall clock with an offset bolted on, which `api.ts` records the evidence for. So
 * the right thing is to believe the stamp — the opposite call from `importers/mec`, where the
 * offset was a fiction and the clock on the page was the fact.
 */
export function toInstant(value: string | null | undefined): Date | null {
	if (!value) return null;
	const stamp = new Date(value.trim());
	return Number.isNaN(stamp.getTime()) ? null : stamp;
}

/**
 * A næringsråd's programme is meetings, with a conference or a course among them.
 *
 * Read off the title because nothing else in the payload says: there is no category field, and
 * every one of these is a gathering of some kind, so the default is honest rather than lazy.
 */
export function mapCategory(title: string): CategorySlug {
	const text = title.toLowerCase();
	if (text.includes('konferanse') || text.includes('konferansen')) return 'konferanse';
	if (text.includes('kurs')) return 'kurs';
	return 'mote';
}

/**
 * The venue, where the description states one in the form the organiser writes it.
 *
 * `Stad: Bømlo Kulturhus` appears on 14 of the 100 events and nowhere else in the payload — there
 * is no location field at all. Reading the line the organiser wrote for a human is the same move
 * `importers/mec` makes with the clock on the card: it is what the source shows, rather than what
 * we would have guessed.
 *
 * The host is NOT used for this. "Siemens Energy" hosting a frukostmøte is the organiser, and
 * writing it into `venues` would invent a place called Siemens Energy that nobody can visit.
 */
export function venueFrom(markdown: string | null | undefined): string | null {
	if (!markdown) return null;
	const line = /^\s*(?:\*\*)?\s*Stad:\s*(?:\*\*)?\s*(.+?)\s*(?:\*\*)?\s*$/m.exec(markdown);
	const value = line?.[1]?.replace(/\s+/g, ' ').trim();
	if (!value) return null;
	// A whole paragraph is not a place name: the line is meant to be short, and anything longer is
	// prose that happened to start with the word.
	return value.length <= 80 ? value : null;
}

export function mapEvent(input: UpstreamEvent): MappedEvent | MapFailure {
	const externalId = input.id.trim();
	const title = input.name.replace(/\s+/g, ' ').trim();

	if (!externalId) return { externalId: title, title, problem: 'no id on the listing row' };
	if (!title) return { externalId, title: '', problem: 'empty title' };

	const startsAt = toInstant(input.starttime);
	if (!startsAt) return { externalId, title, problem: `unusable starttime: ${input.starttime}` };

	const endRaw = toInstant(input.endtime);
	const endsAt = endRaw && endRaw.getTime() > startsAt.getTime() ? endRaw : null;

	const venueName = venueFrom(input.about?.markdown);
	const host = input.host?.name?.replace(/\s+/g, ' ').trim() || null;

	return {
		externalId,
		title,
		category: mapCategory(title),
		startsAt,
		endsAt,
		venueName,
		venueSlug: venueName ? slugifyVenue(venueName) : null,
		organizerName: host,
		organizerSlug: host ? slugifyVenue(host) : null,
		description: input.about?.markdown?.trim() || null,
		/*
		 * The event's own page, built from the slug the listing carries. Verified to resolve: the
		 * `/hendingar/<slug>` route answers 200 for a slug from this payload, and we are an index —
		 * a reader should land on the organiser's page, not on ours with no way back.
		 */
		sourceUrl: input.slug.trim() ? eventUrl(input.slug.trim()) : `${SITE.origin}/hendingar`
	};
}
