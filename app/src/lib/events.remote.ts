import { form, query } from '$app/server';
import { and, asc, eq, gte } from 'drizzle-orm';
import { events, venues } from '@hendingar/core/schema';
import { eventQuerySchema, eventSubmissionSchema } from '@hendingar/core/validation';
import { db } from '#lib/server/db';

/**
 * The client↔server boundary, typed end to end.
 *
 * The Zod schemas imported from @hendingar/core ARE the wire types — there is no separate
 * request/response type to keep in sync, and no hand-written fetch. Change a schema and every
 * call site fails to typecheck. See docs/decisions/0002-remote-functions.md.
 */

export const listEvents = query(eventQuerySchema, async ({ from, category, limit }) => {
	const since = from ? new Date(from) : new Date();

	return db()
		.select({
			id: events.id,
			title: events.title,
			category: events.category,
			startsAt: events.startsAt,
			venueName: venues.name
		})
		.from(events)
		.leftJoin(venues, eq(events.venueId, venues.id))
		.where(
			and(
				eq(events.status, 'published'),
				gte(events.startsAt, since),
				category ? eq(events.category, category) : undefined
			)
		)
		.orderBy(asc(events.startsAt))
		.limit(limit);
});

/**
 * Anyone can submit an event — no account required (README non-goals: not a walled garden).
 * Submissions land as `pending` for the verification pipeline; they are never published directly.
 */
export const submitEvent = form(eventSubmissionSchema, async (submission) => {
	await db()
		.insert(events)
		.values({
			title: submission.title,
			description: submission.description,
			category: submission.category,
			startsAt: new Date(submission.startsAt),
			endsAt: submission.endsAt ? new Date(submission.endsAt) : null,
			sourceUrl: submission.sourceUrl,
			ctaUrl: submission.ctaUrl,
			status: 'pending'
		});

	return { received: true };
});
