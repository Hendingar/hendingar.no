import { query } from '$app/server';
import { z } from 'zod';
import { and, asc, count, desc, eq, gte, ilike, isNull, lte, ne, sql } from 'drizzle-orm';
import {
	eventHearts,
	eventViewDays,
	eventViews,
	events,
	organizers,
	sources,
	venues
} from '@hendingar/core/schema';
import { eventQuerySchema } from '@hendingar/core/validation';
import { SUBMITTED_SLUG } from '@hendingar/core/directory';
import { likePattern, searchTermSchema, searchTokens } from '@hendingar/core/search';
import { categoryLabel } from '@hendingar/core/taxonomy';
import {
	DEFAULT_TIME_ZONE,
	addDays,
	nextWeekendDates,
	weekendAhead
} from '@hendingar/core/datetime';
// The rail covers exactly as far ahead as a repeating event is worked out. Imported rather than
// spelled 26 here, so the page cannot promise a horizon the data does not have (ADR 0009).
import { db } from './server/db';
import { localDayKey } from './calendar.ts';
import {
	datedOnly,
	fromSourceGroup,
	listed,
	matchesSearch,
	notOver,
	sourceMarksFor,
	stillListed,
	tileColumns,
	submittedByHand,
	weeklyListed
} from './server/listing.ts';
import { withStartsIn } from './starts-in.ts';

/**
 * The client↔server boundary, typed end to end.
 *
 * The Zod schemas imported from @hendingar/core ARE the wire types — there is no separate
 * request/response type to keep in sync, and no hand-written fetch. Change a schema and every
 * call site fails to typecheck. See docs/decisions/0002-remote-functions.md.
 *
 * Every field the schema accepts must be honoured here. A validator that advertises a filter the
 * query ignores is worse than no filter: it returns confident, wrong results, and remote-query
 * results are cached per-argument, so two different filters become two cache entries holding the
 * same unfiltered data.
 */

export const listEvents = query(
	eventQuerySchema,
	async ({ from, to, category, source, municipality, q, venue, limit, offset }) => {
		const since = from ? new Date(from) : new Date();
		// Its own instant, not `since`: a caller can ask for a window starting next month, and
		// "starts in" is always measured from now rather than from the edge of the window.
		const now = new Date();

		const rows = await db()
			.select(tileColumns)
			.from(events)
			.leftJoin(venues, eq(events.venueId, venues.id))
			.leftJoin(sources, eq(events.sourceId, sources.id))
			/*
			 * Joined for the search, not for the select.
			 *
			 * The organiser is one of the four fields a query matches against — "bømlo turlag" is
			 * how somebody looks for the turlag's walks — and a left join cannot change which rows
			 * come back, only what can be asked about them.
			 */
			.leftJoin(organizers, eq(events.organizerId, organizers.id))
			.where(
				and(
					// Only canonical rows: several sources report the same concert, and without this the
					// listing shows the same evening twice under two spellings.
					listed,
					// An event that has started but not ended is still happening, and must stay
					// visible. Filtering on startsAt alone hid a three-hour concert for its whole
					// duration, and a weekend festival for the entire weekend.
					notOver(since),
					to ? lte(events.startsAt, new Date(to)) : undefined,
					category ? eq(events.category, category) : undefined,
					/*
					 * Match the whole group, not just the row that won. `innsendt` is checked first
					 * because it is not a row in `sources`: the group match would search for a slug
					 * that is deliberately not there and quietly return nothing.
					 */
					source === SUBMITTED_SLUG
						? submittedByHand
						: source
							? fromSourceGroup(source)
							: undefined,
					municipality ? eq(venues.municipality, municipality) : undefined,
					/*
					 * One venue, matched exactly on its name.
					 *
					 * The suggestions offer venue names and the URL carries one, so this is a
					 * filter rather than a second search: `?stad=Stord kyrkje` means that place,
					 * not every place with "stord" in the name.
					 */
					venue ? eq(venues.name, venue) : undefined,
					matchesSearch(q)
				)
			)
			// Ordered by the same effective instant the grouping uses, so day groups stay contiguous.
			.orderBy(sql`greatest(${events.startsAt}, now())`, asc(events.startsAt))
			.limit(limit)
			.offset(offset);

		return withStartsIn(rows, now);
	}
);

