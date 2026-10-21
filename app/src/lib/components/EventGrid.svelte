<script lang="ts">
	import EventTile from './EventTile.svelte';
	import { stackOccurrences } from '../occurrences.ts';
	import type { UpcomingEvent } from '../events.remote';
	import type { Trend } from '../trend.ts';

	/**
	 * One day's events as a responsive grid of tiles.
	 *
	 * Lifted out of `EventsByDay` when `/kalender/<dato>` needed the same grid without a day
	 * heading — the page's own h1 already *is* the date, and a second heading saying it again is
	 * noise in the outline as well as on the screen. Extracting it rather than adding a
	 * `showHeading` flag keeps each component answerable for one thing: this one lays out a day,
	 * `EventsByDay` decides where the days begin and end.
	 *
	 * The alternative was a third event card, which this repo has already paid for once.
	 */
	let {
		events,
		hearts = {},
		views = null,
		trends = null,
		featured = false
	}: {
		events: UpcomingEvent[];
		/** Heart counts by event id, fetched in bulk by the page rather than per tile. */
		hearts?: Record<number, number>;
		/**
		 * Open counts by event id — only for /poppis/vist, which is ordered by them.
		 *
		 * Null on every other listing, so no tile renders the number. A view count on the front
		 * page would turn "what is on near you soonest" into a popularity ranking in the reader's
		 * head, and push every quiet event down for no reason.
		 */
		views?: Record<number, number> | null;
		/**
		 * Trends by event id, for /poppis/vist alone, as `views` is. A card's place is its position
		 * in this grid, so the grid is what numbers them.
		 */
		trends?: Record<number, Trend> | null;
		/**
		 * Render this day's tiles as the leading ones: wider cells, a larger title cap, and the
		 * calendar link.
		 *
		 * Only the front page asks for it, and only for the first day it shows. It is a property of
		 * WHERE the grid sits on the page, not of the events in it — the same rows are ordinary
		 * tiles on /hendingar an hour later.
		 */
		featured?: boolean;
	} = $props();
</script>

<ul class="tile-grid" class:tile-grid--featured={featured}>
	<!--
		Repeats of the same event share a card. Public swimming runs four times a day; four
		identical posters spend a screenful saying one thing. Each time is still its own event
		with its own page — the grouping is presentation only.
	-->
	{#each stackOccurrences(events) as stack, i (stack.lead.id)}
		<li class="rise" style:--rise-delay="{Math.min(i, 7) * 45}ms">
			<EventTile
				event={stack.lead}
				occurrences={stack.occurrences}
				hearts={hearts[stack.lead.id] ?? 0}
				views={views ? (views[stack.lead.id] ?? 0) : null}
				trend={trends?.[stack.lead.id] ?? null}
				place={trends ? i + 1 : null}
				{featured}
			/>
		</li>
	{/each}
</ul>

<style>
	/*
	 * The leading day gets one column fewer at every step, so its cards are wider.
	 *
	 * A size difference, not a different layout: same tiles, same gaps, same breakpoints, so the
	 * page still reads as one list with its first day nearer the front rather than as two
	 * components stacked. Below 34rem it is left alone — a single column cannot be made wider, and
	 * that is exactly the width where density matters most.
	 */
	@media (width >= 60rem) {
		.tile-grid--featured {
			grid-template-columns: repeat(2, 1fr);
		}
	}
	@media (width >= 80rem) {
		.tile-grid--featured {
			grid-template-columns: repeat(3, 1fr);
		}
	}
</style>
