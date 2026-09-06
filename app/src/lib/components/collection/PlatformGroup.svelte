<script lang="ts">
	import type { SourcePlatform } from '@hendingar/core/directory';
	import SourceRow from './SourceRow.svelte';
	import type { CollectedSource } from '../../collection.remote';

	/**
	 * One platform, and the organisers we collect from it.
	 *
	 * A platform is not a source: AllEvents and Billetto are products that many local organisers
	 * publish on, and we add profiles as we find them. Rendered flat, four rows saying "AllEvents"
	 * sit among fourteen saying a real organisation's name and bury them — and misreport the answer
	 * too, because a reader counting rows would think we watch more places than we do, when what
	 * grew was one integration.
	 *
	 * Each organiser keeps its own row inside, because each is fetched separately and writes its own
	 * `ingest_runs` row. A single combined row would hide which profile stopped reporting, which is
	 * the one thing this page exists to show.
	 *
	 * `<details>` for the same reasons `SourceRow` uses one: it opens without JavaScript, is
	 * keyboard operable and announced as expandable for free, and survives Ctrl-F.
	 */
	let {
		platform,
		sources,
		now
	}: { platform: SourcePlatform; sources: CollectedSource[]; now: Date } = $props();

	/*
	 * Open by default when there is only one organiser.
	 *
	 * A collapsed group hiding a single row is a click that reveals no grouping at all — it costs
	 * the reader an interaction to learn nothing. It earns its fold once there is more than one.
	 */
	const many = $derived(sources.length > 1);

	const upcoming = $derived(sources.reduce((n, s) => n + s.eventsUpcoming, 0));
	const label = $derived(sources.length === 1 ? 'éin arrangør' : `${sources.length} arrangørar`);
</script>

<details class="group" open={!many}>
	<summary class="group__sum">
		<span class="group__name">{platform.name}</span>
		<span class="group__meta">
			{label} · {upcoming} framover
		</span>
	</summary>

	<div class="group__body">
		<p class="group__note">{platform.note}</p>
		<p class="group__link">
			<!-- rel=nofollow: it is a citation of where the data lives, not a recommendation. -->
			<a href={platform.url} rel="noopener nofollow">{new URL(platform.url).hostname}</a>
		</p>

		<div class="group__rows">
			{#each sources as source (source.slug)}
				<SourceRow {source} {now} />
			{/each}
		</div>
	</div>
</details>

<style>
	.group {
		border-block-end: var(--rule) solid var(--peach-line);
	}
	/*
	 * On a wrapper class, never on `summary` itself.
	 *
	 * A component rule on a bare element is (0,1,1) and outranks a shared single-class utility in
	 * brand.css — the trap CLAUDE.md records, which once gave two visually-hidden radios a full
	 * inline size and pushed a page past the viewport.
	 */
	.group__sum {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem 1rem;
		align-items: baseline;
		justify-content: space-between;
		padding: 0.9rem 0;
		cursor: pointer;
		list-style: none;
	}
	.group__sum::-webkit-details-marker {
		display: none;
	}
	/*
	 * The marker belongs to the name, not to the row.
	 *
	 * On `.group__sum` it is a flex item of its own, so `space-between` spreads three children and
	 * pushes the platform name into the middle of the row — floating, aligned with nothing. Hung
	 * off the name it stays beside the word it discloses, and the row has two items again.
	 */
	.group__name::before {
		content: '▸';
		margin-inline-end: 0.6rem;
		color: var(--peach-dim);
	}
	.group:open > .group__sum .group__name::before {
		content: '▾';
	}
	.group__sum:focus-visible {
		outline: 2px solid var(--peach-hi);
		outline-offset: 2px;
	}
	.group__name {
		font-family: var(--font-display);
		font-weight: 800;
		font-size: var(--step-mid);
		letter-spacing: 0.01em;
	}
	.group__meta {
		font-family: var(--font-mono);
		font-size: var(--step-micro);
		letter-spacing: 0.16em;
		text-transform: uppercase;
		color: var(--peach-dim);
	}
	.group__body {
		padding-block-end: 0.5rem;
	}
	.group__note,
	.group__link {
		margin: 0 0 0.5rem;
		max-inline-size: 68ch;
		font-size: 0.875rem;
		color: var(--peach-dim);
	}
	.group__link {
		font-family: var(--font-mono);
		font-size: var(--step-micro);
	}
	/*
	 * Indented so the nesting is visible without a second border fighting the row's own.
	 * A rule on the inline start reads as "these belong to the thing above".
	 */
	.group__rows {
		padding-inline-start: clamp(0.6rem, 2vw, 1.25rem);
		border-inline-start: var(--rule-fat) solid var(--peach-line);
	}
</style>
