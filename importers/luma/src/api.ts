import { z } from 'zod';
import { itemsUrl, type LumaCalendar } from './calendars.ts';

/**
 * Reading a public Luma calendar.
 *
 * `https://api.lu.ma/calendar/get-items?calendar_api_id=cal-…` answers `{entries, has_more}` with
 * no key and no auth for a calendar whose `access_level` is `public`. It is the endpoint Luma's own
 * web client calls, discovered from the network trace of `luma.com/tcw` — undocumented, therefore
 * validated field by field. A page that changes shape must fail loudly here rather than arrive as
 * an event with no date.
 *
 * ## The times are real instants, and that was checked rather than assumed
 *
 * CLAUDE.md is emphatic that a source's stated offset is not evidence: Modern Events Calendar adds
 * the site's offset to a wall clock and then writes the offset it just added, so a 16:00 event
 * publishes as 18:00 in the page, the JSON-LD and the `.ics` alike.
 *
 * Luma is not that. `start_at` is UTC with a `Z`, `timezone` is a separate IANA zone, and the two
 * agree with what the source shows a human — the calendar page's own embedded schema.org says
 * `"startDate":"2026-10-22T18:30:00.000+02:00"` for the event the API reports as
 * `2026-10-22T16:30:00.000Z`, and `end_at 18:30Z` against `"endDate":"…20:30:00.000+02:00"`. Two
 * independent statements from the source, consistent, which is the cross-check the rule asks for.
 *
 * So these are parsed as instants and stored as instants. Nothing here resolves a wall clock, and
 * nothing here should start to.
 */

/** An ISO instant. Required, and required to actually parse — `Invalid Date` is not a date. */
const instant = z.string().refine((s) => Number.isFinite(Date.parse(s)), 'not a parseable instant');

const nullableInstant = z
	.string()
	.nullish()
	.transform((s) => (s && Number.isFinite(Date.parse(s)) ? s : null));

/**
 * The bit of `geo_address_info` we use.
 *
 * `localized.no.full_address` is preferred over the top-level `full_address` because it is the
 * Norwegian rendering — "Sæ 134, 5417 Stord, Norge" rather than "…, Norway" — and the postnummer
 * sits in the middle of it either way, which is the shape `fromLine` in packages/core/src/address
 * already parses.
 *
 * `passthrough` is absent on purpose: this object carries a dozen fields we do not want (a Google
 * `place_id`, an `apple_maps_place_id`, a `sublocality`), and naming only what we read is what
 * keeps the mapper honest about what it knows.
 */
const localizedAddress = z.object({
	address: z.string().nullish(),
	city: z.string().nullish(),
	full_address: z.string().nullish()
});

const geoAddress = z
	.object({
		address: z.string().nullish(),
		city: z.string().nullish(),
		region: z.string().nullish(),
		country: z.string().nullish(),
		country_code: z.string().nullish(),
		full_address: z.string().nullish(),
		localized: z.record(z.string(), localizedAddress).nullish(),
		place_coordinate: z.object({ latitude: z.number(), longitude: z.number() }).nullish()
	})
	.nullish();

const eventSchema = z.object({
	/** `evt-…`. Stable per event, and our `external_id` — see the note in map.ts. */
	api_id: z.string().min(1),
	name: z.string().min(1),
	start_at: instant,
	end_at: nullableInstant,
	/** IANA zone for this event. Preferred over the calendar's. */
	timezone: z.string().nullish(),
	/** The vanity path of the event's own page, e.g. `ahupvg92`. No host, no leading slash. */
	url: z.string().nullish(),
	cover_url: z.string().nullish(),
	/** `public` | `private` | … . Only public rows are ours to republish. */
	visibility: z.string().nullish(),
	/** `offline` | `online` | `hybrid`. */
	location_type: z.string().nullish(),
	/**
	 * Set when this event is one occurrence of a repeating series.
	 *
	 * We do not read it, and it is declared so it cannot arrive unnoticed: if Luma ever gives a
	 * whole series ONE `api_id`, keying on that id would collapse the occurrences into a single
	 * row. There is a test asserting the ids in the fixtures are distinct, and this field is the
	 * thing to look at the day it fails.
	 */
	recurrence_id: z.unknown().nullish(),
	geo_address_info: geoAddress
});

export type UpstreamEvent = z.infer<typeof eventSchema>;

