import { error } from '@sveltejs/kit';
import { query } from '$app/server';
import { z } from 'zod';
import { alias } from 'drizzle-orm/pg-core';
import { and, asc, eq, gte, inArray, lte, ne, or, sql } from 'drizzle-orm';
import {
	eventContributions,
	events,
	organizers,
	sources,
	venues,
	verifications
} from '@hendingar/core/schema';
import { isContributableField } from '@hendingar/core/contribution';
import { CINEMA_SOURCE_SLUGS } from '@hendingar/core/directory';
import { db } from './server/db';
import { instantWindowForDays, localDayKey } from './calendar.ts';
import { notOver, listed, fromSourceGroup, stillListed, tileColumns } from './server/listing.ts';
import { withStartsIn } from './starts-in.ts';

/**
 * One event: its page, the events related to it, and a film's other screenings.
 */

/** The same table again, joined to itself so a duplicate can name the row it duplicates. */
const canonicalEvent = alias(events, 'canonical_event');

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
			posterSrcset: events.posterSrcset,
			// The whole of a submitted poster, where `posterUrl` is only the card's crop of it.
			posterWholeUrl: events.posterWholeUrl,
			trail: events.trail,
			// Decides what a shared link shows: a poster we may redraw goes into our own card, any
			// other is pointed at where it already lives. See `shareImage` on the event page.
			posterRightsVerified: events.posterRightsVerified,
			ctaUrl: events.ctaUrl,
			sourceUrl: events.sourceUrl,
			submissionMethod: events.submissionMethod,
			verificationNotes: events.verificationNotes,
			venueName: venues.name,
			venueAddress: venues.address,
			venuePostalCode: venues.postalCode,
			venueMunicipality: venues.municipality,
			venueLatitude: venues.latitude,
			venueLongitude: venues.longitude,
			venueTimeZone: venues.timezone,
			organizerName: organizers.name,
			/** A standing activity's timetable — shown in place of a start time it does not have. */
			weeklyHours: events.weeklyHours,
			// Read by the JSON-LD, as `typicalAgeRange`.
			ageFrom: events.ageFrom,
			ageTo: events.ageTo,
			sourceName: sources.name,
			sourceAttribution: sources.attribution,
			sourceSiteUrl: sources.url,
			/*
			 * The row this one duplicates, if any — id and title, which is everything `eventPath`
			 * needs to build its URL.
			 *
			 * Unlike every listing query, this one does NOT filter duplicates out. A duplicate has
			 * a page on purpose: somebody is reading a link to it, and hearts.remote.ts already
			 * records why breaking such a link is the wrong trade. What it must not do is claim to
			 * be the original — before this, a published duplicate pointed its canonical at itself
			 * and asked to be indexed alongside the row it duplicates.
			 */
			duplicateOfId: events.duplicateOfId,
			/*
			 * Set when a run found the source no longer listing this event.
			 *
			 * The page keeps working — people have the link, and some of them hearted it — and says
			 * so instead of quietly advertising something that is not happening. Every listing
			 * drops it; see `stillListed`.
			 */
			removedUpstreamAt: events.removedUpstreamAt,
			duplicateOfTitle: canonicalEvent.title
		})
		.from(events)
		.leftJoin(venues, eq(events.venueId, venues.id))
		.leftJoin(organizers, eq(events.organizerId, organizers.id))
		.leftJoin(sources, eq(events.sourceId, sources.id))
		.leftJoin(canonicalEvent, eq(events.duplicateOfId, canonicalEvent.id))
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

	/*
	 * What a reader added to this event, and which fields it was.
	 *
	 * `reportedBy` above cannot carry this and should not try: it joins `sources` with an INNER
	 * join, so a human submission — which has no `source_id` — was never in it. That is why the
	 * verdict panel's promise to credit a duplicate "kjelda under" was one the event page could not
	 * keep for the only kind of contributor that has no calendar behind them.
	 *
	 * Named as a count of contributions and a list of fields, never as a person: a `client_id` is a
	 * random value a browser keeps in localStorage, and turning it into a byline would be inventing
	 * an identity out of something deliberately built not to be one. Distinct browsers are counted
	 * so "frå to lesarar" is honest, which is as far as the data can honestly go.
	 */
	const contributed = await database
		.select({
			field: eventContributions.field,
			clientId: eventContributions.clientId
		})
		.from(eventContributions)
		.where(and(eq(eventContributions.eventId, id), eq(eventContributions.applied, true)))
		.orderBy(asc(eventContributions.id));

	const contributions = {
		fields: [...new Set(contributed.map((c) => c.field))].filter(isContributableField),
		/* Null client ids are one anonymous contributor each — they cannot be told apart. */
		contributors: new Set(contributed.map((c, index) => c.clientId ?? `anon-${index}`)).size
	};

	return { ...row, checks, reportedBy, contributions };
});

