import { z } from 'zod';
import { apiUrl, detailsUrl, type DntAssociation } from './associations.ts';

/**
 * Reading DNT's activity calendar.
 *
 * The calendar page at /aktivitetskalender is a React island that renders nothing server-side, so
 * there is no markup to parse. It calls `/api/activities` with *the page's own query string* —
 * which is why the endpoint takes the same `associations` and `culture` parameters the reader sees
 * in their address bar, and why this importer is a JSON reader rather than a scraper.
 *
 * Each card opens a modal rather than navigating, and the modal fills itself from a second call to
 * `/api/search/activitydetails?id=<id>`. That call is the only place the description and the
 * outbound sign-up link exist, so a full import is one listing request per page plus one detail
 * request per activity.
 *
 * Neither endpoint is documented, so every response is validated: if DNT changes shape we want a
 * loud rejection in the run, not silently empty events.
 *
 * Parsing is split from fetching — `parseListing` and `parseDetails` are pure, so the tests run
 * against committed responses and never touch the network (CLAUDE.md rule 6).
 */

const viewModelSchema = z.object({
	eventLocation: z.string().nullish(),
	imageUrl: z.string().nullish(),
	/** A comma-joined list of names. DNT's own UI strips a leading ", " — see `subTypeList`. */
	subTypes: z.string().nullish(),
	mainType: z.string().nullish(),
	targetGroups: z.string().nullish(),
	/** ISO 8601 with the source's offset. Preserve it — never normalise to UTC (CLAUDE.md). */
	start: z.string(),
	end: z.string().nullish(),
	isCancelled: z.boolean().nullish(),
	isFull: z.boolean().nullish(),
	hasWaitinglist: z.boolean().nullish()
});

const pageHitSchema = z.object({
	id: z.number(),
	pageTitle: z.string(),
	level: z.string().nullish(),
	organizorName: z.string().nullish(),
	coOrganizorNames: z.array(z.string()).nullish(),
	activityViewModel: viewModelSchema.nullish()
});

export type UpstreamActivity = z.infer<typeof pageHitSchema>;

const listingSchema = z.object({
	pageHits: z.array(z.unknown()),
	pageCount: z.number().nullish(),
	totalMatching: z.number().nullish()
});

export type ParsedListing = {
	activities: UpstreamActivity[];
	pageCount: number;
	totalMatching: number;
	/** Hits that looked like activities but did not validate, kept so a run can report them. */
	rejected: string[];
};

export function parseListing(body: unknown): ParsedListing {
	const outer = listingSchema.safeParse(body);
	if (!outer.success) {
		throw new Error(`unexpected /api/activities shape: ${outer.error.issues[0]?.message}`);
	}

	const activities: UpstreamActivity[] = [];
	const rejected: string[] = [];
	for (const hit of outer.data.pageHits) {
		const parsed = pageHitSchema.safeParse(hit);
		if (parsed.success) {
			activities.push(parsed.data);
		} else {
			rejected.push(parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join(', '));
		}
	}

	return {
		activities,
		pageCount: outer.data.pageCount ?? 1,
		totalMatching: outer.data.totalMatching ?? activities.length,
		rejected
	};
}

const detailsSchema = z.object({
	/** Rich text from DNT's editor. Turned into plain text in map.ts. */
	description: z.string().nullish(),
	/**
	 * The sign-up page on aktiviteter.dnt.no. This is what DNT's own modal links to, and the only
	 * per-activity URL that resolves — see the note on `sourceUrl` in map.ts.
	 */
	utUrl: z.string().nullish(),
	bookingUrl: z.string().nullish()
});

export type UpstreamDetails = z.infer<typeof detailsSchema>;

export function parseDetails(body: unknown): UpstreamDetails | null {
	const parsed = detailsSchema.safeParse(body);
	return parsed.success ? parsed.data : null;
}

/** DNT joins the subtype names with ", " and leaves a leading separator when the first is blank. */
export function subTypeList(subTypes: string | null | undefined): string[] {
	if (!subTypes) return [];
	return subTypes
		.split(',')
		.map((s) => s.trim())
		.filter(Boolean);
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

export type ReadListing = (association: DntAssociation, page: number) => Promise<unknown>;
export type ReadDetails = (activityId: number) => Promise<unknown>;

export const readListing: ReadListing = (association, page) => getJson(apiUrl(association, page));
export const readDetails: ReadDetails = (activityId) => getJson(detailsUrl(activityId));

/**
 * Every page of one turlag's calendar.
 *
 * `pageCount` comes from the first response rather than being discovered by reading until empty:
 * an endpoint that ignores an out-of-range `page` and returns page 1 forever would otherwise loop.
 * The cap is a second belt — 10 pages is 100 activities, far above any turlag's programme.
 */
export const MAX_PAGES = 10;

export async function fetchAllPages(
	association: DntAssociation,
	read: ReadListing
): Promise<ParsedListing> {
	const first = parseListing(await read(association, 1));
	const pages = Math.min(first.pageCount, MAX_PAGES);

	const activities = [...first.activities];
	const rejected = [...first.rejected];
	for (let page = 2; page <= pages; page += 1) {
		const next = parseListing(await read(association, page));
		activities.push(...next.activities);
		rejected.push(...next.rejected);
	}

	return { activities, pageCount: first.pageCount, totalMatching: first.totalMatching, rejected };
}