/** `ticket_info` lives on the entry, not the event. Free events are the common case here. */
const ticketInfo = z
	.object({ is_free: z.boolean().nullish(), price: z.unknown().nullish() })
	.nullish();

const entrySchema = z.object({
	/** `calev-…`, the calendar's entry id. Not our key: the event's own id is. */
	api_id: z.string().min(1),
	event: eventSchema,
	ticket_info: ticketInfo,
	/** `approved` | `pending` | … . A calendar admin can hold a submitted event. */
	status: z.string().nullish()
});

export type UpstreamEntry = z.infer<typeof entrySchema>;

const envelope = z.object({
	/*
	 * Required, not optional, and a test is why.
	 *
	 * `.nullish()` here let `{"error": "nope"}` parse cleanly into zero rows — so an error
	 * document, an HTML challenge page or a renamed endpoint would all arrive as "this calendar
	 * has no events", which is a thing that legitimately happens and therefore the one failure we
	 * cannot afford to imitate. A real response always carries the key, even when it is empty.
	 */
	entries: z.array(z.unknown()),
	/**
	 * Python's `False` reaches us as JSON `false`, but the calendar page's embedded copy of the
	 * same payload spells it `False`. Accepting both costs nothing and a truthy `"False"` string
	 * would page forever.
	 */
	has_more: z
		.union([z.boolean(), z.string()])
		.nullish()
		.transform((v) => v === true || v === 'True'),
	next_cursor: z.string().nullish()
});

export type Parsed = { rows: UpstreamEntry[]; rejected: string[]; hasMore: boolean };

/**
 * Validate one response. A row that does not fit is reported, not thrown away silently.
 *
 * The envelope failing IS thrown: `entries` missing means the endpoint moved or we are being
 * served an error document, and importing zero events from a calendar that has some would look
 * exactly like a calendar that emptied.
 */
export function parseItems(body: unknown): Parsed {
	const outer = envelope.safeParse(body);
	if (!outer.success) {
		throw new Error(`unexpected get-items shape: ${outer.error.issues[0]?.message}`);
	}
	const rows: UpstreamEntry[] = [];
	const rejected: string[] = [];
	for (const raw of outer.data.entries) {
		const parsed = entrySchema.safeParse(raw);
		if (parsed.success) rows.push(parsed.data);
		else {
			rejected.push(parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join(', '));
		}
	}
	return { rows, rejected, hasMore: outer.data.has_more };
}

const HEADERS = {
	// Identifying, with a contact URL, as docs/event-sources.md asks of every importer.
	'user-agent': 'hendingar.no importer (+https://hendingar.no)',
	accept: 'application/json'
};

async function getJson(url: string): Promise<unknown> {
	const response = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(30_000) });
	if (!response.ok) throw new Error(`${url} responded ${response.status}`);
	return response.json();
}

export type Read = (calendar: LumaCalendar) => Promise<unknown[]>;

/**
 * How many pages we will follow before giving up.
 *
 * A cap rather than a `while (hasMore)`, because the cursor comes from the response: a server that
 * returns the same cursor forever would spin this importer until the job times out, and a stuck
 * loop against somebody else's API is the rudest failure mode available. Fifty per page.
 */
const MAX_PAGES = 20;

async function readPeriod(
	calendar: LumaCalendar,
	period: 'future' | 'past',
	maxPages: number
): Promise<unknown[]> {
	const pages: unknown[] = [];
	let cursor: string | undefined;
	for (let page = 0; page < maxPages; page += 1) {
		const body = await getJson(itemsUrl(calendar, period, cursor));
		pages.push(body);
		const parsed = parseItems(body);
		const next = envelope.parse(body).next_cursor;
		if (!parsed.hasMore || !next || next === cursor) break;
		cursor = next;
	}
	return pages;
}

/**
 * Both periods, and only one page of the past.
 *
 * `period=future` alone loses an event the moment it starts — which is the bug #95 fixed for
 * another importer, and it is worse here than it sounds: a two-hour meetup would vanish from the
 * listing at the exact moment somebody checks where to go. One page of `past` catches anything
 * that has begun, and a little history besides.
 *
 * One page and not the whole archive, because the archive is unbounded and the value of a 2024
 * meetup is not zero but it is close. `MAX_PAGES` is spent on the future, where the events people
 * are looking for actually are.
 */
export const read: Read = async (calendar) => [
	...(await readPeriod(calendar, 'future', MAX_PAGES)),
	...(await readPeriod(calendar, 'past', 1))
];