/**
 * How many upcoming events each source has, for the source filter.
 *
 * Same reasoning as `listCategoryCounts`: a chip that leads to an empty page is a worse control
 * than one that tells you what it holds before you press it. Only sources with events appear, so a
 * `link` row — which by definition has none — never shows up as a dead filter.
 */
export const listSourceCounts = query(async () => {
	const now = new Date();
	const rows = await db()
		.select({
			slug: sources.slug,
			name: sources.name,
			iconUrl: sources.iconUrl,
			total: count(events.id)
		})
		.from(sources)
		.innerJoin(events, eq(events.sourceId, sources.id))
		.where(and(listed, notOver(now)))
		.groupBy(sources.slug, sources.name, sources.iconUrl);

	/*
	 * Events people sent in, as a source of their own.
	 *
	 * They have no `sources` row — a submission comes from a person, not a calendar — so the join
	 * above cannot see them and there was no way to ask "what did people send in?". Counted
	 * separately and given a reserved slug, which `listEvents` recognises.
	 */
	const [submitted] = await db()
		.select({ total: count(events.id) })
		.from(events)
		.where(and(listed, submittedByHand, notOver(now)));

	const sorted = rows.sort((a, b) => b.total - a.total || a.name.localeCompare(b.name, 'nb-NO'));

	// Last, whatever its count: it is a different kind of thing from a calendar we collect, and
	// sorting it in among them would say otherwise.
	return submitted && submitted.total > 0
		? [
				...sorted,
				{ slug: SUBMITTED_SLUG, name: 'Innsendt av folk', iconUrl: null, total: submitted.total }
			]
		: sorted;
});

/**
 * What the site currently holds, for the front page.
 *
 * The honest answer to "is this everything?" — which a visitor cannot otherwise get without
 * opening /datasamling, a page most people never will. Someone looking at two dozen events cannot
 * tell whether that is a whole country or three calendars in one municipality, and guessing wrong
 * in either direction is bad: they either trust an empty result or dismiss a good one.
 *
 * Every number is read from the data. Nothing here is copy that can drift from the truth.
 */
export const siteStatus = query(async () => {
	const database = db();
	const now = new Date();

	const [upcoming] = await database
		.select({ total: count() })
		.from(events)
		.where(and(listed, notOver(now)));

	// Only sources we actually collect. A `link` row is a signpost, not a feed, and counting it
	// would inflate the number that is supposed to mean "places this list comes from".
	const collected = await database
		.select({ region: sources.region, lastRunAt: sources.lastRunAt })
		.from(sources)
		.where(and(eq(sources.active, true), ne(sources.kind, 'link')));

	const [linked] = await database
		.select({ total: count() })
		.from(sources)
		.where(eq(sources.kind, 'link'));

	/*
	 * Counted separately, and named separately on the page.
	 *
	 * `upcomingCount` above says "hendingar framover" and must mean it — a five-year span sitting
	 * inside that number would make the site's headline figure quietly untrue. But they are still
	 * collected and still ours, so leaving them out of the coverage line entirely would understate
	 * what the index holds. Two numbers, each saying what it is.
	 */
	const [standing] = await database
		.select({ total: count() })
		.from(events)
		.where(
			and(
				eq(events.status, 'published'),
				stillListed,
				isNull(events.duplicateOfId),
				eq(events.kind, 'standing'),
				// Places only. The weekly activities are a club directory, not "stader som alltid
				// er opne", and counting a football squad as a place would make this line untrue.
				isNull(events.weeklyHours),
				gte(events.endsAt, now)
			)
		);

	const lastCollectedAt = collected.reduce<Date | null>(
		(latest, s) => (s.lastRunAt && (!latest || s.lastRunAt > latest) ? s.lastRunAt : latest),
		null
	);

	return {
		generatedAt: now,
		sourceCount: collected.length,
		linkedCount: linked?.total ?? 0,
		upcomingCount: upcoming?.total ?? 0,
		/** Places that are open rather than events that happen — see `standingOffers`. */
		standingCount: standing?.total ?? 0,
		regions: [...new Set(collected.map((s) => s.region))].sort(),
		lastCollectedAt
	};
});

