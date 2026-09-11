/**
 * The Hoopla ticket shops we import from.
 *
 * Hoopla (hoopla.no) is a Norwegian ticketing platform, and every organiser on it gets its own
 * subdomain — `smaasceneri.hoopla.no`, `jmsmusikk.hoopla.no`, `trold.hoopla.no`. So this is a
 * platform importer and the shops are data, the same argument as `mec/` and `luma/`. Adding a
 * local organiser who sells tickets through Hoopla should be an entry here, not a new package.
 *
 * Two of those subdomains are already in this repo, which is how we know the platform is worth
 * parameterising rather than hardcoding: `importers/aktivitetforalle` and `importers/detskjer`
 * both carry committed fixtures whose ticket links point at Hoopla shops we do not yet read.
 *
 * How to tell a Hoopla shop: the page is a React app (`d16s6o6uu491xt.cloudfront.net/sales-4/`)
 * whose HTML sets `window.ORGANIZATION_ID`, and
 * `https://<shop>.hoopla.no/api/public/v3.0/organizations/<that id>/events` answers 200 with
 * `{events: […]}`. The `organizationId` is what this file needs; the subdomain alone is not
 * enough, because the API is keyed on the id.
 */
export type HooplaShop = {
	/**
	 * Our `sources.slug`. Stable — changing it orphans every imported event.
	 *
	 * `hoopla-` prefixed so `platformOf` in packages/core/src/directory.ts groups it under one
	 * Hoopla entry on /kjelder rather than giving every organiser its own line.
	 */
	slug: string;
	name: string;
	/** The subdomain — `smaasceneri` in `smaasceneri.hoopla.no`. Also the API host. */
	subdomain: string;
	/**
	 * The organiser's own numeric id, from `window.ORGANIZATION_ID` in the shop's HTML.
	 *
	 * A string rather than a number: it is an opaque identifier that we only ever put back into a
	 * URL, and nothing is gained by being able to add one to it.
	 */
	organizationId: string;
	region: string;
	attribution: string;
	/**
	 * The shop's IANA zone, used for the venue row.
	 *
	 * A zone and not an offset. Hoopla's own HTML states `window.ORGANIZATION_TIMEZONE =
	 * "Europe/Oslo"` for this shop, which is where this value comes from — but note that it is
	 * only used for the *venue*, never to interpret a time. `start` is a true instant; see the
	 * long note in api.ts.
	 */
	timezone: string;
	scheduleCron: string;
	iconUrl: string | null;
	/**
	 * Editorially maintained by the organiser themselves, so imports publish directly rather than
	 * queueing. Same reasoning as the `trusted` column in schema.ts: these are events somebody is
	 * selling tickets to under their own name, which is a stronger claim to being real than most
	 * things we read.
	 */
	trusted: boolean;
	/**
	 * We may use the shop's event images.
	 *
	 * `false`, and deliberately, for the same reason `luma/calendars.ts` records: the organiser
	 * uploaded the artwork to their own ticket shop, which is an arrangement between them and
	 * Hoopla and not an agreement anybody made with us. We still only hotlink, so nothing is
	 * re-hosted — this records that no permission was given, which is what makes it auditable the
	 * moment something starts caching or resizing images.
	 *
	 * Worth knowing for this shop specifically: all four events in the committed fixture point at
	 * the same `Logo.jpg`, so what Hoopla calls an event image is often the organiser's logo
	 * rather than a poster. Harmless — a logo thumbnail is better than a generated tile — but it
	 * is the reason not to read "has an image" as "has a poster".
	 */
	posterRightsCleared: boolean;
};

export const SHOPS: readonly HooplaShop[] = [
	{
		slug: 'hoopla-smaasceneri',
		name: 'Småsceneri',
		subdomain: 'smaasceneri',
		organizationId: '254371621',
		region: 'Sunnhordland',
		attribution: 'Småsceneri',
		timezone: 'Europe/Oslo',
		scheduleCron: '0 5 * * *',
		iconUrl: null,
		trusted: true,
		posterRightsCleared: false
	},
	{
		slug: 'hoopla-mono-log',
		name: 'Mono-Log',
		subdomain: 'mono-log',
		organizationId: '15868869',
		region: 'Sunnhordland',
		/*
		 * `Mono-Log`, though the shop styles itself `mono-log` in lower case.
		 *
		 * Their own prose capitalises it — "Mono-Log Label", "Mono-Log Konsertserie", and the
		 * event actually called "Mono-Log Festival 5.0" — so this is the brand as they write it,
		 * not a tidy-up we invented.
		 */
		attribution: 'Mono-Log',
		timezone: 'Europe/Oslo',
		scheduleCron: '0 5 * * *',
		/*
		 * Null, like Småsceneri's. The shop's `og:image` is whichever event poster is current
		 * rather than a logo — today a festival early-bird graphic — so hotlinking it as the
		 * source's icon on /datasamling would put an unrelated poster next to the source name and
		 * silently change it whenever they change their programme.
		 */
		iconUrl: null,
		trusted: true,
		posterRightsCleared: false
	}
];

export function shopBySlug(slug: string): HooplaShop | undefined {
	return SHOPS.find((s) => s.slug === slug);
}

/** The listing a reader can open. */
export const listingUrl = (shop: HooplaShop) => `https://${shop.subdomain}.hoopla.no/`;

/**
 * One event's own page.
 *
 * `/event/<id>` on the shop's own host, which is the path the app's own router builds and the
 * shape of the Hoopla links already sitting in two other importers' fixtures
 * (`https://trold.hoopla.no/event/1928817933`). Every imported event keeps a link to its source
 * (CLAUDE.md), and that link has to be the event, not the shop it sits in.
 */
export const eventUrl = (shop: HooplaShop, eventId: number) =>
	`https://${shop.subdomain}.hoopla.no/event/${eventId}`;

/** The list of everything this organiser has on sale. */
export const eventsUrl = (shop: HooplaShop) =>
	`https://${shop.subdomain}.hoopla.no/api/public/v3.0/organizations/${shop.organizationId}/events`;

/** One event's own record, which is the only place a description lives. */
export const eventDetailUrl = (shop: HooplaShop, eventId: number) =>
	`${eventsUrl(shop)}/${eventId}`;
