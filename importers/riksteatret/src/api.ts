import type { RiksteatretInstance } from './instances.ts';

/**
 * Reading a Riksteatret venue page (`/spillested/<stad>/`).
 *
 * The page is server-rendered ASP.NET HTML. There is **no** JSON-LD, no microdata and no JSON
 * endpoint behind it — `/robots.txt` and `/spillesteder/` both 302 to the site's 404 page, the
 * sitemap lists only pages, and the venue page's own markup carries the whole programme. So this
 * is a scraper, and it parses the one machine-readable statement of a date the template makes:
 *
 *     <div class="item__date" datetime="27.10.2026 18:00">
 *
 * **The attribute, never the visible text.** The rendered date is split across tags —
 * `27. okt<i class="date__suffix">ober</i> 2026` — so flattening it to text depends on whitespace
 * luck and then needs a table of Norwegian month names. The attribute needs neither. Across 91
 * cards on eleven venue pages, every value matched `DD.MM.YYYY HH:MM` exactly.
 *
 * It is a **local wall clock with no offset**, which `map.ts` converts in the venue's zone. That
 * conversion is the one thing this importer must not get wrong, and it is why nothing here builds
 * a `Date`: parsing is strings in, strings out.
 *
 * Parsing is split from fetching, so the tests run against committed HTML and never touch the
 * network (CLAUDE.md rule 6).
 *
 * ## Pagination
 *
 * There is none. `<ul class="nav-program">` holds the venue's whole remaining season — 16 dates on
 * the busiest page sampled (Oslo, Vega Scene), 3–4 on a touring stop — with no pager, no "load
 * more" and no `page=` parameter. A season is a handful of evenings per hall; there is nothing to
 * page. The guard against a pager appearing later is `recognised` below plus a `fetched` count
 * that stops growing, not a paginator written against something that does not exist.
 *
 * ## Politeness
 *
 * `https://www.riksteatret.no/robots.txt` **does not exist**: it answers `302 → /404`, so there is
 * no `Crawl-delay` to honour and nothing is disallowed. `CRAWL_DELAY_MS` is therefore ours rather
 * than the site's — see the comment on it — and we identify in the User-Agent either way.
 */

/**
 * One performance as the page states it. Strings, unconverted — `map.ts` owns every conversion.
 */
export type RawPerformance = {
	/**
	 * `data-production-id` off the card's ticket link — Riksteatret's own id for the *production*,
	 * not for this evening. See `occurrenceId` in `map.ts` for why that distinction decides the
	 * external id.
	 */
	productionId: string;
	title: string;
	/** The `datetime` attribute exactly as written: `DD.MM.YYYY HH:MM`, a local wall clock. */
	datetime: string;
	/** `.item__descr p span` — the hall. "Bømlo kulturhus". */
	venueName: string;
	/** Absolute URL of the production's own page, from the card heading's link. */
	sourceUrl: string;
	/** Absolute URL of the ticket vendor, from the card's action link. */
	ticketUrl: string | null;
};

