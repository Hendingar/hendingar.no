/**
 * The TicketCo shops we import from.
 *
 * TicketCo (ticketco.events) is a ticketing platform that gives every organiser its own subdomain —
 * `frugard.ticketco.events`, `stordjazzklubb.ticketco.events`, `sagvaagsbistroogscene.ticketco.events`.
 * So this is a platform importer and the shops are data, the same argument as `mec/` and `hoopla/`.
 * Adding a local organiser who sells through TicketCo should be an entry here, not a new package.
 *
 * Three of those subdomains are already in this repo as ticket links inside the detskjer and
 * allevents fixtures, which is how we know the platform is worth parameterising.
 *
 * How to tell a TicketCo shop: the listing at `/no/nb/m` renders one `tc-events-list--item` card
 * per event, each followed by its own `<script type='application/ld+json'>` block of `@type: Event`
 * — single-quoted, so a pattern that expects `"` finds nothing.
 */
export type TicketcoShop = {
	/**
	 * Our `sources.slug`. Stable — changing it orphans every imported event.
	 *
	 * `ticketco-` prefixed so `platformOf` in packages/core/src/directory.ts groups it under one
	 * TicketCo entry on /kjelder rather than giving every organiser its own line.
	 */
	slug: string;
	name: string;
	/** The subdomain — `frugard` in `frugard.ticketco.events`. Every URL below is built from it. */
	subdomain: string;
	region: string;
	attribution: string;
	/**
	 * The shop's IANA zone, and here it is load-bearing: TicketCo's JSON-LD writes the shop's wall
	 * clock with a `Z` on the end, so this zone is what turns that clock into an instant. See the
	 * note above `readWallClock` in map.ts.
	 */
	timezone: string;
	scheduleCron: string;
	iconUrl: string | null;
	/**
	 * Events somebody is selling tickets to under their own name, so imports publish directly. Same
	 * reasoning as `hoopla/shops.ts` and the `trusted` column in schema.ts.
	 */
	trusted: boolean;
	/**
	 * We may use the shop's event images.
	 *
	 * `false`, for the reason `hoopla/shops.ts` records: the organiser uploaded the artwork to their
	 * ticket shop, which is an arrangement with TicketCo and not one anybody made with us. We only
	 * hotlink either way; this records that no permission was given.
	 */
	posterRightsCleared: boolean;
	/**
	 * Where every event in this shop is held.
	 *
	 * From the instance, not the page, and for two reasons the page itself supplies. Its
	 * `location.name` is the *room* — "Arena", on all nine events — which on its own names nothing
	 * a reader could find. And its `location.address` is the literal string
	 * `"entities.street_address"`: an untranslated template key in TicketCo's own markup, on every
	 * event, which would be stored as a street if it were read. A single-venue shop states its
	 * venue nowhere usable, so the config does, the way `mec/instances.ts` has `venueFallback`.
	 *
	 * A shop that sells events in several places must not use this — it would put all of them in
	 * one building. That shop needs `location.name` read, and an entry here that says so.
	 */
	venue: {
		name: string;
		street: string;
		postalCode: string;
		/**
		 * The kommune, stated by us about a building we know rather than read off a post town.
		 *
		 * Every other importer writes null here, because what sources hand them is a post town —
		 * "Leirvik", "Bremnes" — and a post town is not a municipality. This is not that: it is a
		 * fact about one fixed address, written down once by a person.
		 */
		municipality: string;
	};
};

export const SHOPS: readonly TicketcoShop[] = [
	{
		/*
		 * Bakeriet Frugård in Leirvik, whose stage is called Arena. Measured 2026-10-05: nine
		 * events, from an Erlend Loe reading in October to stand-up in January, all in Arena.
		 */
		slug: 'ticketco-frugard',
		name: 'Bakeriet Frugård',
		subdomain: 'frugard',
		region: 'Sunnhordland',
		attribution: 'Bakeriet Frugård',
		timezone: 'Europe/Oslo',
		scheduleCron: '0 5 * * *',
		// The shop's own `<link rel="icon">`, verified to answer `200 image/png`.
		iconUrl:
			'https://tuploads.s3.eu-west-1.amazonaws.com/production/uploads/branding/site_favicon_image/20399/bakeriet_logo_face.png',
		trusted: true,
		posterRightsCleared: false,
		venue: {
			name: 'Bakeriet Frugård',
			street: 'Borggata 20',
			postalCode: '5411',
			municipality: 'Stord'
		}
	}
];

export function shopBySlug(slug: string): TicketcoShop | undefined {
	return SHOPS.find((s) => s.slug === slug);
}

const origin = (shop: TicketcoShop) => `https://${shop.subdomain}.ticketco.events`;

/**
 * The listing a reader can open, and the one page we parse.
 *
 * `/no/nb/m` rather than `/no/nb`: both list the same events, but `/m` is the plain list layout
 * whose cards print the date and clock as text (`24.10.2026 20:00`), which is the human-visible
 * time `map.ts` checks the JSON-LD against.
 */
export const listingUrl = (shop: TicketcoShop) => `${origin(shop)}/no/nb/m`;

/**
 * One event's own page, from the slug both the card and the JSON-LD carry.
 *
 * Built rather than taken from the JSON-LD `url`, because the JSON-LD cannot decide which language
 * it is in: six of the nine events link `/no/en/e/…` and three `/no/nb/e/…`. Every one resolves under
 * `/no/nb/`; `/no/nn/` is a 404. So the source link is one shape, in Norwegian, for every event.
 */
export const eventUrl = (shop: TicketcoShop, eventSlug: string) =>
	`${origin(shop)}/no/nb/e/${eventSlug}`;
