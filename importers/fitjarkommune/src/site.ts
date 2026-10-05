/**
 * Fitjar kommune's own calendar, "Kva skjer i Fitjar?".
 *
 * One site. `fitjar.kommune.no` is a Sitevision site, and the calendar is Sitevision's
 * marketplace "NKM" event apps — `nkm-event-list` on the listing, `nkm-event-date` on each entry.
 * Other kommunar run Sitevision too, so if a second one turns up with the same two apps this
 * becomes a platform importer with the sites as data, the way `importers/mec` is. Until then it is
 * one config object, because a list of one is a guess about the shape of the second.
 *
 * ## How it is read
 *
 * There is no feed. The listing mentions "ical" ten times and every one of them is the CSS class
 * `sv-vertical`; there is no `.ics`, no RSS, no `text/calendar` and no JSON request in the
 * browser — the page is complete as served. What it does carry is the list app's own data, as the
 * `AppRegistry.registerInitialState` call Sitevision emits for hydration: id, title, path, image
 * and the date exactly as the card prints it. That is parsed rather than the cards, and each
 * entry's own page is read once for the date, the place and the text a reader sees there.
 *
 * ## robots.txt
 *
 * Read on 2026-10-05. It disallows only action and state URLs — `*.action2`, `?sv.state=`,
 * `;jsessionid=`, `.html.printable` and a few more — and neither the listing nor any entry path
 * matches one. One request for the listing and one per entry, once a day.
 */
export const SITE = {
	/** Our `sources.slug`. */
	slug: 'fitjar-kommune',
	name: 'Fitjar kommune — Kva skjer i Fitjar?',
	origin: 'https://www.fitjar.kommune.no',
	region: 'Sunnhordland',
	attribution: 'Fitjar kommune',
	timezone: 'Europe/Oslo',
	/**
	 * Every venue this calendar names is in Fitjar, and that is a fact about the source rather than a
	 * reading of the place name: it is the kommune's own "what is on in Fitjar". The only entry that
	 * is about somewhere wider (Friluftsrådet Vest's haustferie programme, "for ungdom i
	 * Sunnhordland") names no venue at all, so this is never written onto a place the page did not
	 * state.
	 */
	municipality: 'Fitjar',
	scheduleCron: '0 5 * * *',
	/*
	 * `/favicon.ico` answers 301 to the image under `/images/18.…/<timestamp>/favicon.ico`. The
	 * stable address is the one stored: the target carries an upload timestamp and moves the day the
	 * kommune replaces its icon.
	 */
	iconUrl: 'https://www.fitjar.kommune.no/favicon.ico',
	// Edited by the kommune itself — see the `trusted` column comment in schema.ts.
	trusted: true,
	/**
	 * Does one run see everything this calendar publishes?
	 *
	 * True: the list app's state carries every entry it renders, and its settings carry no item cap
	 * (`showAs`, fonts and heading level, nothing else). Ordered by event date, upcoming only — which
	 * is the half the gone-upstream sweep looks at, since it only ever considers rows still ahead.
	 * A source read through a window must never claim this.
	 */
	listingIsComplete: true
} as const;

/** The listing a reader opens, and the first page this importer fetches. */
export const listingUrl = () => `${SITE.origin}/kva-skjer-i-fitjar`;

/**
 * An entry's own page, from the path the list app carries.
 *
 * Two path shapes are live at once — `/kva-skjer-i-fitjar/kva-skjer-i-fitjar/<slug>` and the older
 * `/kvaskjerifitjar/kvaskjerifitjar/<name>.5.<id>.html` — and both answer 200, so the path is used
 * as given rather than rebuilt from a slug.
 */
export const entryUrl = (path: string) => new URL(path, SITE.origin).toString();
