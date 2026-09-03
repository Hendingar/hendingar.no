import { z } from 'zod';
import { monthUrl, type HvlCampus } from './campuses.ts';

/**
 * Reading HVL's calendar.
 *
 * The calendar page is an AngularJS view that renders no events server-side. Its controller —
 * `/internett/js/controllers/calendar-list-controller.js` — calls one month service per view, and
 * that service is what we read. It is not documented anywhere, so every response is validated.
 *
 * The service takes the campus filter and answers for the *whole* institution either way: it does
 * not drop the rows that do not match, it marks the ones that do with `visible: true` and leaves
 * the client to hide the rest. Asking for Stord and keeping every item would therefore import the
 * entire national calendar. See `parseMonth`.
 *
 * Parsing is split from fetching, so the tests run against committed responses and never touch the
 * network (CLAUDE.md rule 6).
 */

const filterSchema = z.object({
	id: z.string(),
	name: z.string().nullish(),
	selected: z.boolean().nullish()
});

const itemSchema = z.object({
	title: z.string(),
	/*
	 * The instant, with a real offset. Note that the sibling `startFullDateTime` is NOT this value
	 * in another format — see the warning in map.ts.
	 */
	startDateTime: z.string(),
	endDateTime: z.string().nullish(),
	/** HVL's spelling. The venue as free text: "Biblioteket, Høgskulen på Vestlandet, campus Stord". */
	adress: z.string().nullish(),
	description: z.string().nullish(),
	/** The event's own page, relative. Unlike DNT's, these resolve. */
	url: z.string().nullish(),
	/** A registration or Zoom link when the event has one. */
	buttonUrl: z.string().nullish(),
	buttonText: z.string().nullish(),
	/** The campus tags AND the event-type tags, in one flat list. */
	filters: z.array(filterSchema).nullish(),
	/** The service's own answer to "does this row match the requested filter". */
	visible: z.boolean().nullish(),
	multiDayEvent: z.boolean().nullish()
});

export type UpstreamEvent = z.infer<typeof itemSchema>;

const monthSchema = z.object({
	year: z.number().nullish(),
	month: z.number().nullish(),
	items: z.array(z.unknown()).nullish()
});

export type ParsedMonth = {
	events: UpstreamEvent[];
	/** Items the service returned but did not mark for this campus. Counted, never imported. */
	otherCampus: number;
	/** Items that looked like events but did not validate, kept so a run can report them. */
	rejected: string[];
};

export function parseMonth(body: unknown): ParsedMonth {
	const outer = monthSchema.safeParse(body);
	if (!outer.success) {
		throw new Error(`unexpected month service shape: ${outer.error.issues[0]?.message}`);
	}

	const events: UpstreamEvent[] = [];
	const rejected: string[] = [];
	let otherCampus = 0;

	for (const raw of outer.data.items ?? []) {
		const parsed = itemSchema.safeParse(raw);
		if (!parsed.success) {
			rejected.push(parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join(', '));
			continue;
		}
		/*
		 * The service's own filter verdict. Without this the importer would take the whole national
		 * calendar: fifty-four September rows came back for a campus with thirteen.
		 */
		if (parsed.data.visible !== true) {
			otherCampus += 1;
			continue;
		}
		events.push(parsed.data);
	}

	return { events, otherCampus, rejected };
}

/** HVL's event-type tags, as distinct from its campus tags — both arrive in one flat list. */
export const CAMPUS_FILTER_IDS = new Set(['Bergen', 'Førde', 'Haugesund', 'Sogndal', 'Stord']);

export function eventTypes(input: UpstreamEvent): string[] {
	return (input.filters ?? []).map((f) => f.id).filter((id) => !CAMPUS_FILTER_IDS.has(id));
}

/**
 * The event's banner image, read from the detail page's Open Graph tag.
 *
 * The month service carries no image at all, and the listing is much poorer without one — this is
 * the only place HVL publishes a picture per event. Pure, so it is tested against a committed page.
 *
 * HVL writes the URL with a doubled slash after the host (`https://www.hvl.no//contentassets/…`).
 * Both forms resolve, but `new URL` is what normalises it, and an un-normalised URL would differ
 * from itself between runs if HVL ever fixes it — which would look like the poster changing daily.
 */
const OG_IMAGE = /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i;

export function parsePoster(html: string): string | null {
	const raw = OG_IMAGE.exec(html)?.[1];
	if (!raw) return null;
	try {
		const url = new URL(raw, 'https://www.hvl.no');
		if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
		url.pathname = url.pathname.replace(/\/{2,}/g, '/');
		return url.toString();
	} catch {
		return null;
	}
}

const HEADERS = {
	// Identifying, with a contact URL, as docs/event-sources.md asks of every importer.
	'user-agent': 'hendingar.no importer (+https://hendingar.no)'
};

export type ReadMonth = (campus: HvlCampus, year: number, month: number) => Promise<unknown>;
export type ReadDetail = (url: string) => Promise<string>;

export const readMonth: ReadMonth = async (campus, year, month) => {
	const url = monthUrl(campus, year, month);
	const response = await fetch(url, {
		headers: { ...HEADERS, accept: 'application/json' },
		signal: AbortSignal.timeout(30_000)
	});
	if (!response.ok) throw new Error(`${url} responded ${response.status}`);
	return response.json();
};

export const readDetail: ReadDetail = async (url) => {
	const response = await fetch(url, {
		headers: { ...HEADERS, accept: 'text/html' },
		signal: AbortSignal.timeout(30_000)
	});
	if (!response.ok) throw new Error(`${url} responded ${response.status}`);
	return response.text();
};

/**
 * How many months ahead to walk.
 *
 * The service answers per month and has no "everything from here" mode, so the horizon is a choice
 * rather than a discovery. Twelve keeps a year of lead time — a conference announced next autumn
 * is exactly the sort of thing a university calendar carries — at twelve cheap requests a day.
 */
export const MONTHS_AHEAD = 12;

export function monthsFrom(now: Date): Array<{ year: number; month: number }> {
	const months: Array<{ year: number; month: number }> = [];
	for (let i = 0; i < MONTHS_AHEAD; i += 1) {
		// Built in UTC so the list cannot shift by a month depending on where the job runs.
		const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + i, 1));
		months.push({ year: d.getUTCFullYear(), month: d.getUTCMonth() + 1 });
	}
	return months;
}
