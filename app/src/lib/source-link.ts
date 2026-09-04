/**
 * Rendering somebody else's URL as a link.
 *
 * Two separate problems, and only one of them is cosmetic.
 *
 * The first is safety. `packages/core` now rejects any scheme but http and https, so nothing new
 * gets in — but every row written before that check existed was validated by a `z.url()` that
 * happily accepted `javascript:alert(1)`, and those rows are still in the database. A schema fixes
 * the future; it does not clean the past. So the scheme is checked again here, at the point the
 * value becomes an `href`, which is the only place that can be sure.
 *
 * The second is legibility. A raw `https://www.facebook.com/events/1234567890/?ref=newsfeed` as
 * link text is unreadable and wraps badly on a phone. The host is what tells a reader whether it is
 * worth a tap.
 */

/** Schemes a browser will not execute as script. Anything else never becomes an `href`. */
const SAFE_PROTOCOLS = new Set(['http:', 'https:']);

/**
 * The URL, if it is one we are willing to link to. Null otherwise — never a thrown error.
 *
 * A bad URL on one event must not take down the page that lists it, so this is a filter and not a
 * validator. The caller writes `{#if}` around it.
 */
export function safeHttpUrl(value: string | null | undefined): string | null {
	if (!value) return null;
	try {
		return SAFE_PROTOCOLS.has(new URL(value).protocol) ? value : null;
	} catch {
		return null;
	}
}

/**
 * What to show instead of the URL: the host, without the `www.` nobody reads.
 *
 * Falls back to the raw string rather than to nothing, on the principle that an unparseable link
 * the reader can see beats a link with no label at all.
 */
export function linkLabel(value: string): string {
	try {
		return new URL(value).hostname.replace(/^www\./, '');
	} catch {
		return value;
	}
}
