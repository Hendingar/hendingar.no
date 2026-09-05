<script lang="ts">
	import { formatEventClock } from '@hendingar/core/datetime';
	import { categoryLabel } from '@hendingar/core/taxonomy';
	import EventThumb from '../EventThumb.svelte';
	import type { WeekTimedEvent } from '../../events.remote';

	/**
	 * The card that appears when you hover a block in the week grid.
	 *
	 * A block in a three-lane column is about 70px wide. That is enough to find something and not
	 * enough to decide about it — the title is clipped and the poster, which is the thing that
	 * actually tells you what a gig is, has nowhere to go. So the grid stays dense and hovering
	 * one block shows it properly.
	 *
	 * It is **decorative**, and marked so. Everything here is already the link's accessible name or
	 * one click away on the event's own page, and a live region firing on every mouse-over as the
	 * pointer crosses a busy Saturday would be worse than useless to a screen reader. It also never
	 * takes pointer events: the reader is aiming at the block underneath it.
	 *
	 * Rendered as a sibling of the scroller rather than inside it. `.week` carries `contain: paint`,
	 * which clips fixed-position descendants too — a preview inside it would be cut off by the very
	 * edge it needs to escape.
	 */
	let {
		event,
		x,
		y
	}: {
		event: WeekTimedEvent;
		/** Viewport coordinates, already flipped away from the edges by the grid. */
		x: number;
		y: number;
	} = $props();

	const ends = $derived(event.endsAt ? formatEventClock(event.endsAt, event.venueTimeZone) : null);
</script>

<div class="peek" style:--x="{x}px" style:--y="{y}px" aria-hidden="true">
	<EventThumb
		id={event.id}
		posterUrl={event.posterUrl}
		posterSrcset={event.posterSrcset}
		title={event.title}
	/>
	<div class="peek__body">
		<p class="peek__top">
			<span class="peek__time">
				{formatEventClock(event.startsAt, event.venueTimeZone)}{ends ? `–${ends}` : ''}
			</span>
			<span class="peek__cat">{categoryLabel(event.category)}</span>
		</p>
		<p class="peek__t display display--md">{event.title}</p>
		{#if event.venueName}
			<p class="peek__venue">{event.venueName}</p>
		{/if}
	</div>
</div>

<style>
	.peek {
		position: fixed;
		inset-block-start: var(--y);
		inset-inline-start: var(--x);
		inline-size: 17rem;
		z-index: 20;
		/* The reader is aiming at the block underneath. A card that eats the click would make the
		   densest part of the grid the hardest part to use. */
		pointer-events: none;
		background: var(--navy-900);
		border: var(--rule) solid var(--peach);
		box-shadow: 0 12px 32px -14px rgb(0 0 0 / 0.8);
		animation: peek-in var(--dur-fast) var(--ease-out) both;
	}

	@keyframes peek-in {
		from {
			opacity: 0;
			transform: translateY(4px);
		}
		to {
			opacity: 1;
			transform: none;
		}
	}

	.peek__body {
		display: grid;
		gap: 0.3rem;
		padding: 0.7rem 0.8rem 0.85rem;
	}
	.peek__top {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.5rem;
		margin: 0;
	}
	.peek__time {
		font-family: var(--font-mono);
		font-size: var(--step-micro);
		font-weight: 700;
		letter-spacing: 0.16em;
		background: var(--peach);
		color: var(--navy-900);
		padding: 0.2em 0.45em;
	}
	.peek__cat {
		font-family: var(--font-mono);
		font-size: var(--step-micro);
		font-weight: 700;
		letter-spacing: 0.2em;
		text-transform: uppercase;
		color: var(--peach-dim);
	}
	.peek__t {
		margin: 0;
		font-size: 1.15rem;
	}
	.peek__venue {
		margin: 0;
		font-family: var(--font-mono);
		font-size: var(--step-micro);
		letter-spacing: 0.14em;
		text-transform: uppercase;
		color: var(--peach-dim);
		overflow-wrap: anywhere;
	}

	@media (prefers-reduced-motion: reduce) {
		.peek {
			animation: none;
		}
	}
</style>
