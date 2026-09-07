import { z } from 'zod';
import type { MecInstance } from './instances.ts';

/**
 * Reading a Modern Events Calendar page.
 *
 * MEC renders no machine-readable date anywhere in its markup — no `datetime` attribute, no
 * microdata, and the WordPress REST API exposes the *post* date rather than the occurrence, with
 * `meta` empty. The only structured dates on the page are the `application/ld+json` blocks, so
 * those are what we parse. `/wp-json/wp/v2/mec-events` is not usable for this.
 *
 * **But the JSON-LD is not the whole story for the clock.** MEC's `startDate` cannot be trusted as
 * an instant — see the note above `readStamp` in `map.ts` — so the times MEC *prints on the card*
 * are read too, out of `.mec-start-time` / `.mec-end-time`, and paired with the JSON-LD block for
 * the same occurrence. That pairing is why this file returns `occurrences` rather than a bare list
 * of events: the times and the structured fields for one occurrence arrive from two different
 * places in the document and only mean anything together.
 *
 * Parsing is split from fetching: `parseListing` is pure, so the tests run against committed HTML
 * and never touch the network (CLAUDE.md rule 6).
 */

/** Only the fields we use. Unknown keys are ignored — MEC emits plenty we do not need. */
const placeSchema = z.object({ name: z.string().nullish() }).nullish();

const eventSchema = z.object({
	'@type': z.literal('Event'),
	name: z.string(),
	startDate: z.string(),
	endDate: z.string().nullish(),
	url: z.string().nullish(),
	description: z.string().nullish(),
	image: z.string().nullish(),
	location: placeSchema,
	offers: z.object({ url: z.string().nullish() }).nullish()
});

export type UpstreamEvent = z.infer<typeof eventSchema>;

/**
 * The wall clock MEC prints on an occurrence's card, in the site's own timezone.
 *
 * `HH:MM`, or null where the page shows none — a permanent exhibition prints no clock at all, and
 * plenty of events state a start without an end.
 */
export type CardTimes = { start: string | null; end: string | null };

/**
 * One occurrence: its JSON-LD block, the post it came from, and the clock the page prints for it.
 *
 * All three are needed to place an event in time, and none of them is sufficient on its own. See
 * the note above `readStamp` in `map.ts` for why the printed clock has to be consulted at all.
 */
export type Occurrence = {
	event: UpstreamEvent;
	/**
	 * MEC's post id, read from the `data-event-id` attribute on the card's link.
	 *
	 * The id matters because MEC repeats one post across its occurrences: five posts produced the
	 * twelve events on the page this was written against. A per-occurrence identity therefore has
	 * to combine the post id with the day, and the slug alone is not that identity.
	 */
	postId: string | null;
	card: CardTimes | null;
};

export type ParsedListing = {
	occurrences: Occurrence[];
	/** Blocks that looked like events but did not validate, kept so a run can report them. */
	rejected: string[];
};

const LD_BLOCK = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
const EVENT_ID_LINK = /data-event-id="(\d+)"\s+href="([^"]+)"/g;

