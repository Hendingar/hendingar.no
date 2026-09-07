<script lang="ts">
	import { page } from '$app/state';
	import { CATEGORY_SLUGS, categoryLabel, type CategorySlug } from '@hendingar/core/taxonomy';
	import InfiniteList from '../../lib/components/InfiniteList.svelte';
	import SearchCombo from '../../lib/components/hendingar/SearchCombo.svelte';
	import PageMeta from '../../lib/components/PageMeta.svelte';
	import { eventPath } from '@hendingar/core/slug';
	import { canonicalUrl } from '../../lib/origin.ts';
	import { itemListJsonLd, jsonLdScript } from '../../lib/jsonld.ts';
	import { listCategoryCounts, listEvents, listSourceCounts } from '../../lib/events.remote';
	import { heartCounts } from '../../lib/hearts.remote';
	import { filterTokens, filtersFromParams, isUnfiltered } from '../../lib/listing-url.ts';

	/**
	 * The filter is a URL, not a client-side toggle.
	 *
	 * `?kategori=musikk` means a filtered view is linkable, shareable, back-buttonable and
	 * server-rendered — and it works with JavaScript off, which a set of buttons holding state in a
	 * component would not. It also keeps the page's data flow identical on the server and the
	 * client: one query, one argument, read from the address bar.
	 *
	 * That rule survived the control being replaced. Forty chips — sixteen categories and
	 * twenty-three calendars, about 480px of furniture above the events — are now one field
	 * (`SearchCombo`), and every filter it can apply is still a link to an address this page reads
	 * back out. The four axes are `q`, `kategori`, `kjelde` and `stad`; `listing-url.ts` owns how
	 * they become a URL, because three surfaces have to agree on it.
	 */
	const raw = $derived(filtersFromParams(page.url.searchParams));

	const sourceCounts = await listSourceCounts();

	/**
	 * Validated where each axis can be validated, and never with an error.
	 *
	 * A category is a compile-time set, so an unknown one is dropped. Sources are rows, so `kjelde`
	 * is checked against the counts already fetched. A venue cannot be validated cheaply and does
	 * not need to be: an unknown name matches nothing and the page says so in words. Every one of
	 * these falls back to showing more rather than to an error page — the treatment a hand-edited
	 * URL has always got here.
	 */
	const filters = $derived.by(() => {
		const next = { ...raw };
		if (next.kategori && !CATEGORY_SLUGS.includes(next.kategori as CategorySlug)) {
			delete next.kategori;
		}
		if (next.kjelde && !sourceCounts.some((s) => s.slug === next.kjelde)) delete next.kjelde;
		return next;
	});

	const active = $derived(filters.kategori as CategorySlug | undefined);
	const activeSourceName = $derived(
		sourceCounts.find((s) => s.slug === filters.kjelde)?.name ?? undefined
	);

	const tokens = $derived(
		filterTokens(filters, {
			category: (slug) => categoryLabel(slug as CategorySlug),
			source: (slug) => sourceCounts.find((s) => s.slug === slug)?.name ?? slug
		})
	);

	// Top-level await for the counts, which never change with the filter. Still the honest total
	// for "how much is in here", which is what the field's placeholder offers to search.
	const counts = await listCategoryCounts();
	const total = counts.reduce((n, c) => n + c.total, 0);

	/*
	 * The listing is a $derived resource awaited in the markup, NOT a top-level await.
	 *
	 * A top-level `await listEvents({ category: active })` captures `active` once — svelte-check
	 * says so outright — so the list would never change when you clicked a filter. Deriving the
	 * query and awaiting it in the template keeps the dependency live while still suspending the
	 * component on the server, so the filtered list is server-rendered too.
	 */
	/**
	 * One screenful and a bit, not the whole hundred.
	 *
	 * The page used to ask for 100 events and stop dead there, with nothing beyond. A smaller first
	 * page renders and paints faster, and `InfiniteList` fetches the next one before the reader
	 * reaches the bottom — so the list is both quicker to appear and no longer has an end.
	 */
	const PAGE_SIZE = 24;

	const filtered = $derived(
		listEvents({
			limit: PAGE_SIZE,
			offset: 0,
			category: active,
			source: filters.kjelde,
			venue: filters.stad,
			q: filters.q
		})
	);

	/*
	 * Heart counts for whatever the filter produced, chained off the same promise.
	 *
	 * Derived rather than fetched once, because changing the filter changes the set of events — and
	 * awaited in the template beside the list, so both are in the server HTML together.
	 */
	const hearts = $derived(
		filtered.then(async (list) =>
			Object.fromEntries(
				(await heartCounts(list.map((e) => e.id))).map((h) => [h.eventId, h.hearts])
			)
		)
	);
	/**
	 * How many the filter left, as a sentence.
	 *
	 * A full page means there are more behind it — the listing pages as you scroll — so it says so
	 * rather than claiming exactly twenty-four.
	 */
	const summary = $derived(
		filtered.then((list) =>
			list.length === PAGE_SIZE ? `Meir enn ${PAGE_SIZE} treff` : `${list.length} treff`
		)
	);

	/**
	 * The first screenful, named as a list.
	 *
	 * Only what this page actually links to. The rest of the corpus is in the sitemap, and claiming
	 * a hundred items in a list that renders twenty-four would describe a different page from the
	 * one the crawler is reading.
	 */
	function listJsonLd(list: readonly { id: number; title: string }[]) {
		return itemListJsonLd(
			active ? `${categoryLabel(active)} i Sunnhordland` : 'Hendingar i Sunnhordland',
			list.map((e) => canonicalUrl(page.url, eventPath(e.id, e.title)))
		);
	}

	/**
	 * What this page is called, given what it is filtered to.
	 *
	 * A search is not a page with a name — it is one reader's question, and there are infinitely
	 * many of them — so a searched or venue-filtered listing says so in its title and is kept out
	 * of the index below. A category or a source, which are finite and stable, stay indexable
	 * pages exactly as before.
	 */
	const heading = $derived.by(() => {
		if (filters.q) return `Søk: ${filters.q}`;
		if (filters.stad) return filters.stad;
		return active ? categoryLabel(active) : 'Alle hendingar';
	});
	const openEnded = $derived(Boolean(filters.q || filters.stad));
