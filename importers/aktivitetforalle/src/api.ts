import { z } from 'zod';
import { eventsUrl, filtersUrl, locationsUrl, type AfaSite } from './sites.ts';

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

const uploadSchema = z
	.object({
		/** Absolute, and already built by the API — do not construct it from `upload_path`. */
		upload_url: z.string().nullish(),
		upload_mime: z.string().nullish(),
		upload_public: z.boolean().nullish()
	})
	.nullish();

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
	/** Present on `activity` rows: the weekly pattern. We do not import those — see map.ts. */
	event_weekdays: z.unknown().nullish()
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

const HEADERS = {
	// Identifying, with a contact URL, as docs/event-sources.md asks of every importer.
	'user-agent': 'hendingar.no importer (+https://hendingar.no)',
	accept: 'application/json'
};

async function getJson(url: string): Promise<unknown> {
	const response = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(60_000) });
	if (!response.ok) throw new Error(`${url} responded ${response.status}`);
	return response.json();
}

export type Read = (site: AfaSite) => Promise<{
	events: unknown;
	locations: unknown;
	filters: unknown;
}>;

/**
 * Three requests per run, and no more.
 *
 * robots.txt asks for a 600-second crawl delay. Three calls a day against a collection endpoint is
 * a far lighter touch than a crawler walking the listing, which is the behaviour that delay exists
 * to discourage — but it is the reason this importer never fetches a per-event page.
 */
export const read: Read = async (site) => ({
	events: await getJson(eventsUrl(site)),
	locations: await getJson(locationsUrl(site)),
	filters: await getJson(filtersUrl(site))
});
