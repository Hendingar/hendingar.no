/**
 * Bømlo Næringsråd's own event list.
 *
 * One site, not a platform: `bomlonr.no` is a Next.js site built for this one næringsråd, and the
 * next næringsråd runs something else entirely — Stord's is a Getynet CMS with a different shape.
 * What they share is what they are, not how they publish, which is why they are grouped on
 * /kjelder and not in one importer.
 *
 * ## How it is read
 *
 * The listing is server-rendered and ships its data as `__NEXT_DATA__`, the JSON blob Next.js
 * embeds for hydration. That is the page's own data rather than a reading of its layout, so it is
 * the right thing to parse: no selector can rot under it, and a redesign that keeps the data keeps
 * the importer working.
 *
 * `bomlonr.no` publishes no robots.txt at all — the path 404s with the site's own Next.js error
 * page. One request a day for the page a reader opens is well inside what that leaves open.
 */
export const SITE = {
	/** Our `sources.slug`. The `naeringsrad-` prefix is what groups it on /kjelder. */
	slug: 'naeringsrad-bomlo',
	name: 'Bømlo Næringsråd',
	origin: 'https://www.bomlonr.no',
	region: 'Sunnhordland',
	attribution: 'Bømlo Næringsråd',
	timezone: 'Europe/Oslo',
	scheduleCron: '0 5 * * *',
	iconUrl: 'https://www.bomlonr.no/favicon.ico',
	trusted: true,
	/**
	 * Does one run see everything this site publishes?
	 *
	 * True: the `__NEXT_DATA__` blob carries the site's whole event archive — a hundred rows, past
	 * and future, in the one response. That is what licenses the gone-upstream sweep. A source read
	 * through a window must never claim it.
	 */
	listingIsComplete: true
} as const;

/** The listing a reader can open, and the one page this importer fetches. */
export const listingUrl = () => `${SITE.origin}/hendingar`;

/** Every event has its own page, built from the slug the listing already carries. */
export const eventUrl = (slug: string) => `${SITE.origin}/hendingar/${slug}`;
