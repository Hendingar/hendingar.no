import { command, query } from '$app/server';
import { z } from 'zod';
import { and, count, eq, inArray, sql } from 'drizzle-orm';
import { eventHearts, events, sources, venues } from '@hendingar/core/schema';
import { db } from './server/db';

/**
 * Hearts: the count, and the toggle.
 *
 * The split matters. *Which* events a reader has hearted never reaches the server as a list — that
 * lives in their browser. What reaches the server is one row per (event, browser) so the public
 * count is a count of browsers rather than of taps, and so tapping twice is idempotent.
 *
 * `clientId` is an opaque string the browser generated for itself. It is not an account, carries
 * nothing about the person, and is validated only for shape.
 */

/**
 * Long enough that two browsers will not collide, short enough to reject junk. A UUID is 36
 * characters; the fallback in hearts.svelte.ts is shorter, so the floor is set below both.
 */
const clientIdSchema = z
	.string()
	.trim()
	.min(8)
	.max(64)
	.regex(/^[A-Za-z0-9-]+$/, 'client id must be opaque and alphanumeric');

const toggleSchema = z.object({
	eventId: z.number().int().positive(),
	clientId: clientIdSchema,
	hearted: z.boolean()
});

/**
 * Heart or unheart, from one browser.
 *
 * Returns the fresh count so the tapped card can show a true number rather than guessing by adding
 * one — which would be wrong the moment the same person has the site open in two tabs.
 */
export const toggleHeart = command(toggleSchema, async ({ eventId, clientId, hearted }) => {
	const database = db();

	/*
	 * The event must exist and be published.
	 *
	 * Without this the table happily accumulates hearts for ids that were guessed, and a `pending`
	 * submission could be made to look popular before a human has even seen it.
	 */
	const [event] = await database
		.select({ id: events.id })
		.from(events)
		.where(and(eq(events.id, eventId), eq(events.status, 'published')))
		.limit(1);
	if (!event) return { eventId, hearts: 0, hearted: false };

	if (hearted) {
		// Idempotent by the unique index: tapping twice, or a retried request, is still one heart.
		await database
			.insert(eventHearts)
			.values({ eventId, clientId })
			.onConflictDoNothing({ target: [eventHearts.eventId, eventHearts.clientId] });
	} else {
		await database
			.delete(eventHearts)
			.where(and(eq(eventHearts.eventId, eventId), eq(eventHearts.clientId, clientId)));
	}

	const [row] = await database
		.select({ hearts: count() })
		.from(eventHearts)
		.where(eq(eventHearts.eventId, eventId));

	return { eventId, hearts: row?.hearts ?? 0, hearted };
});

/**
 * Counts for a set of events, in one round trip.
 *
 * A listing shows two dozen cards, and asking per card would be two dozen requests. Events with no
 * hearts are simply absent from the result rather than returned as zero — the caller defaults.
 */
export const heartCounts = query(
	z.array(z.number().int().positive()).max(200),
	async (eventIds) => {
		if (eventIds.length === 0) return [];
		return db()
			.select({ eventId: eventHearts.eventId, hearts: count() })
			.from(eventHearts)
			.where(inArray(eventHearts.eventId, eventIds))
			.groupBy(eventHearts.eventId);
	}
);

/**
 * The reader's own hearted events, resolved from ids their browser supplies.
 *
 * The server is told which ids to look up on every request and remembers nothing between them.
 * Ids for events that have since been unpublished or deleted simply do not come back, which is why
 * `/hjarta` can show fewer events than the browser remembers and should say so.
 */
export const listHearted = query(
	z.array(z.number().int().positive()).max(200),
	async (eventIds) => {
		if (eventIds.length === 0) return [];
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
					posterSrcset: events.posterSrcset,
					sourceMarks: sql<{ name: string; iconUrl: string | null }[]>`
					coalesce((
						select json_agg(m order by m.name)
						from (
							select distinct ${sources.name} as name, ${sources.iconUrl} as "iconUrl"
							from ${events} dup
							join ${sources} on ${sources.id} = dup.source_id
							where dup.id = ${events.id} or dup.duplicate_of_id = ${events.id}
						) m
					), '[]'::json)
				`.as('source_marks'),
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
				/*
				 * Two filters this listing deliberately does NOT have.
				 *
				 * No date filter: every other listing hides what has already happened, but this is the
				 * reader's own list, and an event vanishing from it the morning after would look like
				 * data loss rather than housekeeping. The page groups them instead.
				 *
				 * No `duplicateOfId` filter either: they hearted this row, from whichever source they
				 * were reading. Silently swapping it for the canonical one, or dropping it because
				 * consolidation later picked a different winner, would take away the thing they saved.
				 */
				.where(and(inArray(events.id, eventIds), eq(events.status, 'published')))
				.orderBy(events.startsAt)
		);
	}
);

export type HeartedEvent = Awaited<ReturnType<typeof listHearted>>[number];
