/**
 * The Modern Events Calendar sites we import from.
 *
 * MEC is a WordPress plugin, so this is one importer for a whole family of sites rather than one
 * per site — the same argument as the Innocode "bestevent" platform behind Det skjer. Adding a
 * Norwegian venue running MEC should be an entry here, not a new package.
 *
 * How to tell: the events page carries `data-mec-postid`, a `mec-load-more` button, and one
 * `application/ld+json` block of `@type: Event` per occurrence shown.
 */
export type MecInstance = {
	/** Our `sources.slug`. Stable — changing it orphans every imported event. */
	slug: string;
	name: string;
	/** The human-facing page, for attribution links. */
	url: string;
	/** The page we actually parse. */
	endpoint: string;
	region: string;
	attribution: string;
	timezone: string;
	/**
	 * Used when an event's JSON-LD `location.name` is empty, which is the normal case on a
	 * single-venue site: the page never repeats the venue because every event is held there.
	 * Without this the events would arrive with no place at all.
	 */
	venueFallback: string;
	scheduleCron: string;
	/**
	 * The site's own icon, hotlinked, so a tile and a source row carry its mark.
	 *
	 * Read from the page rather than guessed: Moster Amfi's `<link rel="apple-touch-icon">` points
	 * at files it does not serve, and only the WordPress `site_icon_url` resolves.
	 */
	iconUrl: string | null;
	/**
	 * The venue has given us permission to use its event images.
	 *
	 * Recorded per source rather than assumed globally, because it is a fact about an agreement
	 * with a named organisation and not a property of the software. We hotlink rather than re-host
	 * either way, so today this only makes the permission auditable — but it becomes load-bearing
	 * the moment anything caches or resizes an image, and at that point nobody should have to
	 * reconstruct who agreed to what from memory.
	 */
	posterRightsCleared: boolean;
	/**
	 * Editorially maintained by the venue itself, so imports publish directly rather than queueing
	 * for review. See the `trusted` column comment in schema.ts.
	 */
	trusted: boolean;
};

export const INSTANCES: readonly MecInstance[] = [
	{
		slug: 'bomlobibliotek',
		name: 'Bømlo folkebibliotek',
		url: 'https://www.bomlobibliotek.no/kva-skjer/',
		endpoint: 'https://www.bomlobibliotek.no/kva-skjer/',
		region: 'Sunnhordland',
		attribution: 'Bømlo folkebibliotek',
		timezone: 'Europe/Oslo',
		venueFallback: 'Bømlo folkebibliotek',
		scheduleCron: '0 5 * * *',
		iconUrl: 'https://www.bomlobibliotek.no/wp-content/uploads/2022/06/webloft-favicon.png',
		posterRightsCleared: true,
		trusted: true
	},
	{
		slug: 'mosteramfi',
		name: 'Moster Amfi',
		url: 'https://mosteramfi.no/kva-skjer/',
		endpoint: 'https://mosteramfi.no/kva-skjer/',
		region: 'Sunnhordland',
		attribution: 'Moster Amfi',
		timezone: 'Europe/Oslo',
		venueFallback: 'Moster Amfi',
		scheduleCron: '0 5 * * *',
		iconUrl: 'https://mosteramfi.no/wp-content/uploads/2020/09/cropped-favicon.png',
		posterRightsCleared: true,
		trusted: true
	},
	{
		slug: 'sunnhordland-museum',
		name: 'Sunnhordland museum',
		url: 'https://sunnhordland.museum.no/aktivitetskalender/',
		endpoint: 'https://sunnhordland.museum.no/aktivitetskalender/',
		region: 'Sunnhordland',
		attribution: 'Sunnhordland museum',
		timezone: 'Europe/Oslo',
		venueFallback: 'Sunnhordland museum',
		scheduleCron: '0 5 * * *',
		/*
		 * The site declares no favicon at all — no <link rel="icon">, no /favicon.ico, and the
		 * WordPress `site_icon_url` is empty. Null rather than a guessed path, so SourceIcon shows
		 * initials instead of a broken image.
		 */
		iconUrl: null,
		trusted: true,
		posterRightsCleared: true
	}
];

export function instanceBySlug(slug: string): MecInstance | undefined {
	return INSTANCES.find((i) => i.slug === slug);
}
