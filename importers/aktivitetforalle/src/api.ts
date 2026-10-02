import { z } from 'zod';
import { eventsUrl, filtersUrl, locationsUrl, organizersUrl, type AfaSite } from './sites.ts';

/**
 * Reading an "Aktivitet for Alle" portal.
 *
 * The site is server-rendered but carries no machine-readable dates; its data comes from a public
 * JSON API under `/api/v1`, discovered from the `Sitemap: /api/v1/sitemap` line in robots.txt.
 * `/api/v1/events` returns the whole collection in one response, which is what makes this importer
 * possible at all — robots.txt asks for a 600-second crawl delay.
 *
 * Everything is validated: the API is undocumented, and it stringifies aggressively.
 */

/**
 * The API serialises Python's `None` as the four-character string "None".
 *
 * Not as JSON null, and not consistently — the same field is `null` on one row and `"None"` on the
 * next. A plain `?? fallback` therefore keeps the word "None", which is how a venue ends up called
 * None on a poster. Every optional string goes through this.
 */
export function orNull(value: unknown): string | null {
	if (value === null || value === undefined) return null;
	const text = String(value).trim();
	return text === '' || text === 'None' ? null : text;
}

const nullish = z.preprocess(orNull, z.string().nullable());

/**
 * One rendition of an upload: the same picture, resized.
 *
 * The platform generates a ladder per upload and names the files beside the original, so the name
 * is all we need to address one — see `posterSrcsetFrom` in map.ts. Validated loosely and with a
 * `.catch` on the array below: a ladder we cannot read costs a `srcset`, and must never cost the
 * event.
 */
const variantSchema = z.object({
	/** A file name beside the original: `original-640w.webp`, or `w640.avif` on older uploads. */
	name: z.string(),
	width: z.number().nullish(),
	height: z.number().nullish(),
	mime: z.string().nullish(),
	format: z.string().nullish(),
	upload_exists: z.boolean().nullish()
});

const uploadSchema = z
	.object({
		/**
		 * The file — and **not reliably absolute**, whatever an older comment here claimed.
		 *
		 * It was `https://bomlo.aktivitetforalle.no/uploads/…` when this importer was written and is
		 * `/uploads/…` now, on every one of the 180 uploads the portal holds. Nothing announced the
		 * change and nothing failed: `new URL()` threw on the relative path, the mapper swallowed it
		 * as "no poster", and 81 of 82 events quietly lost their picture while every run still
		 * reported success. Resolve it against the site's origin, which is right either way.
		 */
		upload_url: z.string().nullish(),
		upload_mime: z.string().nullish(),
		upload_public: z.boolean().nullish(),
		/** The portal's own flag for a file it no longer has. */
		upload_exists: z.boolean().nullish(),
		/** `"1920x1005"` — the original's pixels, which is how a resize is told from a crop. */
		upload_resolution: z.string().nullish(),
		upload_variants: z.array(variantSchema).nullish().catch(null)
	})
	.nullish();

/** The thumbnail object as the API sends it. `map.ts` reads the ladder out of this. */
export type UpstreamUpload = NonNullable<z.infer<typeof uploadSchema>>;

const eventSchema = z.object({
	event_id: z.union([z.string(), z.number()]),
	event_title: z.string(),
	/** `public` | `archived` | `draft`. Only the first is published anywhere. */
	event_status: nullish,
	/** `arrangement` (a dated event) | `activity` (a standing weekly offer). */
	event_type: nullish,
	event_summary: nullish,
	event_description: nullish,
	/** Naive wall clock, "YYYY-MM-DD HH:MM:SS", with no zone anywhere in the payload. */
	event_from: nullish,
	event_to: nullish,
	event_location_type: nullish,
	event_location_id: z.union([z.string(), z.number()]).nullish(),
	event_location_custom_title: nullish,
	event_location_address1: nullish,
	event_location_zip: nullish,
	event_location_city: nullish,
	event_ticket_link: nullish,
	event_organizer_name: nullish,
	event_filter_ids: z.array(z.union([z.string(), z.number()])).nullish(),
	event_thumbnail: uploadSchema,
	/**
	 * Present on `activity` rows: which weekdays, and when. Validated loosely here and strictly in
	 * `mapWeeklyHours` — a timetable we cannot read costs that one activity, never the run.
	 */
	event_weekdays: z.unknown().nullish(),
	/**
	 * `each-week` | `even-weeks` | `odd-weeks` | `first-of-month` | `last-of-month`, or null —
	 * which the portal's own page renders as "Kvar veke".
	 */
	event_week_interval: nullish,
	/** References /api/v1/organizers. `event_organizer_name` is empty on every row that has one. */
	organizer_id: z.union([z.string(), z.number()]).nullish()
});

