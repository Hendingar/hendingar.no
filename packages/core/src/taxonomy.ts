/**
 * The event taxonomy — defined here and NOWHERE ELSE.
 *
 * The Postgres enum in schema.ts and the Zod enum in validation.ts are both derived from
 * CATEGORY_SLUGS. Adding a category means adding it here; TypeScript then *forces* you to add a
 * label, because CATEGORY_LABELS is an exhaustive Record. There is no list to forget to update
 * (see CLAUDE.md rule 1).
 *
 * Labels are Norwegian (nynorsk) — that is what our sources and our pilot region use.
 */
export const CATEGORY_SLUGS = [
	'musikk',
	'teater',
	'utstilling',
	'sport',
	'mote',
	'kyrkjeliv',
	'festival',
	'litteratur',
	'stand-up',
	'show',
	'mat-og-drikke',
	'dans',
	'marknad',
	'konferanse',
	'kurs',
	'anna'
] as const;

export type CategorySlug = (typeof CATEGORY_SLUGS)[number];

/** Exhaustive by construction: a missing entry is a compile error, not a runtime surprise. */
export const CATEGORY_LABELS: Record<CategorySlug, string> = {
	musikk: 'Musikk',
	teater: 'Teater',
	utstilling: 'Utstilling',
	sport: 'Sport',
	mote: 'Møte',
	kyrkjeliv: 'Kyrkjeliv',
	festival: 'Festival',
	litteratur: 'Litteratur',
	'stand-up': 'Stand-up',
	show: 'Show',
	'mat-og-drikke': 'Mat og drikke',
	dans: 'Dans',
	marknad: 'Marknad/shopping',
	konferanse: 'Konferanse',
	kurs: 'Kurs',
	anna: 'Anna'
};

export function categoryLabel(slug: CategorySlug): string {
	return CATEGORY_LABELS[slug];
}

export const CATEGORIES: ReadonlyArray<{ slug: CategorySlug; label: string }> = CATEGORY_SLUGS.map(
	(slug) => ({ slug, label: CATEGORY_LABELS[slug] })
);
