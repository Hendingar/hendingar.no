<script lang="ts">
	import { categoryLabel } from '@hendingar/core/taxonomy';
	import { formatEventTime, machineDateTime } from '@hendingar/core/datetime';
	import EventThumb from './EventThumb.svelte';
	import type { TodayEvent } from '../events.remote';

	let { event }: { event: TodayEvent } = $props();
</script>

<article class="tile frame">
	<EventThumb id={event.id} posterUrl={event.posterUrl} title={event.title} />

	<div class="tile__body">
		<p class="tile__top">
			{#if event.isToday}
				<span class="today">I dag</span>
			{/if}
			<span class="label"
				><span class="visually-hidden">Kategori: </span>{categoryLabel(event.category)}</span
			>
		</p>

		<h3 class="display display--md tile__t">{event.title}</h3>

		<p class="tile__meta">
			{#if event.venueName}
				<span><span class="visually-hidden">Stad: </span>{event.venueName}</span>
				<span aria-hidden="true"> · </span>
			{/if}
			<span class="visually-hidden">Tid: </span>
			<time datetime={machineDateTime(event.startsAt)}>
				{formatEventTime(event.startsAt, event.venueTimeZone)}
			</time>
		</p>
	</div>
</article>

<style>
	.tile {
		display: grid;
		grid-template-rows: auto 1fr;
		block-size: 100%;
		min-inline-size: 0;
		container-type: inline-size;
		background: var(--navy-900);
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
	.today {
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
