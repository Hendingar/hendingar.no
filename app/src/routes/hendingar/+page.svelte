<script lang="ts">
	import { page } from '$app/state';
	import { CATEGORY_SLUGS, categoryLabel, type CategorySlug } from '@hendingar/core/taxonomy';
	import EventsByDay from '../../lib/components/EventsByDay.svelte';
	import { listCategoryCounts, listEvents } from '../../lib/events.remote';

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
	const filtered = $derived(listEvents({ limit: 100, category: active }));
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
	<h1 class="display list__h">
		{active ? categoryLabel(active) : 'Alle hendingar'}
	</h1>

	<nav class="filters" aria-label="Filtrer på kategori">
		<!-- Links, not buttons: each filter is a real location. aria-current marks the active one
		     so it is not signalled by colour alone. -->
		<a class="chip" href="/hendingar" aria-current={active ? undefined : 'page'}>
			Alle <span class="chip__n">{total}</span>
		</a>
		{#each counts as category (category.slug)}
			<a
				class="chip"
				href={`/hendingar?kategori=${category.slug}`}
				aria-current={active === category.slug ? 'page' : undefined}
			>
				{category.label} <span class="chip__n">{category.total}</span>
			</a>
		{/each}
	</nav>

	{#if (await filtered).length === 0}
		<p class="empty">
			Ingen hendingar i denne kategorien enno.
			<a href="/hendingar">Sjå alle</a> eller <a href="/send-inn">send inn ei</a>.
		</p>
	{:else}
		<!-- headingLevel 2 so each day nests under this page's h1. -->
		<EventsByDay events={await filtered} headingLevel={2} />
	{/if}
</div>

<style>
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
