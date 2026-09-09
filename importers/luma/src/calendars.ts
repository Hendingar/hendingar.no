/**
 * The Luma calendars we import from.
 *
 * Luma (luma.com, formerly lu.ma) is a hosted events platform, so this is a platform importer and
 * the calendars are data — the same argument as `mec/` and `aktivitetforalle/`. Adding a local
 * organiser who runs their events on Luma should be an entry here, not a new package.
 *
 * How to tell a Luma calendar: the page is a Next.js app whose `__NEXT_DATA__` carries
 * `props.pageProps.initialData.data.calendar.api_id` starting `cal-`, and
 * `https://api.lu.ma/calendar/get-items?calendar_api_id=<that>` answers 200 with `{entries,
 * has_more}`. The `api_id` is what this file needs; the vanity handle in the URL is not enough,
 * because the API is keyed on the id.
 */
export type LumaCalendar = {
	/** Our `sources.slug`. Stable — changing it orphans every imported event.
	 *
	 * `luma-` prefixed so `platformOf` in packages/core/src/directory.ts groups it under one
	 * Luma entry on /kjelder rather than giving every organiser its own line.
	 */
	slug: string;
	name: string;
	/**
	 * The calendar's own id, `cal-…`. What the API is keyed on.
	 *
	 * Not derivable from the handle: `luma.com/tcw` is a vanity path that resolves in the browser,
	 * and the JSON endpoint accepts only this.
	 */
	calendarApiId: string;
	/** The vanity handle — `tcw` in `luma.com/tcw`. For the human-facing listing link. */
	handle: string;
	region: string;
	attribution: string;
	/**
	 * The calendar's IANA zone, used for the venue row.
	 *
	 * Belt and braces: every event in the payload carries its own `timezone` and that is preferred
	 * (see `map.ts`). This is what a venue falls back to when an event omits it, and it must be a
	 * zone rather than an offset — an offset is a fact about one moment, a zone about a place.
	 */
	timezone: string;
	scheduleCron: string;
	iconUrl: string | null;
	/**
	 * Editorially maintained by the organiser themselves, so imports publish directly rather than
	 * queueing. Same reasoning as the `trusted` column in schema.ts.
	 */
	trusted: boolean;
	/**
	 * We may use the calendar's event images.
	 *
	 * `false` for Luma, and deliberately, because it is the honest answer rather than a formality.
	 * Luma cover images are frequently stock art the organiser picked from Unsplash inside Luma's
	 * own picker — the Tech Cluster West event in the committed fixture is a `images.unsplash.com`
	 * URL with an `ixid` tracking parameter. Whatever licence covers that is between Unsplash and
	 * the organiser, and it is not an agreement anybody made with us. We still hotlink, so nothing
	 * is re-hosted; this records that no permission was given, which is what makes it auditable
	 * the moment something starts caching or resizing images.
	 */
	posterRightsCleared: boolean;
};

export const CALENDARS: readonly LumaCalendar[] = [
	{
		slug: 'luma-tcw',
		name: 'Tech Cluster West',
		calendarApiId: 'cal-yKlrTBwsAAkMhX3',
		handle: 'tcw',
		region: 'Sunnhordland',
		attribution: 'Tech Cluster West',
		timezone: 'Europe/Oslo',
		scheduleCron: '0 5 * * *',
		iconUrl: 'https://images.lumacdn.com/calendars/jw/521518b1-7c0d-48be-9969-8ab3afac6bf4',
		trusted: true,
		posterRightsCleared: false
	}
];

export function calendarBySlug(slug: string): LumaCalendar | undefined {
	return CALENDARS.find((c) => c.slug === slug);
}

/** The listing a reader can open. */
export const listingUrl = (calendar: LumaCalendar) => `https://luma.com/${calendar.handle}`;

/**
 * One event's own page.
 *
 * The payload's `event.url` is the vanity path only — `ahupvg92`, no host, no leading slash — so
 * this is built rather than read. Every imported event keeps a link to its source (CLAUDE.md), and
 * that link has to be the event, not the calendar it sits on.
 */
export const eventUrl = (path: string) => `https://luma.com/${path}`;

/**
 * `api.lu.ma`, not `api.luma.com`.
 *
 * Both answer identically today — verified against this calendar — and `api.lu.ma` is the host the
 * site's own client calls, so it is the one likelier to keep working. Recorded because the
 * difference looks like a typo and is a deliberate choice.
 */
export const itemsUrl = (calendar: LumaCalendar, period: 'future' | 'past', cursor?: string) => {
	const url = new URL('https://api.lu.ma/calendar/get-items');
	url.searchParams.set('calendar_api_id', calendar.calendarApiId);
	url.searchParams.set('period', period);
	url.searchParams.set('pagination_limit', '50');
	if (cursor) url.searchParams.set('pagination_cursor', cursor);
	return url.toString();
};
