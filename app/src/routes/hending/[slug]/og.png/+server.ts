import { error } from '@sveltejs/kit';
import { and, eq } from 'drizzle-orm';
import { formatEventTime } from '@hendingar/core/datetime';
import { events, venues } from '@hendingar/core/schema';
import { eventIdFromParam } from '@hendingar/core/slug';
import { categoryLabel } from '@hendingar/core/taxonomy';
import { renderOgImage } from '../../../../lib/server/og-image.ts';
import { db } from '../../../../lib/server/db';
import type { RequestHandler } from './$types';

/**
 * One event's share card, as a PNG.
 *
 * A `+server.ts` under the event's own path, exactly like `kalender.ics` next to it: the id comes
 * from the slug, a scraper navigates to it with a plain GET, and a remote function is a POST to an
 * internal endpoint that no scraper could use.
 */
export const GET: RequestHandler = async ({ params }) => {
	const id = eventIdFromParam(params.slug ?? '');
	if (id === null) error(404, 'Fann ikkje hendinga');

	const [row] = await db()
		.select({
			title: events.title,
			category: events.category,
			startsAt: events.startsAt,
			posterUrl: events.posterUrl,
			posterRightsVerified: events.posterRightsVerified,
			venueName: venues.name,
			venueMunicipality: venues.municipality,
			venueTimeZone: venues.timezone
		})
		.from(events)
		.leftJoin(venues, eq(events.venueId, venues.id))
		// The same rule the page and the .ics use: an unpublished event has no page, so it has no
		// picture either.
		.where(and(eq(events.id, id), eq(events.status, 'published')))
		.limit(1);

	if (!row) error(404, 'Fann ikkje hendinga');

	const png = await renderOgImage({
		label: [categoryLabel(row.category), row.venueMunicipality].filter(Boolean).join(' · '),
		title: row.title,
		// Formatted here, with the venue's zone, because that is the rule everywhere (CLAUDE.md):
		// a timestamptz is an instant, and rendering it in the server's zone moves concerts.
		primary: formatEventTime(row.startsAt, row.venueTimeZone, 'full'),
		secondary: [row.venueName, row.venueMunicipality].filter(Boolean).join(', ') || null,
		// Only a poster we are allowed to redraw. Everything else gets the generated card, which is
		// the common case and is why this route exists.
		posterUrl: row.posterRightsVerified ? row.posterUrl : null
	});

	return new Response(png, {
		headers: {
			'content-type': 'image/png',
			/*
			 * A day, and a week of serving the old one while a new one renders. Scrapers refetch
			 * rarely and this costs a font load, a layout and a rasterise; the event's title can
			 * change upstream, so it is not immutable.
			 */
			'cache-control': 'public, max-age=86400, stale-while-revalidate=604800'
		}
	});
};
