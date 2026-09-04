import { z } from 'zod';
import type { BakhagenInstance } from './instances.ts';

/**
 * Reading a Bakhagen (Corepublish) hagelag activity page.
 *
 * The listing is server-rendered HTML carrying **schema.org microdata**, one
 * `<article itemtype="http://schema.org/Event">` per activity, and that is the only structured
 * copy of the events on the page. The page also has an `application/ld+json` block, but it
 * describes the *listing itself* as an `Article` ("Aktiviteter i Hageselskapet Bømlo") and holds
 * no events at all — reading it would import one bogus row and miss every real one.
 *
 * Parsing is split from fetching: `parseListing` and `parseDetail` are pure, so the tests run
 * against committed HTML and never touch the network (CLAUDE.md rule 6).
 *
 * ## Pagination
 *
 * There is none. The template renders every upcoming activity into a single
 * `<ul class="articles">`, and neither Bømlo (2 activities) nor a busier lag such as Ski
 * (3 activities, fetched while writing this) carries a pager, a "load more" control, a `page=`
 * parameter, or a next-page link. A hagelag programme is a handful of evenings a year, so there
 * is nothing to page. If a lag ever outgrows one page this parser will silently import the first
 * page only — the guard against that is `recognised` below plus a run whose `fetched` count stops
 * growing, not a paginator written against a pager that does not exist.
 *
 * ## Politeness
 *
 * `https://bakhagen.hageselskapet.no/robots.txt` allows `User-agent: *` everywhere and asks for
 * `Crawl-delay: 5`. It disallows `ClaudeBot` by name; we are not ClaudeBot, we are hendingar.no's
 * own importer, and we identify as such in the User-Agent. The five seconds is honoured between
 * every request this importer makes — see `CRAWL_DELAY_MS`.
 */

/** One activity as the listing states it. Strings, unconverted — `map.ts` owns the conversion. */
export type RawEvent = {
	/**
	 * `data-articleId` on the `<article>` — Corepublish's own id for the activity, stable across
	 * runs and across a title being re-edited.
	 *
	 * Read case-insensitively on purpose. The attribute is written camelCase in the markup, HTML
	 * attribute names are case-insensitive, and anything that normalises the document (a browser,
	 * a DOM parser, a proxy that rewrites markup) hands it back as `data-articleid`.
	 */
	articleId: string;
	title: string;
	/** `datetime` of the `startDate` time element, exactly as written. May omit seconds. */
	startDateTime: string;
	/** `datetime` of the `endDate` time element, exactly as written. Often absent. */
	endDateTime: string | null;
	/**
	 * The clock the card prints under the title: `18:00`, or the literal `(heldags)` for a
	 * whole-day activity. Kept as written — `map.ts` decides what it means.
	 */
	clockLabel: string | null;
	/** `location > itemprop="name"`. Some lag write the full postal address into this field. */
	location: string;
	/** Absolute, query-free URL of the activity's own page. See `cleanUrl`. */
	sourceUrl: string;
};

export type ParsedListing = {
	events: RawEvent[];
	/** Cards that looked like events but could not be read, kept so a run can report them. */
	rejected: string[];
	/**
	 * Whether this is still the Bakhagen activity page we asked for.
	 *
	 * Zero events is a legitimate state — a small hagelag between programmes has nothing on, and
	 * the template then omits the whole `<ul class="articles">` list rather than rendering an
	 * empty one. So an empty result cannot be treated as an error, which leaves a redesign
	 * indistinguishable from a quiet month unless something else vouches for the page.
	 *
	 * The intro `<article itemtype="http://schema.org/Article" itemid="<the page URL>">` is that
	 * something: it is rendered on every activity page, including the empty ones, and it names the
	 * URL it belongs to. If it is gone, the page is not the page we think it is and the run fails
	 * loudly instead of reporting a successful import of nothing.
	 */
	recognised: boolean;
};

const NAMED_ENTITIES: Record<string, string> = {
	nbsp: ' ',
	amp: '&',
	lt: '<',
	gt: '>',
	quot: '"',
	apos: "'",
	oslash: 'ø',
	Oslash: 'Ø',
	aring: 'å',
	Aring: 'Å',
	aelig: 'æ',
	AElig: 'Æ',
	ndash: '–',
	mdash: '—'
};

