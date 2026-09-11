import type { CategorySlug } from '@hendingar/core/taxonomy';

/**
 * What a `map.ts` returns, and how a rejection is told apart from an event.
 *
 * `MapFailure` and `isFailure` were **byte-identical in all fifteen importers**, and every
 * `MappedEvent` opened with the same seven fields and closed with the same three. This is that
 * agreement written once. Per-source extras — `posterSrcset`, `venueAddress`, `municipality`,
 * `cancelled`, `detailUrl`, `organizerName` — compose onto the base with `&`.
 *
 * It lives here rather than in `packages/core` on purpose: core is schema, taxonomy and validation
 * (CLAUDE.md rule 1), and this is the importer contract. The shape an importer must ultimately
 * produce for the *database* is `importedEventSchema` in `@hendingar/core/validation`; this is the
 * shape it hands to the runner on the way there.
 */

export type MappedEventBase = {
	/** Stable per source. Never keyed on the start instant — see importers/mec/src/map.ts. */
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

export function isFailure<T>(v: T | MapFailure): v is MapFailure {
	return typeof v === 'object' && v !== null && 'problem' in v;
}
