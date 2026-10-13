<script lang="ts">
	import { error } from '@sveltejs/kit';
	import { page } from '$app/state';
	import { eventIdFromParam, eventPath } from '@hendingar/core/slug';
	import {
		formatCalendarDate,
		formatDayLabel,
		formatEventClock,
		machineDateTime
	} from '@hendingar/core/datetime';
	import { filmScreenings, getEvent } from '../../../../lib/events.remote';
	import { screeningDays, showsInSeveralRooms } from '../../../../lib/screenings.ts';
	import { safeHttpUrl } from '../../../../lib/source-link.ts';
	import PageMeta from '../../../../lib/components/PageMeta.svelte';

	/**
	 * A film's programme: every screening from now on, a day at a time, so a visit can be planned.
	 *
	 * Where "Vis alle tider" on a cinema card goes. It used to open the times inside the card, which
	 * is a list squeezed into a thumbnail's width with nowhere to put a ticket link, and gone again
	 * the moment you scroll. Planning a cinema trip is a page's worth of looking — which day, which
	 * room, which time suits — so it is a page, with an address you can send to whoever is coming.
	 *
	 * Hung off a screening's address rather than a film slug of its own: a film has no row here,
	 * only screenings that share a title, and `filmScreenings` already recovers the film from any
	 * one of them. The screening the reader came from is the one marked.
	 */
	const id = eventIdFromParam(page.params.slug ?? '');
	if (id === null) error(404, 'Fann ikkje filmen');

	// Top-level await, so the whole programme is in the server-rendered HTML (CLAUDE.md).
	const event = await getEvent(id);
	const programme = await filmScreenings(event.id);
	if (!programme.film) error(404, 'Dette er ikkje ei filmvising');

	const days = $derived(screeningDays(programme.screenings));
	const rooms = $derived(showsInSeveralRooms(programme.screenings));
	const today = $derived(programme.todayLocalDate);
	const canonical = $derived(`${eventPath(event.id, event.title)}/tider`);
</script>

<PageMeta
	title="{event.title} — alle tider — hendingar.no"
	description={`Alle visingane av ${event.title} frå i dag og framover, dag for dag.`}
	path={canonical}
/>

