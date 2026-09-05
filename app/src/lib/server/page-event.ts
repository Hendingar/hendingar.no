import { DEFAULT_TIME_ZONE, instantToZonedWallClock } from '@hendingar/core/datetime';
import type { ExtractedEvent } from '@hendingar/core/validation';

/**
 * Reading an event out of a page, without asking a model.
 *
 * Most Norwegian event sites already publish the thing we want, in a format designed for exactly
 * this: schema.org, as JSON-LD or as microdata. WordPress with Modern Events Calendar emits it,
 * Hageselskapet's CMS emits it, most ticketing platforms emit it. Where it is present it is better
 * than anything a model could read off the rendered page, because it is what the site itself
 * asserts rather than an interpretation of its layout — and it costs nothing and cannot hallucinate.
 *
 * So this runs first, and the model is a fallback for pages that carry no structured data at all.
 *
 * Deliberately hand-written rather than a DOM library. What is needed is four fields out of one
 * `<script>` tag or a handful of `itemprop` attributes; a parser dependency would be more code,
 * more supply chain, and no more correct for this.
 */

/** Nothing here is trusted to be well-formed. Every reader returns null rather than throwing. */
type Json = Record<string, unknown>;

function asString(value: unknown): string | null {
	if (typeof value === 'string') {
		const trimmed = value.trim();
		return trimmed === '' ? null : trimmed;
	}
	// schema.org allows a bare string or an object with a name — both are common in the wild.
	if (value && typeof value === 'object' && 'name' in value) {
		return asString((value as Json).name);
	}
	return null;
}

/**
 * A schema.org date-time, as the local wall clock the page means.
 *
 * Three shapes turn up, and they are not the same question:
 *
 * - `2026-09-07T18:00:00+02:00` — an instant. Converted to the pilot zone, because 16:00Z and
 *   18:00+02:00 are the same moment and the second is what a reader in Stord should see.
 * - `2026-09-18T18:00` — no offset, so it is already a wall clock. Taken literally; guessing an
 *   offset for it would move the event by an hour for no reason.
 * - `2026-10-06` — a date with no time at all.
 */
export function readSchemaDateTime(value: unknown): { date: string; time: string | null } | null {
	const text = asString(value);
	if (!text) return null;

	const dateOnly = /^(\d{4}-\d{2}-\d{2})$/.exec(text);
	if (dateOnly?.[1]) return { date: dateOnly[1], time: null };

	const local = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?$/.exec(text);
	if (local?.[1] && local[2] && local[3]) {
		return { date: local[1], time: `${local[2]}:${local[3]}` };
	}

	const zoned = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})$/.test(text);
	if (!zoned) return null;
	const instant = new Date(text);
	if (Number.isNaN(instant.getTime())) return null;
	const wall = instantToZonedWallClock(instant, DEFAULT_TIME_ZONE);
	return { date: wall.date, time: wall.time };
}

/** Every JSON-LD payload in the document, flattened through `@graph` and top-level arrays. */
function jsonLdNodes(html: string): Json[] {
	const nodes: Json[] = [];
	const pattern = /<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;

	for (const match of html.matchAll(pattern)) {
		const raw = match[1];
		if (!raw) continue;
		let parsed: unknown;
		try {
			parsed = JSON.parse(raw);
		} catch {
			// One malformed block must not hide the valid ones further down the page.
			continue;
		}
		const queue: unknown[] = [parsed];
		while (queue.length > 0) {
			const item = queue.pop();
			if (Array.isArray(item)) {
				queue.push(...item);
			} else if (item && typeof item === 'object') {
				const node = item as Json;
				nodes.push(node);
				if (Array.isArray(node['@graph'])) queue.push(...node['@graph']);
			}
		}
	}
	return nodes;
}

/** `@type` may be a string or a list; a node is an Event if any of them says so. */
function isEventNode(node: Json): boolean {
	const type = node['@type'];
	const types = Array.isArray(type) ? type : [type];
	return types.some(
		(value) => typeof value === 'string' && /(^|\/)(Event|[A-Za-z]+Event)$/.test(value)
	);
}

