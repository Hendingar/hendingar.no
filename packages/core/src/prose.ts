/**
 * Small pieces of Nynorsk prose that more than one sentence on the site is built from.
 *
 * Each of these was written out inline wherever a sentence needed it — the list joiner seven times
 * — which is how the same string ends up punctuated two ways on one page.
 */

/**
 * "a, b og c". Nynorsk puts no comma before the last item, and this string is shown, not logged.
 *
 * `eller` for a question ("Stord, Bømlo eller Fitjar?"). An empty list is an empty string, so a
 * caller with a fallback writes `listSentence(xs) || 'ingen'`.
 */
export function listSentence(items: readonly string[], conjunction: 'og' | 'eller' = 'og'): string {
	if (items.length <= 1) return items[0] ?? '';
	return `${items.slice(0, -1).join(', ')} ${conjunction} ${items[items.length - 1]}`;
}

/** The first letter upper-cased: a word that starts a line or a heading. */
export function capitalise(word: string): string {
	return word.charAt(0).toUpperCase() + word.slice(1);
}
