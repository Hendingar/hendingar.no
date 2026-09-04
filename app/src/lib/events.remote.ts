import { error } from '@sveltejs/kit';
import { query } from '$app/server';
import { z } from 'zod';
import { and, asc, count, eq, gte, isNull, lte, max, min, ne, or, sql } from 'drizzle-orm';
import type { AnyColumn, SQL } from 'drizzle-orm';
import { events, organizers, sources, venues, verifications } from '@hendingar/core/schema';
import {
	calendarDateSchema,
	calendarMonthSchema,
	eventQuerySchema
} from '@hendingar/core/validation';
import { SUBMITTED_SLUG } from '@hendingar/core/directory';
import { categoryLabel } from '@hendingar/core/taxonomy';
import { DEFAULT_TIME_ZONE } from '@hendingar/core/datetime';
import {
	countByDay,
	instantWindowForDays,
	localDayKey,
	monthBounds,
	monthKeyOf,
	shiftMonth
} from './calendar.ts';
import { db } from './server/db';

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

/** One source's mark on a tile. Its name is the tooltip; the icon is what a reader recognises. */
export type SourceMark = { name: string; iconUrl: string | null };

/**
 * Every source that reported an event, as one JSON array per listing row.
 *
 * A consolidated event is reported by two or three calendars, and the row that won is arbitrary —
 * the lowest id. Showing only its mark credits whichever importer happened to run first, and hides
 * the most interesting thing an index can say: that three separate places agree this is on.
 *
 * Done as a correlated subquery rather than a join so a listing row stays one row. Joining the
 * group would multiply every event by its source count and break both the day grouping and the
 * limit. `events_duplicate_of_idx` is what keeps it cheap.
 *
 * `coalesce(..., '[]')` matters: a human submission has no source row at all, so the aggregate is
 * NULL rather than empty, and the template would render nothing where an array is expected.
 */
function sourceMarksFor(eventId: SQL | AnyColumn) {
	return sql<SourceMark[]>`
		coalesce((
			select json_agg(m order by m.name)
			from (
				select distinct ${sources.name} as name, ${sources.iconUrl} as "iconUrl"
				from ${events} dup
				join ${sources} on ${sources.id} = dup.source_id
				where dup.id = ${eventId} or dup.duplicate_of_id = ${eventId}
			) m
		), '[]'::json)
	`;
}