export type EventDetail = Awaited<ReturnType<typeof getEvent>>;

/** Tiles per group under an event. A taste with a link onward, not a second listing. */
const RELATED_SHOWN = 4;

/**
 * What else is worth a look from an event's page: the same day, the same calendar, the same kind.
 *
 * The event page was a dead end — the category, the date and the source were all printed and none
 * of them led anywhere, so a reader who liked the look of a coffee morning had to go back to the
 * listing and rebuild that question by hand. Each group here is the first few rows of a page that
 * already exists (`/kalender/<dato>`, `/hendingar?kjelde=…`, `/hendingar?kategori=…`), and the
 * page links to it, so these are previews of real answers rather than a recommender.
 *
 * Deduplicated in that order, so an event that is both the same day and the same calendar is
 * shown once, under the more specific heading. Rows sharing this event's title are left out
 * everywhere: next week's identical coffee morning, or the same film's other screenings, are not
 * "something else" — and a film's screenings already have their own list beside the details.
 *
 * Upcoming only for the calendar and category groups, like every listing. The day group is the
 * event's own day in full, like the day page it previews.
 */
export const relatedEvents = query(z.number().int().positive(), async (id) => {
	const database = db();

	const [self] = await database
		.select({
			title: events.title,
			category: events.category,
			kind: events.kind,
			startsAt: events.startsAt,
			venueTimeZone: venues.timezone,
			duplicateOfId: events.duplicateOfId,
			sourceSlug: sources.slug,
			sourceName: sources.name
		})
		.from(events)
		.leftJoin(venues, eq(events.venueId, venues.id))
		.leftJoin(sources, eq(events.sourceId, sources.id))
		.where(and(eq(events.id, id), eq(events.status, 'published')))
		.limit(1);

	if (!self) error(404, 'Fann ikkje hendinga');

	/*
	 * Whose calendar to show more of. The row's own source when it has one; for a canonical whose
	 * own row was submitted by hand, the first calendar that also reported it — the same list the
	 * page credits, in the same order.
	 */
	const [firstReporter] = self.sourceSlug
		? []
		: await database
				.select({ slug: sources.slug, name: sources.name })
				.from(events)
				.innerJoin(sources, eq(events.sourceId, sources.id))
				.where(eq(events.duplicateOfId, id))
				.orderBy(asc(sources.name))
				.limit(1);
	const source = self.sourceSlug
		? { slug: self.sourceSlug, name: self.sourceName ?? self.sourceSlug }
		: (firstReporter ?? null);

	const now = new Date();
	// A standing activity's start is the first day of its season, which is not a day anyone means.
	const day = self.kind === 'dated' ? localDayKey(self.startsAt, self.venueTimeZone) : null;
	const window = day ? instantWindowForDays(day, day) : null;

	const others = and(
		listed,
		ne(events.id, id),
		self.duplicateOfId ? ne(events.id, self.duplicateOfId) : undefined,
		ne(events.title, self.title)
	);
	// Enough over the shown count that deduplication and stacked repeats still leave a full row.
	const fetched = RELATED_SHOWN * 3;

	const select = () =>
		database.select(tileColumns).from(events).leftJoin(venues, eq(events.venueId, venues.id));

	const [dayRows, sourceRows, categoryRows] = await Promise.all([
		window
			? select()
					.where(and(others, gte(events.startsAt, window.from), lte(events.startsAt, window.to)))
					.orderBy(asc(events.startsAt))
			: Promise.resolve([]),
		source
			? select()
					.where(and(others, notOver(now), fromSourceGroup(source.slug)))
					.orderBy(sql`greatest(${events.startsAt}, now())`, asc(events.startsAt))
					.limit(fetched)
			: Promise.resolve([]),
		select()
			.where(and(others, notOver(now), eq(events.category, self.category)))
			.orderBy(sql`greatest(${events.startsAt}, now())`, asc(events.startsAt))
			.limit(fetched)
	]);

	const seen = new Set<number>();
	const take = <T extends { id: number }>(rows: T[]): T[] => {
		const kept = rows.filter((row) => !seen.has(row.id)).slice(0, RELATED_SHOWN);
		for (const row of kept) seen.add(row.id);
		return kept;
	};

	return {
		day,
		source,
		category: self.category,
		// Pinned to the day itself, as on the day page: the listing's "running, so it is today"
		// rule would file a past day's events under today.
		sameDay: withStartsIn(
			take(
				dayRows
					.filter((row) => localDayKey(row.startsAt, row.venueTimeZone) === day)
					.map((row) => (day ? { ...row, localDate: day } : row))
			),
			now
		),
		sameSource: withStartsIn(take(sourceRows), now),
		sameCategory: withStartsIn(take(categoryRows), now)
	};
});

