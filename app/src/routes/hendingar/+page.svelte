<script lang="ts">
	import { page } from '$app/state';
	import { CATEGORY_SLUGS, categoryLabel, type CategorySlug } from '@hendingar/core/taxonomy';
	import InfiniteList from '../../lib/components/InfiniteList.svelte';
	import SourceIcon from '../../lib/components/SourceIcon.svelte';
	import { listCategoryCounts, listEvents, listSourceCounts } from '../../lib/events.remote';
	import { heartCounts } from '../../lib/hearts.remote';

	/**
	 * The filter is a URL, not a client-side toggle.
	 *
	 * `?kategori=musikk` means a filtered view is linkable, shareable, back-buttonable and
	 * server-rendered — and it works with JavaScript off, which a set of buttons holding state in a
	 * component would not. It also keeps the page's data flow identical on the server and the
	 * client: one query, one argument, read from the address bar.
	 */
	const active = $derived.by((): CategorySlug | undefined => {
		const raw = page.url.searchParams.get('kategori');
		// Validated against the taxonomy rather than trusted: an unknown value shows everything,
		// which is a better answer to a hand-edited URL than an error page.
		return CATEGORY_SLUGS.includes(raw as CategorySlug) ? (raw as CategorySlug) : undefined;
	});

	/*
	 * The source filter, also a URL.
	 *
	 * Sources are rows rather than a compile-time set, so this cannot be validated the way the
	 * category is. It is checked against the counts we already fetched, which has the same effect —
	 * a slug nobody publishes under falls back to showing everything — without a second query.
	 */
	const sourceCounts = await listSourceCounts();
	const activeSource = $derived.by((): string | undefined => {
		const raw = page.url.searchParams.get('kjelde');
		return raw && sourceCounts.some((s) => s.slug === raw) ? raw : undefined;
	});
	const activeSourceName = $derived(
		sourceCounts.find((s) => s.slug === activeSource)?.name ?? undefined
	);

	/**
	 * Both filters compose, so a URL keeps whichever one you are not changing.
	 *
	 * Without this, pressing a source chip would silently drop the category you had chosen — the
	 * list would change in two ways at once and neither chip would explain why.
	 */
	function filterHref(next: { kategori?: string | null; kjelde?: string | null }): string {
		// Built by hand rather than with URLSearchParams: svelte/prefer-svelte-reactivity rightly
		// bans a mutable instance of it in a component, and reaching for the reactive variant would
		// be heavier machinery than a throwaway string of two known keys deserves.
		const kategori = next.kategori === undefined ? active : next.kategori;
		const kjelde = next.kjelde === undefined ? activeSource : next.kjelde;
		const parts: string[] = [];
		if (kategori) parts.push(`kategori=${encodeURIComponent(kategori)}`);
		if (kjelde) parts.push(`kjelde=${encodeURIComponent(kjelde)}`);
		return parts.length ? `/hendingar?${parts.join('&')}` : '/hendingar';
	}

	// Top-level await for the counts, which never change with the filter.
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
		listEvents({ limit: PAGE_SIZE, offset: 0, category: active, source: activeSource })
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
</script>

<svelte:head>
	<title>
		{active ? `${categoryLabel(active)} — hendingar.no` : 'Alle hendingar — hendingar.no'}
	</title>
	<meta
		name="description"
		content="Alle komande hendingar i Sunnhordland, gruppert etter dag. Filtrer på kategori."
	/>
</svelte:head>

