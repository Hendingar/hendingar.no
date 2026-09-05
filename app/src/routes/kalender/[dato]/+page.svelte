<script lang="ts">
	import { error } from '@sveltejs/kit';
	import { page } from '$app/state';
	import { formatCalendarDate, formatMonthName, isCalendarDate } from '@hendingar/core/datetime';
	import EventGrid from '../../../lib/components/EventGrid.svelte';
	import { monthKeyOf } from '../../../lib/calendar.ts';
	import { adjacentEventDays, listEventsOnDate } from '../../../lib/events.remote';
	import { heartCounts } from '../../../lib/hearts.remote';

	/**
	 * One calendar day.
	 *
	 * A malformed or impossible date is a 404, not an empty page. `2026-02-31` and `i-morgon` both
	 * match "something in the URL" and neither is a day, so answering them with a nicely rendered
	 * "ingen hendingar" would tell a reader — and a crawler — that a date exists when it does not.
	 * Checked before the query so nothing reaches the database, and `isCalendarDate` is the same
	 * rule `calendarDateSchema` validates the query argument with.
	 *
	 * A *real* date with nothing on it is the opposite case and is answered with a page: the URL is
	 * linkable and guessable, somebody may have bookmarked it, and "nothing that day" is a true and
	 * useful answer.
	 */
	const date = page.params.dato ?? '';
	if (!isCalendarDate(date)) error(404, 'Fann ikkje datoen');

	// Top-level await, so the day's events are in the server-rendered HTML rather than arriving
	// after hydration. A calendar page that renders "Lastar…" to a crawler indexes nothing.
	const events = await listEventsOnDate(date);
	const hearts = Object.fromEntries(
		(await heartCounts(events.map((e) => e.id))).map((h) => [h.eventId, h.hearts])
	);
	const neighbours = await adjacentEventDays(date);

	const heading = formatCalendarDate(date);
	const month = monthKeyOf(date);
</script>

<svelte:head>
	<title>{heading} — hendingar.no</title>
	<meta
		name="description"
		content={events.length > 0
			? `${events.length === 1 ? 'Éi hending' : `${events.length} hendingar`} i Sunnhordland ${heading.toLowerCase()}.`
			: `Ingen registrerte hendingar i Sunnhordland ${heading.toLowerCase()}.`}
	/>
</svelte:head>

<div class="shell day-page">
	<p class="label">
		<a href="/kalender?maanad={month}">Kalender</a> · {formatMonthName(month)}
	</p>
	<h1 class="display day-page__h">{heading}</h1>

	{#if events.length > 0}
		<p class="day-page__count">
			{events.length === 1 ? 'Éi hending' : `${events.length} hendingar`}
		</p>
		<!-- EventGrid, not a new card: the same tiles as the front page and /hendingar, so a day
		     looks like the site rather than like a second product. -->
		<EventGrid {events} {hearts} />
	{:else}
		<p class="day-page__empty">Ingen hendingar denne dagen — enno.</p>
		<p class="day-page__note">
			Vi samlar inn frå kalendrane vi kjenner til. Veit du om noko som skjer,
			<a href="/send-inn">send det inn</a>.
		</p>
	{/if}

	<!--
		The arrows skip to the next day that has something on it, rather than stepping through empty
		Tuesdays one tap at a time. Absent when there is nothing to skip to within a month either
		side — at which point the grid is the right tool and says so.
	-->
	<nav class="steps" aria-label="Andre dagar">
		{#if neighbours.previous}
			<a class="steps__link" href="/kalender/{neighbours.previous}" rel="prev">
				<span aria-hidden="true">←</span>
				{formatCalendarDate(neighbours.previous)}
			</a>
		{/if}
		<a class="steps__link steps__link--month" href="/kalender?maanad={month}">
			Heile {formatMonthName(month).toLowerCase()}
		</a>
		{#if neighbours.next}
			<a class="steps__link steps__link--next" href="/kalender/{neighbours.next}" rel="next">
				{formatCalendarDate(neighbours.next)}
				<span aria-hidden="true">→</span>
			</a>
		{/if}
	</nav>
</div>

<style>
	.day-page {
		padding-block: clamp(2rem, 5vw, 4rem) var(--section-y);
		container-type: inline-size;
	}
	.day-page__h {
		/* cqw against this column, so the longest heading — "Onsdag 28. september 2027" — neither
		   overflows a desktop nor clips at 320px. */
		font-size: clamp(1.5rem, 8cqw, 3.5rem);
		margin-block: 0.4rem 0.8rem;
	}
	.day-page__count {
		font-family: var(--font-mono);
		font-size: var(--step-micro);
		font-weight: 700;
		letter-spacing: 0.18em;
		text-transform: uppercase;
		color: var(--peach-dim);
		margin-block: 0 1.25rem;
		padding-block-end: 0.5rem;
		border-block-end: var(--rule) solid var(--peach-line);
	}
	.day-page__empty {
		font-family: var(--font-display);
		font-weight: 800;
		font-stretch: 108%;
		font-size: var(--step-mid);
		text-transform: uppercase;
		line-height: 1.15;
		max-inline-size: 22ch;
	}
	.day-page__note {
		max-inline-size: 48ch;
		color: var(--peach-dim);
	}

	.steps {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		justify-content: space-between;
		gap: 0.75rem 1.5rem;
		margin-block-start: clamp(2rem, 4vw, 3rem);
		padding-block-start: 1rem;
		border-block-start: var(--rule) solid var(--peach-line);
	}
	.steps .steps__link {
		font-family: var(--font-mono);
		font-size: var(--step-micro);
		font-weight: 700;
		letter-spacing: 0.12em;
		text-transform: uppercase;
		text-decoration: none;
		color: var(--peach-dim);
	}
	.steps .steps__link:hover {
		color: var(--peach-hi);
	}
	.steps .steps__link--next {
		text-align: end;
	}
	.steps .steps__link--month {
		/* Always in the middle, whether or not there are arrows either side of it. */
		margin-inline: auto;
	}
</style>
