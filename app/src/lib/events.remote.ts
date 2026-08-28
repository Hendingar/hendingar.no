import { form, query } from '$app/server';
import { z } from 'zod';
import { and, asc, eq, gte, lte, or, sql } from 'drizzle-orm';
import { events, organizers, venues } from '@hendingar/core/schema';
import { eventQuerySchema, eventSubmissionSchema } from '@hendingar/core/validation';
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

		return db()
			.select({
				id: events.id,
				title: events.title,
				category: events.category,
				startsAt: events.startsAt,
				endsAt: events.endsAt,
				venueName: venues.name,
				// The zone is what makes startsAt renderable as a wall clock. Always select it.
				venueTimeZone: venues.timezone,
				municipality: venues.municipality
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
			.orderBy(asc(events.startsAt))
			.limit(limit);
	}
);

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

/**
 * Anyone can submit an event — no account required (README non-goals: not a walled garden).
 * Submissions land as `pending` for the verification pipeline; they are never published directly.
 */
export const submitEvent = form(eventSubmissionSchema, async (submission) => {
	const database = db();

	// venueName is REQUIRED by the schema, so dropping it silently — as this previously did —
	// meant every submission landed with venue_id NULL and the location, the single most useful
	// field on a local-events site, was unrecoverable.
	const venueSlug = slugify(submission.venueName);
	const [venue] = await database
		.insert(venues)
		.values({
			name: submission.venueName,
			slug: venueSlug,
			municipality: submission.municipality
		})
		.onConflictDoUpdate({
			target: venues.slug,
			// Only overwrite the municipality when the submitter actually supplied one — an absent
			// value must not blank out what we already know about a known venue.
			set: submission.municipality
				? { municipality: submission.municipality }
				: { name: submission.venueName }
		})
		.returning({ id: venues.id });

	let organizerId: number | undefined;
	if (submission.organizerName) {
		const [organizer] = await database
			.insert(organizers)
			.values({ name: submission.organizerName, slug: slugify(submission.organizerName) })
			.onConflictDoUpdate({ target: organizers.slug, set: { name: submission.organizerName } })
			.returning({ id: organizers.id });
		organizerId = organizer?.id;
	}

	await database.insert(events).values({
		title: submission.title,
		description: submission.description,
		category: submission.category,
		startsAt: new Date(submission.startsAt),
		endsAt: submission.endsAt ? new Date(submission.endsAt) : null,
		venueId: venue?.id,
		organizerId,
		sourceUrl: submission.sourceUrl,
		ctaUrl: submission.ctaUrl,
		status: 'pending'
	});

	return { received: true };
});

/** Norwegian-aware slug: æøå transliterate rather than vanishing. */
function slugify(value: string): string {
	return value
		.toLowerCase()
		.replace(/æ/g, 'ae')
		.replace(/ø/g, 'oe')
		.replace(/å/g, 'aa')
		.normalize('NFD')
		.replace(/[̀-ͯ]/g, '')
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, 120);
}