const ARTICLE = /<article[^>]*class="[^"]*mec-event-article[^"]*"[\s\S]*?<\/article>/g;
const CARD_POST_ID = /data-event-id="(\d+)"/;
const CARD_START = /class="mec-start-time">([^<]*)</;
const CARD_END = /class="mec-end-time">([^<]*)</;

/**
 * `9:30` and `09:30`, and nothing else.
 *
 * A guard rather than a parser. MEC prints the clock in the site's WordPress locale, so an
 * English-configured instance would render "4:00 pm" — a wall clock we could in principle read,
 * but a half-understood "4:00" would put an evening concert in the morning. Anything that does not
 * match is treated as no card time at all, which falls back to the JSON-LD rather than to a guess.
 */
const CLOCK = /^(\d{1,2}):(\d{2})$/;

function normaliseUrl(value: string): string {
	// Trailing slashes differ between the JSON-LD `url` and the card's href on some themes.
	return value.trim().replace(/\/+$/, '');
}

/** A card's printed clock, normalised to `HH:MM`, or null if it is not one. */
function readClock(raw: string | undefined): string | null {
	const match = CLOCK.exec((raw ?? '').trim());
	if (!match) return null;
	const hour = Number(match[1]);
	if (hour > 23 || Number(match[2]) > 59) return null;
	return `${String(hour).padStart(2, '0')}:${match[2]}`;
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
			// A malformed block is not automatically a problem: pages carry WebSite and
			// Organization blocks too, and one bad one must not fail the run.
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

	const idByUrl = new Map<string, string>();
	for (const [, id, href] of html.matchAll(EVENT_ID_LINK)) {
		if (id && href) idByUrl.set(normaliseUrl(href), id);
	}

	return { occurrences: pairWithCards(events, idByUrl, readCards(html)), rejected };
}

/** Every occurrence card on the page, in document order. */
function readCards(html: string): { postId: string; times: CardTimes }[] {
	const cards: { postId: string; times: CardTimes }[] = [];
	for (const [article] of html.matchAll(ARTICLE)) {
		const postId = CARD_POST_ID.exec(article)?.[1];
		if (!postId) continue;
		cards.push({
			postId,
			times: {
				start: readClock(CARD_START.exec(article)?.[1]),
				end: readClock(CARD_END.exec(article)?.[1])
			}
		});
	}
	return cards;
}

/**
 * Match each JSON-LD block to the card that renders the same occurrence.
 *
 * Not by position in the document: the two skins in use here disagree about that. Bømlo
 * folkebibliotek prints all twelve cards and then all twelve JSON-LD blocks, while Moster Amfi and
 * Sunnhordland museum emit each block immediately before its own card. Index-into-the-page would
 * work on one and be off by everything on the others.
 *
 * So the pairing is by post id, taking the *nth* card of a post for the nth block of that post.
 * Both lists come out of one template loop, so both are in the venue's own listing order — which
 * is what makes the nth of each the same occurrence. Verified against all three live sites: the
 * library's weekly Pokémontreff appears three times under one post id and pairs to the three cards
 * that print 16:00, in order.
 *
 * Nothing here parses the date off the card, deliberately. The skins do not agree on that either —
 * one prints "7. september 2026", one prints a bare "08" over "september", one prints no date at
 * all — and every one of those spellings depends on the site's WordPress locale. The day comes
 * from the JSON-LD, which is machine-readable and, unlike the clock, correct.
 */
function pairWithCards(
	events: UpstreamEvent[],
	idByUrl: Map<string, string>,
	cards: { postId: string; times: CardTimes }[]
): Occurrence[] {
	const byPost = new Map<string, CardTimes[]>();
	for (const card of cards) {
		const list = byPost.get(card.postId);
		if (list) list.push(card.times);
		else byPost.set(card.postId, [card.times]);
	}

	const taken = new Map<string, number>();
	return events.map((event) => {
		const postId = postIdOf(idByUrl, event.url);
		if (!postId) return { event, postId: null, card: null };
		const nth = taken.get(postId) ?? 0;
		taken.set(postId, nth + 1);
		return { event, postId, card: byPost.get(postId)?.[nth] ?? null };
	});
}

function postIdOf(idByUrl: Map<string, string>, url: string | null | undefined): string | null {
	if (!url) return null;
	return idByUrl.get(normaliseUrl(url)) ?? null;
}

export type FetchListing = (instance: MecInstance) => Promise<string>;

export const fetchListing: FetchListing = async (instance) => {
	const response = await fetch(instance.endpoint, {
		headers: {
			// Identifying, with a contact URL, as docs/event-sources.md asks of every importer.
			'user-agent': 'hendingar.no importer (+https://hendingar.no)',
			accept: 'text/html'
		},
		signal: AbortSignal.timeout(30_000)
	});
	if (!response.ok) {
		throw new Error(`${instance.endpoint} responded ${response.status}`);
	}
	return response.text();
};
