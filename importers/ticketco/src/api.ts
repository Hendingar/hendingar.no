import { z } from 'zod';
import { listingUrl, type TicketcoShop } from './instances.ts';

/**
 * Reading a TicketCo shop's listing.
 *
 * TicketCo publishes no open API we could find, but its listing page does the work of one: every
 * event card is followed by an `application/ld+json` block of `@type: Event`, which carries the
 * name, the dates, the image, the description and the event's own URL. That is what we parse.
 *
 * **The JSON-LD is not the whole story for the clock.** Its `startDate` says `Z` and means Oslo —
 * see `readWallClock` in map.ts — so the date and clock the card *prints* are read too, out of
 * `.tc-events-list--place-time`, and paired with the block for the same event. That pairing is why
 * this returns `listings` rather than a bare list of events.
 *
 * One request per run, for the whole shop. The page is unpaginated — nine events and no "load
 * more" — and robots.txt disallows only purchase receipts and order PDFs.
 *
 * Parsing is split from fetching: `parseListing` is pure, so the tests run against committed HTML
 * and never touch the network (CLAUDE.md rule 6).
 */

/** Only the fields we use. Unknown keys are ignored — TicketCo emits `landing_image` and more. */
const eventSchema = z.object({
	'@type': z.literal('Event'),
	name: z.string(),
	startDate: z.string(),
	endDate: z.string().nullish(),
	url: z.string(),
	description: z.string().nullish(),
	image: z.string().nullish(),
	eventStatus: z.string().nullish(),
	location: z.object({ name: z.string().nullish() }).nullish()
});

export type UpstreamEvent = z.infer<typeof eventSchema>;

/** The date and clock a card prints, as `YYYY-MM-DD` and `HH:MM` in the shop's own zone. */
export type CardTime = { date: string; time: string };

/**
 * One event: its JSON-LD block, its slug, and the time its card prints.
 *
 * `card` is null where no card for that slug was found or its text did not read as a date and
 * clock — the mapper then falls back to the JSON-LD, which is right on every event measured.
 */
export type Listing = {
	event: UpstreamEvent;
	/** The `<slug>` in `/e/<slug>`, which is the event's identity in the shop. */
	slug: string | null;
	card: CardTime | null;
};

export type ParsedListing = {
	listings: Listing[];
	/** Blocks that looked like events but did not validate, kept so a run can report them. */
	rejected: string[];
};

const LD_BLOCK = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;

/** A card, from its opening tag to the next card's. `--item-logo` and friends are not cards. */
const CARD_START = /class=['"][^'"]*\btc-events-list--item(?=[\s'"])/g;
const CARD_TITLE_HREF =
	/class=['"][^'"]*\btc-events-list--title\b[^'"]*['"]\s+href=['"]([^'"]+)['"]/;
/**
 * `24.10.2026 20:00`, which is how the card prints it, and nothing else.
 *
 * A guard rather than a parser: a shop configured in another locale would print something else,
 * and a half-read date is worse than none — anything that does not match falls back to the
 * JSON-LD rather than to a guess.
 */
const CARD_PLACE_TIME =
	/class=['"][^'"]*\btc-events-list--place-time\b[^'"]*['"][^>]*>\s*(\d{2})\.(\d{2})\.(\d{4})\s+(\d{1,2}):(\d{2})\b/;

/**
 * The slug in an event URL: `rammsund_2026` in `…/no/en/e/rammsund_2026` and in the card's
 * `…/no/nb/m/e/rammsund_2026` alike. The language segment and the `/m` differ between the two;
 * the slug does not, which is what makes it the key to pair them on.
 */
export function slugOf(url: string | null | undefined): string | null {
	if (!url) return null;
	try {
		const match = /\/e\/([^/?#]+)\/?$/.exec(new URL(url).pathname);
		return match?.[1] ? decodeURIComponent(match[1]) : null;
	} catch {
		return null;
	}
}

/** A printed date and clock, or null if the numbers are not a real one. */
function readCardTime(match: RegExpExecArray | null): CardTime | null {
	if (!match) return null;
	const [, day, month, year, hourRaw, minute] = match;
	const hour = Number(hourRaw);
	if (hour > 23 || Number(minute) > 59) return null;
	const date = `${year}-${month}-${day}`;
	// `31.02.2026` matches the shape and is not a day. Round-tripping catches it.
	const probe = new Date(`${date}T12:00:00Z`);
	if (Number.isNaN(probe.getTime()) || probe.toISOString().slice(0, 10) !== date) return null;
	return { date, time: `${String(hour).padStart(2, '0')}:${minute}` };
}

/** Every card's slug and printed time, in document order. */
function readCards(html: string): { slug: string; time: CardTime | null }[] {
	const starts = [...html.matchAll(CARD_START)].map((m) => m.index);
	const cards: { slug: string; time: CardTime | null }[] = [];
	for (let i = 0; i < starts.length; i += 1) {
		const chunk = html.slice(starts[i], starts[i + 1] ?? html.length);
		const slug = slugOf(CARD_TITLE_HREF.exec(chunk)?.[1]);
		if (!slug) continue;
		cards.push({ slug, time: readCardTime(CARD_PLACE_TIME.exec(chunk)) });
	}
	return cards;
}

export function parseListing(html: string): ParsedListing {
	const events: UpstreamEvent[] = [];
	const rejected: string[] = [];

	for (const match of html.matchAll(LD_BLOCK)) {
		const body = match[1];
		if (!body) continue;
		let parsed: unknown;
		try {
			parsed = JSON.parse(body);
		} catch {
			// One malformed block must not fail the run; a page can carry non-event blocks too.
			continue;
		}
		if (typeof parsed !== 'object' || parsed === null) continue;
		if (!('@type' in parsed) || parsed['@type'] !== 'Event') continue;

		const result = eventSchema.safeParse(parsed);
		if (result.success) {
			events.push(result.data);
		} else {
			rejected.push(result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join(', '));
		}
	}

	/*
	 * Paired by slug, taking the nth card of a slug for the nth block of it — not by position.
	 *
	 * Today each block sits directly after its own card, so position would work, but that is a
	 * fact about one template and the slug is a fact about the event. A shop that showed the same
	 * event twice (a "featured" strip above the list, say) would still pair each block with a card
	 * that prints the same event.
	 */
	const bySlug = new Map<string, (CardTime | null)[]>();
	for (const card of readCards(html)) {
		const list = bySlug.get(card.slug);
		if (list) list.push(card.time);
		else bySlug.set(card.slug, [card.time]);
	}

	const taken = new Map<string, number>();
	const listings = events.map((event): Listing => {
		const slug = slugOf(event.url);
		if (!slug) return { event, slug: null, card: null };
		const nth = taken.get(slug) ?? 0;
		taken.set(slug, nth + 1);
		return { event, slug, card: bySlug.get(slug)?.[nth] ?? null };
	});

	return { listings, rejected };
}

export type FetchListing = (shop: TicketcoShop) => Promise<string>;

export const fetchListing: FetchListing = async (shop) => {
	const url = listingUrl(shop);
	const response = await fetch(url, {
		headers: {
			// Identifying, with a contact URL, as docs/event-sources.md asks of every importer.
			'user-agent': 'hendingar.no importer (+https://hendingar.no)',
			accept: 'text/html'
		},
		/*
		 * A redirect fails the run naming it, rather than being followed to a page — a queue, a
		 * login, a moved shop — that would parse into zero events and look like a quiet week.
		 */
		redirect: 'error',
		signal: AbortSignal.timeout(30_000)
	});
	if (!response.ok) throw new Error(`${url} responded ${response.status}`);
	return response.text();
};
