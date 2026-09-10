import { z } from 'zod';
import { eventDetailUrl, eventsUrl, type HooplaShop } from './shops.ts';

/**
 * Reading a public Hoopla ticket shop.
 *
 * `https://<shop>.hoopla.no/api/public/v3.0/organizations/<id>/events` answers `{events: […]}`
 * with no key and no auth. It is the endpoint the shop's own React client calls, found the way
 * docs/event-sources.md describes: the shop HTML is an empty `<div id="root">` plus
 * `sales-4/loader.production.js`, which names `static/js/main.<hash>.js`, in which the only
 * `/api/public/…` paths are this list and `…/events/<id>` beside it. Undocumented, therefore
 * validated field by field — a payload that changes shape must fail loudly here rather than
 * arrive as an event with no date.
 *
 * ## The virtual waiting room applies to the page, not to this
 *
 * `https://smaasceneri.hoopla.no/` 302s to `hoopla.queue-it.net` and only serves HTML once a
 * `queueittoken` has been exchanged for a cookie. That looks like a wall, and reading it as one
 * would have meant either a cookie dance or abandoning the source.
 *
 * It is not a wall: **the JSON endpoint is not queued.** Verified with no cookie jar, no prior
 * request and our own user-agent — `200 application/json`, the full payload. Queue-It is fronting
 * the ticket-buying flow, which is what it is for; nothing here goes near a checkout. So this
 * importer sends plain requests and keeps no session, and if that ever changes it will change as
 * a `302` on a JSON call, which `getJson` rejects loudly rather than parsing an HTML challenge
 * page into zero events.
 *
 * ## The times are real instants, and that was checked rather than assumed
 *
 * CLAUDE.md is emphatic that a source's stated offset is not evidence: Modern Events Calendar adds
 * the site's offset to a wall clock and then writes the offset it just added, so a 16:00 event
 * publishes as 18:00 in the page, the JSON-LD and the `.ics` alike.
 *
 * Hoopla is not that, and the committed fixtures contain the proof — which is stronger here than
 * a single reading, because it straddles a clock change:
 *
 *   - `smaasceneri-event-174397646` — 11 September, CEST (+02). `start` is `19:00Z`, and the
 *     organiser's own description says "Dørene opnar kl 20:00, showstart kl 21:00!". 19:00Z is
 *     21:00 in Oslo. Agrees.
 *   - `smaasceneri-event-698512154` — 6 November, CET (+01). Same event series, same prose
 *     ("showstart kl 21:00"), and `start` is `20:00Z`. 20:00Z is 21:00 in Oslo. Agrees.
 *
 * The raw UTC differs by exactly one hour between the two *in order to keep the local clock the
 * same*, which is what a system storing true instants does and precisely what an offset-adder
 * cannot do — MEC would have written `19:00` for both. That is the cross-check CLAUDE.md asks
 * for, from prose the source shows a human, on both sides of the DST boundary.
 *
 * So these are parsed as instants and stored as instants. Nothing here resolves a wall clock, and
 * nothing here should start to. The shop's `Europe/Oslo` is for the venue row only.
 */

/** An ISO instant. Required, and required to actually parse — `Invalid Date` is not a date. */
const instant = z.string().refine((s) => Number.isFinite(Date.parse(s)), 'not a parseable instant');

const nullableInstant = z
	.string()
	.nullish()
	.transform((s) => (s && Number.isFinite(Date.parse(s)) ? s : null));

/**
 * One of the three crops Hoopla keeps per image.
 *
 * Only `url` is read. The crop rectangle and the blurhash are declared so the shape is documented
 * where the next person looks, and because naming a field we ignore is cheaper than wondering
 * later whether it existed.
 */
const image = z
	.object({
		url: z.string().nullish(),
		width: z.number().nullish(),
		height: z.number().nullish()
	})
	.nullish();

/**
 * The top-level `images`, not `data.images`.
 *
 * Both exist and carry the same URLs, and `data.images` is the one that goes missing: event
 * 698512154 in the committed fixture has no `images` key inside `data` at all while the top-level
 * object is fully populated. So the flat one is the one to read, and this is the reason.
 */
const images = z
	.object({
		crop16x9: image,
		crop4x3: image,
		crop1x1: image
	})
	.nullish();

/**
 * Where the event is. Discrete fields, which is the clean case `fromParts` was written for.
 *
 * `coordinates` is `null` on every row in the fixture and absent altogether on one. Declared
 * because the bundle reads `u.coordinates.latitude`, so the shop's own client expects it to be
 * populated sometimes — and a coordinate the organiser picked is worth storing when it appears.
 */
const location = z
	.object({
		name: z.string().nullish(),
		street_address: z.string().nullish(),
		postal_code: z.string().nullish(),
		postal_area: z.string().nullish(),
		coordinates: z.object({ latitude: z.number(), longitude: z.number() }).nullish()
	})
	.nullish();

const eventData = z.object({
	/**
	 * One of `CONCERT CONFERENCE FESTIVAL SEMINAR COURSE SHOW SPORTS EXHIBITION GATHERING OTHER`
	 * — the list the bundle validates against. Kept as a plain string rather than a Zod enum: a
	 * vocabulary somebody else owns must not be able to reject a whole event by growing, and
	 * `map.ts` sends anything it does not recognise to `anna`.
	 */
	category: z.string().nullish(),
	/** Free text the organiser types when they pick `OTHER`. Read by nobody — see map.ts. */
	other_category_description: z.string().nullish(),
	location
});