export const listEvents = query(
	eventQuerySchema,
	async ({ from, to, category, source, municipality, limit, offset }) => {
		const since = from ? new Date(from) : new Date();

		return (
			db()
				.select({
					id: events.id,
					title: events.title,
					category: events.category,
					startsAt: events.startsAt,
					endsAt: events.endsAt,
					venueName: venues.name,
					// The zone is what makes startsAt renderable as a wall clock. Always select it.
					venueTimeZone: venues.timezone,
					municipality: venues.municipality,
					posterUrl: events.posterUrl,
					/*
					 * The source, so a tile can show whose calendar an event came from. We are an index, not a
					 * replacement — a tile that shows no origin quietly claims the event as ours. Null for human
					 * submissions, which have no source row.
					 */
					sourceMarks: sourceMarksFor(events.id).as('source_marks'),
					// Same day-grouping columns as listUpcoming, so one component renders both listings
					// instead of /hendingar having a second, plainer list that drifts from the front page.
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
				.leftJoin(sources, eq(events.sourceId, sources.id))
				.where(
					and(
						eq(events.status, 'published'),
						/*
						 * Only canonical rows.
						 *
						 * Several sources report the same concert; `pnpm consolidate` picks one row per
						 * event and points the others at it. Without this the listing shows the same
						 * evening twice under two spellings.
						 */
						isNull(events.duplicateOfId),
						// An event that has started but not ended is still happening, and must stay
						// visible. Filtering on startsAt alone hid a three-hour concert for its whole
						// duration, and a weekend festival for the entire weekend.
						or(gte(events.startsAt, since), gte(events.endsAt, since)),
						to ? lte(events.startsAt, new Date(to)) : undefined,
						category ? eq(events.category, category) : undefined,
						/*
						 * Match the whole group, not just the row that won.
						 *
						 * Filtering on the canonical's own source alone would hide an event from the
						 * venue that actually runs it whenever a newspaper's copy happened to have the
						 * lower id — "Stord kulturhus" would stop listing its own concerts. So a
						 * canonical matches if IT or any row pointing at it comes from that source.
						 */
						/*
						 * `innsendt` is not a row in `sources`, so it cannot be found by the join.
						 *
						 * It selects the events that have no source at all and did not arrive by
						 * import — which is exactly "somebody sent this in". Checked before the
						 * general branch because that one would search `sources.slug` for a slug
						 * that is deliberately not there and quietly return nothing.
						 */
						source === SUBMITTED_SLUG
							? and(isNull(events.sourceId), ne(events.submissionMethod, 'import'))
							: source
								? sql`exists (
									select 1 from ${events} as m
									join ${sources} as ms on ms.id = m.source_id
									where (m.id = ${events.id} or m.duplicate_of_id = ${events.id})
										and ms.slug = ${source}
								)`
								: undefined,
						municipality ? eq(venues.municipality, municipality) : undefined
					)
				)
				// Ordered by the same effective instant the grouping uses, so day groups stay contiguous.
				.orderBy(sql`greatest(${events.startsAt}, now())`, asc(events.startsAt))
				.limit(limit)
				.offset(offset)
		);
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
		.where(
			and(
				eq(events.status, 'published'),
				isNull(events.duplicateOfId),
				or(gte(events.startsAt, now), gte(events.endsAt, now))
			)
		)
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
		.where(
			and(
				eq(events.status, 'published'),
				isNull(events.duplicateOfId),
				isNull(events.sourceId),
				ne(events.submissionMethod, 'import'),
				or(gte(events.startsAt, now), gte(events.endsAt, now))
			)
		);

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
		.where(
			and(
				eq(events.status, 'published'),
				isNull(events.duplicateOfId),
				or(gte(events.startsAt, now), gte(events.endsAt, now))
			)
		);

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

	const lastCollectedAt = collected.reduce<Date | null>(
		(latest, s) => (s.lastRunAt && (!latest || s.lastRunAt > latest) ? s.lastRunAt : latest),
		null
	);

	return {
		generatedAt: now,
		sourceCount: collected.length,
		linkedCount: linked?.total ?? 0,
		upcomingCount: upcoming?.total ?? 0,
		regions: [...new Set(collected.map((s) => s.region))].sort(),
		lastCollectedAt
	};
});

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
		.where(
			and(
				eq(events.status, 'published'),
				isNull(events.duplicateOfId),
				or(gte(events.startsAt, now), gte(events.endsAt, now))
			)
		)
		.groupBy(events.category);

	return rows
		.map((row) => ({ slug: row.category, label: categoryLabel(row.category), total: row.total }))
		.sort((a, b) => b.total - a.total || a.label.localeCompare(b.label, 'nb-NO'));
});

/** The row shape callers get, derived from the query rather than hand-written. */
export type EventSummary = Awaited<ReturnType<typeof listEvents>>[number];

/**
 * The front-page listing: the nearest events, in order, each carrying the calendar day it falls on
 * at its own venue so the page can group by date.
 */
export const listUpcoming = query(z.number().int().min(1).max(60).default(24), async (limit) => {
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
			sourceMarks: sourceMarksFor(events.id).as('source_marks'),
			/*
			 * The calendar day AT THE VENUE, resolved in SQL. Grouping by day is a calendar
			 * question, not an instant one — deriving it in JS from the server's clock would put a
			 * late Helsinki concert in the wrong group for a reader in Norway.
			 *
			 * greatest(starts_at, now()) so a multi-day exhibition that opened last week is grouped
			 * under TODAY, where a visitor can actually go to it, rather than under a heading dated
			 * before the page they are reading.
			 */
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
		.leftJoin(sources, eq(events.sourceId, sources.id))
		.where(
			and(
				eq(events.status, 'published'),
				// One row per event — see listEvents.
				isNull(events.duplicateOfId),
				// Still-running events belong to today.
				or(gte(events.startsAt, new Date()), gte(events.endsAt, new Date()))
			)
		)
		// Order by the same effective instant the grouping uses, so groups stay contiguous.
		.orderBy(sql`greatest(${events.startsAt}, now())`, asc(events.startsAt))
		.limit(limit);

	return rows;
});

export type UpcomingEvent = Awaited<ReturnType<typeof listUpcoming>>[number];

/*
 * ---------------------------------------------------------------------------------------------
 * The calendar
 *
 * Four queries, and one rule they all share: **published, canonical, whatever the date.**
 *
 * `status = 'published'` and `duplicate_of_id is null` are exactly what `/hendingar` filters on,
 * and they have to be — a square that says 3 must lead to a page that shows 3, and that page must
 * show the same events the listing would. Dropping either filter would count pending submissions
 * the site has not vouched for, or count the same concert three times because three calendars
 * reported it.
 *
 * What the calendar deliberately does NOT copy from the listing is its "still upcoming" filter
 * (`starts_at >= now or ends_at >= now`). A calendar is a calendar: the first half of this month
 * has already happened, and blanking it out would make the grid look like a site with no history
 * while the day pages behind those squares still worked. Past days are shown, and they are honest.
 *
 * Day membership is decided by `localDayKey` in TypeScript rather than by a `to_char(... at time
 * zone ...)` in SQL — see app/src/lib/calendar.ts for why one function has to decide both the
 * count and the contents.
 * ---------------------------------------------------------------------------------------------
 */

