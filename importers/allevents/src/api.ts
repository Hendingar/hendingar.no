import { z } from 'zod';
import { isEventNode, jsonLdNodes } from '@hendingar/core/schemaorg';
import type { AlleventsOrganiser } from './organisers.ts';

/**
 * Reading an allevents.in organiser's programme.
 *
 * ## Why the JSON endpoint and not the organiser page's JSON-LD
 *
 * `allevents.in/org/<slug>/<id>` does carry `application/ld+json` with one `Event` node per event,
 * and reading it is a trap: **its `startDate` is date-only** (`"2026-09-19"`). Storing that would
 * mean either inventing a time nobody stated or flattening a `timestamptz` to midnight, and both
 * are forbidden here — `starts_at` is an instant.
 *
 * The page's own Vue app does not use that markup either. It renders from
 * `POST https://allevents.in/api/index.php/organizer/web/get_events`, found by following `showMore`
 * in `allevents.in/scripts/organizer-combined.js` to the `wsbase` defined in `common.js` — exactly
 * the "look for a hidden JSON API" walk `docs/event-sources.md` describes. That response carries a
 * real time of day, plus the categories, the venue, the ticket link and the publication flags, so it
 * is what we read.
 *
 * **Its `start_time` is a trap of its own**, and a subtler one than the date-only markup: it is a
 * plain integer that looks exactly like epoch seconds and is the local wall clock serialised as if
 * it were UTC. Taking it at face value publishes every event one or two hours late. `map.ts` owns
 * that conversion and the evidence for it — read `wallClockToInstant` before touching times here.
 *
 * Undocumented, therefore validated on every hit: a changed shape must fail loudly rather than
 * import nothing and report success.
 *
 * ## What still needs the event's own page
 *
 * Only the description. `get_events` does not return one, and an event page's
 * `<div class="event-description-html">` holds the organiser's full text — the JSON-LD `description`
 * on the same page is truncated to roughly 250 characters mid-word. That costs one request per
 * event, so `parseDetail` is a *supplement*: a detail page that fails loses a description, never an
 * event (see `ingest.ts`).
 *
 * ## Politeness
 *
 * `https://allevents.in/robots.txt` disallows only old year-archive paths (`/*​/2013-0` and friends)
 * and a long list of `?ref=` tracking variants. `/org/`, `/events/` and `/api/index.php` are all
 * allowed, and `User-agent: *` is given **no** crawl delay.
 *
 * We take one anyway, and we take the strictest number the file states for any general-purpose
 * automated reader: the `Crawl-delay: 10` it asks of ClaudeBot and AhrefsBot. We are neither — we
 * are hendingar.no's own importer and we say so in the User-Agent — but the file is the site telling
 * us what pace it considers acceptable from a machine, and this importer makes one request per
 * event rather than one per source. Ten seconds between every request, across organisers as well as
 * within one, because a scheduled run walking several profiles is one crawler as far as the site is
 * concerned.
 *
 * Parsing is split from fetching, so the tests run against committed responses (CLAUDE.md rule 6).
 */

export const ENDPOINT = 'https://allevents.in/api/index.php/organizer/web/get_events';

/**
 * A page of the organiser's upcoming events, exactly as the page's own Vue app asks for it.
 *
 * `past: 0` is upcoming only, `city: 0` means "do not narrow to a city" and `page` is **zero-based**
 * — page 0 is the first page, and a page past the end answers `{"error":0,"count":0,"data":[]}`
 * rather than an error. Verified against Stord Jazzklubb at `count: 3`: page 0 and page 1 returned
 * disjoint threes in date order.
 */
export const requestBody = (organiser: AlleventsOrganiser, page: number, count: number) => ({
	organizer_id: organiser.organiserId,
	past: 0,
	page,
	count,
	city: 0,
	past_events_filter: 1
});

/**
 * One event as `get_events` states it.
 *
 * Only the fields we read are described; the payload carries another twenty (`rsvp_status`,
 * `featured`, review counts) that are none of our business. Types are as observed and deliberately
 * loose where the API is inconsistent — `spam` and `draft` come back as the *strings* `"0"`, and an
 * id is a string here while the same id is a number elsewhere on the site.
 */
