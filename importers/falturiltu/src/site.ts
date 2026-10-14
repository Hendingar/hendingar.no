/**
 * Falturiltu — the literature and music festival on Stord, one week every autumn.
 *
 * One site, a WordPress theme built for this festival. Most of its programme is also listed by
 * Stord kulturhus and Det skjer Sunnhordland, titled each their own way; the festival's page is
 * the one that names the acts as the festival does, and the only one that has the events outside
 * the culture house (the school, the campus, the museum). Consolidation folds the overlap — see
 * `sameSlot` in packages/core/src/consolidate.ts, which exists for exactly this week.
 *
 * ## How it is read
 *
 * Two requests, because neither carries everything:
 *
 * - `/program/` is server-rendered and is the only place the date, clock, venue and ticket link
 *   exist. Each card carries a `<time datetime="2026-10-29 11:45">` and shows the same clock to a
 *   reader beside it.
 * - `/wp-json/wp/v2/program_items` is WordPress's own REST view of the same posts. It has the
 *   description and the festival's category, and no date at all (its ACF fields are not exposed).
 *
 * They join on the event's own page URL, which both carry. robots.txt allows everything and asks
 * for a 10-second crawl delay, which the second request honours.
 */
export const SITE = {
	slug: 'falturiltu',
	name: 'Falturiltu',
	origin: 'https://falturiltu.no',
	region: 'Sunnhordland',
	attribution: 'Falturiltu',
	timezone: 'Europe/Oslo',
	scheduleCron: '0 5 * * *',
	iconUrl: 'https://falturiltu.no/favicon.ico',
	trusted: true,
	/** robots.txt: `Crawl-delay: 10`. */
	crawlDelayMs: 10_000,
	/**
	 * True: `/program/` is the whole programme for the coming festival on one page, with no
	 * pagination and no window. That licenses the gone-upstream sweep.
	 */
	listingIsComplete: true
} as const;

export const programUrl = () => `${SITE.origin}/program/`;

/** Every programme item, at most one page of 100 — the festival has around twenty. */
export const itemsUrl = () => `${SITE.origin}/wp-json/wp/v2/program_items?per_page=100`;
