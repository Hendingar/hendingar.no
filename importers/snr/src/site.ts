/**
 * Stord Næringsråd's activity calendar.
 *
 * The page is a Getynet CMS listing whose filters are served by one endpoint:
 * `/modules/Activities/output/ajax.get_news_by_year.php`, posted with the year the reader picked.
 * We ask it the same question a reader's browser asks.
 *
 * ## Why the year endpoint and not the page
 *
 * The rendered page shows day, month name, time and title — and **no year anywhere**, on the card
 * or on the event's own page. Resolving a bare "16. oktober" against today would be a guess that
 * is wrong for a fortnight every December, and a fixture whose year we invented is the kind of
 * error nothing downstream can catch.
 *
 * The year endpoint answers with the month headings spelled "Jan 2026". So the year is evidence:
 * we ask for a year, and the response says which year it gave us.
 *
 * `snr.no/robots.txt` allows `User-agent: *` everywhere except `/fw`, `/ckeditor` and `/ckfinder`,
 * and asks for no crawl delay. Two requests a day — this year and the next — is well inside that.
 */
export const SITE = {
	/** Our `sources.slug`. The `naeringsrad-` prefix is what groups it on /kjelder. */
	slug: 'naeringsrad-stord',
	name: 'Stord Næringsråd',
	origin: 'https://www.snr.no',
	region: 'Sunnhordland',
	attribution: 'Stord Næringsråd',
	timezone: 'Europe/Oslo',
	scheduleCron: '0 5 * * *',
	iconUrl: 'https://www.snr.no/favicon.ico',
	trusted: true
} as const;

/** The calendar a reader can open. */
export const listingUrl = () => `${SITE.origin}/Arrayliste/aktiviteterliste/aktivitetskalender`;

/** The endpoint the page's own year filter posts to. */
export const yearEndpoint = () =>
	`${SITE.origin}/modules/Activities/output/ajax.get_news_by_year.php`;

/**
 * The customer id the CMS instance is keyed on, as the page's own script passes it.
 *
 * Read out of the page rather than invented: it is `24900` in every one of its three calls to this
 * endpoint. Hardcoded here because it identifies this site, exactly like the origin above does.
 */
export const CUSTOMER_ID = '24900';

/**
 * Where a reader lands.
 *
 * The listing links its cards with a bare query string — `?frukostmote-...-23982` — which resolves
 * against the calendar page itself. Built back into an absolute URL so the event's own page is
 * what we store, rather than the calendar it happened to be listed on.
 */
export const eventUrl = (query: string) => `${listingUrl()}?${query}`;
