/**
 * The Riksteatret venues we import from.
 *
 * Riksteatret is the national touring theatre: one repertoire, played in a hall in ~79 towns, and
 * every one of those halls gets the same `/spillested/<stad>/` page rendered by the same template.
 * So this is a platform importer with the venues as data, the same argument as `importers/mec` and
 * `importers/bakhagen`: adding Stord should be an entry in this list, not a new package. The tests
 * parse a committed Stord page for exactly that reason, without shipping it as a source.
 *
 * How to tell a Riksteatret venue page: a `<section class="section section--program">` headed
 * "ALLE FORESTILLINGER I <stad>", a `<ul class="nav-program">` of `<li class="nav-program__item">`
 * cards, and an `<div class="item__date" datetime="DD.MM.YYYY HH:MM">` on each one.
 */
export type RiksteatretInstance = {
	/**
	 * Our `sources.slug`, always `riksteatret-<stad>`.
	 *
	 * The prefix is load-bearing: /kjelder groups a platform's sources by slug prefix
	 * (`platformOf` in packages/core/src/directory.ts), so every venue here folds under one
	 * "Riksteatret" heading and adding the next hall needs no edit to that page.
	 *
	 * `riksteatret-bomlo` is deliberately the slug this source already had in `LINKED_SOURCES`,
	 * where it sat as a `kind: 'link'` row we pointed at but did not collect. Upserting the same
	 * slug graduates that row in place; a new one would leave a duplicate on /datasamling and
	 * orphan nothing but confuse everything.
	 */
	slug: string;
	name: string;
	/** The human-facing page, for attribution links. Here it is also the page we parse. */
	url: string;
	region: string;
	attribution: string;
	timezone: string;
	/**
	 * Used when a card names no place. Every card seen names the hall in `.item__descr p span`,
	 * but a card that did not would otherwise arrive with no place at all — and a Riksteatret
	 * performance always has one, because the venue is what the page is about.
	 */
	venueFallback: string;
	scheduleCron: string;
	/**
	 * The site's own icon, hotlinked, so a tile and a source row carry its mark.
	 *
	 * Read from `<link rel="apple-touch-icon">` in the page head and fetched to confirm it
	 * resolves. This is the same URL the `LINKED_SOURCES` row already carried.
	 */
	iconUrl: string | null;
	/**
	 * Riksteatret's own programme, published by the theatre that performs it, so imports publish
	 * directly rather than landing as `pending`. See the `trusted` column comment in schema.ts.
	 *
	 * Not a convenience. On a *collecting* source `trusted: false` means every imported event is
	 * written as `pending`, and nothing in this codebase ever moves an imported event out of
	 * `pending`: importers do not call the verifier (ADR 0004 keeps them deterministic), there is
	 * no job that sweeps the table, and ADR 0012 removed the review queue the column comment was
	 * written against. Every listing filters `status = 'published'`. So `false` here would import
	 * events nobody can ever see, while /kjelder reported healthy runs — the worst of both.
	 */
	trusted: boolean;
};

export const INSTANCES: readonly RiksteatretInstance[] = [
	{
		slug: 'riksteatret-bomlo',
		name: 'Riksteatret på Bømlo',
		url: 'https://www.riksteatret.no/spillested/bomlo/',
		region: 'Sunnhordland',
		attribution: 'Riksteatret',
		timezone: 'Europe/Oslo',
		venueFallback: 'Bømlo kulturhus',
		scheduleCron: '0 5 * * *',
		iconUrl: 'https://www.riksteatret.no/apple-touch-icon-precomposed.png',
		trusted: true
	},
	{
		slug: 'riksteatret-stord',
		name: 'Riksteatret på Stord',
		url: 'https://www.riksteatret.no/spillested/stord/',
		region: 'Sunnhordland',
		attribution: 'Riksteatret',
		timezone: 'Europe/Oslo',
		/*
		 * "Kulturhuset Stord", which is what the cards actually say — not "Stord kulturhus", which
		 * is what `importers/kulturhus` calls the same building, and not a normalisation of one
		 * into the other. The hall is written down here exactly as its own theatre writes it,
		 * because an importer that quietly renames a venue is an importer whose output cannot be
		 * checked against the page it came from.
		 *
		 * The consequence is real and is recorded rather than hidden: `venues` will hold both
		 * `kulturhuset-stord` and `stord-kulturhus`. That is already the shape of that building in
		 * our data — the culture house's own feed names the *room* ("Storsalen", "Småsalen"), so
		 * there were several rows for it before this importer existed.
		 */
		venueFallback: 'Kulturhuset Stord',
		scheduleCron: '0 5 * * *',
		iconUrl: 'https://www.riksteatret.no/apple-touch-icon-precomposed.png',
		trusted: true
	}
];

export function instanceBySlug(slug: string): RiksteatretInstance | undefined {
	return INSTANCES.find((i) => i.slug === slug);
}
