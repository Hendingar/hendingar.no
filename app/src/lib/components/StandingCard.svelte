<script lang="ts">
	import { categoryLabel } from '@hendingar/core/taxonomy';
	import { eventPath } from '@hendingar/core/slug';
	import EventThumb from './EventThumb.svelte';
	import SourceIcon from './SourceIcon.svelte';
	import type { StandingOffer } from '../events.remote';

	/**
	 * A place that is open, not an event that happens.
	 *
	 * Deliberately NOT `EventTile`. That card's whole vocabulary is time — a peach clock chip, an
	 * "om 3 t" badge, a day heading above it — and none of it means anything here. Reusing it would
	 * have forced a clock onto something that has none, which is exactly how the escape room came to
	 * announce itself at 01:00 every morning for five years.
	 *
	 * What replaces the clock is the category, because that is the useful thing to know about
	 * somewhere you might go: a museum, a swimming hall, a gallery. The time is simply absent rather
	 * than filled with something true-but-useless like "opna 1. januar 2023".
	 */
	let { offer }: { offer: StandingOffer } = $props();

	const marks = $derived(offer.sourceMarks ?? []);
	const shown = $derived(marks.slice(0, 3));
	const marksTitle = $derived(
		marks.length === 1
			? `Kjelde: ${marks[0]!.name}`
			: `Kjelder: ${marks.map((m) => m.name).join(', ')}`
	);

	const where = $derived(
		[offer.venueName, offer.municipality].filter(Boolean).filter((v, i, a) => a.indexOf(v) === i)
	);
</script>

<article class="card frame">
	<EventThumb
		id={offer.id}
		posterUrl={offer.posterUrl}
		posterSrcset={offer.posterSrcset}
		title={offer.title}
	/>

	<div class="card__body">
		<!--
			The category where the clock would be, outlined rather than filled.
			Filled peach is this site's mark for a fixed time; this is the opposite of one.
		-->
		<p class="card__kind">
			<span class="visually-hidden">Kategori: </span>{categoryLabel(offer.category)}
		</p>

		<h3 class="display display--md card__t">
			<a class="card__link" href={eventPath(offer.id, offer.title)}>{offer.title}</a>
		</h3>

		{#if where.length > 0}
			<p class="card__meta"><span class="visually-hidden">Stad: </span>{where.join(', ')}</p>
		{/if}
	</div>

	{#if marks.length > 0}
		<span class="card__src" title={marksTitle}>
			{#each shown as mark (mark.name)}
				<SourceIcon src={mark.iconUrl} name={mark.name} size="1.1rem" />
			{/each}
		</span>
	{/if}
</article>

<style>
	.card {
		position: relative;
		display: grid;
		grid-template-rows: auto 1fr;
		block-size: 100%;
		min-inline-size: 0;
		container-type: inline-size;
		background: var(--navy-900);
		overflow: hidden;
		transition:
			transform var(--dur-base) var(--ease-out),
			border-color var(--dur-base) ease,
			box-shadow var(--dur-base) ease;
	}
	.card:hover {
		transform: translateY(-3px);
		border-color: var(--peach);
		box-shadow: 0 10px 24px -12px rgb(0 0 0 / 0.75);
	}
	.card:hover .card__link {
		color: var(--peach-hi);
	}
	.card:hover :global(.thumb) {
		transform: scale(1.03);
	}
	:global(.card .thumb) {
		transition: transform var(--dur-base) var(--ease-out);
	}

	.card__body {
		padding: 0.85rem 0.9rem 1rem;
		display: grid;
		gap: 0.45rem;
		align-content: start;
	}
	.card__kind {
		justify-self: start;
		margin: 0;
		font-family: var(--font-mono);
		font-size: var(--step-micro);
		font-weight: 700;
		letter-spacing: 0.14em;
		text-transform: uppercase;
		color: var(--peach);
		border: var(--rule) solid var(--peach);
		padding: 0.3em 0.55em;
	}
	.card__t {
		font-size: clamp(0.95rem, 7cqw, 1.2rem);
		margin: 0;
		hyphens: auto;
	}
	.card__link {
		color: inherit;
		text-decoration: none;
	}
	.card__link::after {
		content: '';
		position: absolute;
		inset: 0;
	}
	.card__meta {
		margin: 0;
		overflow-wrap: anywhere;
		font-size: var(--step-micro);
		letter-spacing: 0.16em;
		text-transform: uppercase;
		color: var(--peach-dim);
	}

	.card__src {
		position: absolute;
		inset-block-end: 0.55rem;
		inset-inline-end: 0.55rem;
		z-index: 1;
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
		pointer-events: none;
		opacity: 0.55;
		transition: opacity var(--dur-fast) ease;
	}
	.card:hover .card__src {
		opacity: 1;
	}

	.card:has(.card__link:focus-visible) {
		outline: 2px solid var(--peach);
		outline-offset: 2px;
	}
	.card__link:focus-visible {
		outline: none;
	}

	@media (prefers-reduced-motion: reduce) {
		.card,
		.card__src,
		:global(.card .thumb) {
			transition: none;
		}
		.card:hover {
			transform: none;
		}
		.card:hover :global(.thumb) {
			transform: none;
		}
	}
</style>