/**
 * What the one field can offer you, for what you have typed so far.
 *
 * The listing's whole filter is a single input (ADR-less by design note: see the canvas that
 * settled it), so this is the only place a reader is shown what the corpus contains. It answers in
 * four kinds at once — a place, a kind of thing, a calendar, and a specific event — because a
 * person typing "bremnes" may mean any of them and the field cannot know which.
 *
 * **An empty query is not an empty answer.** Focusing the field with nothing typed returns the
 * biggest categories and the busiest venues, which is what the chip rows used to say out loud.
 * Without that, the cost of collapsing forty chips into one field is that nothing is discoverable
 * until you already know what to ask for — the tradeoff the sketch named, paid off here.
 *
 * Every count is upcoming, published, canonical and dated, exactly like the listing itself: a
 * suggestion that leads to an empty page is worse than no suggestion.
 */
export const searchSuggestions = query(searchTermSchema, async (term) => {
	const database = db();
	const now = new Date();
	const live = () => and(listed, notOver(now));

	const tokens = searchTokens(term);
	const searching = tokens.length > 0;
	/*
	 * The name suggestions match on the FIRST token only.
	 *
	 * "bremnes kyrkje jul" should still offer the venue Bremnes kyrkje — the later words are the
	 * reader narrowing what they want there, not part of its name. The free-text row below is what
	 * carries the whole query, and it is always offered.
	 */
	const head = searching ? likePattern(tokens[0]!) : null;

	const [venueRows, categoryRows, sourceRows, eventRows, totalRow] = await Promise.all([
		database
			.select({ name: venues.name, total: count() })
			.from(events)
			.innerJoin(venues, eq(events.venueId, venues.id))
			.where(and(live(), head ? ilike(venues.name, head) : undefined))
			.groupBy(venues.name)
			.orderBy(desc(count()))
			.limit(4),

		database
			.select({ category: events.category, total: count() })
			.from(events)
			.where(live())
			.groupBy(events.category),

		database
			// The icon is the clue a name alone is not: "Stord kino" reads like a place until its own
			// favicon says it is a calendar.
			.select({ slug: sources.slug, name: sources.name, iconUrl: sources.iconUrl, total: count() })
			.from(events)
			.innerJoin(sources, eq(events.sourceId, sources.id))
			.where(and(live(), head ? ilike(sources.name, head) : undefined))
			.groupBy(sources.slug, sources.name, sources.iconUrl)
			.orderBy(desc(count()))
			.limit(3),

		// Named events only when something is typed: a list of four arbitrary titles teaches nobody
		// anything about a corpus of six hundred.
		searching
			? database
					.select({
						id: events.id,
						title: events.title,
						startsAt: events.startsAt,
						venueName: venues.name,
						venueTimeZone: venues.timezone
					})
					.from(events)
					.leftJoin(venues, eq(events.venueId, venues.id))
					.leftJoin(organizers, eq(events.organizerId, organizers.id))
					.where(and(live(), matchesSearch(term)))
					.orderBy(sql`greatest(${events.startsAt}, now())`)
					.limit(4)
			: Promise.resolve([]),

		database
			.select({ total: count() })
			.from(events)
			.leftJoin(venues, eq(events.venueId, venues.id))
			.leftJoin(organizers, eq(events.organizerId, organizers.id))
			.where(and(live(), matchesSearch(term)))
	]);

	/*
	 * Categories are matched in code, against their LABELS.
	 *
	 * The slug is `mat-og-drikke` and the label is "Mat og drikke"; a reader types the second. The
	 * labels live in the taxonomy rather than the database (rule 1), so this is the one axis where
	 * the filtering cannot be a `where` clause — and with sixteen of them, it does not want to be.
	 */
	const categories = categoryRows
		.map((row) => ({ slug: row.category, label: categoryLabel(row.category), total: row.total }))
		.filter((row) => !searching || row.label.toLowerCase().includes(tokens[0]!.toLowerCase()))
		.sort((a, b) => b.total - a.total || a.label.localeCompare(b.label, 'nb-NO'))
		.slice(0, searching ? 3 : 5);

	return {
		venues: venueRows,
		categories,
		// A calendar is provenance, and provenance is never the first thing offered — only ever in
		// answer to somebody typing its name.
		sources: searching ? sourceRows : [],
		events: eventRows,
		/** How many events the free text alone would find. Zero is a useful answer here. */
		total: totalRow[0]?.total ?? 0,
		searching
	};
});

