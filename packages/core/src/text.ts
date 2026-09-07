/**
 * Turning somebody else's markup into the text we actually store.
 *
 * We store descriptions as text, and most of our sources hand us editor HTML. When that markup is
 * not stripped it does not merely look untidy — it escapes into every machine-readable surface at
 * once. On the live site an event's `<meta name="description">` read
 * `&lt;strong&gt;Med historia om den siste heksebrenninga…`, which is what Google would have shown
 * as the snippet, and the same string was sitting in the page's JSON-LD `description` and in its
 * `.ics` DESCRIPTION.
 *
 * This began as `htmlToText` inside `importers/dnt`, the one importer that had noticed. It is here
 * now because every other source has the same problem and none of them may import from each other
 * (CLAUDE.md rule 1).
 *
 * Deliberately regex rather than a parser dependency. What is wanted is the words, not a document
 * tree, and a parser would be more supply chain for no more correctness at this job.
 */

const NAMED_ENTITIES: Record<string, string> = {
	nbsp: ' ',
	amp: '&',
	lt: '<',
	gt: '>',
	quot: '"',
	apos: "'",
	oslash: 'ø',
	Oslash: 'Ø',
	aring: 'å',
	Aring: 'Å',
	aelig: 'æ',
	AElig: 'Æ',
	hellip: '…',
	ndash: '–',
	mdash: '—',
	rsquo: '’',
	lsquo: '‘',
	ldquo: '“',
	rdquo: '”',
	/*
	 * The guillemets, which are **Norwegian's own quotation marks** — not an exotic character the
	 * way the rest of an HTML entity table is.
	 *
	 * Their absence published a Moster Amfi concert as `Viser, Historie og Humor &laquo;Frå
	 * Vestlandet til Amerika i 200 år&raquo;`, in the JSON-LD `name`, in the `<h1>`, and in the
	 * slug, which read `…-laquo-fraa-vestlandet-…`. Any named entity this table does not carry
	 * survives verbatim — the numeric branch below is generic, the named one is a list — so the
	 * failure mode is silent and looks like the source's own text.
	 */
	laquo: '«',
	raquo: '»'
};

/**
 * Entities in someone else's markup, decoded.
 *
 * Exported because five importers had their own copy of this function and their own
 * `NAMED_ENTITIES` table, and the tables had drifted: **none of the five carried `laquo`/`raquo`**,
 * which is how a Moster Amfi concert reached the live site as `…Humor &laquo;Frå Vestlandet…&raquo;`.
 * One table, one decoder — the same argument `plainText` records above, and CLAUDE.md rule 1.
 *
 * The numeric branch is generic; the named one is a list, so a gap in it fails silently and reads as
 * the source's own text. That is the failure mode to keep in mind when adding a source.
 *
 * `code <= 0x10ffff` is not defensive noise: `String.fromCodePoint` **throws a RangeError** above it,
 * and `plainText` runs at render time (`app/src/lib/jsonld.ts`, the `.ics` route, the event page), so
 * without the bound a description containing `&#1114112;` is an SSR crash reachable from text a
 * stranger typed into someone's calendar. The importers' local copies all had this bound; this one
 * did not. Rejecting the impossible rather than throwing: an out-of-range reference is a broken page,
 * and leaving the text as written is more honest than emitting U+FFFD.
 */
export function decodeEntities(value: string): string {
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
		return NAMED_ENTITIES[body] ?? match;
	});
}

/**
 * Tags out, line structure kept.
 *
 * The tag pattern requires a letter or a slash after the `<`, so arithmetic in a description —
 * "plass til 3 < 5 born" — is left alone. A bare `<[^>]+>` eats that, and it is the kind of thing
 * nobody notices until somebody's event listing has lost half a sentence.
 */
function strip(html: string): string {
	return html
		.replace(/<\s*(script|style)[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, '')
		.replace(/<\s*br\s*\/?\s*>/gi, '\n')
		.replace(/<\s*\/\s*(p|div|h[1-6]|li|tr|blockquote)\s*>/gi, '\n\n')
		.replace(/<\s*li[^>]*>/gi, '• ')
		.replace(/<\/?[a-zA-Z][^>]*>/g, '');
}

/**
 * Markup, or plain text that was never markup, in — words out.
 *
 * Block elements become blank lines rather than disappearing, because these descriptions carry the
 * practical detail ("Frå Fitjar Bedehus … klokka 10.00") and running three paragraphs into one line
 * is how that becomes unreadable. `<li>` keeps its bullet for the same reason.
 *
 * Safe to run on text that contains no markup at all, and safe to run twice: it collapses runs of
 * spaces and trims, and neither of those changes anything the second time. That matters because it
 * is applied both where an event is imported and where one is rendered — the second is the net
 * under the first, for the rows that were written before the first existed.
 */
export function plainText(html: string | null | undefined): string | null {
	if (!html) return null;

	/*
	 * Twice, and this is not belt-and-braces.
	 *
	 * Some sources hand us markup as tags (`<strong>`), others hand us the same markup entity-
	 * encoded inside a JSON string (`&lt;strong&gt;`). Stripping before decoding leaves the second
	 * kind untouched; decoding before stripping would turn a reader's literal "&lt;" into the start
	 * of something that looks like a tag. So: strip what is already markup, decode, then strip
	 * whatever the decode just revealed.
	 */
	const text = strip(decodeEntities(strip(html)))
		// Collapse runs of spaces but keep the line structure the block tags just created.
		.replace(/[^\S\n]+/g, ' ')
		.replace(/ ?\n ?/g, '\n')
		.replace(/\n{3,}/g, '\n\n')
		.trim();
	return text || null;
}