/**
 * Which months are worth offering, and what "today" is.
 *
 * There is no point scrolling back to 2019: it is thirty empty grids between the reader and the
 * back button. Navigation is bounded by the data — the month of the earliest published event to
 * the month of the latest — widened so the current month is always reachable even when the
 * database is empty, because a calendar that cannot show you this month is broken rather than
 * merely sparse.
 *
 * `today` comes from here rather than from the browser so the server-rendered HTML and the
 * hydrated page mark the same square. A visitor whose laptop clock is a day out still sees the
 * site's today.
 */
export const calendarRange = query(async () => {
	/*
	 * The bounds are read in the pilot zone rather than per venue, unlike everything else here.
	 * They decide only how far the arrows reach, so a venue in another zone can at worst make the
	 * first or last month reachable a day early — whereas a per-venue min/max would need a join and
	 * a sort to answer a question about arrows.
	 */
	/*
	 * Drizzle's `min`/`max`, not a raw `sql\`min(...)\``. The helpers carry the column's mapper, so
	 * the aggregate comes back as a `Date`; a raw fragment hands over the driver's string and
	 * `instantToZonedWallClock` throws `Invalid time value` on it — which is how this was found.
	 */
	const [row] = await db()
		.select({ earliest: min(events.startsAt), latest: max(events.startsAt) })
		.from(events)
		.where(and(eq(events.status, 'published'), isNull(events.duplicateOfId)));

	const today = localDayKey(new Date(), DEFAULT_TIME_ZONE);
	const current = monthKeyOf(today);
	const earliest = row?.earliest ? monthKeyOf(localDayKey(row.earliest, DEFAULT_TIME_ZONE)) : null;
	const latest = row?.latest ? monthKeyOf(localDayKey(row.latest, DEFAULT_TIME_ZONE)) : null;

	return {
		today,
		current,
		first: earliest && earliest < current ? earliest : current,
		last: latest && latest > current ? latest : current
	};
});

export type CalendarRange = Awaited<ReturnType<typeof calendarRange>>;

/**
 * How many events fall on each day of a month, at each venue's own clock.
 *
 * Only days that have something are returned. An absent day is an empty day — the grid draws those
 * as a plain unlinked number, because a square that leads to a page saying "nothing here" is a
 * worse control than one that never invited the tap.
 */
export const monthEventCounts = query(calendarMonthSchema, async (monthKey) => {
	const { first, last } = monthBounds(monthKey);
	const { from, to } = instantWindowForDays(first, last);

	const rows = await db()
		.select({ startsAt: events.startsAt, venueTimeZone: venues.timezone })
		.from(events)
		.leftJoin(venues, eq(events.venueId, venues.id))
		.where(
			and(
				eq(events.status, 'published'),
				isNull(events.duplicateOfId),
				// A window on the indexed instant, deliberately a day wider than the month at each
				// end; countByDay below decides which of those rows actually belong to it.
				gte(events.startsAt, from),
				lte(events.startsAt, to)
			)
		);

	return [...countByDay(rows)]
		.filter(([date]) => date >= first && date <= last)
		.map(([date, total]) => ({ date, total }))
		.sort((a, b) => a.date.localeCompare(b.date));
});

export type DayCount = Awaited<ReturnType<typeof monthEventCounts>>[number];

/**
 * Everything on one calendar day, in the shape the listing already renders.
 *
 * Returns `UpcomingEvent` rows so `/kalender/<dato>` reuses the tiles the rest of the site is made
 * of instead of growing a third event card. `localDate` is the day asked for — every row here is
 * on it by definition — rather than the listing's `greatest(starts_at, now())`, which exists to
 * pull a running exhibition forward onto today and would be a lie on a page about a fixed date.
 *
 * An event is on the day it *starts*, at its venue. A three-week exhibition therefore counts once,
 * on its opening day, rather than painting twenty-one squares with the same row and making every
 * count on the grid meaningless.
 */
