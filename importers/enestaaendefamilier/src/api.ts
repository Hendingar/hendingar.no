import { z } from 'zod';
import { decodeEntities } from '@hendingar/core/text';

/**
 * Reading an Enestående familier group: its list of cards, and each activity's own page.
 *
 * Markup, because markup is all there is — no JSON-LD, no `<time>`, no API; the only structured
 * data on an activity page is the `og:` block and the map's coordinates. So every reading here is
 * anchored on something the page labels for a reader ("Date", "Address") rather than on position,
 * and everything read is validated: a redesign must be a loud failure, not an empty import.
 */

/* -------------------------------------------------------------------------------------------- */
/* The list                                                                                       */
/* -------------------------------------------------------------------------------------------- */

const cardSchema = z.object({
	/** The site's activity id, from the card's link. What `external_id` is built from. */
	activityId: z.string().regex(/^\d+$/),
	title: z.string().min(1),
	/** "24. October 2026", or "16. October - 17. October 2026". Cross-checked, never trusted alone. */
	dateText: z.string().min(1),
	/** Which group runs it. Usually one; a co-hosted activity carries one badge per group. */
	groups: z.array(z.string().min(1)).min(1)
});

export type UpstreamCard = z.infer<typeof cardSchema>;

export type ParsedCards = { cards: UpstreamCard[]; rejected: string[] };

/** Tags out and whitespace collapsed — for the short labels on a card, not for descriptions. */
function inline(html: string): string {
	return decodeEntities(html.replace(/<[^>]+>/g, ' '))
		.replace(/\s+/g, ' ')
		.trim();
}

/**
 * Every activity card in a page of the list — the group page or a later fragment, which share the
 * card markup exactly.
 *
 * Split on the card's own opening tag, so one malformed card is one rejected row rather than a
 * regex that silently swallows its neighbour.
 */
export function parseCards(html: string): ParsedCards {
	const cards: UpstreamCard[] = [];
	const rejected: string[] = [];
	for (const chunk of html.split('<div class="card mb-3">').slice(1)) {
		const link = /<a href="\/en\/activity\/(\d+)\/">([\s\S]*?)<\/a>/.exec(chunk);
		const date = /<\/a>\s*<div>([\s\S]*?)<\/div>/.exec(chunk);
		const groups = [
			...chunk.matchAll(/<span class="badge[^"]*\bbg-secondary\b[^"]*">([\s\S]*?)<\/span>/g)
		].map((m) => inline(m[1] ?? ''));
		const parsed = cardSchema.safeParse({
			activityId: link?.[1],
			title: inline(link?.[2] ?? ''),
			dateText: inline(date?.[1] ?? ''),
			groups
		});
		if (parsed.success) cards.push(parsed.data);
		else
			rejected.push(parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join(', '));
	}
	return { cards, rejected };
}

export type GroupPage = ParsedCards & { pageCount: number };

/**
 * The group page: its first page of cards, and how many pages there are.
 *
 * The count is the one the page hands its own pager (`countPages: 1`). A group with nothing
 * planned renders no pager at all — Oslo, measured, says "No upcoming activities found" in the
 * same container — so a missing count with the container present is one page, possibly empty.
 * A missing *container* is a redesign, and throws.
 */
export function parseGroupPage(html: string): GroupPage {
	if (!html.includes('id="svelte-upcoming-activities"')) {
		throw new Error('no upcoming-activities list on the group page');
	}
	const count = /countPages:\s*(\d+)/.exec(html);
	const pageCount = count?.[1] ? Number(count[1]) : 1;
	return { ...parseCards(html), pageCount };
}

/* -------------------------------------------------------------------------------------------- */
/* An activity                                                                                    */
/* -------------------------------------------------------------------------------------------- */

