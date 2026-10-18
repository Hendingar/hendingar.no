import { eq, gte, ilike, isNotNull, isNull, ne, or, and, sql } from 'drizzle-orm';
import type { AnyColumn, SQL } from 'drizzle-orm';
import { events, organizers, sources, venues } from '@hendingar/core/schema';
import { stillListedUpstream } from '@hendingar/core/gone-upstream';
import { hasSearch, likePattern, searchTokens } from '@hendingar/core/search';

/*
 * The clauses every listing shares.
 *
 * Moved out of `events.remote.ts` when `/haugen` became a second remote module that lists upcoming
 * events: a `*.remote.ts` file may only export remote functions, so a clause that lived there could
 * not be imported, and a copy in `haugen.remote.ts` would be the nineteenth place to forget one.
 */

/**
 * Only the rows that belong under a date.
 *
 * Every listing and every count in this file sorts or groups by `starts_at`, and a standing offer
 * has no meaningful one — "Sunnhordland Escape" runs 2023 to 2027, so `greatest(starts_at, now())`
 * filed it under TODAY, every day, for five years, above the concerts.
 *
 * `events.kind` is a generated column, so this cannot go stale and no importer can forget to set
 * it. The standing rows are not lost: `standingOffers` below serves them, and `getEvent` still
 * finds one by id so its own page and any link to it keep working.
 *
 * See packages/core/src/standing.ts and docs/decisions/0013-standing-offers.md.
 */
export const datedOnly = eq(events.kind, 'dated');

/**
 * Still listed by the source that reported it.
 *
 * Beside `datedOnly` rather than written out in each query below, for the same reason: this is a
 * clause that gets added to eighteen places and forgotten in the nineteenth, where it shows up as
 * one page still advertising something that was cancelled a week ago.
 *
 * `getEvent` deliberately does NOT use it. A row that has gone from its source keeps its own page —
 * with a line saying so — because people have the link, and some of them hearted it.
 */
export const stillListed = stillListedUpstream();

/**
 * What a visitor may see under a date: published, still listed upstream, the canonical row of its
 * duplicate group, and dated.
 *
 * Four clauses that every listing, count and suggestion needs together and that were written out
 * together in twenty places. A count that drops one of them disagrees with the listing it links to
 * — which is exactly what `/datasamling` and the sitemap had done.
 */
export const listed = and(
	eq(events.status, 'published'),
	stillListed,
	// Only canonical rows: `pnpm consolidate` points the other sources' copies at the winner.
	isNull(events.duplicateOfId),
	datedOnly
);

/**
 * What `/alltid-ope` lists under "Faste aktivitetar": a group that meets on a weekly timetable and
 * whose season has not ended.
 *
 * Said once because two pages count it: `/alltid-ope` lists these rows, and `/datasamling` tells a
 * reader how many each source gives. A source whose calendar is nothing but weekly activities — a
 * frivilligsentral — showed "0 framover" there, and sat under "Ingenting framover", while its four
 * activities were live one page away.
 */
export function weeklyListed(now: Date) {
	return and(
		eq(events.status, 'published'),
		stillListed,
		isNull(events.duplicateOfId),
		eq(events.kind, 'standing'),
		isNotNull(events.weeklyHours),
		gte(events.endsAt, now)
	);
}

/** Not already over. A concert that started an hour ago and is still running belongs to today. */
export function notOver(now: Date | SQL) {
	return or(gte(events.startsAt, now), gte(events.endsAt, now));
}

/**
 * Reported by this source — the canonical row itself, or any row pointing at it.
 *
 * Filtering on the canonical's own source alone would hide an event from the venue that actually
 * runs it whenever a newspaper's copy happened to have the lower id: "Stord kulturhus" would stop
 * listing its own concerts. Every "from this calendar" — the listing filter, the related row and
 * the count `/datasamling` gates its link on — has to mean the same thing, so it is said once.
 */
export function fromSourceGroup(slug: string) {
	return sql`exists (
		select 1 from ${events} as m
		join ${sources} as ms on ms.id = m.source_id
		where (m.id = ${events.id} or m.duplicate_of_id = ${events.id})
			and ms.slug = ${slug}
	)`;
}

/**
 * Somebody sent this in: no source row, and not an import that happens to lack one.
 *
 * `innsendt` is not a row in `sources`, so `fromSourceGroup` cannot find it.
 */
export const submittedByHand = and(isNull(events.sourceId), ne(events.submissionMethod, 'import'));

/** One source's mark on a tile. Its name is the tooltip; the icon is what a reader recognises. */
export type SourceMark = {
	/** The source's own slug. What a tile keys on when a source has a card of its own. */
	slug: string;
	name: string;
	iconUrl: string | null;
};

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
export function sourceMarksFor(eventId: SQL | AnyColumn) {
	return sql<SourceMark[]>`
		coalesce((
			select json_agg(m order by m.name)
			from (
				select distinct ${sources.slug} as slug, ${sources.name} as name, ${sources.iconUrl} as "iconUrl"
				from ${events} dup
				join ${sources} on ${sources.id} = dup.source_id
				where dup.id = ${eventId} or dup.duplicate_of_id = ${eventId}
			) m
		), '[]'::json)
	`;
}

/**
 * The free-text half of the listing filter.
 *
 * Every token must appear somewhere in the row — title, description, venue or organiser — but not
 * in the same field, which is what makes "jazz stord" find the jazz club's concert on Stord. See
 * `packages/core/src/search.ts` for why this is `ilike` and not full-text search, and for the
 * measurement that decided it.
 *
 * Returns `undefined` for an empty query so it can be dropped straight into an `and(...)` beside
 * the other optional filters, exactly like `category` and `source`.
 */
export function matchesSearch(term: string | undefined): SQL | undefined {
	if (!hasSearch(term)) return undefined;
	const tokens = searchTokens(term);
	if (tokens.length === 0) return undefined;
	return and(
		...tokens.map((token) => {
			const pattern = likePattern(token);
			return or(
				ilike(events.title, pattern),
				ilike(events.description, pattern),
				ilike(venues.name, pattern),
				ilike(organizers.name, pattern)
			);
		})
	);
}

/**
 * The columns an `EventTile` draws, in one place.
 *
 * Shared by every listing that draws tiles — the front page, `/hendingar`, `eventTile`, `/hjarta` —
 * so the card a sender sees on their receipt is the same card the listing shows, not a third shape
 * that drifts from it.
 */
export const tileColumns = {
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
	// Whose calendar this came from. We are an index, not a replacement: a tile that shows no origin
	// quietly claims the event as ours.
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
};