const eventSchema = z.object({
	/** Stable per event, and our `external_id` — see the note in map.ts. */
	event_id: z.number(),
	name: z.string().min(1),
	start: instant,
	end: nullableInstant,
	is_cancelled: z.boolean().nullish(),
	data: eventData,
	images,
	/**
	 * `active` and friends. Not a filter — see `isPublishable` in map.ts.
	 */
	sale_state: z.string().nullish(),
	/** `MANY_LEFT` | `FEW_LEFT` | `SOLD_OUT`. Also not a filter. */
	availability: z.string().nullish(),
	/** Present on the list, always null in the fixture. The detail record is where prose lives. */
	short_description: z.string().nullish()
});

export type UpstreamEvent = z.infer<typeof eventSchema>;

const envelope = z.object({
	/*
	 * Required, not optional, and `importers/luma` records why in the same words.
	 *
	 * `.nullish()` here would let `{"error": "nope"}` parse cleanly into zero rows — so an error
	 * document, a Queue-It challenge page or a renamed endpoint would all arrive as "this shop has
	 * no events", which is a thing that legitimately happens and therefore the one failure we
	 * cannot afford to imitate. A real response always carries the key, even when it is empty.
	 */
	events: z.array(z.unknown())
});

export type Parsed = { rows: UpstreamEvent[]; rejected: string[] };

/**
 * Validate the list response. A row that does not fit is reported, not thrown away silently.
 *
 * The envelope failing IS thrown, for the reason above.
 */
export function parseEvents(body: unknown): Parsed {
	const outer = envelope.safeParse(body);
	if (!outer.success) {
		throw new Error(`unexpected events shape: ${outer.error.issues[0]?.message}`);
	}
	const rows: UpstreamEvent[] = [];
	const rejected: string[] = [];
	for (const raw of outer.data.events) {
		const parsed = eventSchema.safeParse(raw);
		if (parsed.success) rows.push(parsed.data);
		else {
			rejected.push(parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join(', '));
		}
	}
	return { rows, rejected };
}

/**
 * The detail record, for the description and nothing else.
 *
 * Lenient on purpose, and the opposite of the envelope above: this is a *supplement*, so a detail
 * response that has changed shape must cost a description and never an event. `parseDetail`
 * therefore returns `null` rather than throwing, and `ingest.ts` carries on.
 */
const detailEnvelope = z.object({
	event: z.object({ description: z.string().nullish() }).nullish()
});

export function parseDetail(body: unknown): string | null {
	const parsed = detailEnvelope.safeParse(body);
	if (!parsed.success) return null;
	return parsed.data.event?.description?.trim() || null;
}

const HEADERS = {
	// Identifying, with a contact URL, as docs/event-sources.md asks of every importer.
	'user-agent': 'hendingar.no importer (+https://hendingar.no)',
	accept: 'application/json'
};

/**
 * `redirect: 'error'` is the Queue-It tripwire.
 *
 * If Hoopla ever puts the waiting room in front of the API too, the first symptom is a 302 to
 * `queue-it.net`. Following it would fetch an HTML challenge page, `response.json()` would throw
 * something about unexpected `<`, and the run would fail with a message pointing nowhere. Refusing
 * to follow makes it fail on the redirect itself, which names the thing that changed.
 */
async function getJson(url: string): Promise<unknown> {
	const response = await fetch(url, {
		headers: HEADERS,
		redirect: 'error',
		signal: AbortSignal.timeout(30_000)
	});
	if (!response.ok) throw new Error(`${url} responded ${response.status}`);
	return response.json();
}

export type ReadEvents = (shop: HooplaShop) => Promise<unknown>;
export type ReadDetail = (shop: HooplaShop, eventId: number) => Promise<unknown>;
/** Injected so the tests are hermetic *and* fast — they wait for nothing (CLAUDE.md rule 6). */
export type Wait = (ms: number) => Promise<void>;
export type Pace = () => Promise<void>;

export const readEvents: ReadEvents = (shop) => getJson(eventsUrl(shop));
export const readDetail: ReadDetail = (shop, eventId) => getJson(eventDetailUrl(shop, eventId));

export const wait: Wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Between detail requests, and not before the first.
 *
 * Half a second rather than the ten `importers/allevents` uses: that one scrapes HTML pages and
 * Hoopla's robots.txt is `Disallow:` with no `Crawl-delay`, so there is no stated limit to
 * respect and this is a small JSON document behind a CDN. Slow enough to be one polite client,
 * fast enough that the daily job is not held open by it.
 */
export const CRAWL_DELAY_MS = 500;

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
 * How many descriptions one shop may cost us.
 *
 * The list endpoint has no pagination and accepts no parameters — `?limit`, `?period` and
 * `?include_past` are all ignored, verified against this shop — so it returns exactly what the
 * organiser has on sale, which for a small theatre company is four events. This cap exists for
 * the shop that is not small: a thousand-event shop would otherwise turn one API call into a
 * thousand, and a run that spends nine minutes collecting prose is a run that is holding up
 * fourteen other sources.
 *
 * Events past the cap are still imported, with no description. That is the right way round: the
 * description is the supplement and the event is the point.
 */
export const MAX_DETAILS = 200;
