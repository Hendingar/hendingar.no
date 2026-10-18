import type { CoveredMunicipality } from './coverage.ts';
import { normaliseTitle } from './similarity.ts';

/**
 * Which municipality a source's venue is in, where we know it and the source does not say.
 *
 * Most importers write `venues.municipality = null`, on purpose: what they can read is a post town
 * ("Bremnes", "Leirvik"), and a post town is not a municipality. So every room of Stord kulturhus
 * reached the site with no municipality at all — "elle melle" at Osvald Pub showed up on the
 * listing with no "· Stord" beside it, and a reader filtering on Stord never saw it.
 *
 * The house programmes do not say where their rooms are because, to them, it goes without saying.
 * This writes that down, the same way `venue-aliases.ts` writes down which building a room is in:
 * as a list, scoped to the source that writes the name, each entry with the reason we believe it.
 *
 * ## Room names two buildings share
 *
 * `Storsalen` and `Biblioteket` are written by both culture houses. They were once a single venue
 * row each — "Songlaget Stordabuen" and "Sauen Shaun" on one row, two buildings 40 km and a ferry
 * apart — and no municipality could be right for it. `venueSlugFor` in venue-aliases.ts now keys
 * each with the building its source means, so each building's row can be placed. An entry for a
 * shared name may only list sources that have an alias for it: a source without one writes the
 * plain, still-shared row, and placing that would be the old mistake again. A test enforces it.
 *
 * ## What is deliberately NOT here
 *
 * **Anything we could not place.** `Hagerupshuset` and `Ungdomshallen` are on the Stord kulturhus
 * programme, and the programme is not evidence of where a room is — the house programmes Stord
 * kyrkje too. Neither payload carries an address for them. A name we cannot verify stays null; a
 * wrong municipality is worse than none, because nothing downstream can tell it is wrong.
 *
 * Applied by the importers as fill-only (`coalesce`): a row another source already placed keeps
 * what it has.
 */
export type VenueMunicipality = {
	/** The venue name as these sources write it. Compared normalised, as in `venue-aliases.ts`. */
	name: string;
	municipality: CoveredMunicipality;
	/** The `sources.slug`s that write this name and mean this place. Never a wildcard. */
	sources: readonly string[];
	/** How we know. Written for whoever audits it. */
	evidence: string;
};

const STORD_HOUSE = ['stord-kulturhus', 'stord-aktivitetforalle'] as const;
const BOMLO_HOUSE = ['bomlo-kulturhus', 'bomlo-aktivitetforalle'] as const;