</script>

<!--
	A searched listing is not an indexable page.

	`?q=` is unbounded — every query a crawler can invent is a URL — so this is the one listing view
	that asks not to be indexed, and it carries no canonical for the same reason PageMeta's own note
	gives: a canonical on a page we are asking search engines to ignore is contradictory noise. The
	unfiltered listing and the category views remain exactly as indexable as before.

	The condition is INSIDE the head rather than around it: `<svelte:head>` is a compiler
	construct and may not sit in a block.
-->
<svelte:head>
	{#if openEnded}
		<title>{heading} — hendingar.no</title>
		<meta name="robots" content="noindex, follow" />
	{/if}
</svelte:head>

{#if !openEnded}
	<PageMeta
		title={active ? `${categoryLabel(active)} — hendingar.no` : 'Alle hendingar — hendingar.no'}
		description="Alle komande hendingar i Sunnhordland, gruppert etter dag. Søk, eller filtrer på kategori."
		path={active ? `/hendingar?kategori=${active}` : '/hendingar'}
	/>
{/if}

<div class="shell list">
	<p class="label">Full liste</p>
	<!-- The heading states what the list is filtered to, because a page that says only "Musikk"
	     while also filtered to one library is describing itself inaccurately. -->
	<h1 class="display list__h">{heading}</h1>
	{#if activeSourceName}
		<p class="list__scope">frå <strong>{activeSourceName}</strong></p>
	{/if}

	<SearchCombo {filters} {tokens} {total} />

	{#if (await filtered).length === 0}
		<!-- Names what came up empty, because "no events" after two filters does not tell you which
		     one to loosen. -->
		<p class="empty">
			{#if filters.q}
				Ingen treff for «{filters.q}».
			{:else if filters.stad}
				Ingen hendingar på {filters.stad} enno.
			{:else if active && activeSourceName}
				Ingen {categoryLabel(active).toLowerCase()}-hendingar frå {activeSourceName} enno.
			{:else if activeSourceName}
				Ingen hendingar frå {activeSourceName} enno.
			{:else if active}
				Ingen hendingar i denne kategorien enno.
			{:else}
				Ingen hendingar enno.
			{/if}
			<a href="/hendingar">Sjå alle {total}</a> eller <a href="/send-inn">send inn ei</a>.
		</p>
	{:else}
		{#if !isUnfiltered(filters)}
			<!--
				How much the filter left, and one way back. The number is what a reader checks after
				pressing anything, and it was previously only inferable by counting cards.

				The sentence is built in the script and awaited ONCE here. Written inline it was
				`{(await filtered).length === PAGE_SIZE ? … : `${(await filtered).length} treff`}` —
				two awaits inside a ternary inside an `{#if}` inside an awaited `{:else}` — and that
				wedged the router: Svelte warned `await_reactivity_loss`, the async render never
				settled, and a client-side navigation to any filter it had not already fetched left
				the previous page on screen for ever while the address bar said otherwise.
			-->
			<p class="list__count">
				{await summary}
				<a href="/hendingar">Nullstill</a>
			</p>
		{/if}
		<!-- headingLevel 2 so each day nests under this page's h1. -->
		<!--
			In the body, not the head.

			`filtered` is a derived promise — it has to be, or clicking a category would never change
			the list — and an `{#await}` inside `<svelte:head>` renders nothing at all on the server,
			which is the same trap CLAUDE.md records for `.loading` and boundary snippets. JSON-LD is
			valid anywhere in the document, and here it is inside the region SvelteKit suspends on,
			so it reaches the server-rendered HTML.
		-->
		<!-- eslint-disable-next-line svelte/no-at-html-tags -- JSON.stringify output, escaped in jsonLdScript -->
		{@html `<script type="application/ld+json">${jsonLdScript(listJsonLd(await filtered))}</${'script'}>`}
		<InfiniteList
			first={await filtered}
			firstHearts={await hearts}
			pageSize={PAGE_SIZE}
			category={active}
			source={filters.kjelde}
			venue={filters.stad}
			q={filters.q}
			headingLevel={2}
		/>
	{/if}
</div>

<style>
	.list__scope {
		margin: 0.35rem 0 0;
		font-size: var(--step-body);
		color: var(--peach-dim);
	}
	.list__count {
		display: flex;
		flex-wrap: wrap;
		gap: 0.9rem;
		margin: 0 0 1.25rem;
		font-family: var(--font-mono);
		font-size: var(--step-micro);
		font-weight: 700;
		letter-spacing: 0.16em;
		text-transform: uppercase;
		color: var(--peach-dim);
	}

	.list {
		padding-block: clamp(2rem, 5vw, 4rem) var(--section-y);
		container-type: inline-size;
	}
	.list__h {
		/* cqw floors low enough to survive a 320px viewport — a rem-only clamp clipped the final
		   letter of the longest heading here. */
		font-size: clamp(1.75rem, 11cqw, 5rem);
		margin-block: 0.4rem 1.25rem;
		/* A search term is somebody's words, not a designed heading: it can be one long token, and
		   at 11cqw a long one would run off a phone. */
		overflow-wrap: anywhere;
	}
	.empty {
		font-family: var(--font-display);
		font-weight: 800;
		font-stretch: 108%;
		font-size: var(--step-mid);
		max-inline-size: 34ch;
	}
</style>
