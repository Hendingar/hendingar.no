import { z } from 'zod';
import { SITE, itemsUrl, programUrl } from './site.ts';

/**
 * Reading Falturiltu's programme: the rendered page for the when and where, the REST endpoint for
 * the what. See `site.ts` for why it takes both.
 */

/** One programme card, as the page renders it. Text only; nothing interpreted yet. */
export type Card = {
	/** The event's own page. Also the join key to the REST item. */
	link: string;
	title: string;
	/** The card's `<time datetime>`: `2026-10-29 11:45`, or a bare date for an undated item. */
	datetime: string;
	/** The clock a reader sees beside it, `11:45` — or null when the card shows none. */
	clock: string | null;
	venue: string | null;
	price: string | null;
	ticketUrl: string | null;
};

/** The named entities WordPress's typography filter writes into titles. */
const NAMED: Record<string, string> = {
	laquo: '«',
	raquo: '»',
	ndash: '–',
	mdash: '—',
	hellip: '…',
	lsquo: '‘',
	rsquo: '’',
	ldquo: '“',
	rdquo: '”',
	nbsp: ' '
};

function decode(value: string): string {
	return value
		.replace(/<[^>]+>/g, ' ')
		.replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
		.replace(/&#x([0-9a-f]+);/gi, (_, n: string) => String.fromCodePoint(parseInt(n, 16)))
		.replace(
			/&(laquo|raquo|ndash|mdash|hellip|lsquo|rsquo|ldquo|rdquo|nbsp);/g,
			(_, name: string) => NAMED[name] ?? ' '
		)
		.replace(/&amp;/g, '&')
		.replace(/&quot;/g, '"')
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/\s+/g, ' ')
		.trim();
}

/** The text of the first element carrying `class`, or null. */
function field(block: string, className: string): string | null {
	const match = new RegExp(
		`<[a-z]+[^>]*class="[^"]*\\b${className}\\b[^"]*"[^>]*>([\\s\\S]*?)</`
	).exec(block);
	const text = match?.[1] !== undefined ? decode(match[1]) : '';
	return text || null;
}

/**
 * Every card on the programme page.
 *
 * Split on the card's own class rather than walked as a DOM: the theme emits each card as one
 * flat block, and a page with none is a redesign rather than an empty festival — so it throws.
 */
export function parseProgram(html: string): { cards: Card[]; rejected: string[] } {
	const blocks = html.split('<div class="program-card">').slice(1);
	if (blocks.length === 0) throw new Error('no program-card on the programme page');

	const cards: Card[] = [];
	const rejected: string[] = [];
	for (const block of blocks) {
		const link = /href="(https:\/\/falturiltu\.no\/arrangement\/[^"]+)"/.exec(block)?.[1];
		const datetime = /<time datetime="([^"]+)"/.exec(block)?.[1];
		const title = field(block, 'program-card-content__title');
		if (!link || !datetime || !title) {
			rejected.push(`card without ${!link ? 'link' : !datetime ? 'time' : 'title'}`);
			continue;
		}
		const ticket = /<a href="([^"]+)"[^>]*program-card-content__footer-price/.exec(block)?.[1];
		cards.push({
			link,
			title,
			datetime: datetime.trim(),
			clock: field(block, 'program-card-content__time'),
			venue: field(block, 'program-card-content__location'),
			price: field(block, 'program-card-content__footer-price'),
			ticketUrl: ticket ?? null
		});
	}
	return { cards, rejected };
}

const itemSchema = z.object({
	id: z.number(),
	link: z.string(),
	excerpt: z.object({ rendered: z.string() }),
	program_item_cat: z.array(z.number())
});

export type Item = z.infer<typeof itemSchema>;

/** The REST items, validated. Only what the mapping uses is required. */
export function parseItems(json: unknown): Item[] {
	const parsed = z.array(itemSchema).safeParse(json);
	if (!parsed.success) {
		throw new Error(`unexpected program_items shape: ${parsed.error.issues[0]?.message}`);
	}
	return parsed.data;
}

/** The excerpt as plain paragraphs. */
export function excerptText(item: Item | undefined): string | null {
	if (!item) return null;
	const text = item.excerpt.rendered.split(/<\/p>/).map(decode).filter(Boolean).join('\n\n');
	return text || null;
}

const HEADERS = { 'user-agent': 'hendingar.no importer (+https://hendingar.no)' };

export type Read = () => Promise<{ html: string; items: unknown }>;

async function get(url: string, accept: string): Promise<Response> {
	const response = await fetch(url, {
		headers: { ...HEADERS, accept },
		signal: AbortSignal.timeout(30_000)
	});
	if (!response.ok) throw new Error(`${url} responded ${response.status}`);
	return response;
}

/** Two requests a run, the crawl delay apart. */
export const read: Read = async () => {
	const html = await (await get(programUrl(), 'text/html')).text();
	await new Promise((resolve) => setTimeout(resolve, SITE.crawlDelayMs));
	const items: unknown = await (await get(itemsUrl(), 'application/json')).json();
	return { html, items };
};
