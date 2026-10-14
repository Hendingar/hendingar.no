import { RESOURCE_URI_META_KEY } from '@modelcontextprotocol/ext-apps/server';
import type { McpServer, ToolAnnotations } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { COVERED_MUNICIPALITIES } from '@hendingar/core/coverage';
import {
	DEFAULT_TIME_ZONE,
	formatEventTime,
	instantToZonedWallClock,
	schemaDateTime
} from '@hendingar/core/datetime';
import {
	publicEventDetailSchema,
	publicEventSchema,
	showEventsResultSchema,
	toPublicEvent,
	toPublicEventDetail,
	type DetailRowInput,
	type ListingRowInput
} from '@hendingar/core/public-event';
import { searchTermSchema } from '@hendingar/core/search';
import { eventIdFromParam, eventPath } from '@hendingar/core/slug';
import { CATEGORIES } from '@hendingar/core/taxonomy';
import {
	calendarDateSchema,
	calendarSpanSchema,
	calendarWeekSchema,
	eventQuerySchema
} from '@hendingar/core/validation';
import { describeWeeklyHours, type WeeklyHours } from '@hendingar/core/weekly-hours';
import { shiftMonth } from '../../calendar.ts';

/**
 * What the tools read, stated as the least each of them needs.
 *
 * The live implementation is `liveCatalogue` in `catalogue.ts`, checked against this with
 * `satisfies` — the site's own queries return wider rows, and the compiler confirms they still
 * carry every field named here. Declared here rather than inferred from the queries so the
 * contract test can hand the tools a stub without a database and without a cast.
 */
export type Catalogue = {
	listEvents(input: z.input<typeof eventQuerySchema>): Promise<ListingRowInput[]>;
	getEvent(id: number): Promise<DetailRowInput | null>;
	filmScreenings(id: number): Promise<{
		film: boolean;
		screenings: Array<{
			startsAt: Date;
			venueTimeZone: string | null;
			venueName: string | null;
			ctaUrl: string | null;
		}>;
	}>;
	listEventsOnDate(date: string): Promise<ListingRowInput[]>;
	weekendEvents(which: 'denne' | 'neste'): Promise<ListingRowInput[]>;
	weekEvents(
		week: string
	): Promise<{ dates: string[]; timed: ListingRowInput[]; spanning: ListingRowInput[] }>;
	calendarRange(): Promise<{ current: string; last: string }>;
	dayCounts(span: { from: string; to: string }): Promise<Array<{ date: string; total: number }>>;
	placeCounts(span: {
		from: string;
		to: string;
	}): Promise<Array<{ municipality: string | null; total: number }>>;
	listUpcoming(limit: number): Promise<ListingRowInput[]>;
	standingOffers(): Promise<ListingRowInput[]>;
	weeklyActivities(): Promise<{
		today: string;
		activities: Array<{
			id: number;
			title: string;
			weeklyHours: WeeklyHours | null;
			ageFrom: number | null;
			ageTo: number | null;
			venueName: string | null;
			organizerName: string | null;
		}>;
	}>;
	weekendPicks(): Promise<
		Array<{
			eventId: number;
			rank: number;
			reason: string;
			title: string;
			startsAt: Date;
			venueName: string | null;
			venueTimeZone: string;
		}>
	>;
	listPopular(input: { by: 'hearts' | 'views'; limit: number }): Promise<ListingRowInput[]>;
	searchSuggestions(term: string): Promise<{
		venues: Array<{ name: string; total: number }>;
		categories: Array<{ slug: string; label: string; total: number }>;
		sources: Array<{ slug: string; name: string; total: number }>;
		events: Array<{
			id: number;
			title: string;
			startsAt: Date;
			venueTimeZone: string | null;
		}>;
		total: number;
	}>;
	listCategoryCounts(): Promise<Array<{ slug: string; total: number }>>;
	listSources(): Promise<
		Array<{
			slug: string;
			name: string;
			url: string | null;
			region: string | null;
			kind: string;
			eventsUpcoming: number;
			runs: Array<{ startedAt: Date; status: string }>;
		}>
	>;
	/** Where listed posters are hot-linked from: the MCP App view's image CSP. */
	posterOrigins(): Promise<string[]>;
	siteStatus(): Promise<{
		upcomingCount: number;
		standingCount: number;
		sourceCount: number;
		lastCollectedAt: Date | null;
	}>;
};