const eventSchema = z.object({
	event_id: z.union([z.string(), z.number()]),
	eventname: z.string(),
	/**
	 * **Looks like epoch seconds and is not.** It is the organiser's local wall clock serialised as
	 * though it were UTC — 1789844400 for a concert that starts 19:00 in Oslo, which as a true epoch
	 * would be 21:00 there. `map.ts` converts it; see `wallClockToInstant`, which carries the
	 * evidence.
	 */
	start_time: z.number(),
	/**
	 * The same encoding, and **equal to `start_time` when the organiser stated no end**. Not null,
	 * not absent — the same number again, which `map.ts` has to recognise rather than store a
	 * zero-length event.
	 */
	end_time: z.number().nullish(),
	/**
	 * The offset the record claims, e.g. `"+02:00"`. Correct in the data seen — it says `+01:00` for
	 * the November and December concerts — but used only to *cross-check* the venue's IANA zone,
	 * never as the source of truth: an offset is a fact about one moment, a zone is a fact about a
	 * place. See `offsetAgrees`.
	 */
	timezone: z.string().nullish(),
	/** The place as one line. Sometimes a hall's name, sometimes a bare postal address. */
	location: z.string().nullish(),
	venue: z
		.object({
			street: z.string().nullish(),
			city: z.string().nullish(),
			state: z.string().nullish(),
			country: z.string().nullish(),
			latitude: z.union([z.string(), z.number()]).nullish(),
			longitude: z.union([z.string(), z.number()]).nullish(),
			full_address: z.string().nullish()
		})
		.nullish(),
	event_url: z.string(),
	/** Where the organiser sends people to book. Often a real box office; sometimes Facebook. */
	ticket_url: z.string().nullish(),
	/**
	 * allevents.in's own category slugs, lowercase — except when they are not (`["Concerts",
	 * "Music", "Entertainment"]` on one of the eight jazz events). `map.ts` folds the case.
	 */
	categories: z.array(z.string()).nullish(),
	/**
	 * The 500×250 rendition their imgproxy serves. `map.ts` rebuilds it at useful widths; see
	 * `posterFrom`.
	 */
	banner_url: z.string().nullish(),
	status: z.string().nullish(),
	spam: z.union([z.string(), z.number()]).nullish(),
	draft: z.union([z.string(), z.number()]).nullish()
});

export type UpstreamEvent = z.infer<typeof eventSchema>;

/**
 * The envelope.
 *
 * `error` is `0` on success and non-zero on failure, and the HTTP status is 200 either way — the
 * endpoint reports its own problems in the body. `data` is read as `unknown[]` so one malformed
 * record can be rejected and reported without losing the page.
 */
const responseSchema = z.object({
	error: z.union([z.number(), z.string()]),
	message: z.string().nullish(),
	data: z.array(z.unknown()).nullish(),
	count: z.number().nullish()
});

export type ParsedPage = {
	events: UpstreamEvent[];
	/** Records that looked like events but did not validate, kept so a run can report them. */
	rejected: string[];
};

export function parsePage(body: unknown): ParsedPage {
	const outer = responseSchema.safeParse(body);
	if (!outer.success) {
		throw new Error(`unexpected get_events response: ${outer.error.issues[0]?.message}`);
	}
	if (Number(outer.data.error) !== 0) {
		throw new Error(
			`get_events reported error ${outer.data.error}: ${outer.data.message ?? 'no message'}`
		);
	}

	const events: UpstreamEvent[] = [];
	const rejected: string[] = [];
	for (const record of outer.data.data ?? []) {
		const parsed = eventSchema.safeParse(record);
		if (parsed.success) events.push(parsed.data);
		else
			rejected.push(parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join(', '));
	}
	return { events, rejected };
}

/** What the site's own page asks for. Kept the same so we look like an ordinary reader. */
export const PAGE_SIZE = 25;

/**
 * How many pages to walk. An organiser with more than 250 upcoming events is not a local club, and
 * a paginator with no ceiling is a way to walk a directory of several million events by accident.
 */
export const MAX_PAGES = 10;

/**
 * robots.txt states no delay for `User-agent: *`; this is the ten seconds it asks of ClaudeBot and
 * AhrefsBot, adopted as the site's own statement of an acceptable machine pace. See the module
 * comment.
 */
export const CRAWL_DELAY_MS = 10_000;

const HEADERS = {
	'content-type': 'application/json',
	// Identifying, with a contact URL, as docs/event-sources.md asks of every importer.
	'user-agent': 'hendingar.no importer (+https://hendingar.no)'
};

export type ReadEvents = (organiser: AlleventsOrganiser, page: number) => Promise<unknown>;
export type ReadDetail = (url: string) => Promise<string>;
/** Injected so the tests are hermetic *and* fast — they wait for nothing (CLAUDE.md rule 6). */
export type Wait = (ms: number) => Promise<void>;
export type Pace = () => Promise<void>;

export const readEvents: ReadEvents = async (organiser, page) => {
	const response = await fetch(ENDPOINT, {
		method: 'POST',
		headers: HEADERS,
		body: JSON.stringify(requestBody(organiser, page, PAGE_SIZE)),
		signal: AbortSignal.timeout(30_000)
	});
	if (!response.ok) throw new Error(`get_events responded ${response.status}`);
	return response.json();
};

export const readDetail: ReadDetail = async (url) => {
	const response = await fetch(url, {
		headers: {
			'user-agent': HEADERS['user-agent'],
			accept: 'text/html'
		},
		signal: AbortSignal.timeout(30_000)
	});
	if (!response.ok) throw new Error(`${url} responded ${response.status}`);
	return response.text();
};

