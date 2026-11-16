import { query } from '$app/server';
import { z } from 'zod';
import { and, asc, eq, gte, lte, max, min, or } from 'drizzle-orm';
import { events, venues } from '@hendingar/core/schema';
import {
	calendarDateSchema,
	calendarSpanSchema,
	calendarWeekSchema,
	weekendSchema
} from '@hendingar/core/validation';
import {
	DEFAULT_TIME_ZONE,
	addDays,
	isoWeekDates,
	isoWeekKey,
	isoWeekStart,
	shiftWeek,
	nextWeekendDates,
	weekendAhead
} from '@hendingar/core/datetime';
import { HORIZON_WEEKS } from '@hendingar/core/recurrence';
import {
	countByDay,
	instantWindowForDays,
	localDayKey,
	monthBounds,
	monthKeyOf,
	shiftMonth
} from './calendar.ts';
import { db } from './server/db';
import { listed, notOver, sourceMarksFor } from './server/listing.ts';
import { withStartsIn } from './starts-in.ts';

/*
 * ---------------------------------------------------------------------------------------------
 * The calendar: month ranges, day counts, day pages, weekends, the horizon rail, the week view
 * and the hotspots.
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
		.where(listed);

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
 * How many events fall on each day of a run of months, at each venue's own clock.
 *
 * A span rather than a month because the calendar stacks months and scrolls: asking per month
 * meant a round trip per grid, six of them on first paint, all reading overlapping windows of the
 * same table. One window, one scan, and the page slices the result per month.
 *
 * Only days that have something are returned. An absent day is an empty day — the grid draws those
 * as a plain unlinked number, because a square that leads to a page saying "nothing here" is a
 * worse control than one that never invited the tap.
 */
export const dayCounts = query(calendarSpanSchema, async ({ from: fromMonth, to: toMonth }) => {
	const first = monthBounds(fromMonth).first;
	const last = monthBounds(toMonth).last;
	const { from, to } = instantWindowForDays(first, last);

	const rows = await db()
		.select({ startsAt: events.startsAt, venueTimeZone: venues.timezone })
		.from(events)
		.leftJoin(venues, eq(events.venueId, venues.id))
		.where(
			and(
				listed,
				// A window on the indexed instant, deliberately a day wider than the span at each
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

export type DayCount = Awaited<ReturnType<typeof dayCounts>>[number];

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
			/*
			 * The card renders a srcset, so every query feeding a card must select it.
			 *
			 * Missing here because this query and the column landed in two branches that were each
			 * green on their own and only conflict once both are on main — the calendar was written
			 * against an events table that did not have this column yet.
			 */
			posterSrcset: events.posterSrcset,
			trail: events.trail,
			sourceMarks: sourceMarksFor(events.id).as('source_marks')
		})
		.from(events)
		.leftJoin(venues, eq(events.venueId, venues.id))
		.where(and(listed, gte(events.startsAt, from), lte(events.startsAt, to)))
		.orderBy(asc(events.startsAt));

	const now = new Date();
	const todayLocalDate = localDayKey(now, DEFAULT_TIME_ZONE);

	return withStartsIn(
		rows
			.filter((row) => localDayKey(row.startsAt, row.venueTimeZone) === date)
			.map((row) => ({ ...row, localDate: date, todayLocalDate })),
		now
	);
});

/**
 * Everything on this weekend, Friday to Sunday, in the shape the listing already renders.
 *
 * Three day pages at once, which is what makes it worth a tab of its own: "what is on this
 * weekend" is the question a local events site is asked most often, and answering it previously
 * meant opening `/kalender`, working out which dates were the weekend, and visiting three of them.
 *
 * Addressed by a date range rather than by "upcoming", so an event that has already finished today
 * is still listed — exactly like `/kalender/<dato>`, and for the same reason: a page about
 * specific dates should say what is on those dates. `/hendingar` is the page that answers "what is
 * still to come".
 *
 * Two weekends, one query. `denne` is the weekend you are standing in or walking into; `neste` is
 * the one after it. Everything except which three dates the window covers is identical, and a
 * second copy of a sixty-line select is how two pages drift apart — the reasoning `listPopular`
 * already records for its two orderings.
 *
 * A named weekend, NOT a date. `?helg=2026-09-18` would be a second way to address day pages that
 * already exist, which is the argument this query was written with; `denne` and `neste` are facts
 * about today, so each still answers a different question every Monday — and each still lives at
 * its own URL, which is what makes it shareable.
 */
