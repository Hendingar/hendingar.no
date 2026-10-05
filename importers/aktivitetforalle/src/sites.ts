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
	/**
	 * Does one run see everything this site publishes?
	 *
	 * True here, and it is a statement about the request rather than a preference: `/api/v1/events`
	 * returns the whole collection in one response — that is the same fact `eventsUrl` is built on,
	 * and the reason this importer can be polite about a 600-second crawl delay.
	 *
	 * It is what licenses the gone-upstream sweep (`markGoneUpstream`). A source read through a
	 * window — one page, one month — must never set this: every row outside the window would look
	 * cancelled.
	 */
	listingIsComplete: boolean;
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
		/*
		 * Not `/favicon.ico`: the portal became a single-page app, which answers every path it does
		 * not know with its own HTML — so that address is a 200 that is not an image. The icon the
		 * page itself links is this one.
		 */
		iconUrl: 'https://bomlo.aktivitetforalle.no/assets/img/favicon.png',
		trusted: true,
		listingIsComplete: true
	},
	{
		/*
		 * Stord, on the same platform and the same API. Measured 2026-10-05: 82 public rows, 80 of
		 * them dated `arrangement`s — most in the kulturhus halls, which consolidation folds into
		 * the rows other importers already hold — and two weekly `activity`s, one of them current.
		 */
		slug: 'stord-aktivitetforalle',
		name: 'Aktivitet for Alle — Stord',
		origin: 'https://stord.aktivitetforalle.no',
		region: 'Sunnhordland',
		attribution: 'Aktivitet for Alle — Stord',
		timezone: 'Europe/Oslo',
		scheduleCron: '0 5 * * *',
		iconUrl: 'https://stord.aktivitetforalle.no/assets/img/favicon.png',
		trusted: true,
		listingIsComplete: true
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

/**
 * Clubs, choirs, the kulturskule — who runs each event. Sixty-six of them; one request.
 *
 * Not linked from robots.txt or the sitemap: found in the site's own bundle, which reads it the same
 * way. It is what names the organiser on every activity, where `event_organizer_name` is empty.
 */
export const organizersUrl = (site: AfaSite) => `${site.origin}/api/v1/organizers`;

/** Where a reader lands. Only `public` events have a page; archived ids render "Ikkje funne". */
export const eventUrl = (site: AfaSite, eventId: string) => `${site.origin}/arrangement/${eventId}`;

/**
 * An activity's own page. The portal's nav calls them "Aktivitetar" and routes them here.
 *
 * Checked in a browser: `/arrangement/<id>` renders an activity too, but `/aktivitetar/<id>` is
 * the address the portal itself links, and `/aktivitet/<id>` — the obvious guess — is "Ikkje
 * funne".
 */
export const activityUrl = (site: AfaSite, eventId: string) =>
	`${site.origin}/aktivitetar/${eventId}`;

export function siteBySlug(slug: string): AfaSite | undefined {
	return SITES.find((s) => s.slug === slug);
}
