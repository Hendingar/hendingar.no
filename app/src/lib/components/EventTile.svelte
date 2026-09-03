<script lang="ts">
	import { categoryLabel } from '@hendingar/core/taxonomy';
	import { eventPath } from '@hendingar/core/slug';
	import { formatEventClock, machineDateTime } from '@hendingar/core/datetime';
	import EventThumb from './EventThumb.svelte';
	import SourceIcon from './SourceIcon.svelte';
	import type { UpcomingEvent } from '../events.remote';

	let { event }: { event: UpcomingEvent } = $props();
</script>

<article class="tile frame">
	<EventThumb id={event.id} posterUrl={event.posterUrl} title={event.title} />

	<div class="tile__body">
		<p class="tile__top">
			<span class="time">
				<span class="visually-hidden">Klokka </span>
				<time datetime={machineDateTime(event.startsAt)}>
					{formatEventClock(event.startsAt, event.venueTimeZone)}
				</time>
			</span>
			<span class="label"
				><span class="visually-hidden">Kategori: </span>{categoryLabel(event.category)}</span
			>
		</p>

		<!--
			The link is on the title, with a stretched overlay making the whole tile clickable.
			One link per tile, named by the title: wrapping the entire card would fold the time,
			category and venue into the link's accessible name, and a separate "read more" would
			give every tile the same meaningless name.
		-->
		<h3 class="display display--md tile__t">
			<a class="tile__link" href={eventPath(event.id, event.title)}>{event.title}</a>
		</h3>

		{#if event.venueName || event.sourceName}
			<p class="tile__meta">
				{#if event.sourceName}
					<!--
						Whose calendar this came from. Decorative here: the source is named in full on the
						event's own page and on /datasamling, so repeating it as text on every tile would
						add noise to a screen reader for no information a reader cannot already reach.
					-->
					<span class="tile__src" title={`Kjelde: ${event.sourceName}`}>
						<SourceIcon src={event.sourceIconUrl} name={event.sourceName} size="1rem" />
					</span>
				{/if}
				{#if event.venueName}
					<span class="visually-hidden">Stad: </span>{event.venueName}
				{/if}
			</p>
		{/if}
	</div>
</article>

<style>
	.tile__src {
		display: inline-flex;
		flex: none;
		vertical-align: -0.15em;
		margin-inline-end: 0.4rem;
		/* The icon is a third party's mark, so it is dimmed to sit inside our palette rather than
		   compete with the title above it. */
		opacity: 0.75;
	}

	.tile {
		position: relative;
		display: grid;
		grid-template-rows: auto 1fr;
		block-size: 100%;
		min-inline-size: 0;
		container-type: inline-size;
		background: var(--navy-900);
	}
	.tile__link {
		color: inherit;
		text-decoration: none;
	}
	/* The overlay is on the link, not the article, so the hit area and the focus ring agree. */
	.tile__link::after {
		content: '';
		position: absolute;
		inset: 0;
	}
	.tile:hover .tile__link {
		color: var(--peach-hi);
	}
	.tile:has(.tile__link:focus-visible) {
		outline: 2px solid var(--peach);
		outline-offset: 2px;
	}
	.tile__link:focus-visible {
		outline: none;
	}
	.tile__body {
		padding: 0.85rem 0.9rem 1rem;
		display: grid;
		gap: 0.4rem;
		align-content: start;
	}
	.tile__top {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.5rem;
		margin: 0;
	}
	.time {
		font-family: var(--font-mono);
		font-size: var(--step-micro);
		font-weight: 700;
		letter-spacing: 0.2em;
		text-transform: uppercase;
		background: var(--peach);
		color: var(--navy-900);
		padding: 0.25em 0.5em;
	}
	.tile__t {
		font-size: clamp(0.9rem, 8cqw, 1.35rem);
		margin: 0;
		hyphens: auto;
	}
	.tile__meta {
		margin: 0;
		overflow-wrap: anywhere;
		font-size: var(--step-micro);
		letter-spacing: 0.16em;
		text-transform: uppercase;
		color: var(--peach-dim);
	}
</style>
