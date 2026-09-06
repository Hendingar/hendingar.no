import { normaliseTitle } from './similarity.ts';

/**
 * What a source calls a place, and what the place is.
 *
 * Consolidation corroborates a generic title with the venue, and that only works while two sources
 * describing one place write something recognisably alike. They do not. A venue's own programme
 * names the **room**; everybody else names the **building**:
 *
 *   Riksteatret: Apestjernen   detskjer-sunnhordland  "Stord kulturhus"   26 Oct 18:00
 *   Riksteatret: Apestjernen   stord-kulturhus        "Storsalen"         26 Oct 18:00
 *
 * Same show, same minute, two calendars — and `Storsalen` shares not one letter with
 * `Stord kulturhus`, so no string rule can join them. Measured on the live database (788 events,
 * 22 sources): four venue rows are the same building, `Storsalen` (50 events),
 * `Stord kulturhus` (25), `Scene, Storsal` (2) and `Biblioteket Stord Kulturhus` (1), and none of
 * the four is geocoded, so geography cannot corroborate anything either. The only honest thing
 * left is to write down what we know.
 *
 * ## Why every entry names a source
 *
 * Because a room name is not unique, and the database proves it rather than merely suggesting it.
 * `Storsalen` is one `venues` row carrying events from **two** sources — `stord-kulturhus`, where
 * it is the main hall of Stord kulturhus, and `bomlo-aktivitetforalle`, where it is the main hall
 * of Bømlo Kulturhus, a different building in a different municipality. A list keyed on the name
 * alone would state that Bømlo's main hall is in Stord, and the next Riksteatret tour that plays
 * both halls the same evening would have one of the two performances quietly deleted.
 *
 * Keyed on `(source, name)` there is no such claim: it says only what *this* calendar means by
 * that word, which is the thing we can actually check.
 *
 * ## Why a list, and what it costs
 *
 * A list has to be maintained, and when a source invents a room name nobody has written down the
 * failure is silent — the event simply appears twice, which is the bug we started with. That is
 * the honest trade, and it is the right way round: the alternative (guessing that unlike names are
 * the same place) fails by *hiding* an event, and a hidden event is a worse product than a
 * repeated one. To keep the gap audible rather than silent, `pnpm consolidate` ends by printing
 * every venue pair that refused an otherwise-matching title, commonest first — see
 * `scripts/consolidate.ts`. Two churches on that report are correct and should stay; a hall and
 * the building it stands in want an entry adding here.
 *
 * Every entry below was verified against the live database — either the same title at the same
 * minute already merges under the other name, or the event's own description says which building
 * it is in. Nothing here is inferred from a name alone.
 */
export type VenueAlias = {
	/** The `sources.slug` that writes this name. Never a wildcard — see above. */
	source: string;
	/** The venue name as that source writes it. Compared normalised, so case and punctuation vary freely. */
	name: string;
	/**
	 * The place it actually is, written the way the *other* sources write it.
	 *
	 * A plain name rather than an id, so it flows straight into the same venue comparison every
	 * unaliased row goes through: `Storsalen` becomes `Stord kulturhus` and then still has to score
	 * against `Stord Kulturhus` on its merits. Resolution supplies knowledge, it does not bypass
	 * the check.
	 */
	place: string;
	/** How we know. Written for whoever audits a merge, not for us. */
	evidence: string;
};

