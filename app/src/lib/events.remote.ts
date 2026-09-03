import { error } from '@sveltejs/kit';
import { query } from '$app/server';
import { z } from 'zod';
import { and, asc, count, eq, gte, isNull, lte, ne, or, sql } from 'drizzle-orm';
import { events, organizers, sources, venues, verifications } from '@hendingar/core/schema';
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
	async ({ from, to, category, source, municipality, limit }) => {
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
					sourceName: sources.name,
					sourceIconUrl: sources.iconUrl,
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
						source
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

	return rows.sort((a, b) => b.total - a.total || a.name.localeCompare(b.name, 'nb-NO'));
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
			sourceName: sources.name,
			sourceIconUrl: sources.iconUrl,
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