<div class="shell list">
	<p class="label">Full liste</p>
	<!-- The heading states both filters, because a page that says only "Musikk" while also
	     filtered to one library is describing itself inaccurately. -->
	<h1 class="display list__h">
		{active ? categoryLabel(active) : 'Alle hendingar'}
	</h1>
	{#if activeSourceName}
		<p class="list__scope">frå <strong>{activeSourceName}</strong></p>
	{/if}

	<nav class="filters" aria-label="Filtrer på kategori">
		<!-- Links, not buttons: each filter is a real location. aria-current marks the active one
		     so it is not signalled by colour alone. -->
		<a
			class="chip"
			href={filterHref({ kategori: null })}
			aria-current={active ? undefined : 'page'}
		>
			Alle <span class="chip__n">{total}</span>
		</a>
		{#each counts as category (category.slug)}
			<a
				class="chip"
				href={filterHref({ kategori: category.slug })}
				aria-current={active === category.slug ? 'page' : undefined}
			>
				{category.label} <span class="chip__n">{category.total}</span>
			</a>
		{/each}
	</nav>

	{#if sourceCounts.length > 1}
		<!-- A second axis, only when there is more than one source to choose between: one chip that
		     can only ever mean "everything" is furniture, not a control. -->
		<nav class="filters filters--source" aria-label="Filtrer på kjelde">
			<a
				class="chip"
				href={filterHref({ kjelde: null })}
				aria-current={activeSource ? undefined : 'page'}
			>
				Alle kjelder
			</a>
			{#each sourceCounts as src (src.slug)}
				<a
					class="chip chip--source"
					href={filterHref({ kjelde: src.slug })}
					aria-current={activeSource === src.slug ? 'page' : undefined}
				>
					<SourceIcon src={src.iconUrl} name={src.name} size="1rem" />
					{src.name} <span class="chip__n">{src.total}</span>
				</a>
			{/each}
		</nav>
	{/if}

	{#if (await filtered).length === 0}
		<!-- Names the combination that came up empty, because "no events" after two filters does not
		     tell you which one to loosen. -->
		<p class="empty">
			{#if active && activeSourceName}
				Ingen {categoryLabel(active).toLowerCase()}-hendingar frå {activeSourceName} enno.
			{:else if activeSourceName}
				Ingen hendingar frå {activeSourceName} enno.
			{:else if active}
				Ingen hendingar i denne kategorien enno.
			{:else}
				Ingen hendingar enno.
			{/if}
			<a href="/hendingar">Sjå alle</a> eller <a href="/send-inn">send inn ei</a>.
		</p>
	{:else}
		<!-- headingLevel 2 so each day nests under this page's h1. -->
		<InfiniteList
			first={await filtered}
			firstHearts={await hearts}
			pageSize={PAGE_SIZE}
			category={active}
			source={activeSource}
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
	.filters--source {
		margin-block-start: 0.6rem;
	}
	/* The icon rides inside the chip, so the chip has to lay out as a row rather than as text. */
	.chip--source {
		display: inline-flex;
		align-items: center;
		gap: 0.45rem;
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
	}
	.filters {
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem;
		margin-block-end: clamp(1.5rem, 3vw, 2.5rem);
	}

	/*
	 * On a phone the chips scroll sideways instead of wrapping.
	 *
	 * Wrapped, the sixteen category chips are 271px tall on a 390x844 screen — a third of the
	 * viewport spent on a control, before a single event is visible. One scrollable row is 44px.
	 *
	 * `flex: none` on the chips is what makes it work: without it flexbox shrinks them to fit and
	 * you get sixteen unreadable slivers rather than a scroller. The negative margin plus matching
	 * padding lets the row bleed to the screen edge so the last chip is not clipped mid-word, which
	 * is also the affordance that says "there is more this way".
	 */
	@media (width < 34rem) {
		.filters {
			flex-wrap: nowrap;
			overflow-x: auto;
			overscroll-behavior-x: contain;
			scroll-snap-type: x proximity;
			margin-inline: calc(var(--gutter, 1rem) * -1);
			padding-inline: var(--gutter, 1rem);
			padding-block-end: 0.35rem;
			margin-block-end: 1.1rem;
			/* The row is the scroller; hiding its bar keeps it from reading as a broken layout.
			   Scrolling is still discoverable because the chips visibly run off the edge. */
			scrollbar-width: none;
		}
		.filters::-webkit-scrollbar {
			display: none;
		}
		.filters .chip {
			flex: none;
			scroll-snap-align: start;
		}
		.filters--source {
			margin-block-start: 0;
		}
	}
	.chip {
		display: inline-flex;
		align-items: baseline;
		gap: 0.4em;
		font-family: var(--font-mono);
		font-size: var(--step-micro);
		font-weight: 700;
		letter-spacing: 0.12em;
		text-transform: uppercase;
		text-decoration: none;
		color: var(--peach-dim);
		border: var(--rule) solid var(--peach-line);
		padding: 0.55em 0.9em;
	}
	.chip:hover {
		color: var(--peach-hi);
		border-color: var(--peach);
	}
	.chip[aria-current='page'] {
		background: var(--peach);
		color: var(--navy-900);
		border-color: var(--peach);
	}
	.chip__n {
		font-weight: 400;
		opacity: 0.72;
	}
	.empty {
		font-family: var(--font-display);
		font-weight: 800;
		font-stretch: 108%;
		font-size: var(--step-mid);
		max-inline-size: 34ch;
	}
</style>
