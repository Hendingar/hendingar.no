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

export type ParsedListing = {
	events: UpstreamEvent[];
	/**
	 * Event page URL → MEC post id, read from the `data-event-id` attribute on each card's link.
	 *
	 * The id matters because MEC repeats one post across its occurrences: five posts produced the
	 * twelve events on the page this was written against. A per-occurrence identity therefore has
	 * to combine the post id with the start instant, and the slug alone is not that identity.
	 */
	idByUrl: Map<string, string>;
	/** Blocks that looked like events but did not validate, kept so a run can report them. */
	rejected: string[];
};

const LD_BLOCK = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
const EVENT_ID_LINK = /data-event-id="(\d+)"\s+href="([^"]+)"/g;

function normaliseUrl(value: string): string {
	// Trailing slashes differ between the JSON-LD `url` and the card's href on some themes.
	return value.trim().replace(/\/+$/, '');
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

	return { events, idByUrl, rejected };
}

export function postIdFor(listing: ParsedListing, url: string | null | undefined): string | null {
	if (!url) return null;
	return listing.idByUrl.get(normaliseUrl(url)) ?? null;
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