export const listEventsOnDate = query(calendarDateSchema, async (date) => {
	const { from, to } = instantWindowForDays(date, date);

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
			sourceMarks: sourceMarksFor(events.id).as('source_marks')
		})
		.from(events)
		.leftJoin(venues, eq(events.venueId, venues.id))
		.where(
			and(
				eq(events.status, 'published'),
				isNull(events.duplicateOfId),
				gte(events.startsAt, from),
				lte(events.startsAt, to)
			)
		)
		.orderBy(asc(events.startsAt));

	const todayLocalDate = localDayKey(new Date(), DEFAULT_TIME_ZONE);

	return rows
		.filter((row) => localDayKey(row.startsAt, row.venueTimeZone) === date)
		.map((row) => ({ ...row, localDate: date, todayLocalDate }));
});

/**
 * The nearest day either side that has anything on it, so a day page can be stepped through.
 *
 * Plain previous-day/next-day arrows would walk a reader through empty Tuesdays one tap at a time.
 * Skipping to the next day that exists keeps the same promise the grid makes: a control is only
 * offered when there is something behind it.
 *
 * Searched a month either side and no further. Past that the grid is the better tool, and the
 * arrows would be doing its job badly.
 */
export const adjacentEventDays = query(calendarDateSchema, async (date) => {
	const month = monthKeyOf(date);
	const { from } = instantWindowForDays(monthBounds(shiftMonth(month, -1)).first, date);
	const { to } = instantWindowForDays(date, monthBounds(shiftMonth(month, 1)).last);

	const rows = await db()
		.select({ startsAt: events.startsAt, venueTimeZone: venues.timezone })
		.from(events)
		.leftJoin(venues, eq(events.venueId, venues.id))
		.where(
			and(
				eq(events.status, 'published'),
				isNull(events.duplicateOfId),
				gte(events.startsAt, from),
				lte(events.startsAt, to)
			)
		);

	const days = [...countByDay(rows).keys()].sort();
	return {
		previous: days.filter((d) => d < date).at(-1) ?? null,
		next: days.find((d) => d > date) ?? null
	};
});

/**
 * One event, with everything needed to render a page for it.
 *
 * Published only. An event awaiting review has a URL that resolves to nothing, deliberately: the
 * queue is not a preview channel, and a `pending` event is one we have not vouched for.
 *
 * The verification rows come along because the README promises the reasoning is auditable rather
 * than a black box, and the event's own page is the only place a reader would look for it.
 */
export const getEvent = query(z.number().int().positive(), async (id) => {
	const database = db();

	const [row] = await database
		.select({
			id: events.id,
			title: events.title,
			description: events.description,
			category: events.category,
			startsAt: events.startsAt,
			endsAt: events.endsAt,
			posterUrl: events.posterUrl,
			ctaUrl: events.ctaUrl,
			sourceUrl: events.sourceUrl,
			submissionMethod: events.submissionMethod,
			verificationNotes: events.verificationNotes,
			venueName: venues.name,
			venueAddress: venues.address,
			venueMunicipality: venues.municipality,
			venueLatitude: venues.latitude,
			venueLongitude: venues.longitude,
			venueTimeZone: venues.timezone,
			organizerName: organizers.name,
			sourceName: sources.name,
			sourceAttribution: sources.attribution,
			sourceSiteUrl: sources.url
		})
		.from(events)
		.leftJoin(venues, eq(events.venueId, venues.id))
		.leftJoin(organizers, eq(events.organizerId, organizers.id))
		.leftJoin(sources, eq(events.sourceId, sources.id))
		.where(and(eq(events.id, id), eq(events.status, 'published')))
		.limit(1);

	if (!row) error(404, 'Fann ikkje hendinga');

	/*
	 * Every source that reported this event, not just the one whose row won.
	 *
	 * "Three places say this is on" is information, and an index that quietly discards two of them
	 * is throwing away the thing it is for. The canonical row is arbitrary — the lowest id — so
	 * naming only its source would credit whichever importer happened to run first.
	 */
	const reportedBy = await database
		.select({
			slug: sources.slug,
			name: sources.name,
			iconUrl: sources.iconUrl,
			attribution: sources.attribution,
			siteUrl: sources.url,
			eventUrl: events.sourceUrl
		})
		.from(events)
		.innerJoin(sources, eq(events.sourceId, sources.id))
		.where(or(eq(events.id, id), eq(events.duplicateOfId, id)))
		.orderBy(asc(sources.name));

	const checks = await database
		.select({
			check: verifications.check,
			verdict: verifications.verdict,
			confidence: verifications.confidence,
			reasoning: verifications.reasoning,
			deterministic: verifications.deterministic,
			model: verifications.model
		})
		.from(verifications)
		.where(eq(verifications.eventId, id))
		.orderBy(asc(verifications.id));

	return { ...row, checks, reportedBy };
});

export type EventDetail = Awaited<ReturnType<typeof getEvent>>;
