import { and, asc, eq, gte, isNull, or, sql } from 'drizzle-orm';
import { events, venues } from '@hendingar/core/schema';
import { eventPath } from '@hendingar/core/slug';
import { CATEGORY_SLUGS } from '@hendingar/core/taxonomy';
import { canonicalUrl } from '../../lib/origin.ts';
import { db } from '../../lib/server/db';
import type { RequestHandler } from './$types';

/**
 * Every page worth indexing, in one file.
 *
 * Without this there was no complete path into the event pages at all. `/hendingar` loads
 * twenty-four events and then pages with a button that calls a remote function — there are no
 * paginated URLs for a crawler to follow — so the only events reachable were whatever the front
 * page, the first listing screen and the day pages happened to link. Roughly a hundred URLs of
 * eight hundred.
 *
 * Deliberately one file rather than a sitemap index: the cap is 50 000 URLs and 50 MB, and this
 * is three orders of magnitude short of both. Note that a recurring series materialises one row
 * per occurrence (ADR 0009), so a weekly series legitimately contributes ~27 URLs.
 */

/** The listing window every other page uses: not yet started, or started and not yet finished. */
const notOver = (now: Date) => or(gte(events.startsAt, now), gte(events.endsAt, now));

function xml(value: string): string {
	return value
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
}

export const GET: RequestHandler = async ({ url }) => {
	const database = db();
	const now = new Date();

	const rows = await database
		.select({
			id: events.id,
			title: events.title,
			updatedAt: events.updatedAt
		})
		.from(events)
		// Canonical rows only, exactly as every listing query does. A duplicate has a page, because
		// a link somebody is reading must keep working, but it points its canonical elsewhere and
		// asking Google to crawl it would be asking for the duplicate to be found.
		.where(and(eq(events.status, 'published'), isNull(events.duplicateOfId), notOver(now)))
		.orderBy(asc(events.startsAt));

	/*
	 * The days that actually have something on. Computed in the venue's timezone for the same
	 * reason every listing does it there: a 00:30 event in Oslo is not the day before.
	 */
	const days = await database
		.selectDistinct({
			date: sql<string>`to_char(${events.startsAt} at time zone coalesce(${venues.timezone}, 'Europe/Oslo'), 'YYYY-MM-DD')`.as(
				'local_date'
			)
		})
		.from(events)
		.leftJoin(venues, eq(events.venueId, venues.id))
		.where(and(eq(events.status, 'published'), isNull(events.duplicateOfId), notOver(now)));

	const paths = [
		'/',
		'/hendingar',
		// Their content changes every week, which is a reason to list them rather than not: a
		// crawler that returns finds a different page, which is exactly what a listing should look
		// like. Both weekends, because they are two pages answering two questions — what is on now
		// and what is coming — and neither ever holds the other's events.
		'/denne-helga',
		'/neste-helg',
		'/kalender',
		'/datasamling',
		'/send-inn',
		'/poppis/hjarta',
		'/poppis/vist',
		// A category listing has its own title and its own set of events — a real page, not a facet.
		// `?kjelde=` deliberately does not appear: it changes nothing in the head and is a filter.
		...CATEGORY_SLUGS.map((slug) => `/hendingar?kategori=${slug}`),
		...days.map((day) => `/kalender/${day.date}`).sort()
	];

	const entries = [
		...paths.map((path) => ({ path, lastmod: null as Date | null })),
		...rows.map((row) => ({ path: eventPath(row.id, row.title), lastmod: row.updatedAt }))
	];

	const body = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${entries
	.map(
		({ path, lastmod }) =>
			`\t<url><loc>${xml(canonicalUrl(url, path))}</loc>${
				lastmod ? `<lastmod>${lastmod.toISOString()}</lastmod>` : ''
			}</url>`
	)
	.join('\n')}
</urlset>
`;

	return new Response(body, {
		headers: {
			'content-type': 'application/xml; charset=utf-8',
			// Events are imported once a day, so an hour is fresh enough and keeps a crawler that
			// fetches this repeatedly off the database.
			'cache-control': 'public, max-age=3600'
		}
	});
};