export type SearchSuggestions = Awaited<ReturnType<typeof searchSuggestions>>;

/**
 * How many upcoming events each category has.
 *
 * The filter renders from this rather than from the full taxonomy: sixteen chips where eleven lead
 * to an empty page is a worse control than five that all go somewhere. The count also tells you
 * whether a filter is worth pressing before you press it.
 */
export const listCategoryCounts = query(async () => {
	const now = new Date();
	const rows = await db()
		.select({ category: events.category, total: count() })
		.from(events)
		.where(and(listed, notOver(now)))
		.groupBy(events.category);

	return rows
		.map((row) => ({ slug: row.category, label: categoryLabel(row.category), total: row.total }))
		.sort((a, b) => b.total - a.total || a.label.localeCompare(b.label, 'nb-NO'));
});

/**
 * How much is on today, tomorrow, this weekend, and altogether — the counts behind the front
 * page's four ways in.
 *
 * The count IS the invitation. "I dag" is a label; "I dag — 6 hendingar" is a reason to press it,
 * and a reader who presses it lands on a page that has something on it. The same argument
 * `listCategoryCounts` records for the filter chips, applied to the entry points a visitor meets
 * first.
 *
 * Every one of the four leads to a page that already exists — `/kalender/<dato>` twice,
 * `/neste-helg`, `/hendingar` — so this returns the DATES as well as the numbers and the caller
 * builds real links. That is deliberate, and it is the reasoning recorded in #81: a filter has to
 * be a URL to be shareable, and a URL that answers a different question every Monday is not a
 * filter but a page. Four buttons swapping a list in place would have been exactly that mistake,
 * one screen earlier.
 *
 * One grouped query rather than four counts. It is the same row set `siteStatus.upcomingCount`
 * measures, with the same predicate, so the total here and the total in the coverage strip below
 * the list cannot disagree — they are two readings of one number.
 */
export const waysInCounts = query(async () => {
	const now = new Date();

	/*
	 * Grouped by the calendar day AT THE VENUE, exactly as the listing groups it — including the
	 * `greatest(starts_at, now())` that files a still-running exhibition under today. A count that
	 * used a different rule from the list it leads to would promise six and deliver five.
	 */
	const localDate = sql<string>`
		to_char(
			greatest(${events.startsAt}, now())
				at time zone coalesce(${venues.timezone}, 'Europe/Oslo'),
			'YYYY-MM-DD'
		)
	`;

	const rows = await db()
		.select({ localDate: localDate.as('local_date'), total: count() })
		.from(events)
		.leftJoin(venues, eq(events.venueId, venues.id))
		.where(and(listed, notOver(now)))
		.groupBy(localDate);

	const byDate = new Map(rows.map((row) => [row.localDate, row.total]));
	const today = localDayKey(now, DEFAULT_TIME_ZONE);
	const tomorrow = addDays(today, 1);
	const weekend = weekendAhead(today);
	const nextWeekend = nextWeekendDates(today);

	return {
		today,
		tomorrow,
		todayCount: byDate.get(today) ?? 0,
		tomorrowCount: byDate.get(tomorrow) ?? 0,
		/*
		 * The same days `/denne-helga` will actually show — `weekendAhead`, not `weekendDates`, so
		 * the number counts what is LEFT of the weekend rather than what was on it. On a Sunday
		 * afternoon those are very different, and the larger one would be a promise the page
		 * cannot keep.
		 */
		weekendCount: weekend.reduce((n, date) => n + (byDate.get(date) ?? 0), 0),
		/*
		 * And the weekend after that, which `/neste-helg` shows in full — a week out, none of its
		 * three days has gone, so there is nothing to drop.
		 *
		 * Counted from the same grouped rows as everything else here, which is what stops the two
		 * weekend tabs from ever claiming the same event: `weekendAhead` and `nextWeekendDates`
		 * cannot overlap, and a unit test walks a year asserting exactly that.
		 */
		nextWeekendCount: nextWeekend.reduce((n, date) => n + (byDate.get(date) ?? 0), 0),
		upcomingCount: rows.reduce((n, row) => n + row.total, 0)
	};
});

