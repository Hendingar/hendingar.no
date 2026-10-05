import { z } from 'zod';
import { decodeEntities, plainText } from '@hendingar/core/text';
import { listingUrl } from './site.ts';

/**
 * Reading "Kva skjer i Fitjar?".
 *
 * Two pages, two different readings.
 *
 * **The listing** is read for its data, not its cards. Sitevision renders each marketplace app on
 * the server and then emits `AppRegistry.registerInitialState('<portlet id>', {…})` so the browser
 * can hydrate it — the same move Next.js makes with `__NEXT_DATA__`, and parsed for the same
 * reason as `importers/bomlonr` parses that: it is the site's own structured data, and no selector
 * can rot under it. The list app is found by its application id, then its state by its portlet id,
 * so the menu apps that emit states of their own on the same page are never mistaken for it.
 *
 * **Each entry** is read for what a reader sees there: the date line the `nkm-event-date` app
 * prints, the heading, the ingress and the body. The entry is the authority, because it is the page
 * a reader decides from; the listing's copy of the date is the fallback when an entry cannot be
 * read, and the cross-check when it can.
 *
 * Everything is validated. The state is an implementation detail of somebody else's app, and the
 * day it changes shape must be a loud failure rather than an empty import.
 */

const LIST_APP = 'marketplace.sitevision.nkm-event-list';

const itemSchema = z.object({
	/**
	 * Sitevision's own page id, `5.<hex>`. The same id the older path shape spells into its URL
	 * (`…fitjarhusflidslagshandarbeidskafe.5.1a2db2a419ed4320d6e1ec97.html`), so it is the page's
	 * identity rather than a property of how it happens to be addressed today.
	 */
	id: z.string().regex(/^\d+\.[0-9a-f]+$/),
	articleName: z.string(),
	/** Site-relative, and checked to stay that way — see `parseListing`. */
	URI: z.string(),
	/** The date line exactly as the card prints it: `24. november 2026, 18.00`. */
	eventDate: z.string().nullish(),
	/** The entry's ingress, as plain text. */
	text: z.string().nullish(),
	img: z.string().nullish(),
	/**
	 * When the article was published, as epoch milliseconds. Not the event date, and neither is the
	 * `[2026-08-07]` in `displayName` or the date in the slug: all three are the day the article was
	 * written. The handarbeidskafé whose slug says 2026-08-07 is on 24 November.
	 */
	publishDate: z.number().nullish(),
	displayName: z.string().nullish()
});

export type ListingItem = z.infer<typeof itemSchema>;

const stateSchema = z.object({
	settings: z.object({ showAs: z.string().nullish() }).passthrough().nullish(),
	items: z.array(z.unknown())
});

export type ParsedListing = { rows: ListingItem[]; rejected: string[] };

/** Every `registerInitialState` call on a page, by portlet id. */
function initialStates(html: string): Map<string, string> {
	const states = new Map<string, string>();
	const pattern = /AppRegistry\.registerInitialState\('([^']+)',(\{[\s\S]*?\})\);\s*<\/script>/g;
	for (const match of html.matchAll(pattern)) {
		if (match[1] && match[2]) states.set(match[1], match[2]);
	}
	return states;
}

/**
 * The list app's portlet id.
 *
 * Read off its own `registerApp` call rather than hard-coded: the id is a property of how the
 * kommune built the page, and moving the list into another column would change it without changing
 * anything we care about.
 */
function listPortletId(html: string): string | null {
	const apps = html.matchAll(/AppRegistry\.registerApp\(\{([\s\S]*?)\}\);\s*<\/script>/g);
	for (const app of apps) {
		const body = app[1] ?? '';
		const application = /applicationId:'([^'|]+)/.exec(body)?.[1];
		if (application !== LIST_APP) continue;
		const portlet = /portletId:'([^']+)'/.exec(body)?.[1];
		if (portlet) return portlet;
	}
	return null;
}

/**
 * The list app's items out of the listing page.
 *
 * A page without the app is a redesign, not an empty calendar, so it throws. A page with the app and
 * no items is a calendar with nothing on, which is an ordinary answer — and the gone-upstream sweep
 * refuses to act on an empty run, so it cannot empty the source either.
 */
