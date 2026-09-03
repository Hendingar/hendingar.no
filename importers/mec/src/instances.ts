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
		trusted: true
	}
];

export function instanceBySlug(slug: string): MecInstance | undefined {
	return INSTANCES.find((i) => i.slug === slug);
}