function decodeEntities(value: string): string {
	const named: Record<string, string> = {
		amp: '&',
		lt: '<',
		gt: '>',
		quot: '"',
		apos: "'",
		nbsp: ' '
	};
	return value.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (match, body: string) => {
		if (body.startsWith('#')) {
			const code =
				body[1] === 'x' || body[1] === 'X'
					? Number.parseInt(body.slice(2), 16)
					: Number.parseInt(body.slice(1), 10);
			return Number.isFinite(code) && code > 0 && code <= 0x10ffff
				? String.fromCodePoint(code)
				: match;
		}
		return named[body.toLowerCase()] ?? match;
	});
}

function stripTags(value: string): string {
	return decodeEntities(value.replace(/<[^>]*>/g, ' '))
		.replace(/\s+/g, ' ')
		.trim();
}

/**
 * The first `itemprop` of a given name, as text or as the attribute schema.org puts it in.
 *
 * `<time datetime="…">` and `<meta content="…">` carry the machine value in an attribute; anything
 * else carries it as text. Reading the attribute first is what makes a `<time>` element usable.
 */
function microdataValue(fragment: string, prop: string): string | null {
	/*
	 * The whole opening tag, not the part after `itemprop`.
	 *
	 * Attribute order is not guaranteed and real markup exercises that: Hageselskapet writes
	 * `<time datetime="…" itemprop="startDate">`, so a pattern that only looks to the right of
	 * `itemprop` never sees the value and every date came back null.
	 */
	const pattern = new RegExp(`<([a-z0-9]+)\\b([^>]*itemprop=["']${prop}["'][^>]*)>`, 'i');
	const match = pattern.exec(fragment);
	if (!match) return null;

	const attributes = match[2] ?? '';
	for (const attribute of ['datetime', 'content', 'href', 'src']) {
		const found = new RegExp(`\\b${attribute}=["']([^"']*)["']`, 'i').exec(attributes);
		if (found?.[1]) return decodeEntities(found[1].trim());
	}

	// Otherwise the text between this tag and its close — good enough for a name or a place.
	const after = fragment.slice(match.index + match[0].length);
	const close = new RegExp(`</${match[1]}>`, 'i').exec(after);
	return close ? stripTags(after.slice(0, close.index)) || null : null;
}

/** An `<meta property="og:…">` value, for pages that have nothing better. */
function openGraph(html: string, property: string): string | null {
	const pattern = new RegExp(
		`<meta\\b[^>]*(?:property|name)=["']${property}["'][^>]*content=["']([^"']*)["']`,
		'i'
	);
	const match = pattern.exec(html);
	if (match?.[1]) return decodeEntities(match[1].trim()) || null;

	// Attribute order is not guaranteed, so try the other way round before giving up.
	const reversed = new RegExp(
		`<meta\\b[^>]*content=["']([^"']*)["'][^>]*(?:property|name)=["']${property}["']`,
		'i'
	);
	const other = reversed.exec(html);
	return other?.[1] ? decodeEntities(other[1].trim()) || null : null;
}

/** Where the fields came from, so the form can say so and /datasamling can count honestly. */
export type PageExtractionSource = 'json-ld' | 'microdata' | 'opengraph' | 'none';

export type PageExtraction = {
	source: PageExtractionSource;
	event: ExtractedEvent;
	/** The page text, for the model fallback when nothing structured was found. */
	text: string;
};

function emptyEvent(): ExtractedEvent {
	return {
		title: null,
		description: null,
		// Never guessed. schema.org's event types do not map onto our taxonomy, and a wrong
		// category chosen for somebody is worse than an empty select they have to look at.
		category: null,
		date: null,
		startTime: null,
		endTime: null,
		recurrence: null,
		venueName: null,
		municipality: null,
		organizerName: null,
		ticketUrl: null,
		confidence: 0,
		unreadable: [],
		dates: [],
		note: ''
	};
}

function fromJsonLd(html: string): ExtractedEvent | null {
	const node = jsonLdNodes(html).find(isEventNode);
	if (!node) return null;

	const start = readSchemaDateTime(node.startDate);
	const end = readSchemaDateTime(node.endDate);
	const location = (node.location ?? {}) as Json;
	const address = (location.address ?? {}) as Json;
	const offers = (Array.isArray(node.offers) ? node.offers[0] : node.offers) as Json | undefined;

	return {
		...emptyEvent(),
		title: asString(node.name),
		description: asString(node.description),
		date: start?.date ?? null,
		startTime: start?.time ?? null,
		// Only when it is the same day. A multi-day festival's end time is not this form's field.
		endTime: end && start && end.date === start.date ? end.time : null,
		venueName: asString(location.name),
		municipality: asString(address.addressLocality),
		organizerName: asString(node.organizer),
		ticketUrl: asString(offers?.url) ?? asString(node.url),
		confidence: 100,
		note: 'Lese frå strukturerte data på sida (JSON-LD).'
	};
}