export function parseListing(html: string): ParsedListing {
	const portlet = listPortletId(html);
	if (!portlet) throw new Error(`no ${LIST_APP} app on the listing page`);

	const raw = initialStates(html).get(portlet);
	if (!raw) throw new Error(`no initial state for the ${LIST_APP} portlet ${portlet}`);

	let json: unknown;
	try {
		json = JSON.parse(raw);
	} catch {
		throw new Error(`the ${LIST_APP} state is not JSON`);
	}

	const outer = stateSchema.safeParse(json);
	if (!outer.success) {
		throw new Error(`unexpected ${LIST_APP} state: ${outer.error.issues[0]?.message}`);
	}

	const rows: ListingItem[] = [];
	const rejected: string[] = [];
	for (const item of outer.data.items) {
		const parsed = itemSchema.safeParse(item);
		if (!parsed.success) {
			rejected.push(parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join(', '));
			continue;
		}
		/*
		 * Same-origin paths only. The importer follows every one of these, and a list that one day
		 * carried an absolute URL to somewhere else must not turn a daily job into a request to a
		 * host nobody chose.
		 */
		if (!parsed.data.URI.startsWith('/') || parsed.data.URI.startsWith('//')) {
			rejected.push(`${parsed.data.id}: URI is not a site path: ${parsed.data.URI}`);
			continue;
		}
		rows.push(parsed.data);
	}
	return { rows, rejected };
}

export type UpstreamEntry = {
	/** The `nkm-event-date` line: `24. november 2026, 18.00`, `6.–8. oktober 2026`. */
	dateText: string | null;
	title: string | null;
	/** The ingress, as a reader sees it — `Fitjar<span>tun</span>` reads `Fitjartun`. */
	preamble: string | null;
	/** The body text portlet. Empty on every entry seen so far. */
	body: string | null;
	/** The first image in the body, at full size, and every width Sitevision will serve it at. */
	image: { src: string; srcset: string | null } | null;
};

/** The first match's group, or null. */
function first(pattern: RegExp, html: string): string | null {
	return pattern.exec(html)?.[1] ?? null;
}

/** An attribute out of one tag's attribute text. */
function attribute(tag: string, name: string): string | null {
	const value = new RegExp(`\\s${name}="([^"]*)"`).exec(tag)?.[1];
	return value === undefined ? null : decodeEntities(value);
}

/**
 * An entry page → the fields a reader sees on it.
 *
 * Each is found by the Sitevision portlet that holds it — the `Hendelsedato` app, the `Overskrift`,
 * `Ingress` and `Innhold` text portlets, the `Bilde 1` image portlet — which are named in the page
 * template rather than per article, so they are the same on every entry.
 *
 * Throws when the page has no `nkm-event-date` app at all. The app is part of the entry template,
 * so a page without it is not an entry any more — a redirect to the front page, a login wall — and
 * the listing page itself would otherwise pass, heading and all. An app that is present and prints
 * nothing is different: that is an entry without a date, and comes back as `dateText: null`.
 */
export function parseEntry(html: string): UpstreamEntry {
	const marker = 'sv-marketplace-sitevision-nkm-event-date';
	const at = html.indexOf(marker);
	if (at === -1) throw new Error('not an event entry: no nkm-event-date app on the page');

	// Bounded to the app's own container, so an empty app cannot borrow the next paragraph down.
	const end = html.indexOf('</div></div></div>', at);
	const app = end === -1 ? html.slice(at) : html.slice(at, end);
	const dateBlock = first(/<p[^>]*>([\s\S]*?)<\/p>/, app);
	const heading = first(/<h1[^>]*>([\s\S]*?)<\/h1>/, html);

	const preamble = first(/<p class="preamble">([\s\S]*?)<\/p>/, html);
	/*
	 * The body portlet ends at the first `</div></div>` — its own content div, then the portlet. A
	 * text portlet holds paragraphs, headings and lists, not divs, so that is where it ends; if an
	 * editor ever nests one, the body is cut short rather than running into the page chrome.
	 */
	const body = first(
		/<div id="Innhold"><!-- Innhold --><\/div><div class="sv-text-portlet-content">([\s\S]*?)<\/div><\/div>/,
		html
	);

	const imageTag = first(/<div id="Bilde1"><!-- Bilde 1 --><\/div>(?:<a[^>]*>)?<img([^>]*)>/, html);
	const src = imageTag ? attribute(imageTag, 'src') : null;

	return {
		dateText: dateBlock === null ? null : plainText(dateBlock),
		title: heading === null ? null : plainText(heading),
		preamble: plainText(preamble),
		body: plainText(body),
		image: src ? { src, srcset: imageTag ? attribute(imageTag, 'srcset') : null } : null
	};
}

const HEADERS = {
	// Identifying, with a contact URL, as docs/event-sources.md asks of every importer.
	'user-agent': 'hendingar.no importer (+https://hendingar.no)',
	accept: 'text/html'
};

async function getHtml(url: string): Promise<string> {
	const response = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(30_000) });
	if (!response.ok) throw new Error(`${url} responded ${response.status}`);
	return response.text();
}

export type ReadListing = () => Promise<string>;
export type ReadEntry = (url: string) => Promise<string>;

/** The page a reader opens. */
export const readListing: ReadListing = () => getHtml(listingUrl());

/**
 * One entry, one request. Called once per listed entry, one after another — never in parallel, so
 * a run is a reader paging through the calendar rather than a burst.
 */
export const readEntry: ReadEntry = (url) => getHtml(url);