/**
 * The places that are simply open — museums, galleries, a swimming hall, an escape room.
 *
 * Everything the listings above exclude, which is the point: these have no meaningful start time,
 * so they cannot be sorted into a day without claiming one. They are not a lesser kind of row, they
 * are a different question — "what can I do" rather than "what is on tonight".
 *
 * Ordered by title. Not by `starts_at`, which for these is an arbitrary date years in the past, and
 * not by how long they run, which means nothing to a reader. Alphabetical is the only order that
 * does not imply a ranking nobody intended.
 *
 * No date filter beyond "not finished": a standing offer that has genuinely closed should drop off,
 * and `ends_at >= now()` is what says so.
 *
 * **Places only — not the weekly activities.** A standing row with a timetable is a club's training
 * or a choir's rehearsal, and there are a hundred of them; served here they would make every
 * consumer of this query — the front-page band, the "Òg ope denne dagen" line — a list of football
 * squads. `weeklyActivities` serves them, grouped. See ADR 0021.
 */
export const standingOffers = query(async () => {
	return db()
		.select({
			id: events.id,
			title: events.title,
			category: events.category,
			startsAt: events.startsAt,
			endsAt: events.endsAt,
			venueName: venues.name,
			municipality: venues.municipality,
			posterUrl: events.posterUrl,
			posterSrcset: events.posterSrcset,
			trail: events.trail,
			sourceMarks: sourceMarksFor(events.id).as('source_marks')
		})
		.from(events)
		.leftJoin(venues, eq(events.venueId, venues.id))
		.where(
			and(
				eq(events.status, 'published'),
				stillListed,
				isNull(events.duplicateOfId),
				eq(events.kind, 'standing'),
				isNull(events.weeklyHours),
				gte(events.endsAt, new Date())
			)
		)
		.orderBy(asc(events.title));
});

export type StandingOffer = Awaited<ReturnType<typeof standingOffers>>[number];

/**
 * The clubs, choirs and groups that meet every week, and the date it is in Bømlo.
 *
 * Flat, not grouped: `/alltid-ope` reads the same rows two ways — by day ("what meets on
 * laurdag"), and by who runs them — and both are pure functions in `weekly-view.ts`, where they
 * are unit-tested rather than buried in a query.
 *
 * `today` comes from the server so the page and its hydration agree on what "i dag" is, in the
 * venue's zone rather than the visitor's or the server's. Every venue in the pilot is in Oslo time;
 * a second zone would mean resolving per activity.
 */
export const weeklyActivities = query(async () => {
	const activities = await db()
		.select({
			id: events.id,
			title: events.title,
			weeklyHours: events.weeklyHours,
			ageFrom: events.ageFrom,
			ageTo: events.ageTo,
			venueName: venues.name,
			organizerName: organizers.name
		})
		.from(events)
		.leftJoin(venues, eq(events.venueId, venues.id))
		.leftJoin(organizers, eq(events.organizerId, organizers.id))
		.where(weeklyListed(new Date()));
	return { today: localDayKey(new Date(), DEFAULT_TIME_ZONE), activities };
});

export type WeeklyActivity = Awaited<ReturnType<typeof weeklyActivities>>['activities'][number];

/** The row shape callers get, derived from the query rather than hand-written. */
export type EventSummary = Awaited<ReturnType<typeof listEvents>>[number];

/**
 * The front-page listing: the nearest events, in order, each carrying the calendar day it falls on
 * at its own venue so the page can group by date.
 */
export const listUpcoming = query(z.number().int().min(1).max(60).default(24), async (limit) => {
	const now = new Date();
	const rows = await db()
		.select(tileColumns)
		.from(events)
		.leftJoin(venues, eq(events.venueId, venues.id))
		.leftJoin(sources, eq(events.sourceId, sources.id))
		.where(
			and(
				eq(events.status, 'published'),
				stillListed,
				// One row per event — see listEvents.
				isNull(events.duplicateOfId),
				datedOnly,
				// Still-running events belong to today.
				notOver(new Date())
			)
		)
		// Order by the same effective instant the grouping uses, so groups stay contiguous.
		.orderBy(sql`greatest(${events.startsAt}, now())`, asc(events.startsAt))
		.limit(limit);

	return withStartsIn(rows, now);
});

export type UpcomingEvent = Awaited<ReturnType<typeof listUpcoming>>[number];

