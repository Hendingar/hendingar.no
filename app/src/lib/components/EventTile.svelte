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

		{#if event.venueName}
			<p class="tile__meta"><span class="visually-hidden">Stad: </span>{event.venueName}</p>
		{/if}
	</div>

	{#if event.sourceName}
		<!--
			Whose calendar this came from, in the corner rather than in front of the venue.

			Decorative: the source is named in full on the event's own page and on /datasamling, so
			repeating it as text on every tile would add noise to a screen reader for information a
			reader can already reach. `title` still names it for a pointer user.
		-->
		<span class="tile__src" title={`Kjelde: ${event.sourceName}`}>
			<SourceIcon src={event.sourceIconUrl} name={event.sourceName} size="1.1rem" />
		</span>
	{/if}
</article>

<style>
	/*
	 * The source mark sits in the bottom-right corner of the tile.
	 *
	 * Absolute, so it never pushes the venue line around or wraps a long venue name onto a second
	 * row. It sits above the link's stretched ::after overlay so its tooltip is reachable, but is
	 * `pointer-events: none` so it never steals the click the whole tile is meant to take.
	 */
	.tile__src {
		position: absolute;
		inset-block-end: 0.55rem;
		inset-inline-end: 0.55rem;
		z-index: 1;
		display: inline-flex;
		pointer-events: none;
		/* A third party's mark: dimmed so it sits inside our palette rather than competing with
		   the title, and brought up on hover when the reader is actually looking at this card. */
		opacity: 0.55;
		transition: opacity 160ms ease;
	}
	.tile:hover .tile__src {
		opacity: 1;
	}

	.tile {
		position: relative;
		display: grid;
		grid-template-rows: auto 1fr;
		block-size: 100%;
		min-inline-size: 0;
		container-type: inline-size;
		background: var(--navy-900);
		/* Clips the poster's hover scale. Without it the image grows past the frame and overlaps
		   the tile beside it. An outline is not clipped by overflow, so focus is unaffected. */
		overflow: hidden;
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
	/*
	 * Hover: lift, warm the frame, and let the poster breathe.
	 *
	 * `translateY` on the tile rather than a scale, because scaling resamples the poster and makes
	 * text inside the card shimmer. The shadow is the navy ground darkened rather than black, so it
	 * reads on the dark page instead of turning into a grey halo.
	 */
	.tile {
		transition:
			transform 180ms ease,
			border-color 180ms ease,
			box-shadow 180ms ease;
	}
	.tile:hover {
		transform: translateY(-3px);
		border-color: var(--peach);
		box-shadow: 0 10px 24px -12px rgb(0 0 0 / 0.75);
	}
	.tile:hover .tile__link {
		color: var(--peach-hi);
	}
	.tile:hover :global(.thumb) {
		transform: scale(1.03);
	}
	:global(.tile .thumb) {
		transition: transform 220ms ease;
	}
	/* Everything above is decoration on top of a working card. Anyone who has asked their system
	   for less movement gets the colour change and none of the motion. */
	@media (prefers-reduced-motion: reduce) {
		.tile,
		.tile__src,
		:global(.tile .thumb) {
			transition: none;
		}
		.tile:hover {
			transform: none;
		}
		.tile:hover :global(.thumb) {
			transform: none;
		}
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
