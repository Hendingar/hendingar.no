/**
 * IOGT's Enestående familier — the local groups we collect.
 *
 * One national site, many local groups, each a volunteer-run activity offer for families where one
 * parent is mostly alone with the children. Every group has its own page and its own list of
 * upcoming activities, so the groups are data and adding one is an entry here. Stord is the only
 * group in the three municipalities we cover; Vestland's other one is Bergen.
 *
 * ## How it is read
 *
 * Django, server-rendered, no JSON-LD and no API. The group page renders its first page of cards
 * inline and hands the pager its page count (`countPages: 1`); later pages come from
 * `/en/groups/<id>/upcoming-activities?page=N`, an HTML fragment — the URL the site's own
 * `ActivityPager.js` fetches. Each card links an activity page, which is where the clock and the
 * address are, in an "Information" box a reader sees beside the description.
 *
 * `/en/`, not `/nb/`, and not by preference: `/nb/activity/10075/` is a 404 — the activity pages
 * exist only under the English prefix, though everything the organisers write is Norwegian. The
 * English chrome is also what makes the dates parseable without guessing: "24. October 2026".
 *
 * `robots.txt` is not a robots file — the path answers with the site's own HTML page — so there is
 * nothing to obey and no crawl delay asked for. A run is the group page, any further pages, and one
 * request per activity: three requests today. Politeness is in the count, not in a sleep.
 */
export type EfGroup = {
	/**
	 * Our `sources.slug`. Stable — changing it orphans every imported event.
	 *
	 * `enestaaendefamilier-` is the prefix a `SOURCE_PLATFORMS` entry would match on, chosen now so
	 * that the day a second group is added, grouping them on /kjelder is one entry in
	 * `packages/core/src/directory.ts` and no rename. With one group there is nothing to group, and
	 * a platform heading over a single row would only bury it.
	 */
	slug: string;
	/** The site's own id for the group, from its URL: `/en/groups/51/stord/`. */
	groupId: number;
	/** The URL slug after the id. The site redirects a wrong one, but we link the right one. */
	groupPath: string;
	/**
	 * The name the site prints on each activity card's group badge.
	 *
	 * The upcoming list is headed "Recommended Activities" and means it: Lillehammer's list carries
	 * Hamar's and Ringsaker's activities, each badged with the group that runs it. Only cards that
	 * carry this badge are imported, or Stord's list recommending a Bergen trip would publish an
	 * event 90km outside the area this index covers.
	 */
	badge: string;
	name: string;
	region: string;
	attribution: string;
	/** Who runs the activities, as an `organizers` row. */
	organizer: string;
	timezone: string;
	scheduleCron: string;
	iconUrl: string | null;
	trusted: boolean;
	/**
	 * Does one run see everything this group publishes?
	 *
	 * True, and on evidence: the run follows `countPages` to the last page, and the list keeps an
	 * activity after its registration closes — Ringsaker's overnight trip on 16 October was still
	 * listed on 5 October with "Registration is closed", and Hamar's 5 October outing was listed on
	 * the day itself. So the list is everything not yet past, which is what licenses the
	 * gone-upstream sweep.
	 */
	listingIsComplete: boolean;
};

export const ORIGIN = 'https://www.enestaaendefamilier.no';

export const GROUPS: readonly EfGroup[] = [
	{
		slug: 'enestaaendefamilier-stord',
		groupId: 51,
		groupPath: 'stord',
		badge: 'Stord',
		name: 'Enestående familier — Stord',
		region: 'Sunnhordland',
		attribution: 'IOGT Enestående familier, Stordgruppa',
		organizer: 'Enestående familier Stord',
		timezone: 'Europe/Oslo',
		scheduleCron: '0 5 * * *',
		// Verified to answer `200 image/vnd.microsoft.icon` — the icon every page links.
		iconUrl: 'https://enestaaende01.blob.core.windows.net/static-production/favicon.ico',
		/*
		 * Trusted: every activity is planned and published by the group's own volunteer leaders,
		 * who have been through IOGT's leader course, and nobody else can post to the group.
		 */
		trusted: true,
		listingIsComplete: true
	}
];

/** The group's page, which a reader opens and which carries the first page of cards. */
export const groupUrl = (group: EfGroup) =>
	`${ORIGIN}/en/groups/${group.groupId}/${group.groupPath}/`;

/** Pages after the first, as the site's own pager fetches them. */
export const upcomingUrl = (group: EfGroup, page: number) =>
	`${ORIGIN}/en/groups/${group.groupId}/upcoming-activities?page=${page}`;

/** An activity's own page. Every event links here — it is also where people sign up. */
export const activityUrl = (activityId: string) => `${ORIGIN}/en/activity/${activityId}/`;

export function groupBySlug(slug: string): EfGroup | undefined {
	return GROUPS.find((g) => g.slug === slug);
}