export type RelatedEvents = Awaited<ReturnType<typeof relatedEvents>>;

/** Two weeks of a busy cinema is under forty screenings; this is a ceiling, not a page size. */
const SCREENINGS_CAP = 60;

/**
 * Every upcoming screening of the film this event is one screening of.
 *
 * The film's own page (`/hending/<screening>/tider`, where "Vis alle tider" on a cinema card goes)
 * and the short "Alle tider" list on a screening's page both read this. A screening is
 * its own row, so the film is recovered as the same title from the same cinema — not the same
 * venue: Stord kino plays one film in Storsalen and Småsalen in the same week, and those are two
 * venues in our data and one film to anybody buying a ticket.
 *
 * The id may be a canonical row from another source (the cinema's row consolidated under the
 * kulturhus programme's), so the cinema row is looked for among the event and its duplicates —
 * the same set `reportedBy` reads. Anything that is not a screening answers `film: false` rather
 * than an error: the card offers the button by source, and a stale guess should cost an empty
 * panel, not a broken one.
 */
export const filmScreenings = query(z.number().int().positive(), async (id) => {
	const database = db();
	const [film] = await database
		.select({ title: events.title, sourceId: events.sourceId })
		.from(events)
		.innerJoin(sources, eq(events.sourceId, sources.id))
		.where(
			and(
				or(eq(events.id, id), eq(events.duplicateOfId, id)),
				inArray(sources.slug, [...CINEMA_SOURCE_SLUGS])
			)
		)
		.limit(1);
	if (!film?.sourceId) return { film: false, screenings: [], todayLocalDate: null };

	const rows = await database
		.select({
			id: events.id,
			startsAt: events.startsAt,
			ctaUrl: events.ctaUrl,
			venueName: venues.name,
			venueTimeZone: venues.timezone,
			localDate: sql<string>`
				to_char(
					${events.startsAt} at time zone coalesce(${venues.timezone}, 'Europe/Oslo'),
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
				stillListed,
				eq(events.sourceId, film.sourceId),
				eq(events.title, film.title),
				gte(events.startsAt, new Date())
			)
		)
		.orderBy(asc(events.startsAt))
		.limit(SCREENINGS_CAP);

	return {
		film: true,
		screenings: rows.map((r) => ({
			id: r.id,
			startsAt: r.startsAt,
			ctaUrl: r.ctaUrl,
			venueName: r.venueName,
			venueTimeZone: r.venueTimeZone,
			localDate: r.localDate
		})),
		todayLocalDate: rows[0]?.todayLocalDate ?? null
	};
});

export type FilmScreenings = Awaited<ReturnType<typeof filmScreenings>>;
