/**
 * The listing's filters, as they live in the address bar.
 *
 * `/hendingar` has one control now — a field you type into, that offers you places, kinds,
 * calendars and events — but the thing it produces is still a URL, and that has not changed and
 * must not: a filtered view has to be shareable, back-buttonable and server-rendered, and it has
 * to keep working with JavaScript off. The field is an enhancement on top of a GET form; every
 * token in it is a link.
 *
 * So this module is the one place that knows how a set of filters becomes an address and back.
 * Pure, and unit-tested, because it is the piece three surfaces have to agree on: the page that
 * reads the URL, the tokens that remove one filter and keep the rest, and the suggestions that add
 * one.
 */

import type { CategorySlug } from '@hendingar/core/taxonomy';

/**
 * The four axes, and the query-string key each one owns.
 *
 * Nynorsk keys, like the rest of the site's URLs (`kategori`, `kjelde` are already public). `q` is
 * the exception and stays `q`: it is the one parameter a person types by hand or recognises from
 * every other search box on the web.
 */
export type ListingFilters = {
	/** Free text over title, description, venue and organiser. */
	q?: string;
	kategori?: CategorySlug;
	/** A source slug, or the reserved `innsendt`. */
	kjelde?: string;
	/** One venue, by name. */
	stad?: string;
};

/** Stable order, so the same filters always produce the same URL — and the same cache entry. */
export const FILTER_KEYS = ['q', 'kategori', 'kjelde', 'stad'] as const;

export type FilterKey = (typeof FILTER_KEYS)[number];

/**
 * Read the filters out of a URL.
 *
 * Typed by what it uses rather than as `URLSearchParams`, because SvelteKit hands the page a
 * `ReadonlyURLSearchParams` — which is the same thing minus the four mutating methods, and this
 * only ever reads.
 *
 * Nothing is validated here beyond emptiness: `kategori` is checked against the taxonomy and
 * `kjelde` against the sources that exist by the caller, which is where that knowledge lives. An
 * unknown value has always shown everything rather than erroring, and that stays true.
 */
type ReadableParams = { get(name: string): string | null };

export function filtersFromParams(params: ReadableParams): ListingFilters {
	const filters: ListingFilters = {};
	for (const key of FILTER_KEYS) {
		const raw = params.get(key)?.trim();
		if (raw) filters[key] = raw as never;
	}
	return filters;
}

/** A copy with one axis set, or — for `null` — removed. Never mutates its input. */
export function withFilter(
	filters: ListingFilters,
	key: FilterKey,
	value: string | null
): ListingFilters {
	const next: ListingFilters = { ...filters };
	if (value === null || value.trim() === '') delete next[key];
	else next[key] = value.trim() as never;
	return next;
}

/**
 * The address for a set of filters.
 *
 * Built by hand rather than with `URLSearchParams`, for the reason the page already recorded when
 * it had two filters: `svelte/prefer-svelte-reactivity` rightly bans a mutable instance of it in a
 * component, and the reactive variant is heavier machinery than four known keys deserve. The
 * encoding is not optional though — a venue is `Stord kulturhus`, with a space, and `q` can hold
 * anything somebody types.
 */
export function listingHref(filters: ListingFilters): string {
	const parts: string[] = [];
	for (const key of FILTER_KEYS) {
		const value = filters[key];
		if (value) parts.push(`${key}=${encodeURIComponent(value)}`);
	}
	return parts.length ? `/hendingar?${parts.join('&')}` : '/hendingar';
}

/** True when nothing is filtered — the plain listing. */
export function isUnfiltered(filters: ListingFilters): boolean {
	return FILTER_KEYS.every((key) => !filters[key]);
}

/**
 * One filter, as the field shows it: what it says, and where removing it goes.
 *
 * The label is not the value. A category token says "Musikk", not `musikk`; a source token says
 * "Stord kulturhus", not `stord-kulturhus`. The caller supplies those two lookups because both
 * live elsewhere — the taxonomy and the sources table — and neither belongs in a URL module.
 */
export type FilterToken = {
	key: FilterKey;
	/** What kind of thing this is, for the small print inside the token. */
	kind: string;
	label: string;
	/** The same filters, minus this one. */
	removeHref: string;
};

export function filterTokens(
	filters: ListingFilters,
	labels: { category: (slug: string) => string; source: (slug: string) => string }
): FilterToken[] {
	const tokens: FilterToken[] = [];
	// Not FILTER_KEYS order: the tokens read left to right as a sentence, and the kind of thing
	// comes before where it is, which comes before whose calendar it is on.
	if (filters.kategori) {
		tokens.push({
			key: 'kategori',
			kind: 'Kategori',
			label: labels.category(filters.kategori),
			removeHref: listingHref(withFilter(filters, 'kategori', null))
		});
	}
	if (filters.stad) {
		tokens.push({
			key: 'stad',
			kind: 'Stad',
			label: filters.stad,
			removeHref: listingHref(withFilter(filters, 'stad', null))
		});
	}
	if (filters.kjelde) {
		tokens.push({
			key: 'kjelde',
			kind: 'Kjelde',
			label: labels.source(filters.kjelde),
			removeHref: listingHref(withFilter(filters, 'kjelde', null))
		});
	}
	return tokens;
}

/**
 * Everything except the free text, as hidden form fields.
 *
 * This is what makes the no-JavaScript path keep its tokens: the field is a GET form whose only
 * visible input is `q`, so without these, submitting a search from a page filtered to "Musikk"
 * would silently drop the category. The visible input owns `q`, so `q` is never in here.
 */
export function hiddenFilterFields(filters: ListingFilters): { name: FilterKey; value: string }[] {
	return FILTER_KEYS.filter((key) => key !== 'q' && filters[key]).map((key) => ({
		name: key,
		value: filters[key] as string
	}));
}
