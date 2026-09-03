import { zonedWallClockToInstant } from '@hendingar/core/datetime';
import type { CategorySlug } from '@hendingar/core/taxonomy';
import type { KyrkjaInstance, RawEvent } from './api.ts';

/**
 * Pure mapping: parish calendar → our shape. No I/O, no clock, no randomness.
 */

/**
 * Everything here is church life unless the calendar says otherwise.
 *
 * The opposite default from the MEC importer, and for a reason: this is a parish council's own
 * calendar, so `kyrkjeliv` is a fact about the source rather than a guess about the event. Filing
 * a service under `anna` would be less accurate, not more cautious.
 */
export const DEFAULT_CATEGORY: CategorySlug = 'kyrkjeliv';

/**
 * `.calendar-label` is editorial and sparse — most events carry none — so this only overrides the
 * default where the parish has said something our taxonomy actually has a word for.
 */
const CATEGORY_BY_LABEL: Record<string, CategorySlug> = {
	konsert: 'musikk',
	musikk: 'musikk',
	kor: 'musikk',
	konferanse: 'konferanse',
	kurs: 'kurs',
	temakveld: 'mote',
	møte: 'mote',
	basar: 'marknad',
	utstilling: 'utstilling',
	teater: 'teater'
};

export function mapCategory(label: string): CategorySlug {
	const key = label.trim().toLowerCase();
	if (!key) return DEFAULT_CATEGORY;
	return CATEGORY_BY_LABEL[key] ?? DEFAULT_CATEGORY;
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

export function mapEvent(input: RawEvent, instance: KyrkjaInstance): MappedEvent | MapFailure {
	const externalId = input.occurrenceId;

	let startsAt: Date;
	try {
		/*
		 * The page prints a wall clock and never a zone: "06.09" and "kl.11.00". Constructing a
		 * Date from that would use the SERVER's zone, which is wrong for every deployment outside
		 * Norway and wrong twice a year inside it. `zonedWallClockToInstant` resolves it in the
		 * church's zone with a two-pass offset lookup so times near a DST boundary land correctly.
		 */
		startsAt = zonedWallClockToInstant(input.localDate, input.localTime, instance.timezone);
	} catch (error) {
		return {
			externalId,
			title: input.title,
			problem: `unusable date/time ${input.localDate} ${input.localTime}: ${
				error instanceof Error ? error.message : String(error)
			}`
		};
	}

	if (Number.isNaN(startsAt.getTime())) {
		return {
			externalId,
			title: input.title,
			problem: `unparseable date/time: ${input.localDate} ${input.localTime}`
		};
	}

	const venueName = input.location || instance.venueFallback;

	return {
		externalId,
		title: input.title,
		category: mapCategory(input.label),
		startsAt,
		// The calendar states a start and never an end. Inventing a duration would be inventing
		// data; a null end is the honest answer and the UI already handles it.
		endsAt: null,
		venueName,
		venueSlug: slugifyVenue(venueName),
		description: null,
		ctaUrl: null,
		posterUrl: null,
		posterRightsVerified: instance.posterRightsCleared,
		sourceUrl: input.href
	};
}