const activitySchema = z.object({
	activityId: z.string().regex(/^\d+$/),
	title: z.string().min(1),
	/**
	 * The paragraphs under the "Date" label, in order: the date or span, then the clock.
	 *
	 * `["24. October 2026", "11:30 - 13:45"]`. The clock paragraph is what a reader sees and the
	 * only statement of a time anywhere on the page — there is no machine-readable one to disagree
	 * with it. It is read as written, and `map.ts` decides what an absent one means.
	 */
	dateLines: z.array(z.string()).min(1),
	/** The line under "Address": a street ("Fitjarsjøen 2"), a venue, or just a town. */
	address: z.string().nullable(),
	latitude: z.number().min(-90).max(90).nullable(),
	longitude: z.number().min(-180).max(180).nullable(),
	/** The organisers' own text, as markup. */
	descriptionHtml: z.string().nullable(),
	/** `og:image` — the featured image, at the size the site cuts for sharing. */
	imageUrl: z.url().nullable(),
	/** True when the page labels its featured image "This image is AI generated." */
	imageIsAiGenerated: z.boolean()
});

export type UpstreamActivity = z.infer<typeof activitySchema>;

function meta(html: string, property: string): string | null {
	const tag = new RegExp(`<meta property="${property}" content="([^"]*)"`).exec(html);
	return tag?.[1] ? decodeEntities(tag[1]).trim() || null : null;
}

/**
 * The block beside a label in the "Information" card: `<label>Date</label></div><div>…</div>`.
 *
 * Found by the label's text, which is the one thing a reader also reads, so a reordering of the
 * card cannot hand us the address as a date.
 */
function infoBlock(html: string, label: string): string | null {
	const block = new RegExp(
		`<label class="fs-5 fw-bold">\\s*${label}\\s*</label>\\s*</div>\\s*<div>([\\s\\S]*?)</div>`
	).exec(html);
	return block?.[1] ?? null;
}

function paragraphs(block: string | null): string[] {
	if (!block) return [];
	return [...block.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/g)].map((m) => inline(m[1] ?? ''));
}

function coordinate(html: string, axis: 'latitude' | 'longitude'): number | null {
	const hit = new RegExp(`${axis}:\\s*(-?\\d+(?:\\.\\d+)?)`).exec(html);
	return hit?.[1] ? Number(hit[1]) : null;
}

/**
 * One activity page, read.
 *
 * The id comes from `og:url` rather than from the URL we asked for, so a page that redirected
 * somewhere else cannot be filed under the id we requested. The title is `og:title`, which is the
 * card's title; the `<h1>` prefixes it with the group ("Stord: …"), which is the badge's job.
 */
export function parseActivity(html: string): UpstreamActivity {
	const url = meta(html, 'og:url');
	const description = /<div class="mt-3">([\s\S]*?)<\/div>/.exec(html);
	const parsed = activitySchema.safeParse({
		activityId: url ? /\/activity\/(\d+)\//.exec(url)?.[1] : undefined,
		title: meta(html, 'og:title') ?? '',
		dateLines: paragraphs(infoBlock(html, 'Date')),
		address: paragraphs(infoBlock(html, 'Address'))[0] || null,
		latitude: coordinate(html, 'latitude'),
		longitude: coordinate(html, 'longitude'),
		descriptionHtml: description?.[1]?.trim() || null,
		imageUrl: meta(html, 'og:image'),
		imageIsAiGenerated: html.includes('featured-image__ai_notice')
	});
	if (!parsed.success) {
		throw new Error(
			`unexpected activity page: ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join(', ')}`
		);
	}
	return parsed.data;
}

/* -------------------------------------------------------------------------------------------- */
/* Fetching                                                                                       */
/* -------------------------------------------------------------------------------------------- */

const HEADERS = {
	// Identifying, with a contact URL, as docs/event-sources.md asks of every importer.
	'user-agent': 'hendingar.no importer (+https://hendingar.no)',
	accept: 'text/html'
};

/** Every request this importer makes goes through one of these, so a test can hand it fixtures. */
export type Read = (url: string) => Promise<string>;

export const read: Read = async (url) => {
	const response = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(30_000) });
	if (!response.ok) throw new Error(`${url} responded ${response.status}`);
	return response.text();
};
