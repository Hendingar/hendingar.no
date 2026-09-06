import { z } from 'zod';
import type { TecInstance } from './instances.ts';

/**
 * Reading The Events Calendar's REST collection.
 *
 * The plugin ships a documented, unauthenticated endpoint — `/wp-json/tribe/events/v1/events` —
 * that returns exactly the fields we need, already structured. No HTML parsing, and none of the
 * guessing `importers/mec` has to do to find an occurrence's identity.
 *
 * Two things about it are worth knowing before changing anything here:
 *
 *   1. **The default window is "from the start of today, for two years".** A bare call answers
 *      `{"events":[],"total":0,"total_pages":0}` on a site with nothing coming up, which looks
 *      exactly like a broken endpoint and is not one. We rely on that default deliberately: it is
 *      the source's own definition of what is on, it needs no clock of ours, and it keeps a
 *      calendar's dead back catalogue out of the database. `?start_date=…` is for reconnaissance.
 *   2. **`per_page` is capped at 50.** Asking for 100 returns 50 and a `total_pages` computed for
 *      50, so a paginator that trusted its own page size would silently read a fifth of a busy
 *      site.
 *
 * Parsing is split from fetching, so the tests run against committed responses and never touch the
 * network (CLAUDE.md rule 6). Every response is validated: a shape change must fail loudly rather
 * than import nothing and report success.
 */

/** Only the fields we use. Unknown keys are ignored — the plugin emits a great many we do not. */

/**
 * The venue block, which is optional and has two different empty spellings.
 *
 * A venue-less event serialises as `"venue": []` — PHP's empty array, not `null` and not `{}`.
 * Validating it as an object would reject every webinar on a site that runs them, so both are
 * accepted here and told apart in map.ts.
 */
const venueSchema = z.object({
	id: z.number().nullish(),
	venue: z.string().nullish(),
	address: z.string().nullish(),
	city: z.string().nullish(),
	zip: z.string().nullish(),
	province: z.string().nullish(),
	country: z.string().nullish(),
	url: z.string().nullish()
});

export type UpstreamVenue = z.infer<typeof venueSchema>;

/**
 * The featured image, which serialises as `false` when there is none.
 *
 * `sizes` is the WordPress rendition ladder — `medium`, `medium_large`, `large`, `thumbnail` — and
 * it is the only place a `srcset` for this source can come from. See `posterSrcsetFrom` in map.ts.
 */
const imageSchema = z.object({
	url: z.string(),
	width: z.number().nullish(),
	height: z.number().nullish(),
	sizes: z
		.record(
			z.string(),
			z.object({
				url: z.string(),
				width: z.number().nullish(),
				height: z.number().nullish()
			})
		)
		.nullish()
});

export type UpstreamImage = z.infer<typeof imageSchema>;

const categorySchema = z.object({
	name: z.string(),
	slug: z.string()
});

export type UpstreamCategory = z.infer<typeof categorySchema>;

const eventSchema = z.object({
	id: z.number(),
	title: z.string(),
	description: z.string().nullish(),
	excerpt: z.string().nullish(),
	url: z.string(),
	status: z.string().nullish(),
	/**
	 * Local wall clock as `YYYY-MM-DD HH:MM:SS`. Not ISO 8601 and not an instant — see
	 * `wallClockToInstant` in map.ts, and note that the sibling `utc_start_date` is not read at
	 * all.
	 */
	start_date: z.string(),
	end_date: z.string().nullish(),
	/** The zone the site *claims*. Believed only when it is an IANA name; see `resolveZone`. */
	timezone: z.string().nullish(),
	all_day: z.boolean().nullish(),
	cost: z.string().nullish(),
	/** The organiser's own outbound link — a ticket shop, usually. Frequently an empty string. */
	website: z.string().nullish(),
	image: z.union([imageSchema, z.boolean()]).nullish(),
	venue: z.union([venueSchema, z.array(z.unknown())]).nullish(),
	categories: z.array(categorySchema).nullish()
});

export type UpstreamEvent = z.infer<typeof eventSchema>;

const collectionSchema = z.object({
	events: z.array(z.unknown()),
	total: z.number().nullish(),
	total_pages: z.number().nullish()
});

export type ParsedCollection = {
	events: UpstreamEvent[];
	total: number;
	pages: number;
	/** Entries that looked like events but did not validate, kept so a run can report them. */
	rejected: string[];
};

export function parseCollection(body: unknown): ParsedCollection {
	const outer = collectionSchema.safeParse(body);
	if (!outer.success) {
		throw new Error(
			`unexpected tribe/events/v1 response: ${outer.error.issues
				.map((i) => `${i.path.join('.')}: ${i.message}`)
				.join(', ')}`
		);
	}

	const events: UpstreamEvent[] = [];
	const rejected: string[] = [];
	for (const entry of outer.data.events) {
		const parsed = eventSchema.safeParse(entry);
		if (parsed.success) events.push(parsed.data);
		else
			rejected.push(parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join(', '));
	}

	return {
		events,
		total: outer.data.total ?? events.length,
		pages: outer.data.total_pages ?? (events.length > 0 ? 1 : 0),
		rejected
	};
}

/** The plugin's own ceiling. Asking for more silently gives 50. */
export const PER_PAGE = 50;

/**
 * How many pages to walk. A thousand upcoming events is not a local venue's programme, it is a
 * misconfigured filter — and a runaway paginator against somebody else's server is the one thing
 * an importer must not become.
 */
export const MAX_PAGES = 20;

export type ReadPage = (instance: TecInstance, page: number) => Promise<unknown>;

export function pageUrl(instance: TecInstance, page: number): string {
	const url = new URL(instance.endpoint);
	url.searchParams.set('per_page', String(PER_PAGE));
	url.searchParams.set('page', String(page));
	return url.toString();
}

export const readPage: ReadPage = async (instance, page) => {
	const response = await fetch(pageUrl(instance, page), {
		headers: {
			// Identifying, with a contact URL, as docs/event-sources.md asks of every importer.
			'user-agent': 'hendingar.no importer (+https://hendingar.no)',
			accept: 'application/json'
		},
		signal: AbortSignal.timeout(30_000)
	});
	/*
	 * A page past the end answers 404 with `{"code":"event-archive-page-not-found"}`, so an empty
	 * calendar is a 200 with `total: 0` and only a real problem reaches here. We stop on
	 * `total_pages` rather than walking until a 404, which keeps that distinction intact.
	 */
	if (!response.ok) {
		throw new Error(`${instance.endpoint} responded ${response.status} on page ${page}`);
	}
	return response.json();
};

export async function fetchAll(
	instance: TecInstance,
	read: ReadPage = readPage
): Promise<ParsedCollection> {
	const first = parseCollection(await read(instance, 1));
	const pages = Math.min(first.pages, MAX_PAGES);

	const events = [...first.events];
	const rejected = [...first.rejected];
	for (let page = 2; page <= pages; page += 1) {
		const next = parseCollection(await read(instance, page));
		events.push(...next.events);
		rejected.push(...next.rejected);
	}
	return { events, total: first.total, pages: first.pages, rejected };
}