export const weekendEvents = query(weekendSchema, async (which) => {
	const now = new Date();
	const today = localDayKey(now, DEFAULT_TIME_ZONE);
	/*
	 * "Denne helga" drops the days that have gone; "neste helg" is a week out, so all three of its
	 * days are always still ahead and there is nothing to filter.
	 */
	const dates = which === 'neste' ? nextWeekendDates(today) : weekendAhead(today);
	const first = dates[0] ?? '';
	const last = dates[dates.length - 1] ?? '';
	const { from, to } = instantWindowForDays(first, last);

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
			sourceMarks: sourceMarksFor(events.id).as('source_marks')
		})
		.from(events)
		.leftJoin(venues, eq(events.venueId, venues.id))
		.where(
			and(
				listed,
				gte(events.startsAt, from),
				lte(events.startsAt, to),
				/*
				 * And not already over — the same rule /hendingar and the front page use.
				 *
				 * This is where this page parts company with `/kalender/<dato>`, which is a record
				 * of a date and lists everything on it. A tab called "neste helg" is a plan, and a
				 * concert that finished an hour ago is not part of one.
				 */
				notOver(now)
			)
		)
		.orderBy(asc(events.startsAt));

	const todayLocalDate = localDayKey(now, DEFAULT_TIME_ZONE);

	/*
	 * The window is built from instants, so it is wider than the three days at the edges — a venue
	 * in Helsinki turns Friday 00:30 local into Thursday 22:30 in Oslo. Re-deriving each row's day
	 * at its own venue and dropping what falls outside is the same guard `listEventsOnDate` uses,
	 * and it is why the grouping below can be trusted.
	 */
	return withStartsIn(
		rows
			.map((row) => ({
				...row,
				localDate: localDayKey(row.startsAt, row.venueTimeZone),
				todayLocalDate
			}))
			.filter((row) => dates.includes(row.localDate)),
		now
	);
});

export type WeekendEvent = Awaited<ReturnType<typeof weekendEvents>>[number];

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
		.where(and(listed, gte(events.startsAt, from), lte(events.startsAt, to)));

	const days = [...countByDay(rows).keys()].sort();
	return {
		previous: days.filter((d) => d < date).at(-1) ?? null,
		next: days.find((d) => d > date) ?? null
	};
});

/**
 * How many events fall in each of the next N weeks — the horizon rail.
 *
 * The rail answers a question the month grid structurally cannot: *when* is the busy stretch. A
 * grid shows you one month, and finding the weekend worth travelling for means paging through
 * four of them and remembering what you saw. Twenty-six bars is that whole answer in one glance.
 *
 * **The current week is counted whole, past days included.** The alternative — counting only what
 * is still ahead — makes the first bar shrink a little every day and read as "this week is quiet"
 * on a Sunday. It would also disagree with the grid directly below it, which shows past days with
 * their real counts. The bar is marked as *now* instead, which is the honest way to say it.
 *
 * Reads two columns for every event in the window and buckets them in TypeScript, for the reason
 * `countByDay` exists: one function decides day membership for the counts, the grid and the day
 * pages, so they cannot drift apart. At a few hundred events a week that is not a trade worth
 * thinking about; if it ever becomes one, the fix is a materialised per-day count, not a second
 * `to_char` in SQL.
 */
export const horizonWeeks = query(
	z.number().int().min(4).max(HORIZON_WEEKS).default(HORIZON_WEEKS),
	async (weeks) => {
		const today = localDayKey(new Date(), DEFAULT_TIME_ZONE);
		const firstWeek = isoWeekKey(today);
		const firstDate = isoWeekStart(firstWeek);
		const lastDate = addDays(firstDate, weeks * 7 - 1);
		const { from, to } = instantWindowForDays(firstDate, lastDate);

		const rows = await db()
			.select({ startsAt: events.startsAt, venueTimeZone: venues.timezone })
			.from(events)
			.leftJoin(venues, eq(events.venueId, venues.id))
			.where(and(listed, gte(events.startsAt, from), lte(events.startsAt, to)));

		const byDay = countByDay(rows);
		const bars = Array.from({ length: weeks }, (_, i) => {
			const weekKey = shiftWeek(firstWeek, i);
			return {
				weekKey,
				start: isoWeekStart(weekKey),
				total: isoWeekDates(weekKey).reduce((n, date) => n + (byDay.get(date) ?? 0), 0)
			};
		});

		return {
			weeks: bars,
			today,
			currentWeek: firstWeek,
			/** The last day the rail covers, so the page can name where it stops rather than just stopping. */
			horizonEnd: lastDate,
			total: bars.reduce((n, b) => n + b.total, 0)
		};
	}
);

export type HorizonWeek = Awaited<ReturnType<typeof horizonWeeks>>['weeks'][number];

/**
 * How far back an event may have started and still be drawn as running through a week.
 *
 * A bound, not a rule about exhibitions. Without one the query's lower bound is unbounded and
 * Postgres reads the whole history of the table to find the handful of things still running; with
 * it, both halves of the `or` are index ranges. A quarter is comfortably longer than anything our
 * sources actually publish, and the cost of being wrong is that a very long exhibition is missing
 * from one band — not that a count is wrong.
 */
const LONGEST_RUN_DAYS = 92;

/**
 * One week's events, split into the two things a week view draws.
 *
 * `timed` are blocks on the grid: they start and end on the same calendar day at their venue, so
 * they have a position and a height. `spanning` are the band across the top — a three-week
 * exhibition has no meaningful 19:00, and drawing it as a block would either claim it happens once
 * or paint a column-tall rectangle over everything else.
 *
 * An event that runs past midnight is `timed` on the day it starts, not `spanning`. It is one
 * evening out, and the day it belongs to is the day it began — the same rule the counts use.
 */
