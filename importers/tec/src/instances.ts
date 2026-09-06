import type { CategorySlug } from '@hendingar/core/taxonomy';

/**
 * The Events Calendar sites we import from.
 *
 * The Events Calendar (formerly Modern Tribe's, now by StellarWP) is one of the most widely
 * installed WordPress event plugins there is, so this is one importer for a whole family of sites
 * rather than one per site — the same argument as `importers/mec` and the Innocode "bestevent"
 * platform behind Det skjer. Adding a Norwegian venue running it should be an entry here, not a
 * new package.
 *
 * How to tell a site runs it, in one request:
 *
 *   curl -s https://example.no/wp-json/wp/v2/types | grep -o tribe_events
 *   curl -s 'https://example.no/wp-json/tribe/events/v1/events?per_page=5'
 *
 * `tribe_events` in the post types and a `{"events":[…],"total":…,"total_pages":…}` body is the
 * whole test. Note the second call answers `total: 0` on a site with nothing coming up — that is
 * the plugin's own default window, not a missing endpoint. Add `&start_date=2020-01-01` to see
 * whether the calendar was ever used.
 */
export type TecInstance = {
	/**
	 * Our `sources.slug`. Stable — changing it orphans every imported event.
	 *
	 * Always `tec-<site>`: /kjelder groups a platform's sources by that prefix (see
	 * `SOURCE_PLATFORMS` in packages/core/src/directory.ts), so a slug that drops it silently
	 * un-groups the row.
	 */
	slug: string;
	name: string;
	/** The human-facing calendar, for attribution links. */
	url: string;
	/** The REST collection we actually call. Recorded on the source row, so the method is public. */
	endpoint: string;
	region: string;
	attribution: string;
	/**
	 * The zone the site's wall clocks are really in.
	 *
	 * Load-bearing rather than decorative, and not merely a fallback: see `resolveZone` in map.ts.
	 * The plugin reports a zone per event, but a WordPress configured with a manual UTC offset
	 * instead of a city reports `UTC+0` — which is what bomloteater.no does — and then labels a
	 * 20:00 Norwegian curtain-up as 20:00 UTC. This value is what such a site is read against.
	 */
	timezone: string;
	/**
	 * Where an event with no venue of its own is held.
	 *
	 * The Events Calendar makes the venue optional, and a single-venue site often leaves it off
	 * every event because everyone already knows where the theatre is. Without this those events
	 * would arrive with no place at all.
	 */
	venueFallback: string;
	/**
	 * Where an event lands when the site's own categories say nothing we recognise — including the
	 * common case of a site that uses no categories at all.
	 *
	 * A per-site value rather than a global `anna`, because on a single-purpose site the answer is
	 * a fact about the source and not a guess about the event: everything Bømlo Teater puts in its
	 * calendar is theatre. The same reasoning `importers/kyrkja` uses for `kyrkjeliv` and
	 * `importers/bakhagen` for `mote`. A general-purpose venue running the same plugin should be
	 * configured `anna` here and let its categories do the work.
	 */
	defaultCategory: CategorySlug;
	scheduleCron: string;
	/**
	 * The site's own icon, hotlinked, so a tile and a source row carry its mark.
	 *
	 * Read from `/wp-json/`'s `site_icon_url` rather than guessed: bomloteater.no's `/favicon.ico`
	 * answers a 302 to an HTML page, and only the WordPress site icon actually resolves.
	 */
	iconUrl: string | null;
	/**
	 * The venue has given us permission to use its event images.
	 *
	 * Recorded per source rather than assumed globally, because it is a fact about an agreement
	 * with a named organisation and not a property of the software. We hotlink rather than re-host
	 * either way — but an unstated right is not a granted one, so a site we have not spoken to is
	 * `false` here.
	 */
	posterRightsCleared: boolean;
	/**
	 * Editorially maintained by the venue itself, so imports publish directly.
	 *
	 * Not a formality. Nothing in this codebase promotes a collected event out of `pending`: no
	 * importer calls the verifier, there is no job that would, and ADR 0012 removed the review
	 * queue the `trusted` column's comment still describes. Every listing filters
	 * `status = 'published'`. So `false` on a collecting source means importing events nobody can
	 * ever see, while /kjelder reports healthy runs — worse than not importing at all, because it
	 * looks like success. A site whose own staff write its programme is trusted; anything else
	 * should not be collected yet.
	 */
	trusted: boolean;
};

export const INSTANCES: readonly TecInstance[] = [
	{
		slug: 'tec-bomloteater',
		name: 'Bømlo Teater',
		url: 'https://bomloteater.no/arrangement/',
		endpoint: 'https://bomloteater.no/wp-json/tribe/events/v1/events',
		region: 'Sunnhordland',
		attribution: 'Bømlo Teater',
		/*
		 * The site says `UTC+0` and means Europe/Oslo.
		 *
		 * `/wp-json/` reports `timezone_string: ""` with `gmt_offset: "0"`, so WordPress is set to a
		 * manual offset rather than a city, and every event's `utc_start_date` is therefore a copy
		 * of its local `start_date`. A 20:00 curtain-up in Bremnes is not 20:00 UTC. See
		 * `resolveZone` in map.ts for how that is handled.
		 */
		timezone: 'Europe/Oslo',
		venueFallback: 'Bømlo Kulturhus',
		/*
		 * A theatre's calendar. Every one of the four events it has ever held is a stage
		 * production, and the site itself carries no event categories to read instead.
		 */
		defaultCategory: 'teater',
		scheduleCron: '0 5 * * *',
		iconUrl: 'https://bomloteater.no/wp-content/uploads/2022/11/cropped-bt-favicon.png',
		/*
		 * No agreement with Bømlo Teater. The posters are hotlinked from their own media library
		 * and never copied onto ours, which is what an unverified right allows.
		 */
		posterRightsCleared: false,
		trusted: true
	}
];

export function instanceBySlug(slug: string): TecInstance | undefined {
	return INSTANCES.find((i) => i.slug === slug);
}
