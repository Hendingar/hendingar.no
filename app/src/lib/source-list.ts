import { freshness } from '@hendingar/core/schedule';
import { platformOf } from '@hendingar/core/directory';

/**
 * The search, filter and sort on /datasamling, as a URL.
 *
 * A URL rather than component state for the same reason as `/hendingar`: a filtered view is
 * linkable, survives a reload, and works with JavaScript off — the controls are a GET form and
 * plain links, and the server renders the filtered list.
 */

/** What a row needs to be filtered. `CollectedSource` satisfies it; tests need not build one. */
export type ListableSource = {
	slug: string;
	name: string;
	kind: string;
	active: boolean;
	scheduleCron: string | null;
	lastRunAt: Date | null;
	eventsUpcoming: number;
	runs: readonly { status: string }[];
};

export const SOURCE_VIEWS = ['tilsyn', 'tomme', 'lenkje'] as const;
export type SourceView = (typeof SOURCE_VIEWS)[number];

export const SOURCE_SORTS = ['namn'] as const;
export type SourceSort = (typeof SOURCE_SORTS)[number];

export type SourceListParams = { q: string; vis: SourceView | null; sorter: SourceSort | null };

/** Unknown values are dropped, never refused — the treatment a hand-edited URL gets everywhere. */
export function sourceListParams(params: { get(name: string): string | null }): SourceListParams {
	const vis = params.get('vis');
	const sorter = params.get('sorter');
	return {
		q: (params.get('q') ?? '').trim().slice(0, 80),
		vis: SOURCE_VIEWS.find((v) => v === vis) ?? null,
		sorter: SOURCE_SORTS.find((s) => s === sorter) ?? null
	};
}

/** `/datasamling` with these parameters, leaving out the defaults so the plain URL stays plain. */
export function sourceListHref(params: SourceListParams): string {
	const search = new URLSearchParams();
	if (params.q) search.set('q', params.q);
	if (params.vis) search.set('vis', params.vis);
	if (params.sorter) search.set('sorter', params.sorter);
	const query = search.toString();
	return query ? `/datasamling?${query}` : '/datasamling';
}

/**
 * Collected, but something is wrong: late, stale, never run, or the last run failed.
 *
 * A linked source is never in here. It has no runs because we chose not to collect it, which is
 * a different fact from an importer that has stopped.
 */
export function needsAttention(source: ListableSource, now: Date): boolean {
	if (source.kind === 'link' || !source.active) return false;
	if (source.runs[0]?.status === 'failed') return true;
	return freshness(source.lastRunAt, source.scheduleCron, now) !== 'fresh';
}

/** Lower-case, accents folded, so "bomlo" finds "Bømlo" and "fjordnorway" finds "Fjord Norway". */
function fold(text: string): string {
	return text
		.toLowerCase()
		.replaceAll('ø', 'o')
		.replaceAll('æ', 'ae')
		.replaceAll('å', 'a')
		.normalize('NFD')
		.replace(/[̀-ͯ]/g, '')
		.replace(/[^a-z0-9]+/g, '');
}

function matches(source: ListableSource, q: string): boolean {
	if (!q) return true;
	const needle = fold(q);
	if (!needle) return true;
	// The platform counts as part of the name: "allevents" should find every AllEvents organiser.
	const platform = platformOf(source.slug)?.name ?? '';
	return fold(`${source.name} ${platform}`).includes(needle);
}

function inView(source: ListableSource, vis: SourceView | null, now: Date): boolean {
	switch (vis) {
		case null:
			return true;
		case 'tilsyn':
			return needsAttention(source, now);
		case 'tomme':
			return source.kind !== 'link' && source.eventsUpcoming === 0;
		case 'lenkje':
			return source.kind === 'link';
	}
}

/**
 * The rows to show, in order.
 *
 * Default order is by what a source actually contributes — events still to come — because that
 * is the question most readers bring ("where does all this come from?"). Linked sources go last
 * in that order: they contribute nothing to the listing, and the top of it should be the sources
 * that do. `sorter=namn` is alphabetical, Norwegian collation, links in with everything else.
 */
export function listSources<T extends ListableSource>(
	sources: readonly T[],
	params: SourceListParams,
	now: Date
): T[] {
	const shown = sources.filter((s) => matches(s, params.q) && inView(s, params.vis, now));
	const byName = (a: T, b: T) => a.name.localeCompare(b.name, 'nb');
	if (params.sorter === 'namn') return shown.sort(byName);
	return shown.sort((a, b) => {
		const linked = Number(a.kind === 'link') - Number(b.kind === 'link');
		return linked || b.eventsUpcoming - a.eventsUpcoming || byName(a, b);
	});
}

/** How many rows each view would show, so a chip can say so before it is pressed. */
export function viewCounts(
	sources: readonly ListableSource[],
	now: Date
): Record<SourceView, number> {
	return {
		tilsyn: sources.filter((s) => inView(s, 'tilsyn', now)).length,
		tomme: sources.filter((s) => inView(s, 'tomme', now)).length,
		lenkje: sources.filter((s) => inView(s, 'lenkje', now)).length
	};
}
