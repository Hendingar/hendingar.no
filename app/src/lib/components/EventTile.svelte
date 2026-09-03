<script lang="ts">
	import { categoryLabel } from '@hendingar/core/taxonomy';
	import { eventPath } from '@hendingar/core/slug';
	import { formatEventClock, machineDateTime } from '@hendingar/core/datetime';
	import EventThumb from './EventThumb.svelte';
	import SourceIcon from './SourceIcon.svelte';
	import HeartButton from './HeartButton.svelte';
	import type { UpcomingEvent } from '../events.remote';
	import type { Occurrence } from '../occurrences.ts';

	/**
	 * `occurrences` is every time this event runs today, the lead included.
	 *
	 * Four identical swimming posters down the page spend a screenful saying one thing, so repeats
	 * of the same event on the same day share a card and list their times. Each time is still its
	 * own event with its own page — this is presentation, not a merge.
	 */
	let {
		event,
		occurrences = [],
		hearts = 0
	}: { event: UpcomingEvent; occurrences?: Occurrence[]; hearts?: number } = $props();

	// More than one time to show. A single occurrence keeps the plain clock it always had.
	const repeats = $derived(occurrences.length > 1);

	/*
	 * Three marks fit the corner; a fourth starts crowding the venue line on a narrow tile.
	 *
	 * Capping rather than wrapping keeps the corner a corner — a mark row that grows onto a second
	 * line pushes into the title, which is the one thing on the tile that must stay readable. The
	 * count says what was left out, and the tooltip still names every source.
	 */
	const marks = $derived(event.sourceMarks ?? []);
	const shown = $derived(marks.slice(0, 3));
	const overflow = $derived(marks.length - shown.length);
	const marksTitle = $derived(
		marks.length === 1
			? `Kjelde: ${marks[0]!.name}`
			: `Kjelder: ${marks.map((m) => m.name).join(', ')}`
	);
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
			{#if repeats}
				<span class="tile__count">{occurrences.length}&nbsp;tider</span>
			{/if}
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

		{#if repeats}
			<!--
				The other times, as links.

				A real list, so it is announced as one and each time is reachable — the whole point is
				that these are separate events, not decoration on one. The lead's own time appears
				here too rather than being special-cased out: a reader scanning for 18:00 should find
				it in the same place whether it happens to be first or fourth.
			-->
			<ul class="times" aria-label={`Fleire tider for ${event.title}`}>
				{#each occurrences as occurrence (occurrence.id)}
					<li>
						<a
							class="times__t"
							href={eventPath(occurrence.id, event.title)}
							aria-current={occurrence.id === event.id ? 'true' : undefined}
						>
							<time datetime={machineDateTime(occurrence.startsAt)}>
								{formatEventClock(occurrence.startsAt, occurrence.venueTimeZone)}
							</time>
						</a>
					</li>
				{/each}
			</ul>
		{/if}
	</div>

	<!--
		The heart sits in the top-right of the poster, opposite the source marks in the bottom-right.

		Above the tile's stretched link overlay so it can be tapped, and it stops the click itself —
		otherwise hearting an event opens it.
	-->
	<div class="tile__heart">
		<HeartButton eventId={event.id} {hearts} />
	</div>

	{#if marks.length > 0}
		<!--
			Whose calendars this came from, in the corner rather than in front of the venue.

			All of them, not just the one whose row won consolidation — "three places say this is on"
			is the most useful thing an index can tell you, and the winning row is arbitrary (the
			lowest id), so showing one mark credits whichever importer happened to run first.

			Decorative: the sources are named in full on the event's own page and on /datasamling, so
			repeating them as text on every tile would add noise to a screen reader for information a
			reader can already reach. `title` still names them all for a pointer user.
		-->
		<span class="tile__src" title={marksTitle}>
			{#each shown as mark (mark.name)}
				<SourceIcon src={mark.iconUrl} name={mark.name} size="1.1rem" />
			{/each}
			{#if overflow > 0}
				<span class="tile__srcmore" aria-hidden="true">+{overflow}</span>
			{/if}
		</span>
	{/if}
</article>

<style>
	.tile__count {
		font-family: var(--font-mono);
		font-size: var(--step-micro);
		letter-spacing: 0.1em;
		text-transform: uppercase;
		color: var(--peach-dim);
		margin-inline-start: auto;
	}

	.times {
		list-style: none;
		margin: 0.5rem 0 0;
		padding: 0;
		display: flex;
		flex-wrap: wrap;
		gap: 0.3rem;
		/*
		 * Above the link's stretched ::after overlay, or the whole card would swallow these clicks
		 * and every time would open the first one.
		 */
		position: relative;
		z-index: 1;
	}
	.times__t {
		display: inline-block;
		font-family: var(--font-mono);
		font-size: var(--step-micro);
		letter-spacing: 0.08em;
		text-decoration: none;
		color: var(--peach);
		border: var(--rule) solid var(--peach-line);
		padding: 0.2em 0.5em;
	}
	.times__t:hover {
		border-color: var(--peach);
	}
	/* The time this card leads with, marked so the reader can tell which one they were looking at. */
	.times__t[aria-current='true'] {
		background: var(--peach);
		color: var(--navy-900);
		border-color: var(--peach);
	}

	/*
	 * The source mark sits in the bottom-right corner of the tile.
	 *
	 * Absolute, so it never pushes the venue line around or wraps a long venue name onto a second
	 * row. It sits above the link's stretched ::after overlay so its tooltip is reachable, but is
	 * `pointer-events: none` so it never steals the click the whole tile is meant to take.
	 */
	/*
	 * Opposite corner to the source marks, and above the link overlay.
	 *
	 * `pointer-events: auto` is not redundant: the mark row beside it sets `none` so it never steals
	 * the tile's click, and this one must do the exact opposite.
	 */
	.tile__heart {
		position: absolute;
		inset-block-start: 0.35rem;
		inset-inline-end: 0.35rem;
		z-index: 2;
		pointer-events: auto;
		/* Legible over a bright poster, the same problem the source mark has. */
		background: color-mix(in srgb, var(--navy-900) 68%, transparent);
		border-radius: 999px;
		backdrop-filter: blur(2px);
	}

	.tile__src {
		position: absolute;
		inset-block-end: 0.55rem;
		inset-inline-end: 0.55rem;
		z-index: 1;
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
		pointer-events: none;
		/* A third party's mark: dimmed so it sits inside our palette rather than competing with
		   the title, and brought up on hover when the reader is actually looking at this card. */
		opacity: 0.55;
		transition: opacity var(--dur-fast) ease;
	}
	.tile:hover .tile__src {
		opacity: 1;
	}
	.tile__srcmore {
		font-family: var(--font-mono);
		font-size: var(--step-micro);
		color: var(--peach-dim);
		line-height: 1;
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
			transform var(--dur-base) var(--ease-out),
			border-color var(--dur-base) ease,
			box-shadow var(--dur-base) ease;
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
		transition: transform var(--dur-base) var(--ease-out);
	}
	/* Everything above is decoration on top of a working card. Anyone who has asked their system
	   for less movement gets the colour change and none of the motion. */
	/*
	 * Below the grid's first breakpoint the tile becomes a row: text left, a square thumbnail
	 * right.
	 *
	 * Measured, not guessed. The poster-on-top card is 315px tall on a 390x844 phone, so 2.7
	 * events fit on screen and finding next Friday means a lot of scrolling past pictures. As a
	 * row it is about a third of that. The poster still earns its place at wider widths, where
	 * there is room for it beside its neighbours.
	 *
	 * A media query rather than a container query, deliberately: the tile is FULL width on a phone
	 * and NARROW in a desktop grid column, so its own width says nothing about which layout it is
	 * in — a container query here fires on exactly the wrong one. 34rem matches where
	 * EventsByDay's grid actually goes multi-column.
	 */
	@media (width < 34rem) {
		.tile {
			grid-template-columns: minmax(0, 1fr) 5.5rem;
			grid-template-rows: auto;
		}
		.tile__body {
			grid-column: 1;
			grid-row: 1;
			padding: 0.6rem 0.7rem 0.65rem;
			gap: 0.1rem;
			align-content: center;
		}
		/* EventThumb's root element carries .thumb, so this reaches past the scoping boundary the
		   same way the hover rule above already does. */
		.tile > :global(.thumb) {
			grid-column: 2;
			grid-row: 1;
			inline-size: 5.5rem;
			block-size: 100%;
			aspect-ratio: auto;
			/* The rule moves from under the poster to beside it, so the row still reads as one
			   object rather than two glued together. */
			border-block-end: none;
			border-inline-start: var(--rule) solid var(--peach-line);
		}
		.tile__t {
			font-size: 1.05rem;
			line-height: 1.15;
		}
		.tile__top {
			font-size: var(--step-micro);
		}
		.tile__meta {
			font-size: 0.8125rem;
		}
		/* Over a photograph now rather than over our own navy, so it needs its own ground to stay
		   legible — without it the mark disappears into a bright poster. */
		.tile__src {
			inset-block-end: 0.3rem;
			inset-inline-end: 0.3rem;
			padding: 0.15rem;
			background: color-mix(in srgb, var(--navy-900) 78%, transparent);
			opacity: 0.9;
		}
	}

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