/**
 * Entities in the rendered markup.
 *
 * Numeric references are handled generically rather than by a list of literals: Corepublish emits
 * whatever the hagelag typed into its editor, and the next lag will type a character this one
 * never did. `importers/kyrkja` learned that the expensive way — twenty-eight events published
 * with `B&#248;mlo` in the title.
 */
function decodeEntities(value: string): string {
	return value.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (match, body: string) => {
		if (body.startsWith('#')) {
			const code =
				body[1] === 'x' || body[1] === 'X'
					? Number.parseInt(body.slice(2), 16)
					: Number.parseInt(body.slice(1), 10);
			return Number.isFinite(code) && code > 0 && code <= 0x10ffff
				? String.fromCodePoint(code)
				: match;
		}
		return NAMED_ENTITIES[body] ?? match;
	});
}

const clean = (value: string) =>
	decodeEntities(value.replace(/<[^>]+>/g, ' '))
		.replace(/\s+/g, ' ')
		.trim();

/** One attribute off an already-matched start tag, quoted either way, name case-insensitive. */
function attr(tag: string, name: string): string | null {
	const match = new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, 'i').exec(tag);
	if (!match) return null;
	return match[2] ?? match[3] ?? null;
}

/**
 * Strip the query and the fragment.
 *
 * This is load-bearing, not tidiness. The card's own `href` carries `?instance=0`, and requesting
 * an activity page with a query string trips Corepublish's bot guard: it 302s to
 * `…?instance=0&cpbotguard=1`, which answers `403 Forbidden for non-conforming clients`. The same
 * path without the query answers 200. The `itemid` — which is the clean path plus an `#article`
 * fragment — is therefore the URL to build from, with the href as a fallback.
 */
export function cleanUrl(value: string, base: string): string | null {
	try {
		const url = new URL(decodeEntities(value.trim()), base);
		if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
		url.search = '';
		url.hash = '';
		return url.toString();
	} catch {
		return null;
	}
}