/**
 * The tools, one registration each. Read with ADR 0024.
 *
 * Every input is a schema from `packages/core` — the same validator the page's remote query
 * already runs — with a description added for the model that has to fill it in. Nothing is
 * redefined here (rule 1); `.describe()` and `.extend()` only annotate.
 *
 * Every tool is read-only and says so in its annotations, which some clients use to skip the
 * "allow this tool?" prompt. That claim is true by construction: the catalogue it reads from has
 * no write in it.
 */

const READ_ONLY: ToolAnnotations = {
	readOnlyHint: true,
	destructiveHint: false,
	idempotentHint: true,
	openWorldHint: false
};

/** Today where the events are, so "i dag" in the answer means what it means on Stord. */
function today(): string {
	return instantToZonedWallClock(new Date(), DEFAULT_TIME_ZONE).date;
}

const listResultSchema = z.object({
	/** Today's date at the venues, `YYYY-MM-DD`, so relative words in the question can be resolved. */
	today: z.string(),
	timeZone: z.string(),
	count: z.number().int(),
	events: z.array(publicEventSchema)
});

type ListResult = z.infer<typeof listResultSchema>;

/**
 * A result in both forms: `structuredContent` for clients that read the output schema, and the
 * same JSON as text for the many that still only read text. Neither is a summary of the other.
 */
function result<T extends Record<string, unknown>>(structured: T) {
	return {
		structuredContent: structured,
		content: [{ type: 'text' as const, text: JSON.stringify(structured) }]
	};
}

/**
 * How to show what came back, said once per result rather than only in the server instructions.
 *
 * An assistant handed `url`, `icsUrl` and `posterUrl` for every event used none of them until it
 * was told to (reported 2026-10-14). Instructions are read once at connect and are easy to lose by
 * the third tool call; a line beside the data is read with the data. English, because it is
 * addressed to the model, not to the reader.
 */
export const LIST_HINT =
	'Presentation: group events by day using `startsAt`, in time order. Make each title a Markdown link to its `url`. Give the time from `when` and the venue with its municipality. Add a short "add to calendar" link to `icsUrl`, and a ticket link to `ticketUrl` when an event has one. Name the source(s). Keep it compact: one or two lines per event. Once you have chosen what to recommend from these, call `show_events` with their ids: clients that can draw it show them as cards with posters and calendar buttons, and then your text can stay short.';

/** The MCP App view, served by `server.ts`. A tool that names it is drawn with it. */
export const VIEW_URI = 'ui://hendingar/events.html';

/**
 * Drawn with the view. Only the tools that answer a whole question in one call — a day, a weekend,
 * a week, what is next — plus `show_events`. Not `search_events`: an answer runs four or five
 * searches, and a card set per search would fill the chat with half-relevant widgets.
 *
 * It used to be `show_events` alone, and the first real conversation never called it: asked what
 * was on at the weekend, Claude called `weekend_events`, had 62 rows, and wrote them out as a list
 * — a twelve-card picker did not look like the tool for an overview. So the overview draws itself.
 */
const VIEW_META = { ui: { resourceUri: VIEW_URI }, [RESOURCE_URI_META_KEY]: VIEW_URI };

export const VIEW_LIST_HINT =
	'In clients that draw MCP Apps, these events are already shown to the user as cards, grouped by day, with calendar buttons. Then do not list them all again: answer in a few sentences, highlight what stands out, and mention the rest by count. In clients without cards, present them as a list: group by day, make each title a Markdown link to its `url`, give the time from `when` and the venue.';

/** Enough for a weekend; more than that is a listing, and the site is better at those. */
const SHOW_MAX = 12;

export const SHOW_HINT =
	'These events are now shown to the user as cards (in clients that draw them). Do not repeat each one in full: add a sentence or two on why you picked them, and mention anything in `missing`.';