<article class="film">
	<div class="shell">
		<p class="film__back"><a href={eventPath(event.id, event.title)}>← {event.title}</a></p>

		<div class="film__grid">
			{#if event.posterUrl}
				<img
					class="film__poster"
					src={event.posterUrl}
					srcset={event.posterSrcset}
					sizes={event.posterSrcset ? '(width < 48rem) 40vw, 18rem' : undefined}
					alt={`Plakat for ${event.title}`}
					decoding="async"
					referrerpolicy="no-referrer"
				/>
			{/if}

			<header class="film__head">
				<p class="label">
					Alle tider{#if event.sourceName}&nbsp;· {event.sourceName}{/if}
				</p>
				<h1 class="display film__h">{event.title}</h1>
			</header>

			<div class="film__main">
				{#if days.length === 0}
					<p class="film__none">
						Ingen fleire visingar er lagde ut. Kinoen legg ut nye tider fortløpande — sjå
						<a href={eventPath(event.id, event.title)}>sida til filmen</a> for kjelda.
					</p>
				{:else}
					{#each days as day (day.localDate)}
						{@const label = today ? formatDayLabel(day.localDate, today) : null}
						<section class="day" aria-labelledby={`dag-${day.localDate}`}>
							<h2 class="day__h" id={`dag-${day.localDate}`}>
								<!-- "I dag" and "I morgon" say when, relative to now; the date beside them is
								     what a reader planning with somebody else will actually quote. -->
								{label ?? formatCalendarDate(day.localDate)}
								{#if label === 'I dag' || label === 'I morgon'}
									<span class="day__date">{formatCalendarDate(day.localDate)}</span>
								{/if}
							</h2>
							<ul class="day__list">
								{#each day.screenings as screening (screening.id)}
									{@const ticket = safeHttpUrl(screening.ctaUrl)}
									<li class="show" class:show--here={screening.id === event.id}>
										<a class="show__t" href={eventPath(screening.id, event.title)}>
											<time datetime={machineDateTime(screening.startsAt)}>
												{formatEventClock(screening.startsAt, screening.venueTimeZone)}
											</time>
											{#if rooms && screening.venueName}
												<span class="show__room">{screening.venueName}</span>
											{/if}
										</a>
										{#if ticket}
											<a class="show__ticket" href={ticket} rel="noopener" target="_blank">
												Billett<span class="visually-hidden">
													til {formatEventClock(screening.startsAt, screening.venueTimeZone)}</span
												> ↗
											</a>
										{/if}
									</li>
								{/each}
							</ul>
						</section>
					{/each}
				{/if}

				{#if !rooms && event.venueName}
					<!-- Once, rather than beside every time, when every screening is in the same room. -->
					<p class="film__where label">Alle visingane er i {event.venueName}</p>
				{/if}
			</div>
		</div>
	</div>
</article>

<style>
	.film {
		padding-block: clamp(1.25rem, 3vw, 2rem) clamp(2.5rem, 6vw, 5rem);
	}
	.film__back {
		margin: 0 0 1.25rem;
		font-family: var(--font-mono);
		font-size: var(--step-micro);
		letter-spacing: 0.14em;
		text-transform: uppercase;
	}
	/*
	 * On a phone the poster is a thumbnail beside the title, not a screen above it: the times are
	 * what the reader came for, and a full-width poster put the first one below the fold. From
	 * 48rem it is a column of its own beside the whole programme, and stays in view while the
	 * days scroll past.
	 */
	.film__grid {
		display: grid;
		gap: 1rem clamp(1rem, 3vw, 2.5rem);
		grid-template-columns: 5.5rem minmax(0, 1fr);
		grid-template-areas:
			'poster head'
			'main main';
		align-items: start;
	}
	.film__poster {
		grid-area: poster;
		display: block;
		inline-size: 100%;
		block-size: auto;
		border: var(--rule) solid var(--peach-line);
	}
	.film__head {
		grid-area: head;
		min-inline-size: 0;
		align-self: center;
		/* Display type is sized against its own column, never the viewport — docs/brand.md. */
		container-type: inline-size;
	}
	.film__main {
		grid-area: main;
		min-inline-size: 0;
		container-type: inline-size;
	}
	@media (width >= 48rem) {
		.film__grid {
			grid-template-columns: 18rem minmax(0, 1fr);
			grid-template-areas:
				'poster head'
				'poster main';
		}
		.film__head {
			align-self: start;
		}
		.film__poster {
			position: sticky;
			inset-block-start: 1.5rem;
		}
	}
	/*
	 * Sized so a one-word title fits its column whole. Beside the phone thumbnail that column is
	 * about 246px, and "Pensjonskuppet" (14 capitals at ~0.92em) needs the floor at 1.1rem to fit
	 * it — a 1.35rem floor broke it after the second P. Where a word is still too long, it
	 * hyphenates where the browser can (the page is lang=nn) and breaks where it cannot.
	 */
	.film__h {
		font-size: clamp(1.1rem, 7cqw, 3.5rem);
		margin: 0.2em 0 0;
		hyphens: auto;
		overflow-wrap: break-word;
	}

	.day {
		border-block-start: var(--rule) solid var(--peach-line);
		padding-block: 0.9rem 1.1rem;
	}
	.day__h {
		margin: 0 0 0.65rem;
		font-family: var(--font-display);
		font-weight: 800;
		font-stretch: 108%;
		font-size: clamp(1.05rem, 3.4cqw, 1.35rem);
		text-transform: uppercase;
		color: var(--peach);
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: 0.25rem 0.75rem;
	}
	.day__date {
		font-family: var(--font-mono);
		font-weight: 400;
		font-size: var(--step-micro);
		letter-spacing: 0.12em;
		color: var(--peach-dim);
	}
	.day__list {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
	}

	/* One screening: the time as the big target, the ticket as a smaller one joined to it. */
	.show {
		display: flex;
		align-items: stretch;
		border: var(--rule) solid var(--peach-line);
	}
	.show--here {
		border-color: var(--peach);
	}
	.show__t {
		display: inline-flex;
		align-items: baseline;
		gap: 0.5em;
		min-block-size: 2.75rem;
		padding: 0.55rem 0.8rem;
		font-family: var(--font-mono);
		font-size: 1.125rem;
		font-weight: 700;
		letter-spacing: 0.06em;
		text-decoration: none;
		color: var(--peach);
		font-variant-numeric: tabular-nums;
	}
	.show__t:hover {
		background: var(--peach-ghost);
	}
	.show--here .show__t {
		background: var(--peach);
		color: var(--navy-900);
	}
	.show__room {
		font-size: var(--step-micro);
		font-weight: 400;
		letter-spacing: 0.06em;
	}
	.show__ticket {
		display: inline-flex;
		align-items: center;
		padding: 0 0.75rem;
		border-inline-start: var(--rule) solid var(--peach-line);
		font-family: var(--font-mono);
		font-size: var(--step-micro);
		font-weight: 700;
		letter-spacing: 0.14em;
		text-transform: uppercase;
		text-decoration: none;
		color: var(--peach-dim);
	}
	.show__ticket:hover {
		color: var(--peach);
		background: var(--peach-ghost);
	}

	.film__none {
		max-inline-size: 40ch;
	}
	.film__where {
		margin-block-start: 1rem;
		color: var(--peach-dim);
	}
</style>
