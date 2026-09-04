/**
 * The Bakhagen hagelag sites we import from.
 *
 * Bakhagen is Hageselskapet's national CMS (Corepublish), and every one of its ~350 local hagelag
 * gets the same `/<fylke>/<lag>/aktiviteter/` page rendered by the same template. So this is a
 * platform importer with the lag as data, the same argument as `importers/mec` and
 * `importers/kyrkja`: adding Stord hagelag should be an entry in this list, not a new package.
 *
 * How to tell a Bakhagen page: `<article class="activity … " data-articleId="…"
 * itemscope itemtype="http://schema.org/Event">` cards, a `.local-branch` line naming the hagelag,
 * and a `div.date-duration` carrying `<time … itemprop="startDate">`.
 */
export type BakhagenInstance = {
	/** Our `sources.slug`. Stable — changing it orphans every imported event. */
	slug: string;
	name: string;
	/** The human-facing page, for attribution links. Here it is also the page we parse. */
	url: string;
	region: string;
	attribution: string;
	timezone: string;
	/**
	 * Used when a card names no place. Hagelag activities are usually held in a borrowed hall and
	 * the field is filled in, but an entry with an empty `.location` would otherwise arrive with
	 * no place at all.
	 */
	venueFallback: string;
	scheduleCron: string;
	/**
	 * The site's own icon, hotlinked, so a tile and a source row carry its mark.
	 *
	 * Read from the page's `<link rel="shortcut icon">` and fetched to confirm it resolves, rather
	 * than guessed from `/favicon.ico` — Bakhagen serves every asset through `getfile.php` and has
	 * no file at the conventional path.
	 */
	iconUrl: string | null;
	/**
	 * Editorially maintained by the hagelag itself, so imports publish directly rather than
	 * queueing for review. See the `trusted` column comment in schema.ts.
	 */
	trusted: boolean;
};

export const INSTANCES: readonly BakhagenInstance[] = [
	{
		slug: 'bomlo-hagelag',
		name: 'Hageselskapet Bømlo',
		url: 'https://bakhagen.hageselskapet.no/hordaland/bomlo/aktiviteter/',
		region: 'Sunnhordland',
		attribution: 'Hageselskapet Bømlo',
		timezone: 'Europe/Oslo',
		venueFallback: 'Hageselskapet Bømlo',
		scheduleCron: '0 5 * * *',
		iconUrl: 'https://bakhagen.hageselskapet.no/getfile.php/131213-1602249604/favicon-32x32.png',
		trusted: true
	}
];

export function instanceBySlug(slug: string): BakhagenInstance | undefined {
	return INSTANCES.find((i) => i.slug === slug);
}