export const PICKS_HINT =
	"Presentation: if there are picks, show them in `rank` order, each as the title linked to `url`, its `when` and venue, and the kurator's `reason` quoted as written (translate it if the user writes another language). Say they are hendingar.no's own weekend picks. If there are none, say so plainly and use `weekend_events` instead.";

export const DETAIL_HINT =
	'Presentation: title as a Markdown link to `url`; then when, where (address) and who organises it; the description in a sentence or two; then links: "add to calendar" (`icsUrl`), tickets (`ticketUrl`), and each source by name linked to its `eventUrl` or `siteUrl`. Show `posterUrl` as an image if you can render images. For a film, list the `screenings`.';

/**
 * A list result: the JSON, the hint, and one `resource_link` per event, so a client that renders
 * links as chips can show each event as something to open — and read in full through the
 * `hendingar://event/{id}` resource, without another search.
 */
function listResult(structured: ListResult & Record<string, unknown>, hint = LIST_HINT) {
	return {
		structuredContent: structured,
		content: [
			{ type: 'text' as const, text: JSON.stringify(structured) },
			{ type: 'text' as const, text: hint },
			...structured.events.map((event) => ({
				type: 'resource_link' as const,
				uri: `hendingar://event/${event.id}`,
				name: event.title,
				title: event.title,
				description: [event.when, event.venue, event.municipality].filter(Boolean).join(' · '),
				mimeType: 'application/json'
			}))
		]
	};
}

function withHint<T extends Record<string, unknown>>(hint: string, structured: T) {
	const answer = result(structured);
	return { ...answer, content: [...answer.content, { type: 'text' as const, text: hint }] };
}

function failure(text: string) {
	return { isError: true, content: [{ type: 'text' as const, text }] };
}

function listOf(rows: ListingRowInput[], origin: string): ListResult & Record<string, unknown> {
	const events = rows.map((row) => toPublicEvent(row, origin));
	return { today: today(), timeZone: DEFAULT_TIME_ZONE, count: events.length, events };
}

const eventRef = z
	.union([z.number().int().positive(), z.string().trim().min(1).max(500)])
	.describe(
		'The event: its numeric id, or its hendingar.no address (https://hendingar.no/hending/123-tittel).'
	);

