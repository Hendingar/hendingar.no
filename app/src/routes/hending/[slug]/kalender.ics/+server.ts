import { error } from '@sveltejs/kit';
import { and, eq } from 'drizzle-orm';
import { buildIcal, icalFilename } from '@hendingar/core/ical';
import { events, venues } from '@hendingar/core/schema';
import { eventIdFromParam, eventPath } from '@hendingar/core/slug';
import { db } from '../../../../lib/server/db';
import type { RequestHandler } from './$types';

/**
 * One event as a downloadable `.ics`, so a reader can put it in their own calendar.
 *
 * A plain GET rather than a remote function on purpose: the browser has to be able to navigate to
 * it, and a calendar client has to be able to fetch it. A remote function is a POST to an internal
 * endpoint and neither of those can use one.
 *
 * The URL sits under the event's own path — `/hending/133-.../kalender.ics` — so it inherits the id
 * from the slug and needs no separate route or lookup table. Anything after the leading digits is
 * ignored, exactly as on the page itself, so a stale slug still resolves.
 */
export const GET: RequestHandler = async ({ params, url }) => {
	const id = eventIdFromParam(params.slug ?? '');
	if (id === null) error(404, 'Fann ikkje hendinga');

	const [row] = await db()
		.select({
			id: events.id,
			title: events.title,
			description: events.description,
			startsAt: events.startsAt,
			endsAt: events.endsAt,
			sourceUrl: events.sourceUrl,
			venueName: venues.name,
			venueMunicipality: venues.municipality
		})
		.from(events)
		.leftJoin(venues, eq(events.venueId, venues.id))
		// Published only, and the same rule the page uses: an unpublished event has no page, so it
		// must not have a calendar file either.
		.where(and(eq(events.id, id), eq(events.status, 'published')))
		.limit(1);

	if (!row) error(404, 'Fann ikkje hendinga');

	const location = [row.venueName, row.venueMunicipality]
		.filter((part): part is string => Boolean(part))
		// A venue whose name already ends in the municipality would otherwise read "Stord, Stord".
		.filter((part, index, all) => all.indexOf(part) === index)
		.join(', ');

	const body = buildIcal({
		id: row.id,
		title: row.title,
		description: row.description,
		location: location || null,
		startsAt: row.startsAt,
		endsAt: row.endsAt,
		// Absolute, built from the request: the file is read outside any browser context, so a
		// relative link in it would point nowhere.
		url: new URL(eventPath(row.id, row.title), url.origin).toString(),
		sourceUrl: row.sourceUrl
	});

	return new Response(body, {
		headers: {
			'content-type': 'text/calendar; charset=utf-8',
			// `attachment` so a click saves or opens a calendar rather than rendering plain text in
			// the tab, which is what every browser does with an inline text/calendar response.
			'content-disposition': `attachment; filename="${icalFilename(row.id, row.title)}"`,
			// The event can be corrected upstream, and a stale copy in a shared cache would hand
			// someone yesterday's time. An hour is long enough to be worth having.
			'cache-control': 'public, max-age=3600'
		}
	});
};
