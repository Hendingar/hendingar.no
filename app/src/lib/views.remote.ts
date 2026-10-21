import { command, query } from '$app/server';
import { z } from 'zod';
import { and, eq, gte, inArray, sql } from 'drizzle-orm';
import { eventViewDays, eventViews, events } from '@hendingar/core/schema';
import { db } from './server/db';
import { enforce } from './server/limits';
import { TREND_DAYS } from './trend.ts';

/**
 * The view counter: one number per event, and the way it goes up.
 *
 * Deliberately asymmetric with hearts. A heart is a thing a reader does and can undo, so it is
 * stored per browser and toggled. A view is a page load, and storing it per browser would make a
 * reading history out of something nobody chose. The server therefore receives "one more" and is
 * told nothing about who; the browser decides what counts as new (see `seen.ts`).
 */

/**
 * Count one view of an event.
 *
 * Takes no client id — not because it is optional, but because there is nothing here to identify.
 * That is the whole design, and passing one would quietly undo it.
 */
export const recordView = command(z.number().int().positive(), async (eventId) => {
	enforce('view');
	const database = db();

	/*
	 * Published events only.
	 *
	 * Without this the table accumulates counts for ids that were guessed, and somebody's rejected
	 * submission could be made to look popular from outside. The same guard hearts already has,
	 * for the same reason.
	 */
	const [event] = await database
		.select({ id: events.id })
		.from(events)
		.where(and(eq(events.id, eventId), eq(events.status, 'published')))
		.limit(1);
	if (!event) return { eventId, views: 0 };

	/*
	 * One statement, so two readers at once cannot both read 5 and both write 6.
	 *
	 * The increment happens inside the database rather than as read-then-write in this function;
	 * `excluded.views` is the value the insert would have written, so the update adds to whatever
	 * is actually stored at that moment.
	 */
	const [row] = await database
		.insert(eventViews)
		.values({ eventId, views: 1 })
		.onConflictDoUpdate({
			target: eventViews.eventId,
			set: { views: sql`${eventViews.views} + 1`, updatedAt: new Date() }
		})
		.returning({ views: eventViews.views });

	/*
	 * The same "one more", filed under today in Oslo, so /poppis/vist can draw a trend. The day is
	 * the database's clock rather than this server's, for the same reason the increment is in SQL:
	 * one authority for the number.
	 */
	await database
		.insert(eventViewDays)
		.values({ eventId, day: sql`(now() at time zone 'Europe/Oslo')::date`, views: 1 })
		.onConflictDoUpdate({
			target: [eventViewDays.eventId, eventViewDays.day],
			set: { views: sql`${eventViewDays.views} + 1` }
		});

	return { eventId, views: row?.views ?? 0 };
});

/**
 * Counts for a set of events, in one round trip.
 *
 * Events nobody has opened are absent rather than returned as zero; the caller defaults. Same
 * shape as `heartCounts`, so a listing can ask for both the same way.
 */
export const viewCounts = query(z.array(z.number().int().positive()).max(200), async (eventIds) => {
	if (eventIds.length === 0) return [];
	return db()
		.select({ eventId: eventViews.eventId, views: eventViews.views })
		.from(eventViews)
		.where(inArray(eventViews.eventId, eventIds));
});

/**
 * The last fortnight of daily opens for a set of events, and what "today" is in Oslo.
 *
 * Today comes from the database, the same clock `recordView` files opens under, so a sparkline's
 * last bar and the count that fills it cannot disagree about which day it is.
 */
export const viewHistory = query(
	z.array(z.number().int().positive()).max(200),
	async (eventIds) => {
		const database = db();
		const [clock] = await database.execute<{ today: string; since: string }>(
			sql`select to_char((now() at time zone 'Europe/Oslo')::date, 'YYYY-MM-DD') as today,
			to_char((now() at time zone 'Europe/Oslo')::date - ${TREND_DAYS - 1}::int, 'YYYY-MM-DD') as since`
		);
		if (!clock) throw new Error('the database did not say what day it is');
		if (eventIds.length === 0) return { today: clock.today, days: [] };
		const days = await database
			.select({
				eventId: eventViewDays.eventId,
				day: eventViewDays.day,
				views: eventViewDays.views
			})
			.from(eventViewDays)
			.where(and(inArray(eventViewDays.eventId, eventIds), gte(eventViewDays.day, clock.since)));
		return { today: clock.today, days };
	}
);