export const weekEvents = query(calendarWeekSchema, async (weekKey) => {
	const dates = isoWeekDates(weekKey);
	const first = dates[0] ?? '';
	const last = dates[6] ?? '';
	const { from, to } = instantWindowForDays(first, last);
	const lookback = instantWindowForDays(addDays(first, -LONGEST_RUN_DAYS), first).from;

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
			/*
			 * The poster, for the hover preview.
			 *
			 * A block in a three-lane column is about 70px wide and can hold a time and a clipped
			 * title. That is enough to find something and not enough to decide about it, so
			 * hovering one shows the poster at a size worth looking at. Selected here rather than
			 * fetched on hover: a request per mouse-over would fire dozens of times crossing a
			 * busy Saturday, and the rows are already in hand.
			 */
			posterUrl: events.posterUrl,
			posterSrcset: events.posterSrcset,
			trail: events.trail
		})
		.from(events)
		.leftJoin(venues, eq(events.venueId, venues.id))
		.where(
			and(
				listed,
				/*
				 * Two index ranges rather than one open-ended scan: things starting inside the week,
				 * and things that started earlier and have not finished. Written as an `or` of two
				 * bounded ranges so the planner can bitmap them together — `coalesce(ends_at, …) >=`
				 * on its own gives up the index on `starts_at` and reads the table.
				 */
				or(
					and(gte(events.startsAt, from), lte(events.startsAt, to)),
					and(gte(events.startsAt, lookback), lte(events.startsAt, from), gte(events.endsAt, from))
				)
			)
		)
		.orderBy(asc(events.startsAt));

	type Row = (typeof rows)[number];
	const timed: (Row & { localDate: string })[] = [];
	const spanning: (Row & {
		fromDate: string;
		toDate: string;
		startsBefore: boolean;
		endsAfter: boolean;
	})[] = [];

	for (const row of rows) {
		const startDay = localDayKey(row.startsAt, row.venueTimeZone);
		const endDay = row.endsAt ? localDayKey(row.endsAt, row.venueTimeZone) : startDay;

		if (startDay === endDay) {
			if (startDay >= first && startDay <= last) timed.push({ ...row, localDate: startDay });
			continue;
		}

		// Clamped to the week, so the band draws what is visible rather than running off both ends.
		const fromDate = startDay < first ? first : startDay;
		const toDate = endDay > last ? last : endDay;
		if (fromDate <= toDate) {
			spanning.push({
				...row,
				fromDate,
				toDate,
				startsBefore: startDay < first,
				endsAfter: endDay > last
			});
		}
	}

	// Longest first, so the band reads as layers rather than as a jumble.
	spanning.sort(
		(a, b) =>
			a.fromDate.localeCompare(b.fromDate) ||
			b.toDate.localeCompare(a.toDate) ||
			a.title.localeCompare(b.title, 'nb-NO')
	);

	return { weekKey, dates, timed, spanning, today: localDayKey(new Date(), DEFAULT_TIME_ZONE) };
});

export type WeekTimedEvent = Awaited<ReturnType<typeof weekEvents>>['timed'][number];
export type WeekSpanningEvent = Awaited<ReturnType<typeof weekEvents>>['spanning'][number];

/**
 * Where a span's events are, by municipality.
 *
 * The other half of "hotspot": the grid says which days are busy, this says which places are. A
 * reader planning a Saturday in Kvinnherad is asking a question no arrangement of squares answers.
 *
 * A venue with no municipality is counted and returned with a null name rather than dropped. The
 * total has to add up — a place list that quietly omits rows is the same failure as a source list
 * that under-reports itself, and this repo has already paid for that one.
 */
export const placeCounts = query(calendarSpanSchema, async ({ from: fromMonth, to: toMonth }) => {
	const first = monthBounds(fromMonth).first;
	const last = monthBounds(toMonth).last;
	const { from, to } = instantWindowForDays(first, last);

	const rows = await db()
		.select({
			startsAt: events.startsAt,
			venueTimeZone: venues.timezone,
			municipality: venues.municipality
		})
		.from(events)
		.leftJoin(venues, eq(events.venueId, venues.id))
		.where(and(listed, gte(events.startsAt, from), lte(events.startsAt, to)));

	const totals = new Map<string | null, number>();
	for (const row of rows) {
		const date = localDayKey(row.startsAt, row.venueTimeZone);
		if (date < first || date > last) continue;
		totals.set(row.municipality, (totals.get(row.municipality) ?? 0) + 1);
	}

	return [...totals]
		.map(([municipality, total]) => ({ municipality, total }))
		.sort((a, b) => {
			if (a.total !== b.total) return b.total - a.total;
			// A venue with no municipality sorts last whatever its count: it is a gap in our data
			// rather than a place, and listing it among named places would read as one.
			if ((a.municipality === null) !== (b.municipality === null)) {
				return a.municipality === null ? 1 : -1;
			}
			return (a.municipality ?? '').localeCompare(b.municipality ?? '', 'nb-NO');
		});
});

export type PlaceCount = Awaited<ReturnType<typeof placeCounts>>[number];