function fromMicrodata(html: string): ExtractedEvent | null {
	/*
	 * The first Event block, from its itemtype to the end of the document.
	 *
	 * Slicing to the *next* Event rather than to a matching close tag: finding the real close
	 * requires counting nested tags of the same name, and every field we want sits in the first
	 * few hundred bytes of the block anyway.
	 */
	const opener = /itemtype=["']https?:\/\/schema\.org\/[A-Za-z]*Event["']/i.exec(html);
	if (!opener) return null;

	const rest = html.slice(opener.index);
	const next = /itemtype=["']https?:\/\/schema\.org\/[A-Za-z]*Event["']/i.exec(rest.slice(1));
	const block = next ? rest.slice(0, next.index + 1) : rest;

	const start = readSchemaDateTime(microdataValue(block, 'startDate'));
	const end = readSchemaDateTime(microdataValue(block, 'endDate'));
	const name = microdataValue(block, 'name');
	if (!name && !start) return null;

	return {
		...emptyEvent(),
		title: name,
		description: microdataValue(block, 'description'),
		date: start?.date ?? null,
		startTime: start?.time ?? null,
		endTime: end && start && end.date === start.date ? end.time : null,
		/*
		 * `location` is a nested Place whose own `name` sits inside it. Reading `name` from the
		 * whole block would find the event's title first, so the location is sliced out on its own.
		 */
		venueName: (() => {
			const place = /itemprop=["']location["'][\s\S]{0,2000}/i.exec(block);
			return place ? microdataValue(place[0], 'name') : null;
		})(),
		municipality: (() => {
			const place = /itemprop=["']address["'][\s\S]{0,2000}/i.exec(block);
			return place ? microdataValue(place[0], 'addressLocality') : null;
		})(),
		confidence: 100,
		note: 'Lese frå strukturerte data på sida (microdata).'
	};
}

/** Title and description only. Enough to save typing, and honest about being no more than that. */
function fromOpenGraph(html: string): ExtractedEvent | null {
	const title = openGraph(html, 'og:title') ?? readTitleTag(html);
	if (!title) return null;
	return {
		...emptyEvent(),
		title,
		description: openGraph(html, 'og:description') ?? openGraph(html, 'description'),
		confidence: 25,
		unreadable: ['dato', 'klokkeslett', 'stad'],
		note: 'Sida hadde ingen strukturerte data. Berre tittelen er henta — fyll inn resten sjølv.'
	};
}

function readTitleTag(html: string): string | null {
	const match = /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(html);
	return match?.[1] ? stripTags(match[1]) || null : null;
}

/**
 * Everything the page says, as plain text, for the model to read when nothing else worked.
 *
 * Scripts and styles removed first — a page is mostly JavaScript by weight, and none of it is the
 * event.
 */
export function pageText(html: string, limit = 12_000): string {
	const body = html
		.replace(/<(script|style|noscript|svg)\b[\s\S]*?<\/\1>/gi, ' ')
		.replace(/<!--[\s\S]*?-->/g, ' ');
	return stripTags(body).slice(0, limit);
}

/**
 * Read an event out of a page, best source first.
 *
 * Always returns something. A page with nothing on it produces an empty event and `source: 'none'`,
 * which is the signal to try the model — not an error, because "this page has no structured data"
 * is an ordinary fact about most of the web.
 */
export function extractEventFromPage(html: string): PageExtraction {
	const text = pageText(html);

	const jsonLd = fromJsonLd(html);
	if (jsonLd) return { source: 'json-ld', event: jsonLd, text };

	const microdata = fromMicrodata(html);
	if (microdata) return { source: 'microdata', event: microdata, text };

	const og = fromOpenGraph(html);
	if (og) return { source: 'opengraph', event: og, text };

	return { source: 'none', event: emptyEvent(), text };
}
