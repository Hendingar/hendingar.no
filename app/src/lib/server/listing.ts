import { eq, ilike, or, and, sql } from 'drizzle-orm';
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