export const wait: Wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Waits the crawl delay before every request but the first one of the process.
 *
 * Shared across organisers by `ingestAll`, so the pace holds for the whole run rather than resetting
 * per profile.
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

/**
 * Every upcoming event for one organiser.
 *
 * Stops on the first short page. The endpoint returns exactly `count` records while there are more
 * and fewer when there are not, and a page past the end is an empty success rather than an error —
 * so a short page is the end of the list, and no total needs to be trusted.
 */
export async function fetchAll(
	organiser: AlleventsOrganiser,
	read: ReadEvents,
	pace: Pace
): Promise<ParsedPage> {
	const events: UpstreamEvent[] = [];
	const rejected: string[] = [];

	for (let page = 0; page < MAX_PAGES; page += 1) {
		await pace();
		const parsed = parsePage(await read(organiser, page));
		events.push(...parsed.events);
		rejected.push(...parsed.rejected);
		if (parsed.events.length + parsed.rejected.length < PAGE_SIZE) break;
	}

	return { events, rejected };
}

/* ------------------------------------------------------------------ the event's own page ----- */

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
 * Numeric references are handled generically rather than by a list of literals: the text is whatever
 * the organiser typed into Facebook, and the next one will type a character this one did not.
 * `importers/kyrkja` learned that the expensive way — twenty-eight events published with
 * `B&#248;mlo` in the title.
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

const DESCRIPTION_BLOCK =
	/<div\b[^>]*\bclass=["']event-description-html["'][^>]*>([\s\S]*?)<\/div>/i;

/**
 * The organiser's own text, as paragraphs.
 *
 * Two things have to be got right:
 *
 * - **Where the description stops.** allevents.in glues a "You may also like the following events
 *   from …" block, with links to the organiser's other events, inside the very same div. It is
 *   always wrapped in `<p>`, and the organiser's own text — mirrored from Facebook — contains only
 *   `<br />`. So the first `<p` ends the description. Both committed fixtures show that boundary,
 *   and the jazz one would otherwise import a list of three other concerts as part of its blurb.
 * - **Paragraph breaks survive.** The event page splits `description` on blank lines to render
 *   paragraphs, so `<br />` pairs become `\n\n` rather than being flattened to spaces.
 */
export function readDescriptionHtml(html: string): string | null {
	const block = DESCRIPTION_BLOCK.exec(html)?.[1];
	if (!block) return null;

	const promoAt = block.search(/<p\b/i);
	const own = promoAt === -1 ? block : block.slice(0, promoAt);

	const text = decodeEntities(
		own
			.replace(/<br\s*\/?>/gi, '\n')
			.replace(/<[^>]+>/g, ' ')
			// Collapse runs of spaces and tabs but keep newlines, which carry the paragraphs.
			.replace(/[^\S\n]+/g, ' ')
	)
		.split('\n')
		.map((line) => line.trim())
		.join('\n')
		.replace(/\n{3,}/g, '\n\n')
		.trim();

	return text || null;
}

const jsonLdDescriptionSchema = z.object({ description: z.string().nullish() });

/**
 * The JSON-LD `description` on the same page, as a fallback.
 *
 * Truncated upstream to roughly 250 characters and cut mid-word, so it is strictly worse than the
 * div — but it survives a template change that the div would not, and half a description beats
 * none. Note that `@type` here is a **subtype**: the jazz concert is `MusicEvent` and the yoga
 * opening is a bare `Event`, which is why the shared `isEventNode` matches on the suffix.
 */
export function readJsonLdDescription(html: string): string | null {
	for (const node of jsonLdNodes(html)) {
		if (!isEventNode(node)) continue;
		const parsed = jsonLdDescriptionSchema.safeParse(node);
		const description = parsed.success ? parsed.data.description?.trim() : null;
		if (description) return description;
	}
	return null;
}

export type UpstreamDetail = {
	description: string | null;
	/**
	 * Whether the description is the organiser's whole text or upstream's truncated stub.
	 *
	 * This is load-bearing, and it exists because **allevents.in serves two different templates for
	 * the same URL**. Measured on `…/spøt-og-drøs/200030473335209`, three polite fetches a quarter of
	 * a minute apart: 252 757 bytes with the description div, 252 868 bytes with it, then 163 030
	 * bytes without it. Same URL, same headers, HTTP 200 every time.
	 *
	 * So which of the two descriptions a run gets is a coin toss, and without a way to tell them
	 * apart the importer would rewrite the field every night — full text, stub, full text — reporting
	 * each flip as an `updated` and showing readers a description that keeps shrinking and growing.
	 * `ingest.ts` uses this flag to refuse the downgrade.
	 */
	truncated: boolean;
};

export function parseDetail(html: string): UpstreamDetail {
	const full = readDescriptionHtml(html);
	if (full) return { description: full, truncated: false };
	return { description: readJsonLdDescription(html), truncated: true };
}
