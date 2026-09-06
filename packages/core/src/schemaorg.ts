/**
 * Reading schema.org JSON-LD out of a page.
 *
 * Two places need exactly this and they are not allowed to know about each other: the submission
 * flow's `app/src/lib/server/page-event.ts`, which reads a pasted URL before it considers asking a
 * model, and `importers/allevents`, which reads an event's own page for the description its JSON
 * API does not carry. A third caller was about to write it a third time, so it lives here (CLAUDE.md
 * rule 1) — an importer must never import from `app/`, and `app/` must never import from an
 * importer.
 *
 * Deliberately hand-written rather than a DOM library. What is wanted is the contents of one
 * `<script type="application/ld+json">` tag; a parser dependency would be more code, more supply
 * chain, and no more correct for this.
 *
 * Nothing here is trusted to be well-formed. Every function returns a value rather than throwing.
 */

/** One JSON-LD node, unvalidated. Callers narrow it themselves — usually with Zod. */
export type JsonLdNode = Record<string, unknown>;

const LD_BLOCK = /<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;

/** A narrowing predicate rather than a cast, because CLAUDE.md rule 4 means it here too. */
function isObjectNode(value: unknown): value is JsonLdNode {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Every JSON-LD payload in the document, flattened through `@graph` and top-level arrays.
 *
 * Flattening matters: allevents.in puts eight events in one top-level array on an organiser page,
 * and WordPress sites routinely wrap everything in a single `@graph`. A reader that only looked at
 * the top-level object would find one node and miss the rest.
 */
export function jsonLdNodes(html: string): JsonLdNode[] {
	const nodes: JsonLdNode[] = [];

	for (const match of html.matchAll(LD_BLOCK)) {
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
			} else if (isObjectNode(item)) {
				nodes.push(item);
				if (Array.isArray(item['@graph'])) queue.push(...item['@graph']);
			}
		}
	}
	return nodes;
}

/**
 * Whether a node describes an event.
 *
 * **`@type` is very often a subtype, and testing for the literal `"Event"` finds nothing.** The
 * same concert is `MusicEvent` on allevents.in's event page and a bare `Event` on its organiser
 * page; `TheaterEvent`, `SportsEvent`, `EducationEvent` and `ScreeningEvent` are all common in the
 * wild. This has already cost one afternoon, so the suffix match is the rule and every caller uses
 * it rather than its own comparison.
 *
 * `@type` may also be a list, and may be written as a full URL (`https://schema.org/MusicEvent`).
 */
export function isEventNode(node: JsonLdNode): boolean {
	const type = node['@type'];
	const types = Array.isArray(type) ? type : [type];
	return types.some(
		(value) => typeof value === 'string' && /(^|\/)(Event|[A-Za-z]+Event)$/.test(value)
	);
}