/** An id, `"123"`, `"123-tittel"`, or a full hendingar.no address — whatever the user pasted. */
export function resolveEventRef(ref: number | string): number | null {
	if (typeof ref === 'number') return ref;
	const path = /\/hending\/([^/?#]+)/.exec(ref);
	return eventIdFromParam(path ? path[1]! : ref);
}

/** This month to the last one with anything in it, inside the schema's 18-month cap. */
async function defaultSpan(catalogue: Catalogue): Promise<{ from: string; to: string }> {
	// Not the calendar's first month: that reaches back into past events nobody asked about.
	const range = await catalogue.calendarRange();
	const cap = shiftMonth(range.current, 17);
	return { from: range.current, to: range.last < cap ? range.last : cap };
}

export function registerTools(server: McpServer, catalogue: Catalogue, origin: string): void {
	server.registerTool(
		'search_events',
		{
			title: 'Search upcoming events',
			description:
				'Search the upcoming events in Stord, Bømlo and Fitjar. Every word in `q` must appear somewhere in the title, description, venue or organiser — it is text matching, not semantic search, so try a few plain Nynorsk or Bokmål words ("konsert", "quiz", "tur") rather than a sentence, and run several searches for a broad question. Filters combine. Use `resolve_names` to turn a half-remembered venue or source into the exact value `venue` and `source` expect. Results are ordered soonest first; page with `offset`.',
			inputSchema: eventQuerySchema.extend({
				q: eventQuerySchema.shape.q.describe(
					'Free text. All words must match. Data is in Norwegian (mostly Nynorsk).'
				),
				category: eventQuerySchema.shape.category.describe(
					'One category slug. `list_categories` gives them with labels and counts.'
				),
				municipality: eventQuerySchema.shape.municipality.describe(
					`Exact municipality name: ${COVERED_MUNICIPALITIES.join(', ')}.`
				),
				venue: eventQuerySchema.shape.venue.describe(
					'Exact venue name, as `resolve_names` returns it.'
				),
				source: eventQuerySchema.shape.source.describe(
					'A source slug from `list_sources`, or `innsendt` for events readers sent in.'
				),
				from: eventQuerySchema.shape.from.describe(
					'Earliest instant, ISO 8601 with offset (2026-10-16T00:00:00+02:00). Defaults to now; an event already under way still counts.'
				),
				to: eventQuerySchema.shape.to.describe(
					'Latest start, ISO 8601 with offset. Omit for no upper bound.'
				)
			}),
			outputSchema: listResultSchema,
			annotations: READ_ONLY
		},
		async (input) => listResult(listOf(await catalogue.listEvents(input), origin))
	);

	server.registerTool(
		'get_event',
		{
			title: 'One event in full',
			description:
				'Everything we know about one event: description, venue with address and coordinates, organiser, where tickets are, every source that reported it with its own link, a weekly timetable if it is a recurring activity, and — for a film — every upcoming screening. Accepts an id or a pasted hendingar.no link.',
			inputSchema: z.object({ event: eventRef }),
			outputSchema: publicEventDetailSchema.extend({
				screenings: z
					.array(
						z.object({
							startsAt: z.string(),
							when: z.string(),
							venue: z.string().nullable(),
							ticketUrl: z.string().nullable()
						})
					)
					.optional()
			}),
			annotations: READ_ONLY
		},
		async ({ event }) => {
			const id = resolveEventRef(event);
			if (id === null)
				return failure('Det ser ikkje ut som ein lenkje til ei hending på hendingar.no.');
			const row = await catalogue.getEvent(id);
			if (!row) return failure(`Fann inga publisert hending med id ${id}.`);
			const detail = toPublicEventDetail(row, origin);
			const film = row.category === 'kino' ? await catalogue.filmScreenings(id) : null;
			return withHint(DETAIL_HINT, {
				...detail,
				...(film?.film
					? {
							screenings: film.screenings.map((s) => ({
								startsAt: schemaDateTime(s.startsAt, s.venueTimeZone),
								when: formatEventTime(s.startsAt, s.venueTimeZone, 'full'),
								venue: s.venueName,
								ticketUrl: s.ctaUrl
							}))
						}
					: {})
			});
		}
	);

	server.registerTool(
		'events_on_date',
		{
			title: 'Events on one day',
			description:
				'Every event on one calendar day at the venues, including ones earlier that day and multi-day events that span it. Use this for "what is on Saturday 18 October", not for ranges.',
			inputSchema: z.object({ date: calendarDateSchema.describe('The day, YYYY-MM-DD.') }),
			outputSchema: listResultSchema,
			annotations: READ_ONLY,
			_meta: VIEW_META
		},
		async ({ date }) =>
			listResult(listOf(await catalogue.listEventsOnDate(date), origin), VIEW_LIST_HINT)
	);

	server.registerTool(
		'weekend_events',
		{
			title: 'This or next weekend',
			description:
				'Everything on this weekend (`denne`) or next (`neste`), Friday to Sunday — the same lists as hendingar.no/denne-helga and /neste-helg. For a hand-picked shortlist instead, see `weekend_picks`.',
			inputSchema: z.object({
				which: z
					.enum(['denne', 'neste'])
					.default('denne')
					.describe('`denne` = this weekend, `neste` = next.')
			}),
			outputSchema: listResultSchema,
			annotations: READ_ONLY,
			_meta: VIEW_META
		},
		async ({ which }) =>
			listResult(listOf(await catalogue.weekendEvents(which), origin), VIEW_LIST_HINT)
	);

	server.registerTool(
		'week_events',
		{
			title: 'Events in one ISO week',
			description:
				'Every event in one ISO week (Monday to Sunday), timed events first and then the ones that span several days.',
			inputSchema: z.object({
				week: calendarWeekSchema.describe('ISO week, YYYY-Www, e.g. 2026-W43.')
			}),
			outputSchema: listResultSchema.extend({ dates: z.array(z.string()) }),
			annotations: READ_ONLY,
			_meta: VIEW_META
		},
		async ({ week }) => {
			const answer = await catalogue.weekEvents(week);
			const list = listOf([...answer.timed, ...answer.spanning], origin);
			return listResult({ ...list, dates: answer.dates }, VIEW_LIST_HINT);
		}
	);

	server.registerTool(
		'busy_days',
		{
			title: 'How many events each day',
			description:
				'A count of events per day across a span of months, plus how many events each municipality has in that span — for questions like "which weekend in November has most on". Omit the span to start from this month.',
			inputSchema: z.object({
				span: calendarSpanSchema
					.optional()
					.describe(
						'Months `{ from: "YYYY-MM", to: "YYYY-MM" }`, at most 18. Defaults to this month onwards.'
					)
			}),
			outputSchema: z.object({
				from: z.string(),
				to: z.string(),
				days: z.array(z.object({ date: z.string(), total: z.number().int() })),
				places: z.array(z.object({ municipality: z.string().nullable(), total: z.number().int() }))
			}),
			annotations: READ_ONLY
		},
		async ({ span }) => {
			const bounded = span ?? (await defaultSpan(catalogue));
			const [days, places] = await Promise.all([
				catalogue.dayCounts(bounded),
				catalogue.placeCounts(bounded)
			]);
			return result({ from: bounded.from, to: bounded.to, days, places });
		}
	);

	server.registerTool(
		'upcoming_events',
		{
			title: 'What is on next',
			description: 'The next events, soonest first, with no filter at all.',
			inputSchema: z.object({
				limit: z.number().int().min(1).max(60).default(24).describe('How many, 1–60.')
			}),
			outputSchema: listResultSchema,
			annotations: READ_ONLY,
			_meta: VIEW_META
		},
		async ({ limit }) =>
			listResult(listOf(await catalogue.listUpcoming(limit), origin), VIEW_LIST_HINT)
	);

	server.registerTool(
		'always_open',
		{
			title: 'Places that are open, not events',
			description:
				'Things that run for a month or more rather than happening at a time: an exhibition, an escape room, a trail. `startsAt`/`endsAt` are the season, not a start time. Weekly clubs and training are in `weekly_activities` instead.',
			inputSchema: z.object({}),
			outputSchema: listResultSchema,
			annotations: READ_ONLY
		},
		async () => listResult(listOf(await catalogue.standingOffers(), origin))
	);

	server.registerTool(
		'weekly_activities',
		{
			title: 'Clubs, training and weekly activities',
			description:
				'Activities that meet on a weekly timetable — sports teams, choirs, groups — with who runs them, where, the timetable as written (including cadences like "partalsveker"), and the age range when the source gives one. Not dated events: there is no single start time.',
			inputSchema: z.object({}),
			outputSchema: z.object({
				today: z.string(),
				count: z.number().int(),
				activities: z.array(
					z.object({
						id: z.number().int(),
						title: z.string(),
						url: z.string(),
						organizer: z.string().nullable(),
						venue: z.string().nullable(),
						timetable: z
							.object({ cadence: z.string().nullable(), lines: z.array(z.string()) })
							.nullable(),
						ageFrom: z.number().int().nullable(),
						ageTo: z.number().int().nullable()
					})
				)
			}),
			annotations: READ_ONLY
		},
		async () => {
			const { today: day, activities } = await catalogue.weeklyActivities();
			return result({
				today: day,
				count: activities.length,
				activities: activities.map((a) => ({
					id: a.id,
					title: a.title,
					url: new URL(eventPath(a.id, a.title), origin).href,
					organizer: a.organizerName,
					venue: a.venueName,
					timetable: a.weeklyHours ? describeWeeklyHours(a.weeklyHours) : null,
					ageFrom: a.ageFrom,
					ageTo: a.ageTo
				}))
			});
		}
	);

	server.registerTool(
		'weekend_picks',
		{
			title: 'Three picks for the weekend',
			description:
				"Up to three of this weekend's events, chosen overnight by hendingar.no's own kurator with one sentence each on why. Every claim in a reason was checked against the event's own record. Popularity is not an input. Often empty — that is an honest answer, not an error; fall back to `weekend_events`.",
			inputSchema: z.object({}),
			outputSchema: z.object({
				picks: z.array(
					z.object({
						rank: z.number().int(),
						reason: z.string(),
						id: z.number().int(),
						title: z.string(),
						startsAt: z.string(),
						when: z.string(),
						venue: z.string().nullable(),
						url: z.string()
					})
				)
			}),
			annotations: READ_ONLY
		},
		async () => {
			const picks = await catalogue.weekendPicks();
			return withHint(PICKS_HINT, {
				picks: picks.map((p) => ({
					rank: p.rank,
					reason: p.reason,
					id: p.eventId,
					title: p.title,
					startsAt: schemaDateTime(p.startsAt, p.venueTimeZone),
					when: formatEventTime(p.startsAt, p.venueTimeZone, 'full'),
					venue: p.venueName,
					url: new URL(eventPath(p.eventId, p.title), origin).href
				}))
			});
		}
	);

	server.registerTool(
		'popular_events',
		{
			title: 'What readers are opening',
			description:
				'Upcoming events ordered by how many readers hearted (`hearts`) or opened (`views`) them on hendingar.no. This measures attention on this site, not quality, and a small event nobody has found yet will not be here. Do not present it as "the best" events.',
			inputSchema: z.object({
				by: z.enum(['hearts', 'views']).default('hearts'),
				limit: z.number().int().min(1).max(60).default(24)
			}),
			outputSchema: listResultSchema,
			annotations: READ_ONLY
		},
		async (input) => listResult(listOf(await catalogue.listPopular(input), origin))
	);

	server.registerTool(
		'resolve_names',
		{
			title: 'Find the exact venue, category or source',
			description:
				'Turn a fragment ("kulturhuset", "turlag", "mat") into the exact venue names, category slugs and source slugs that `search_events` filters on, with how many upcoming events each has, plus a few matching event titles.',
			inputSchema: z.object({
				term: searchTermSchema.describe('A word or two. Matched on the first word.')
			}),
			outputSchema: z.object({
				venues: z.array(z.object({ name: z.string(), total: z.number().int() })),
				categories: z.array(
					z.object({ slug: z.string(), label: z.string(), total: z.number().int() })
				),
				sources: z.array(z.object({ slug: z.string(), name: z.string(), total: z.number().int() })),
				events: z.array(
					z.object({ id: z.number().int(), title: z.string(), when: z.string(), url: z.string() })
				),
				total: z.number().int()
			}),
			annotations: READ_ONLY
		},
		async ({ term }) => {
			const found = await catalogue.searchSuggestions(term);
			return result({
				venues: found.venues,
				categories: found.categories,
				sources: found.sources,
				events: found.events.map((e) => ({
					id: e.id,
					title: e.title,
					when: formatEventTime(e.startsAt, e.venueTimeZone, 'full'),
					url: new URL(eventPath(e.id, e.title), origin).href
				})),
				total: found.total
			});
		}
	);

	server.registerTool(
		'list_categories',
		{
			title: 'Categories',
			description:
				'Every category slug with its Nynorsk label and how many upcoming events it has.',
			inputSchema: z.object({}),
			outputSchema: z.object({
				categories: z.array(
					z.object({ slug: z.string(), label: z.string(), upcoming: z.number().int() })
				)
			}),
			annotations: READ_ONLY
		},
		async () => {
			const counts = new Map((await catalogue.listCategoryCounts()).map((c) => [c.slug, c.total]));
			return result({
				categories: CATEGORIES.map((c) => ({
					slug: c.slug,
					label: c.label,
					upcoming: counts.get(c.slug) ?? 0
				}))
			});
		}
	);

	server.registerTool(
		'list_sources',
		{
			title: 'Where the events come from',
			description:
				'Every calendar hendingar.no collects from, with its own site, how many upcoming events it gives, and how its most recent collection went — the same record as hendingar.no/datasamling. Use it to credit a source, or to tell whether a calendar has gone quiet.',
			inputSchema: z.object({}),
			outputSchema: z.object({
				sources: z.array(
					z.object({
						slug: z.string(),
						name: z.string(),
						url: z.string().nullable(),
						region: z.string().nullable(),
						kind: z.string(),
						upcoming: z.number().int(),
						lastRun: z.object({ at: z.string(), status: z.string() }).nullable()
					})
				)
			}),
			annotations: READ_ONLY
		},
		async () => {
			const rows = await catalogue.listSources();
			return result({
				sources: rows.map((s) => {
					const last = s.runs[0];
					return {
						slug: s.slug,
						name: s.name,
						url: s.url,
						region: s.region,
						kind: s.kind,
						upcoming: s.eventsUpcoming,
						lastRun: last ? { at: last.startedAt.toISOString(), status: last.status } : null
					};
				})
			});
		}
	);

	server.registerTool(
		'show_events',
		{
			title: 'Show events as cards',
			description:
				'Show the user a selection you made, as cards: poster, time, place, and buttons to add each to their calendar, buy tickets, or ask for more. Use it after `search_events` or to narrow a long list to what fits the user — the day, weekend and week tools already draw their own cards. Call it once, with the ids you chose (up to 12). Clients that cannot draw cards get the same events as data. Keep your own text short afterwards: the cards carry the details.',
			inputSchema: z.object({
				ids: z
					.array(z.number().int().positive())
					.min(1)
					.max(SHOW_MAX)
					.describe(`Event ids to show, from any other tool. At most ${SHOW_MAX}.`),
				heading: z
					.string()
					.trim()
					.max(80)
					.optional()
					.describe('A short heading in the user\'s language, e.g. "Laurdag på Stord".')
			}),
			outputSchema: showEventsResultSchema,
			annotations: READ_ONLY,
			_meta: VIEW_META
		},
		async ({ ids, heading }) => {
			const unique = [...new Set(ids)];
			const rows = await Promise.all(unique.map((id) => catalogue.getEvent(id)));
			const events = rows.flatMap((row) => (row ? [toPublicEventDetail(row, origin)] : []));
			const found = new Set(events.map((e) => e.id));
			return withHint(SHOW_HINT, {
				heading: heading || null,
				today: today(),
				timeZone: DEFAULT_TIME_ZONE,
				events,
				missing: unique.filter((id) => !found.has(id))
			});
		}
	);

	server.registerTool(
		'about',
		{
			title: 'About hendingar.no',
			description:
				'What hendingar.no covers, how much it holds right now, when it last collected, and how somebody adds an event. Call this first if unsure whether a place is covered.',
			inputSchema: z.object({}),
			outputSchema: z.object({
				site: z.string(),
				covers: z.array(z.string()),
				upcomingEvents: z.number().int(),
				standingOffers: z.number().int(),
				sources: z.number().int(),
				lastCollectedAt: z.string().nullable(),
				addAnEvent: z.string(),
				notes: z.array(z.string())
			}),
			annotations: READ_ONLY
		},
		async () => {
			const status = await catalogue.siteStatus();
			return result({
				site: origin,
				covers: [...COVERED_MUNICIPALITIES],
				upcomingEvents: status.upcomingCount,
				standingOffers: status.standingCount,
				sources: status.sourceCount,
				lastCollectedAt: status.lastCollectedAt?.toISOString() ?? null,
				addAnEvent: new URL('/send-inn', origin).href,
				notes: ABOUT_NOTES
			});
		}
	);
}

/** Also served as the `hendingar://about` resource. */
export const ABOUT_NOTES = [
	'An open-source index of local events, free and with no ads. It collects from public calendars and from readers, and links back to every source.',
	'It does not sell tickets. `ticketUrl` is where somebody else sells them.',
	'Anyone can add an event at /send-inn with no account. It is checked automatically and the sender sees the verdict.',
	'Times are given with the venue offset and as a wall clock; never shift them to another zone.',
	'The text is in Norwegian, mostly Nynorsk. Translate if the user writes in another language, but keep names as written.'
];
