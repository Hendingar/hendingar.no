import { z } from 'zod';
import { decodeEntities } from '@hendingar/core/text';
import { listingUrl, type FsSite } from './sites.ts';

/**
 * Reading a frivilligsentral's "Kommende" calendar.
 *
 * There is no feed, no JSON-LD and no API: WisWeb renders the listing server-side, and that markup
 * is the only statement of the data. So this reads the markup, and validates what it reads — the
 * day the template changes must be a loud failure, never an empty import.
 *
 * ## What one item says
 *
 * Each `u-timeline-v3` block is one dated occurrence, and shows a human exactly this:
 *
 *   TIRSDAG / 6 / OKTOBER [/ 2027]
 *   11.00 - 13.30: Eldretreff Buneset
 *   Buneset 9
 *
 * The weekday, the day number, the month name, and — only when it is not the current year — the
 * year, as a fourth line. The year is never a heading between groups; it rides on the item. The
 * current year is not stated anywhere near the items, so `parseListing` reads it from the page's
 * own footer ("2026 © Stord Frivilligsentral"), and `map.ts` checks every date it builds against
 * the weekday the page prints beside it.
 *
 * The date block of a second item on the same day is still in the markup, hidden with
 * `display:none` — so every item carries its own date, and none has to borrow one from above.
 */

const itemSchema = z.object({
	/** "Tirsdag" — Bokmål, as the CMS prints it. Checked against the date in `map.ts`. */
	weekday: z.string().min(1),
	day: z.number().int().min(1).max(31),
	/** "Oktober". */
	month: z.string().min(1),
	/** Present only when it differs from `ListingPage.year`. */
	year: z.number().int().min(2000).max(2100).nullable(),
	/** "11.00 - 13.30: Eldretreff Buneset" — times and title in one line. Split in `map.ts`. */
	heading: z.string().min(1),
	/** The line under the heading: a room ("Leirvikstova") or an address ("Buneset 9"). */
	place: z.string().nullable(),
	/**
	 * `/hendelse?eldretreff-buneset&Id=2286445` — one page per OCCURRENCE, not per series: all 674
	 * ids on the page are distinct, and the slug without an id renders no event at all. That is why
	 * a weekly activity links the listing, not one of these.
	 */
	href: z.string().nullable()
});

export type UpstreamItem = z.infer<typeof itemSchema>;

export type ListingPage = {
	/** The current year as the page states it, which is the year of every item that states none. */
	year: number;
	items: UpstreamItem[];
	rejected: string[];
};

/** Tags out, entities decoded, whitespace collapsed. `&nbsp;` sits between the two times. */
function text(html: string): string {
	return decodeEntities(html.replace(/<\/?[a-zA-Z][^>]*>/g, ' '))
		.replace(/\s+/g, ' ')
		.trim();
}

/**
 * The page → its items.
 *
 * Throws when the page is not a calendar we recognise: no "Kommende" switch, no footer year. Those
 * are redesigns, not empty weeks. An empty listing under a recognised page is legitimately empty,
 * and `markGoneUpstream` already refuses to act on zero.
 */
export function parseListing(html: string): ListingPage {
	if (!/<b>\s*Kommende\s*<\/b>/.test(html)) {
		throw new Error('no "Kommende" switch on the calendar page — not the listing we know');
	}
	/*
	 * The footer's copyright year: the only place the page says which year "now" is.
	 *
	 * It is the right witness, not just a convenient one: the year line on an item and this footer
	 * are rendered by the same server in the same request, so they cannot disagree about which year
	 * is current. If the footer were ever a hard-coded string left behind at New Year, every
	 * year-less date would land on the wrong weekday and be rejected by name — see `resolveDate`.
	 */
	const footer = /(\d{4})\s*(?:©|&copy;)/.exec(html);
	if (!footer?.[1]) throw new Error('no copyright year on the calendar page');
	const year = Number(footer[1]);

	const items: UpstreamItem[] = [];
	const rejected: string[] = [];
	// Split on the block's opening tag rather than matching it whole: the blocks nest divs, and a
	// regex cannot balance them. Everything up to the next block belongs to this one.
	const blocks = html.split(/<div class="u-timeline-v3\s[^"]*">/).slice(1);
	for (const block of blocks) {
		const date = [...block.matchAll(/<span style="display: block;[^"]*">([^<]*)<\/span>/g)].map(
			(m) => text(m[1] ?? '')
		);
		const heading = /<h3[^>]*>([\s\S]*?)<\/h3>/.exec(block)?.[1];
		const place = /<h4[^>]*>([\s\S]*?)<\/h4>/.exec(block)?.[1];
		const href = /<a\s[^>]*href="(\/hendelse\?[^"]*)"/.exec(block)?.[1];

		const parsed = itemSchema.safeParse({
			weekday: date[0],
			day: date[1] ? Number(date[1]) : undefined,
			month: date[2],
			year: date[3] ? Number(date[3]) : null,
			heading: heading ? text(heading) : undefined,
			place: place ? text(place) || null : null,
			href: href ? decodeEntities(href) : null
		});
		if (parsed.success) items.push(parsed.data);
		else
			rejected.push(parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join(', '));
	}
	return { year, items, rejected };
}

const HEADERS = {
	// Identifying, with a contact URL, as docs/event-sources.md asks of every importer.
	'user-agent': 'hendingar.no importer (+https://hendingar.no)',
	accept: 'text/html'
};

export type Read = (site: FsSite) => Promise<string>;

/**
 * One request per run, for the one page a reader would open — and outside the hours robots.txt
 * asks for, on purpose.
 *
 * robots.txt is `User-agent: * / Disallow:` — nothing is disallowed — plus a non-standard
 * `Visit-time: 0200-0500 UTC+1`, i.e. 01:00–04:00 UTC. The project owner decided to fetch once per
 * daily run anyway, and the reasoning is worth keeping beside the request:
 *
 * - **The window is unreachable.** The ingest workflow is scheduled for 05:00 UTC and GitHub starts
 *   scheduled jobs late — in practice around 11:00 UTC. Neither is inside 01:00–04:00, and a
 *   schedule pinned into the window would still be started whenever GitHub gets to it.
 * - **What the line protects against is load, and this is one GET a day.** `Visit-time` comes from
 *   an old crawler convention for spreading heavy crawling into quiet hours. One request for one
 *   page, at a time of day when people are reading the same page in a browser, is not the
 *   behaviour it exists to move.
 * - **Nothing is disallowed.** The directive the site does state in standard form permits this
 *   path at any hour.
 *
 * So: never a second request in a run, never a per-occurrence page (674 of them), and never a retry
 * loop. If the sentral asks us to stop, the source is turned off — not moved to another hour.
 *
 * Thirty seconds, like every other importer. The page is ~1.9 MB and arrives in under two.
 */
export const read: Read = async (site) => {
	const url = listingUrl(site);
	const response = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(30_000) });
	if (!response.ok) throw new Error(`${url} responded ${response.status}`);
	return response.text();
};
