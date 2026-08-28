import { query } from '$app/server';
import { z } from 'zod';
import { and, asc, count, eq, gte, lte, or, sql } from 'drizzle-orm';
import { events, venues } from '@hendingar/core/schema';
import { eventQuerySchema } from '@hendingar/core/validation';
import { categoryLabel } from '@hendingar/core/taxonomy';
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

export const listEvents = query(
	eventQuerySchema,
	async ({ from, to, category, municipality, limit }) => {
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
				.where(
					and(
						eq(events.status, 'published'),
						// An event that has started but not ended is still happening, and must stay
						// visible. Filtering on startsAt alone hid a three-hour concert for its whole
						// duration, and a weekend festival for the entire weekend.
						or(gte(events.startsAt, since), gte(events.endsAt, since)),
						to ? lte(events.startsAt, new Date(to)) : undefined,
						category ? eq(events.category, category) : undefined,
						municipality ? eq(venues.municipality, municipality) : undefined
					)
				)
				// Ordered by the same effective instant the grouping uses, so day groups stay contiguous.
				.orderBy(sql`greatest(${events.startsAt}, now())`, asc(events.startsAt))
				.limit(limit)
		);
	}
);

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
			and(eq(events.status, 'published'), or(gte(events.startsAt, now), gte(events.endsAt, now)))
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
		.where(
			and(
				eq(events.status, 'published'),
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