export type ParsedPage = {
	performances: RawPerformance[];
	/**
	 * Production id → poster URL, from the one highlighted-production module the template renders
	 * above the programme.
	 *
	 * A venue page features exactly one production (the next one playing there) and shows its
	 * poster in two crops; the portrait crop is the poster as printed. The module's own button
	 * carries the same `data-production-id` the programme cards do, which is what makes it safe to
	 * attach: the picture is a fact about the production, so every performance of that production
	 * at this venue gets it, and the rest get none rather than a guess.
	 */
	postersByProduction: Map<string, string>;
	/** Cards that looked like performances but could not be read, kept so a run can report them. */
	rejected: string[];
	/**
	 * Whether this is still the Riksteatret venue page we asked for.
	 *
	 * Zero performances is a legitimate state: a touring theatre visits a hall a few times a year,
	 * and between visits the programme list is simply empty. So an empty result cannot be an
	 * error, which leaves a redesign — or a silent 302 to the site's 404 page, which this host does
	 * for anything it does not recognise — indistinguishable from a quiet season.
	 *
	 * `<meta property="og:url">` is the tie-breaker: every venue page carries one, it names the
	 * venue URL it belongs to, and the 404 page's says `/404/`. If it is missing or names somewhere
	 * else, the run fails loudly instead of reporting a successful import of nothing.
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
 * Riksteatret's template escapes every non-ASCII character as a numeric reference — the Bømlo page
 * says `B&#xF8;mlo` in the heading and in every venue name — so this is not optional decoration.
 * Numeric references are handled generically rather than by a list of literals, which is the
 * lesson `importers/kyrkja` paid for with twenty-eight events published as `B&#248;mlo`.
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

/** Tags out, entities decoded, whitespace collapsed. */
function clean(value: string): string {
	return decodeEntities(value.replace(/<[^>]+>/g, ' '))
		.replace(/\s+/g, ' ')
		.trim();
}

/** One attribute off an already-matched start tag, quoted either way, name case-insensitive. */
function attr(tag: string, name: string): string | null {
	const match = new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, 'i').exec(tag);
	if (!match) return null;
	return match[2] ?? match[3] ?? null;
}

/** Absolute, http(s) only. Card links are site-relative (`/repertoar/apestjernen/`). */
export function absoluteUrl(value: string, base: string): string | null {
	try {
		const url = new URL(decodeEntities(value.trim()), base);
		if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
		return url.toString();
	} catch {
		return null;
	}
}

/** Trailing-slash-insensitive comparison: `og:url` and our config may spell the URL differently. */
function sameUrl(a: string, b: string): boolean {
	return a.replace(/\/+$/, '') === b.replace(/\/+$/, '');
}

