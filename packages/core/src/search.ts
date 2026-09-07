/**
 * What a search box sends, and what the database is asked to match.
 *
 * Here rather than in the app because it is a wire type: the listing sends it, the suggestion
 * query receives it, and the route reads the same shape out of the address bar. A second copy of
 * the rules in `app/` is how the URL and the query start disagreeing about what a search is.
 *
 * **Substring matching, not full-text.** Postgres has a `norwegian` text-search configuration and
 * we are not using it, which is a decision worth the paragraph:
 *
 * - Measured on the real corpus: 787 rows, an `ilike` across title, description, venue and
 *   organiser, joined and ordered, executes in **3ms** on a cold plan with no index at all. Full
 *   text search would need a generated column, a GIN index and a migration to save two of those
 *   milliseconds today.
 * - Substring is what a reader means. `konsert` finds `konsertar` and `sommarkonsert`; a stemmer
 *   finds the first and misses the second, because it is a different word to a stemmer and the
 *   same word to a person looking for something to do.
 * - Norwegian compounds make prefix search unusually valuable, and `to_tsquery` only gives it for
 *   the last token of a query.
 *
 * The trigger for revisiting is a number, not a feeling: when `events` passes roughly 10 000 rows
 * the scan is ~40ms and worth an index, and the shape to reach for is a generated `tsvector`
 * column plus GIN — additive, per ADR 0010.
 */

import { z } from 'zod';

/**
 * Long enough for "julekonsert i bremnes kyrkje", short enough that nobody pastes an essay.
 * The cap is on the whole query; individual tokens are capped by it too.
 */
export const SEARCH_MAX_LENGTH = 80;

/** More than this and the reader is not searching, they are pasting. Extra tokens are dropped. */
export const SEARCH_MAX_TOKENS = 6;

/**
 * The query as it travels: trimmed, capped, and never null-vs-empty-string ambiguous.
 *
 * Whitespace collapses so that `"jazz    stord"` and `"jazz stord"` are one query rather than two
 * cache entries, and so the token split below cannot produce empty tokens.
 */
export const searchTermSchema = z
	.string()
	.max(SEARCH_MAX_LENGTH * 2, 'search term is too long')
	.transform((raw) => raw.replace(/\s+/g, ' ').trim().slice(0, SEARCH_MAX_LENGTH));

/**
 * Split a query into the words that must ALL match.
 *
 * Every token has to appear somewhere in the row — title, description, venue or organiser — but
 * not necessarily in the same field. That is what makes "jazz stord" work: the word the reader
 * knows about the event and the word they know about the place are rarely in the same column, and
 * requiring them to be would make the two-word search that feels most natural return nothing.
 */
export function searchTokens(term: string): string[] {
	return term
		.replace(/\s+/g, ' ')
		.trim()
		.slice(0, SEARCH_MAX_LENGTH)
		.split(' ')
		.filter((token) => token.length > 0)
		.slice(0, SEARCH_MAX_TOKENS);
}

/**
 * One token as an `ILIKE` pattern.
 *
 * The three escapes are not optional. `%` and `_` are wildcards to `LIKE`, so a reader searching
 * for `50%` or `a_b` would otherwise get a query that means something else entirely — and `%`
 * alone would match every row, which reads as "search is broken" rather than as "no results".
 * The backslash goes first, or it would escape the escapes.
 *
 * This is about MEANING, not safety: the value is bound as a parameter either way, and nothing
 * here is ever concatenated into SQL.
 */
export function likePattern(token: string): string {
	const escaped = token.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
	return `%${escaped}%`;
}

/**
 * The query with its first word removed.
 *
 * What happens when a suggestion is accepted. Suggestions are matched on the first token — typing
 * "bremnes jul" offers the venue Bremnes kyrkje — so choosing one has to consume the word that
 * produced it and leave the rest as the query: the reader ends up with a token for the place and
 * "jul" still in the field, which is what they were building. Leaving the whole query behind would
 * filter twice on the same word and show a token that duplicates text already on screen.
 */
export function dropFirstToken(term: string): string {
	return searchTokens(term).slice(1).join(' ');
}

/**
 * Is there anything here to search for?
 *
 * A single character is deliberately allowed: `å` is a word in Norwegian place names, and a
 * one-letter search that returns a hundred rows is a legitimate answer to a legitimate question.
 * Only an empty query means "no search".
 */
export function hasSearch(term: string | undefined | null): term is string {
	return typeof term === 'string' && term.trim().length > 0;
}
