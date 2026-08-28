<script lang="ts">
	import { categoryLabel } from '@hendingar/core/taxonomy';
	import { formatEventTime, machineDateTime } from '@hendingar/core/datetime';
	import type { EventSummary } from '../events.remote';

	/**
	 * `headingLevel` so the same card can sit under an h2 on the landing page and under an h1 on
	 * the full list without breaking the heading outline.
	 */
	let { event, headingLevel = 3 }: { event: EventSummary; headingLevel?: 2 | 3 } = $props();
</script>

<article class="card frame">
	<p class="label">
		<span class="visually-hidden">Kategori: </span>{categoryLabel(event.category)}
	</p>

	{#if headingLevel === 2}
		<h2 class="display display--md card__t">{event.title}</h2>
	{:else}
		<h3 class="display display--md card__t">{event.title}</h3>
	{/if}

	<p class="card__meta">
		{#if event.venueName}
			<span><span class="visually-hidden">Stad: </span>{event.venueName}</span>
			<span aria-hidden="true"> · </span>
		{/if}
		<span class="visually-hidden">Tid: </span>
		<time datetime={machineDateTime(event.startsAt)}>
			{formatEventTime(event.startsAt, event.venueTimeZone)}
		</time>
	</p>
</article>

<style>
	.card {
		padding: 1.2rem;
		min-inline-size: 0;
		display: grid;
		gap: 0.5rem;
		align-content: start;
		/* A card is a narrow container inside a wide viewport — the exact case where a viewport
		   step is wrong. At --step-mid (32px at 1440) titles wrapped so tightly that adjacent
		   cards read as one run-on string. */
		container-type: inline-size;
	}
	.card__t {
		font-size: clamp(0.95rem, 8.5cqw, 1.5rem);
		margin: 0;
		/* Long Finnish and Norwegian compounds are the norm here, not the exception. */
		hyphens: auto;
	}
	.card__meta {
		margin: 0;
		overflow-wrap: anywhere;
		font-size: var(--step-micro);
		letter-spacing: 0.18em;
		text-transform: uppercase;
		color: var(--peach-dim);
	}
</style>