export type UpstreamEvent = z.infer<typeof eventSchema>;

/** Every `/api/v1` response is `{code, status, data, pagination}`; only `data` carries content. */
const envelope = z.object({
	data: z.array(z.unknown()).nullish(),
	pagination: z.unknown().nullish()
});

export type Parsed<T> = { rows: T[]; rejected: string[] };

function parseEnvelope<T>(body: unknown, item: z.ZodType<T>, what: string): Parsed<T> {
	const outer = envelope.safeParse(body);
	if (!outer.success) {
		throw new Error(`unexpected ${what} shape: ${outer.error.issues[0]?.message}`);
	}
	const rows: T[] = [];
	const rejected: string[] = [];
	for (const raw of outer.data.data ?? []) {
		const parsed = item.safeParse(raw);
		if (parsed.success) rows.push(parsed.data);
		else
			rejected.push(parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join(', '));
	}
	return { rows, rejected };
}

export function parseEvents(body: unknown): Parsed<UpstreamEvent> {
	return parseEnvelope(body, eventSchema, '/api/v1/events');
}

const locationSchema = z.object({
	location_id: z.union([z.string(), z.number()]),
	location_title: z.string(),
	location_status: nullish
});

export type UpstreamLocation = z.infer<typeof locationSchema>;

export function parseLocations(body: unknown): Map<string, string> {
	const { rows } = parseEnvelope(body, locationSchema, '/api/v1/locations');
	return new Map(rows.map((l) => [String(l.location_id), l.location_title]));
}

const filterSchema = z.object({
	filter_id: z.union([z.string(), z.number()]),
	/** `category` | `target_audience` | `price_type` | `accessibility`. */
	filter_type: nullish,
	filter_name: z.string()
});

export type FilterVocabulary = Map<string, { type: string | null; name: string }>;

export function parseFilters(body: unknown): FilterVocabulary {
	const { rows } = parseEnvelope(body, filterSchema, '/api/v1/filters');
	return new Map(
		rows.map((f) => [String(f.filter_id), { type: f.filter_type, name: f.filter_name }])
	);
}

const organizerSchema = z.object({
	organizer_id: z.union([z.string(), z.number()]),
	/**
	 * The name the portal shows a reader — "Bømlo Kulturskule". Not `organizer_name`, which is the
	 * name in the business register: "Bømlo Kommune Skular" for that one, and for a few rows the
	 * private person who registered the account. Only the public name is read.
	 */
	organizer_title: nullish,
	organizer_public: z.boolean().nullish()
});

/** Organiser id → the name it goes by publicly. Organisers marked not public are left out. */
export function parseOrganizers(body: unknown): Map<string, string> {
	const { rows } = parseEnvelope(body, organizerSchema, '/api/v1/organizers');
	const names = new Map<string, string>();
	for (const o of rows) {
		if (o.organizer_public === false || !o.organizer_title) continue;
		names.set(String(o.organizer_id), o.organizer_title);
	}
	return names;
}

const HEADERS = {
	// Identifying, with a contact URL, as docs/event-sources.md asks of every importer.
	'user-agent': 'hendingar.no importer (+https://hendingar.no)',
	accept: 'application/json'
};

async function getJson(url: string): Promise<unknown> {
	/*
	 * Sixty seconds, where every other importer uses thirty.
	 *
	 * Kept, and now said out loud: this endpoint returns the whole activity list for a municipality
	 * in one response rather than paging, and the slowest observed run was well past thirty. Halving
	 * it would turn a slow-but-working source into a failed run.
	 */
	const response = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(60_000) });
	if (!response.ok) throw new Error(`${url} responded ${response.status}`);
	return response.json();
}

export type Read = (site: AfaSite) => Promise<{
	events: unknown;
	locations: unknown;
	filters: unknown;
	organizers: unknown;
}>;

/**
 * Four requests per run, and no more.
 *
 * robots.txt asks for a 600-second crawl delay. Four calls a day against collection endpoints is
 * a far lighter touch than a crawler walking the listing, which is the behaviour that delay exists
 * to discourage — but it is the reason this importer never fetches a per-event page.
 */
export const read: Read = async (site) => ({
	events: await getJson(eventsUrl(site)),
	locations: await getJson(locationsUrl(site)),
	filters: await getJson(filtersUrl(site)),
	organizers: await getJson(organizersUrl(site))
});
