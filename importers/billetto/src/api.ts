import { z } from 'zod';
import { filterFor, searchUrl, type BillettoOrganiser } from './organisers.ts';

/**
 * Reading Billetto's search index.
 *
 * The organiser page is a Vue app whose event list comes from Algolia; the request it makes is the
 * API, and the credentials are the public search key its own JavaScript ships. Undocumented, so
 * every hit is validated — a changed shape must fail loudly rather than import nothing and report
 * success.
 *
 * Parsing is split from fetching, so the tests run against a committed response (CLAUDE.md rule 6).
 */

const hitSchema = z.object({
	id: z.number(),
	name: z.string(),
	description: z.string().nullish(),
	short_description: z.string().nullish(),
	url: z.string(),
	state: z.string().nullish(),
	/*
	 * Epoch seconds, and the only time value worth trusting.
	 *
	 * The record also carries `starts_at` as a formatted Norwegian string and a `time_zone` that
	 * says "Europe/Paris" for an event in Bømlo. Paris and Oslo happen to share an offset so it
	 * changes nothing today, which is exactly what makes it dangerous to rely on. An epoch is an
	 * instant and needs no zone at all.
	 */
	start_time: z.number(),
	end_time: z.number().nullish(),
	venue_name: z.string().nullish(),
	location: z.string().nullish(),
	city: z.string().nullish(),
	image: z.string().nullish(),
	category: z.string().nullish(),
	type: z.string().nullish(),
	brand: z.string().nullish(),
	organizer_id: z.number().nullish(),
	host_ids: z.array(z.number()).nullish()
});

export type UpstreamEvent = z.infer<typeof hitSchema>;

const responseSchema = z.object({
	hits: z.array(z.unknown()),
	nbHits: z.number().nullish(),
	nbPages: z.number().nullish(),
	page: z.number().nullish()
});

export type ParsedSearch = {
	events: UpstreamEvent[];
	total: number;
	pages: number;
	/** Hits that looked like events but did not validate, kept so a run can report them. */
	rejected: string[];
};

export function parseSearch(body: unknown): ParsedSearch {
	const outer = responseSchema.safeParse(body);
	if (!outer.success) {
		throw new Error(`unexpected Algolia response: ${outer.error.issues[0]?.message}`);
	}

	const events: UpstreamEvent[] = [];
	const rejected: string[] = [];
	for (const hit of outer.data.hits) {
		const parsed = hitSchema.safeParse(hit);
		if (parsed.success) events.push(parsed.data);
		else
			rejected.push(parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join(', '));
	}

	return {
		events,
		total: outer.data.nbHits ?? events.length,
		pages: outer.data.nbPages ?? 1,
		rejected
	};
}

const HEADERS = {
	'content-type': 'application/json',
	// Identifying, with a contact URL, as docs/event-sources.md asks of every importer.
	'user-agent': 'hendingar.no importer (+https://hendingar.no)'
};

export type ReadSearch = (organiser: BillettoOrganiser, page: number) => Promise<unknown>;

export const HITS_PER_PAGE = 50;

/** How many pages to walk. An organiser with more than 500 upcoming events is not a local club. */
export const MAX_PAGES = 10;

export const readSearch: ReadSearch = async (organiser, page) => {
	const response = await fetch(searchUrl(), {
		method: 'POST',
		headers: HEADERS,
		body: JSON.stringify({
			query: '',
			hitsPerPage: HITS_PER_PAGE,
			page,
			filters: filterFor(organiser)
		}),
		signal: AbortSignal.timeout(30_000)
	});
	if (!response.ok) throw new Error(`Algolia responded ${response.status}`);
	return response.json();
};

export async function fetchAll(
	organiser: BillettoOrganiser,
	read: ReadSearch
): Promise<ParsedSearch> {
	const first = parseSearch(await read(organiser, 0));
	const pages = Math.min(first.pages, MAX_PAGES);

	const events = [...first.events];
	const rejected = [...first.rejected];
	for (let page = 1; page < pages; page += 1) {
		const next = parseSearch(await read(organiser, page));
		events.push(...next.events);
		rejected.push(...next.rejected);
	}
	return { events, total: first.total, pages: first.pages, rejected };
}
