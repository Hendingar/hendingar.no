/**
 * Billetto organisers we import from.
 *
 * A root importer with the organisers as data, so adding one is an entry here rather than a new
 * package — the same shape as the DNT turlag and the MEC sites.
 *
 * Billetto's own organiser page renders its events client-side from Algolia, and the search request
 * it makes is the API: one index, filtered by organiser. `robots.txt` allows `/users/*` (only the
 * follower, contact and share paths are closed) and asks for a three-second crawl delay, which one
 * query per organiser per day is comfortably inside.
 */

/** Billetto's Algolia search index, and the public search credentials its own pages use. */
export const ALGOLIA_APP_ID = 'YNEUY03Z8Q';
export const ALGOLIA_API_KEY = '8de1d74c7c7de20e35c1f7215e7c699a';
export const ALGOLIA_INDEX = 'events_by_date';

/**
 * Billetto Norway.
 *
 * Not the organiser — this took a moment to see. The profile page filters on
 * `organization_id:37 AND organizer_id:<id>`, and 37 is the Norwegian storefront, shared by every
 * organiser on billetto.no. Filtering on it alone would import the whole country.
 */
export const NORWAY_ORGANIZATION_ID = 37;

export type BillettoOrganiser = {
	/** Our `sources.slug`. Stable — changing it orphans every imported event. */
	slug: string;
	/** The organiser as they call themselves, which is who the events belong to. */
	name: string;
	/** The `users/<handle>` path on billetto.no, for the attribution link. */
	handle: string;
	/**
	 * Billetto's own organiser id, the `organizer_id` in the search filter.
	 *
	 * Read it off the profile page's Algolia request rather than guessing: it is unrelated to the
	 * handle, and there is no public endpoint that maps one to the other.
	 */
	organizerId: number;
	region: string;
	timezone: string;
	scheduleCron: string;
	iconUrl: string | null;
	trusted: boolean;
};

export const ORGANISERS: readonly BillettoOrganiser[] = [
	{
		slug: 'billetto-bremnes-idrettslag',
		name: 'Bremnes Idrettslag',
		handle: 'bremnes-idrettslag',
		organizerId: 7369531,
		region: 'Sunnhordland',
		timezone: 'Europe/Oslo',
		scheduleCron: '0 5 * * *',
		iconUrl: 'https://billetto.no/favicon.ico',
		trusted: true
	}
];

/** The organiser's public page, which is what we attribute and link to. */
export const organiserUrl = (o: BillettoOrganiser) => `https://billetto.no/users/${o.handle}`;

export const searchUrl = () =>
	`https://${ALGOLIA_APP_ID.toLowerCase()}-dsn.algolia.net/1/indexes/${ALGOLIA_INDEX}/query` +
	`?x-algolia-application-id=${ALGOLIA_APP_ID}&x-algolia-api-key=${ALGOLIA_API_KEY}`;

/** The filter Billetto's own page uses, minus the subscriptions nobody attends. */
export const filterFor = (o: BillettoOrganiser) =>
	`organization_id:${NORWAY_ORGANIZATION_ID} AND (organizer_id:${o.organizerId} OR host_ids:${o.organizerId}) AND (NOT kind:subscription)`;

export function organiserBySlug(slug: string): BillettoOrganiser | undefined {
	return ORGANISERS.find((o) => o.slug === slug);
}