export const VENUE_MUNICIPALITIES: readonly VenueMunicipality[] = [
	{
		name: 'Storsalen',
		municipality: 'Stord',
		sources: [...STORD_HOUSE, 'stord-kino'],
		evidence: 'The main hall of Stord kulturhus, as venue-aliases.ts resolves it for these sources.'
	},
	{
		name: 'Storsalen',
		municipality: 'Bømlo',
		sources: [...BOMLO_HOUSE, 'bomlo-kino'],
		evidence: 'The main hall of Bømlo kulturhus, as venue-aliases.ts resolves it for these sources.'
	},
	{
		name: 'Biblioteket',
		municipality: 'Stord',
		sources: STORD_HOUSE,
		evidence: 'Stord bibliotek, inside Stord kulturhus — see venue-aliases.ts.'
	},
	{
		name: 'Biblioteket',
		municipality: 'Bømlo',
		sources: BOMLO_HOUSE,
		evidence: 'Bømlo folkebibliotek, inside Bømlo kulturhus — see venue-aliases.ts.'
	},
	{
		name: 'Litlesalen',
		municipality: 'Bømlo',
		sources: [...BOMLO_HOUSE, 'bomlo-kino'],
		evidence: "Bømlo kulturhus' second hall. No Stord source writes this name."
	},
	{
		name: 'Kulturhuskafeen',
		municipality: 'Bømlo',
		sources: BOMLO_HOUSE,
		evidence: 'The café of Bømlo kulturhus — its own events say so (venue-aliases.ts).'
	},
	{
		name: 'Foajéen',
		municipality: 'Bømlo',
		sources: BOMLO_HOUSE,
		evidence: 'The foyer of Bømlo kulturhus — its own events say so (venue-aliases.ts).'
	},
	{
		name: 'Stord kulturhus',
		municipality: 'Stord',
		sources: ['stord-kulturhus', 'stord-kino'],
		evidence: 'The building itself: Hamnegata 1, 5411 Stord. The fallback both programmes use.'
	},
	{
		name: 'Osvald Pub',
		municipality: 'Stord',
		sources: STORD_HOUSE,
		evidence:
			'The pub in Leirvik that Stord kulturhus programmes ("Salmar på Osvald", "elle melle"). Confirmed by the project owner.'
	},
	{
		name: 'Småsalen',
		municipality: 'Stord',
		sources: [...STORD_HOUSE, 'stord-kino'],
		evidence:
			'The small hall of Stord kulturhus — see `venue-aliases.ts`. Bømlo Kulturhus calls its second hall Litlesalen, so no Bømlo source writes this name.'
	},
	{
		name: 'Scene, Storsal',
		municipality: 'Stord',
		sources: ['stord-kulturhus'],
		evidence:
			"Stord kulturhus's main hall as its ticketing system writes it. A slug of its own, not the shared `storsalen` row."
	},
	{
		name: 'Vestibylen',
		municipality: 'Stord',
		sources: STORD_HOUSE,
		evidence: 'The foyer of Stord kulturhus — see `venue-aliases.ts`.'
	},
	{
		name: 'Symjehallen',
		municipality: 'Stord',
		sources: STORD_HOUSE,
		evidence:
			"Stord kulturhus's swimming hall, sold through the house's eBillett account. Bømlo's is written \"Bømlo Symjehall\", a different slug."
	},
	{
		name: 'Stord VGS konsertsal',
		municipality: 'Stord',
		sources: STORD_HOUSE,
		evidence: 'The concert hall at Stord vidaregåande skule in Leirvik — see `venue-aliases.ts`.'
	},
	{
		name: 'Stord kyrkje',
		municipality: 'Stord',
		sources: ['stord-kulturhus'],
		evidence: 'The parish church in Leirvik.'
	},
	{
		name: 'Leirvik bedehus',
		municipality: 'Stord',
		sources: ['stord-aktivitetforalle'],
		evidence: 'The portal gives its postnummer, 5416 Stord, on both rows that use it.'
	},
	{
		name: 'Leirvikstova',
		municipality: 'Stord',
		sources: ['stord-aktivitetforalle'],
		evidence:
			'The portal gives its address, Bandadalen 3, 5417 Stord; stord-frivilligsentral already places it in Stord.'
	},
	{
		name: 'Stord Hotell',
		municipality: 'Stord',
		sources: STORD_HOUSE,
		evidence: 'The hotel in Leirvik.'
	},
	{
		name: 'EPOS - Leirvik kai',
		municipality: 'Stord',
		sources: ['stord-kulturhus'],
		evidence: 'The quay in Leirvik, as the name says.'
	},
	{
		name: 'Shl. museum',
		municipality: 'Stord',
		sources: ['stord-kulturhus'],
		evidence: 'Sunnhordland museum, in Leirvik.'
	}
];

function key(source: string, name: string): string {
	return `${source.toLowerCase()} ${normaliseTitle(name)}`;
}

const bySourceAndName = new Map<string, CoveredMunicipality>(
	VENUE_MUNICIPALITIES.flatMap((entry) =>
		entry.sources.map((source) => [key(source, entry.name), entry.municipality] as const)
	)
);

/**
 * The municipality this source's venue is in, or null when it is not listed.
 *
 * Null for an unknown source too — a human submission names its own municipality, or the verifier
 * asks it to.
 */
export function knownVenueMunicipality(
	sourceSlug: string | null,
	venueName: string | null
): CoveredMunicipality | null {
	if (!sourceSlug || !venueName) return null;
	return bySourceAndName.get(key(sourceSlug, venueName)) ?? null;
}