const EVENT_ARTICLE = /<article\b[^>]*schema\.org\/Event[^>]*>([\s\S]*?)<\/article>/gi;
const ARTICLE_TAG = /<article\b[^>]*schema\.org\/Event[^>]*>/i;
const TIME_TAG = /<time\b[^>]*>/gi;
const HEADING_NAME = /<h[1-6]\b[^>]*\bitemprop\s*=\s*["']name["'][^>]*>([\s\S]*?)<\/h[1-6]>/i;
const LOCATION_BLOCK = /schema\.org\/Place[^>]*>([\s\S]*?)<\/div>/i;
const SPAN_NAME = /<span\b[^>]*\bitemprop\s*=\s*["']name["'][^>]*>([\s\S]*?)<\/span>/i;
const CLOCK = /<div\b[^>]*\bclass\s*=\s*["'][^"']*\bstart-time\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/i;
const PAGE_ARTICLE = /<article\b[^>]*schema\.org\/Article[^>]*>/gi;

/** Trailing-slash-insensitive comparison, because the intro `itemid` and our config may differ. */
function sameUrl(a: string, b: string): boolean {
	return a.replace(/\/+$/, '') === b.replace(/\/+$/, '');
}

export function parseListing(html: string, pageUrl: string): ParsedListing {
	const events: RawEvent[] = [];
	const rejected: string[] = [];

	let recognised = false;
	for (const tag of html.matchAll(PAGE_ARTICLE)) {
		const itemid = attr(tag[0], 'itemid');
		if (itemid && sameUrl(itemid, pageUrl)) recognised = true;
	}

	for (const match of html.matchAll(EVENT_ARTICLE)) {
		const block = match[0];
		const body = match[1] ?? '';
		const openTag = ARTICLE_TAG.exec(block)?.[0] ?? '';

		const articleId = attr(openTag, 'data-articleId');
		if (!articleId) {
			// Without the source's own id there is no stable identity, and a title is not one:
			// the event would duplicate the first time somebody fixed a typo upstream.
			rejected.push('an activity card with no data-articleId');
			continue;
		}

		const titleMatch = HEADING_NAME.exec(body);
		const title = titleMatch ? clean(titleMatch[1] ?? '') : '';
		if (!title) {
			rejected.push(`activity ${articleId}: no title`);
			continue;
		}

		let startDateTime: string | null = null;
		let endDateTime: string | null = null;
		for (const timeTag of body.matchAll(TIME_TAG)) {
			const itemprop = attr(timeTag[0], 'itemprop');
			const datetime = attr(timeTag[0], 'datetime');
			if (!datetime) continue;
			if (itemprop === 'startDate' && !startDateTime) startDateTime = datetime.trim();
			if (itemprop === 'endDate' && !endDateTime) endDateTime = datetime.trim();
		}
		if (!startDateTime) {
			rejected.push(`${title} (${articleId}): no startDate`);
			continue;
		}

		/*
		 * The `itemid` is the clean path with an `#article` fragment; the anchor's href is the
		 * same path with `?instance=0`, which 403s. Either produces the right URL once stripped,
		 * and the itemid is preferred because it is the source's own statement of identity.
		 */
		const itemid = attr(openTag, 'itemid');
		const href = /<a\b[^>]*\bhref\s*=\s*["']([^"']+)["']/i.exec(body)?.[1] ?? null;
		const sourceUrl =
			(itemid ? cleanUrl(itemid, pageUrl) : null) ?? (href ? cleanUrl(href, pageUrl) : null);
		if (!sourceUrl) {
			rejected.push(`${title} (${articleId}): no usable link`);
			continue;
		}

		const locationBlock = LOCATION_BLOCK.exec(body)?.[1] ?? '';
		const locationName = SPAN_NAME.exec(locationBlock)?.[1] ?? '';
		const clockLabel = CLOCK.exec(body)?.[1] ?? null;

		events.push({
			articleId,
			title,
			startDateTime,
			endDateTime: endDateTime || null,
			clockLabel: clockLabel === null ? null : clean(clockLabel) || null,
			location: clean(locationName),
			sourceUrl
		});
	}

	return { events, rejected, recognised };
}

/**
 * The activity's own page.
 *
 * Unlike the listing, a detail page *does* carry a real `Event` in JSON-LD — with the description
 * the listing never shows, and with seconds in its timestamps. Only the description is taken from
 * here: the times come from the listing, which we always have, so a detail page that fails to load
 * costs a description and never an event.
 */
const detailSchema = z.object({
	'@type': z.literal('Event'),
	name: z.string().nullish(),
	description: z.string().nullish()
});

export type UpstreamDetail = z.infer<typeof detailSchema>;

const LD_BLOCK = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;

export function parseDetail(html: string): UpstreamDetail | null {
	for (const match of html.matchAll(LD_BLOCK)) {
		const body = match[1];
		if (!body) continue;
		let parsed: unknown;
		try {
			parsed = JSON.parse(body);
		} catch {
			// A page carries several blocks and a malformed one must not lose the good one.
			continue;
		}
		const result = detailSchema.safeParse(parsed);
		if (result.success) return result.data;
	}
	return null;
}

/**
 * robots.txt asks for `Crawl-delay: 5`. Honoured between every request, not only between pages of
 * one lag: a scheduled run walking several hagelag is the same crawler as far as the site is
 * concerned.
 */
export const CRAWL_DELAY_MS = 5_000;

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

export type ReadListing = (instance: BakhagenInstance) => Promise<string>;
export type ReadDetail = (url: string) => Promise<string>;
/** Injected so the tests are hermetic *and* fast — they wait for nothing (CLAUDE.md rule 6). */
export type Wait = (ms: number) => Promise<void>;

export const readListing: ReadListing = (instance) => getHtml(instance.url);
export const readDetail: ReadDetail = (url) => getHtml(url);
export const wait: Wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Waits the crawl delay before every request but the first one of the process. */
export type Pace = () => Promise<void>;

/**
 * robots.txt asks for `Crawl-delay: 5`, so requests are spaced by five seconds — across hagelag as
 * well as within one, because a scheduled run walking several of them is one crawler as far as the
 * site is concerned. The first request waits for nothing: the delay is *between* requests.
 */
export function createPacer(waitFor: Wait = wait): Pace {
	let first = true;
	return async () => {
		if (first) {
			first = false;
			return;
		}
		await waitFor(CRAWL_DELAY_MS);
	};
}
