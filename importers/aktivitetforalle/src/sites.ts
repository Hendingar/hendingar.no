/**
 * "Aktivitet for Alle" municipal activity portals.
 *
 * A white-labelled platform (zpirit.no) with one site per municipality, so this is a platform
 * importer and the municipalities are data. Adding a neighbouring kommune should be an entry here.
 *
 * How to tell: `/api/v1/events` answers with `{code, status, data, pagination}` and the site's
 * robots.txt names `/api/v1/sitemap`.
 */
export type AfaSite = {
	/** Our `sources.slug`. Stable — changing it orphans every imported event. */
	slug: string;
	name: string;
	/** Host, no trailing slash. Every URL below is built from it. */
	origin: string;
	region: string;
	attribution: string;
	timezone: string;
	scheduleCron: string;
	iconUrl: string | null;
	trusted: boolean;
};

export const SITES: readonly AfaSite[] = [
	{
		slug: 'bomlo-aktivitetforalle',
		name: 'Aktivitet for Alle — Bømlo',
		origin: 'https://bomlo.aktivitetforalle.no',
		region: 'Sunnhordland',
		attribution: 'Aktivitet for Alle — Bømlo',
		timezone: 'Europe/Oslo',
		scheduleCron: '0 5 * * *',
		iconUrl: 'https://bomlo.aktivitetforalle.no/favicon.ico',
		trusted: true
	}
];

/** The listing a reader can open. */
export const listingUrl = (site: AfaSite) => `${site.origin}/arrangement`;

/**
 * One request returns every event the portal holds — `pagination` reports a total and no pages.
 *
 * That single request matters: the site's robots.txt asks for a **600 second crawl delay**, which
 * would make a paginated or per-event crawl impossible to do politely. Reading the whole collection
 * once a day is well inside what it asks for.
 */
export const eventsUrl = (site: AfaSite) => `${site.origin}/api/v1/events`;

/** Venue rows referenced by `event_location_id`. Twenty-eight of them; one request. */
export const locationsUrl = (site: AfaSite) => `${site.origin}/api/v1/locations`;

/** The tag vocabulary — categories, audiences, price types — keyed by the ids events carry. */
export const filtersUrl = (site: AfaSite) => `${site.origin}/api/v1/filters`;

/** Where a reader lands. Only `public` events have a page; archived ids render "Ikkje funne". */
export const eventUrl = (site: AfaSite, eventId: string) => `${site.origin}/arrangement/${eventId}`;

export function siteBySlug(slug: string): AfaSite | undefined {
	return SITES.find((s) => s.slug === slug);
}