const OG_URL = /<meta\b[^>]*\bproperty\s*=\s*["']og:url["'][^>]*>/i;
const PROGRAM_ITEM = /<li class="nav-program__item">([\s\S]*?)<\/li>/gi;
const ITEM_DATE = /<div\b[^>]*\bclass\s*=\s*["'][^"']*\bitem__date\b[^"']*["'][^>]*>/i;
const HEADING_LINK = /<h2>\s*<a\b[^>]*\bhref\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/i;
const DESCR_VENUE =
	/<div\b[^>]*\bclass\s*=\s*["'][^"']*\bitem__descr\b[^"']*["'][^>]*>[\s\S]*?<p>\s*<span>([\s\S]*?)<\/span>/i;
const ACTION_LINK = /<a\b[^>]*\bdata-production-id\s*=\s*["'](\d+)["'][^>]*>/i;
const FEATURE_MODULE = /<div class="module module--feature[^"]*">([\s\S]*?)<\/section>/gi;
const PORTRAIT_IMG = /<img\b[^>]*\bclass\s*=\s*["'][^"']*\bportrait-image\b[^"']*["'][^>]*>/i;

/**
 * `data-production-id` sits on the ticket anchor, whose `href` is the vendor. Both are read from
 * the same tag so a card can never contribute one without the other.
 */
function readAction(
	item: string,
	base: string
): { productionId: string; ticketUrl: string | null } | null {
	const tag = ACTION_LINK.exec(item)?.[0];
	if (!tag) return null;
	const productionId = attr(tag, 'data-production-id');
	if (!productionId) return null;
	const href = attr(tag, 'href');
	return { productionId, ticketUrl: href ? absoluteUrl(href, base) : null };
}

export function parseVenuePage(html: string, pageUrl: string): ParsedPage {
	const performances: RawPerformance[] = [];
	const rejected: string[] = [];

	const ogUrl = OG_URL.exec(html)?.[0] ?? null;
	const declaredUrl = ogUrl ? attr(ogUrl, 'content') : null;
	const recognised = declaredUrl !== null && sameUrl(declaredUrl, pageUrl);

	const postersByProduction = new Map<string, string>();
	for (const module of html.matchAll(FEATURE_MODULE)) {
		const body = module[1] ?? '';
		const productionId = attr(ACTION_LINK.exec(body)?.[0] ?? '', 'data-production-id');
		const portrait = PORTRAIT_IMG.exec(body)?.[0] ?? '';
		const src = attr(portrait, 'src');
		if (!productionId || !src) continue;
		const poster = absoluteUrl(src, pageUrl);
		if (poster) postersByProduction.set(productionId, poster);
	}

	for (const match of html.matchAll(PROGRAM_ITEM)) {
		const item = match[1] ?? '';

		const heading = HEADING_LINK.exec(item);
		const title = clean(heading?.[2] ?? '');
		const href = heading?.[1] ?? null;

		const dateTag = ITEM_DATE.exec(item)?.[0] ?? '';
		const datetime = attr(dateTag, 'datetime')?.trim() ?? null;
		if (!datetime) {
			// The visible date is deliberately not a fallback: it is split across tags and spelled
			// in Norwegian, so reading it would be guessing where the attribute was authoritative.
			rejected.push(`${title || 'a card'}: no datetime attribute on .item__date`);
			continue;
		}
		if (!title || !href) {
			rejected.push(`the card for ${datetime}: no linked title`);
			continue;
		}

		const action = readAction(item, pageUrl);
		if (!action) {
			/*
			 * Without the production id there is no stable identity, and the title is not one — a
			 * retitled production would arrive as a second event. Rejecting is the honest outcome
			 * and the run reports it. Every one of 91 cards across eleven venue pages carried the
			 * attribute, so this is a guard rather than a path we expect to take.
			 */
			rejected.push(`${title} (${datetime}): no data-production-id`);
			continue;
		}

		const sourceUrl = absoluteUrl(href, pageUrl);
		if (!sourceUrl) {
			rejected.push(`${title} (${datetime}): unusable link ${href}`);
			continue;
		}

		performances.push({
			productionId: action.productionId,
			title,
			datetime,
			venueName: clean(DESCR_VENUE.exec(item)?.[1] ?? ''),
			sourceUrl,
			ticketUrl: action.ticketUrl
		});
	}

	return { performances, postersByProduction, rejected, recognised };
}

/**
 * Two seconds between requests.
 *
 * **This number is ours, not the site's.** `https://www.riksteatret.no/robots.txt` answers
 * `302 → /404` — there is no robots.txt, so no `Crawl-delay` was stated and nothing is
 * disallowed. Two seconds is a conservative self-imposed floor for a page-per-venue crawl that is
 * designed to grow to dozens of halls: one venue a day costs nothing, and a run across every
 * Riksteatret venue would still be gentler than a single human clicking through the dropdown.
 */
export const CRAWL_DELAY_MS = 2_000;

const HEADERS = {
	// Identifying, with a contact URL, as docs/event-sources.md asks of every importer.
	'user-agent': 'hendingar.no importer (+https://hendingar.no)',
	accept: 'text/html'
};

export type ReadVenuePage = (instance: RiksteatretInstance) => Promise<string>;

export const readVenuePage: ReadVenuePage = async (instance) => {
	const response = await fetch(instance.url, {
		headers: HEADERS,
		// `manual`, because this host answers anything it does not recognise with a 302 to /404 —
		// following it would hand the parser a 200-OK page that is not the venue's. `recognised`
		// would still catch it; failing on the redirect names the problem instead.
		redirect: 'manual',
		signal: AbortSignal.timeout(30_000)
	});
	if (response.status >= 300 && response.status < 400) {
		throw new Error(
			`${instance.url} redirected to ${response.headers.get('location') ?? 'somewhere'}`
		);
	}
	if (!response.ok) throw new Error(`${instance.url} responded ${response.status}`);
	return response.text();
};

/** Injected so the tests are hermetic *and* fast — they wait for nothing (CLAUDE.md rule 6). */
export type Wait = (ms: number) => Promise<void>;
export const wait: Wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export type Pace = () => Promise<void>;

/**
 * Waits the crawl delay before every request but the first one of the process — the delay is
 * *between* requests, so making the first one wait would add dead time to every scheduled run
 * without being any politer. Shared across venues, because a run walking several of them is one
 * crawler as far as the site is concerned.
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