export const VENUE_ALIASES: readonly VenueAlias[] = [
	/*
	 * Stord kulturhus — the house's own programme names its halls.
	 *
	 * Eight groups already merge across `Storsalen` and `Stord kulturhus` today, but only because
	 * those titles happen to run to four words or more and are therefore believed without the
	 * venue. The short ones — "Riksteatret: Apestjernen", "Grand Kiev: Svanesjøen" — are the ones
	 * that fall through, which is the whole defect.
	 */
	{
		source: 'stord-kulturhus',
		name: 'Storsalen',
		place: 'Stord kulturhus',
		evidence:
			'"Claus Sellevoll - Heim til meg", "Flåklypa Grand Prix in Concert" and six more already merge across Storsalen and Stord kulturhus on a distinctive title alone.'
	},
	{
		source: 'stord-kulturhus',
		name: 'Scene, Storsal',
		place: 'Stord kulturhus',
		evidence: 'The same hall as Storsalen, written by the ticketing system rather than the site.'
	},
	{
		source: 'stord-kulturhus',
		name: 'Småsalen',
		place: 'Stord kulturhus',
		evidence: 'The small hall, paired with Storsalen in the house programme.'
	},
	{
		source: 'stord-kulturhus',
		name: 'Vestibylen',
		place: 'Stord kulturhus',
		evidence: 'The foyer of the same building.'
	},
	{
		source: 'stord-kulturhus',
		/*
		 * The library is inside Stord kulturhus, but it resolves to `Stord bibliotek` and not to the
		 * building. That is deliberate: `detskjer-sunnhordland` lists exactly the same story hours
		 * as "Stord bibliotek", and five groups — "Lytt & prat - ei sosial lesestund" among them —
		 * already merge that pair on a distinctive title. Resolving to the building instead would
		 * score 0.33 against "Stord bibliotek" and merge nothing, while inviting a story hour to be
		 * confused with a concert in Storsalen.
		 */
		name: 'Biblioteket',
		place: 'Stord bibliotek',
		evidence:
			'Five groups already merge Biblioteket with Stord bibliotek; the unmerged remainder is the same weekly programme (Musikkleik, Bok & bolle, Språkkafé, Lesesona) at the identical minute.'
	},
	{
		source: 'detskjer-sunnhordland',
		name: 'Biblioteket Stord Kulturhus',
		place: 'Stord bibliotek',
		evidence:
			'The library named by the building it sits in. Without this it scores 0.67 against "Stord kulturhus" and could corroborate a story hour against a concert.'
	},
	{
		source: 'stord-kulturhus',
		name: 'Stord VGS konsertsal',
		place: 'Stord vidaregåande skule',
		evidence:
			'"Ulven (og geitekillingane)" 16 Oct 18:00 here is "Ulven (og geitekillingene)" at "Stord vidaregåande skule" in detskjer-sunnhordland at the same minute.'
	},
	{
		source: 'bomlo-aktivitetforalle',
		name: 'Stord VGS',
		place: 'Stord vidaregåande skule',
		evidence: 'The same school, abbreviated.'
	},

	/*
	 * Bømlo Kulturhus — the municipal activity calendar names its rooms the same way, and reuses
	 * two of the same words. This is the pair that makes source scoping non-negotiable.
	 */
	{
		source: 'bomlo-aktivitetforalle',
		name: 'Storsalen',
		place: 'Bømlo Kulturhus',
		evidence:
			'"Teater Vestland: Gubben og katten og nissemaskina" 9 Dec 18:00 in Storsalen is the same performance fjordnorway-sunnhordland lists at "Bømlo Kulturhus"; the two already merge on the distinctive title.'
	},
	{
		source: 'bomlo-aktivitetforalle',
		name: 'Litlesalen',
		place: 'Bømlo Kulturhus',
		evidence: 'The second cinema hall, running the same film programme as Storsalen.'
	},
	{
		source: 'bomlo-aktivitetforalle',
		name: 'Kulturhuskafeen',
		place: 'Bømlo Kulturhus',
		evidence:
			'Its own events say so: "Velkomen til ei stemningsfull konsert- og pubkveld i Kulturhuskafeen!"'
	},
	{
		source: 'bomlo-aktivitetforalle',
		name: 'Foajéen',
		place: 'Bømlo Kulturhus',
		evidence: 'Its own events say so: "musikalsk pubkveld i foajéen i Bømlo kulturhus".'
	}
];

/**
 * `source normalised name` → the place. Built once; the list is small and never changes at
 * runtime, and `comparePair` asks this question for every candidate pair in a time window.
 */
const bySourceAndName = new Map<string, string>(
	VENUE_ALIASES.map((alias) => [key(alias.source, alias.name), alias.place])
);

function key(source: string, name: string): string {
	return `${source.toLowerCase()} ${normaliseTitle(name)}`;
}

/**
 * What this source means by this venue name.
 *
 * Returns the name unchanged when nothing is listed — including when the source is unknown, which
 * is the case for a human submission. A person typing "Storsalen" into the form has not told us
 * which town's Storsalen they mean, and guessing on their behalf is exactly the merge that would
 * hide someone's event.
 */
export function resolveVenueName(sourceSlug: string | null, venueName: string): string {
	if (!sourceSlug) return venueName;
	return bySourceAndName.get(key(sourceSlug, venueName)) ?? venueName;
}