/**
 * One published event, as a listing tile — or null when it is not on the listing.
 *
 * For the submission receipt: "Publisert" with nothing to click left the sender to go and find
 * their own event. Public on purpose, like `getEvent`: it returns nothing an event page does not
 * already show, and only for an event that is published and canonical.
 */
export const eventTile = query(z.number().int().positive(), async (id) => {
	const now = new Date();
	const rows = await db()
		.select(tileColumns)
		.from(events)
		.leftJoin(venues, eq(events.venueId, venues.id))
		.where(
			and(
				eq(events.id, id),
				eq(events.status, 'published'),
				stillListed,
				isNull(events.duplicateOfId)
			)
		)
		.limit(1);
	return withStartsIn(rows, now)[0] ?? null;
});

/**
 * What is coming up that people actually engaged with — hearts, or opens.
 *
 * Two orderings of one query rather than two queries, because everything except the sort column
 * and the join is identical, and a second copy is how the two pages drift apart.
 *
 * "Next up", so the same window every other listing uses: published, canonical, and not already
 * over. Popularity is only interesting about something you can still go to — a sold-out concert
 * from March topping the list forever would be a leaderboard, not a listing.
 *
 * The count is carried on the row so the card can show it. An event nobody has hearted or opened
 * scores 0 and simply sorts last; it is not excluded, or a quiet week would render an empty page.
 */
export const listPopular = query(
	z.object({
		by: z.enum(['hearts', 'views']),
		limit: z.number().int().min(1).max(60).default(24)
	}),
	async ({ by, limit }) => {
		const now = new Date();

		/*
		 * Correlated subqueries rather than joins.
		 *
		 * A join to event_hearts would need a GROUP BY over every selected column — including the
		 * json aggregation in `sourceMarks` — and a left join to a table with no row yields null
		 * rather than 0, which sorts differently in Postgres. Both problems disappear here.
		 */
		const hearts = sql<number>`
			coalesce((select count(*) from ${eventHearts} where ${eventHearts.eventId} = ${events.id}), 0)
		`;
		const views = sql<number>`
			coalesce((select ${eventViews.views} from ${eventViews} where ${eventViews.eventId} = ${events.id}), 0)
		`;
		const score = by === 'hearts' ? hearts : views;
		// Today's opens in Oslo, for the "moved since yesterday" on /poppis/vist.
		const viewsToday = sql<number>`
			coalesce((select ${eventViewDays.views} from ${eventViewDays}
				where ${eventViewDays.eventId} = ${events.id}
				and ${eventViewDays.day} = (now() at time zone 'Europe/Oslo')::date), 0)
		`;

		const rows = await db()
			.select({
				id: events.id,
				title: events.title,
				category: events.category,
				startsAt: events.startsAt,
				endsAt: events.endsAt,
				venueName: venues.name,
				venueTimeZone: venues.timezone,
				municipality: venues.municipality,
				posterUrl: events.posterUrl,
				posterSrcset: events.posterSrcset,
				trail: events.trail,
				sourceMarks: sourceMarksFor(events.id).as('source_marks'),
				hearts: hearts.mapWith(Number).as('hearts'),
				views: views.mapWith(Number).as('views'),
				viewsToday: viewsToday.mapWith(Number).as('views_today'),
				localDate: sql<string>`
					to_char(
						greatest(${events.startsAt}, now())
							at time zone coalesce(${venues.timezone}, 'Europe/Oslo'),
						'YYYY-MM-DD'
					)
				`.as('local_date'),
				todayLocalDate: sql<string>`
					to_char(now() at time zone coalesce(${venues.timezone}, 'Europe/Oslo'), 'YYYY-MM-DD')
				`.as('today_local_date')
			})
			.from(events)
			.leftJoin(venues, eq(events.venueId, venues.id))
			.where(and(listed, notOver(now)))
			/*
			 * Soonest first among equals.
			 *
			 * Most events score zero, so without a second key the tail of the page would be in
			 * whatever order Postgres happened to return — different on every reload, which reads
			 * as a broken page rather than as a tie.
			 */
			.orderBy(desc(score), asc(events.startsAt))
			.limit(limit);

		return withStartsIn(rows, now);
	}
);

export type PopularEvent = Awaited<ReturnType<typeof listPopular>>[number];
