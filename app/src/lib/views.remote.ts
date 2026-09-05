import { command, query } from '$app/server';
import { z } from 'zod';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { eventViews, events } from '@hendingar/core/schema';
import { db } from './server/db';

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
