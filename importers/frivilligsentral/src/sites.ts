/**
 * Frivilligsentral calendars on WisWeb.
 *
 * The frivilligsentralar in Norges Frivilligsentraler's network share one CMS (WisWeb, the icon is
 * served from `static.wis.no/favicon/norgesfs/`) and one address scheme —
 * `<kommune>.frivilligsentral.no/kalender` — so the sites are data and the parser is shared. Bømlo
 * and Fitjar answer on the same addresses, and on 2026-10-05 both listings were empty.
 *
 * How to tell: the listing is server-rendered, its items are `u-timeline-v3` blocks linking
 * `/hendelse?<slug>&Id=<n>`, and the page has a "Kommende | Tidligere" switch above them.
 */
export type FsSite = {
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
	/** Who runs everything on the calendar — the sentral itself. See `organizers`. */
	organizer: string;
	/**
	 * The municipality every venue on this calendar is in.
	 *
	 * Written where the other importers write null, and the difference is what is known. Those
	 * read a post town ("Bremnes", "Leirvik") and refuse to promote it to a municipality. This is a
	 * municipal service's own calendar — Stord Frivilligsentral answers at `@stord.kommune.no` —
	 * and every place it names is one of its own rooms in Leirvik. Only ever filled in on a venue,
	 * never overwritten, so a row another source already placed keeps what it has.
	 */
	municipality: string;
	/**
	 * Does one run see everything this site publishes?
	 *
	 * True: the "Kommende" listing is every upcoming occurrence in one page — 674 of them, out to
	 * August 2030 — with no paging. That is what licenses the gone-upstream sweep, which only ever
	 * considers rows still ahead of us, so the past view ("Tidligere") is not needed for it.
	 */
	listingIsComplete: boolean;
};

export const SITES: readonly FsSite[] = [
	{
		slug: 'stord-frivilligsentral',
		name: 'Stord Frivilligsentral',
		origin: 'https://stord.frivilligsentral.no',
		region: 'Sunnhordland',
		attribution: 'Stord Frivilligsentral',
		timezone: 'Europe/Oslo',
		scheduleCron: '0 5 * * *',
		/*
		 * The 32px PNG the page itself links with `rel="icon"`, fetched and confirmed to be
		 * `image/png` — not `/favicon.ico` on the site's own host, which nobody has checked and a CMS
		 * like this may well answer with a page.
		 */
		iconUrl: 'https://static.wis.no/favicon/norgesfs/favicon-32x32.png',
		trusted: true,
		organizer: 'Stord Frivilligsentral',
		municipality: 'Stord',
		listingIsComplete: true
	}
];

/** The listing a reader can open, and the one page this importer fetches. */
export const listingUrl = (site: FsSite) => `${site.origin}/kalender`;

export function siteBySlug(slug: string): FsSite | undefined {
	return SITES.find((s) => s.slug === slug);
}
