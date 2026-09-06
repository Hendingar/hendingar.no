/**
 * The allevents.in organisers we import from.
 *
 * allevents.in is a global event directory. It is **not** a source we would ever import wholesale —
 * that would drop a few million rows from every continent into a Sunnhordland listing. What it is
 * good for is the organiser page: a local club that publishes on Facebook usually has an
 * allevents.in mirror of exactly its own programme, and that mirror is openly readable without a
 * login, which the Facebook page is not (see `docs/event-sources.md` on why we never import from
 * Facebook directly).
 *
 * So this is a **platform importer with the organisers as data**, the same argument as
 * `importers/billetto`, `importers/mec` and `importers/bakhagen`: adding the next allevents.in
 * organiser is an entry in `ORGANISERS`, not a new package.
 *
 * ## Finding the organiser id
 *
 * It is the trailing number in the profile URL — `allevents.in/org/<slug>/<organiserId>` — and it
 * is what the events endpoint filters on. The slug is decorative and may contain non-ASCII
 * (`/org/flow-yoga-bømlo/28105398`); the number is the identity.
 *
 * ## Locality: the organiser list *is* the filter
 *
 * We do not draw a bounding box around Sunnhordland. Each entry here is a local organiser chosen by
 * hand, and their programme is their programme: Stord Jazzklubb's list already spans Stord Kulturhus
 * and Stord Hotell, and the city segment allevents.in puts in an event URL is its own guess (it
 * files a Stord Hotell concert under `/haugesund/` and another under `/Ølen/`), so it is no signal
 * at all. A geo box drawn from those coordinates would quietly drop a real concert the first time a
 * club booked a hall a kilometre outside it, and a dropped event is invisible in a way a wrong one
 * is not.
 *
 * The one guard we do apply is the country — see `EXPECTED_COUNTRY` in `map.ts`. A local club
 * listing a members' trip to Copenhagen is not something a Sunnhordland index should carry, and the
 * country is the only part of the address allevents.in states reliably.
 */
export type AlleventsOrganiser = {
	/** Our `sources.slug`. Stable — changing it orphans every imported event. */
	slug: string;
	/** The organiser as they call themselves, which is who the events belong to. */
	name: string;
	/**
	 * allevents.in's own numeric id for the organiser: the last segment of the profile URL, and the
	 * `organizer_id` the events endpoint takes.
	 */
	organiserId: number;
	/** The profile path, `org/<slug>/<id>`, kept whole so the attribution link is exact. */
	path: string;
	region: string;
	timezone: string;
	/**
	 * Used when the source gives an address where a venue name should be — see `venueNameFrom` in
	 * `map.ts`. Flow Yoga's events name no hall at all, only "Hollundsdalen 49, 5430 Bremnes", and
	 * a venue slugged from a street number would never consolidate against the same place named
	 * plainly by another source.
	 */
	venueFallback: string;
	scheduleCron: string;
	iconUrl: string | null;
	/**
	 * Whether imports publish directly.
	 *
	 * True, and the reasoning is worth recording because the first instinct here was the opposite.
	 * An allevents.in profile is mirrored from a Facebook page by a third party and the mirror is
	 * visibly lossy — truncated descriptions, an empty city, `addressRegion: "RO"` for Norway — which
	 * argues for landing events as `pending`.
	 *
	 * It does not survive contact with what `pending` actually means for an *imported* event. No
	 * importer calls the verifier (ADR 0004 keeps them deterministic), no scheduled job promotes an
	 * imported row, and ADR 0012 removed the review queue the `trusted` column's comment still points
	 * at. Every listing filters on `status = 'published'`, and `expire-submissions.ts` only touches
	 * rows with a `submissionOutcome`. A `pending` import is therefore invisible forever, on a source
	 * whose runs report healthy — the worst failure available, because it looks like it works.
	 *
	 * So the quality concern is answered where it can act: in `map.ts`, which refuses a record rather
	 * than importing a bad one. A skipped row with a reason in the run summary is visible; a pending
	 * row is not.
	 */
	trusted: boolean;
};

export const ORGANISERS: readonly AlleventsOrganiser[] = [
	{
		slug: 'allevents-stord-jazzklubb',
		name: 'Stord Jazzklubb',
		organiserId: 13511894,
		path: 'org/stord-jazzklubb/13511894',
		region: 'Sunnhordland',
		timezone: 'Europe/Oslo',
		venueFallback: 'Stord Jazzklubb',
		scheduleCron: '0 5 * * *',
		iconUrl: 'https://allevents.in/favicon.ico',
		trusted: true
	},
	{
		slug: 'allevents-flow-yoga-bomlo',
		name: 'Flow Yoga Bømlo',
		organiserId: 28105398,
		// Percent-encoded: the profile slug carries an ø, and this string is used as a URL.
		path: 'org/flow-yoga-b%C3%B8mlo/28105398',
		region: 'Sunnhordland',
		timezone: 'Europe/Oslo',
		venueFallback: 'Flow Yoga Bømlo',
		scheduleCron: '0 5 * * *',
		iconUrl: 'https://allevents.in/favicon.ico',
		trusted: true
	},
	{
		slug: 'allevents-gruo-pub',
		name: 'Gruo Pub',
		organiserId: 25097795,
		path: 'org/gruo-pub/25097795',
		region: 'Sunnhordland',
		timezone: 'Europe/Oslo',
		venueFallback: 'Gruo Pub',
		scheduleCron: '0 5 * * *',
		iconUrl: 'https://allevents.in/favicon.ico',
		trusted: true
	},
	{
		slug: 'allevents-sagvag-bygdalag',
		name: 'Sagvåg Bygdalag',
		organiserId: 22762840,
		// Percent-encoded: the profile slug carries an å, and this string is used as a URL.
		path: 'org/sagv%C3%A5g-bygdalag/22762840',
		region: 'Sunnhordland',
		timezone: 'Europe/Oslo',
		venueFallback: 'Sagvåg Bygdalag',
		scheduleCron: '0 5 * * *',
		iconUrl: 'https://allevents.in/favicon.ico',
		trusted: true
	}
];

/** The organiser's public page, which is what we attribute and link to. */
export const organiserUrl = (o: AlleventsOrganiser) => `https://allevents.in/${o.path}`;

export function organiserBySlug(slug: string): AlleventsOrganiser | undefined {
	return ORGANISERS.find((o) => o.slug === slug);
}
