<script lang="ts">
	import { eventPath } from '@hendingar/core/slug';
	import { weekdayIndex } from '@hendingar/core/datetime';
	import { standingOffers, weeklyActivities } from '../../events.remote';
	import { dayView, weeklyHref } from '../../weekly-view.ts';

	/**
	 * What else a reader can go to on this date: the clubs, choirs and groups that meet that
	 * weekday, as small cards, and the places that are simply open.
	 *
	 * A day page used to end on one line naming a single escape room, while the forty-odd weekly
	 * activities meeting that same evening sat a click away on `/alltid-ope`, invisible from the
	 * page that asks "what is on this date". They are an honest part of that answer — they are just
	 * not appointments — so they come AFTER the events, in a card a third the size of an event tile,
	 * and never in the event grid itself.
	 *
	 * The day comes from the same `dayView` `/alltid-ope` uses, so a fortnightly service is shown on
	 * the dates it meets and not on the ones it does not, and the two pages can never disagree.
	 *
	 * Only the day pages get this. `/denne-helga` keeps its one line (`AlsoOpen`): across two or
	 * three days the same list would print once per date.
	 *
	 * Top-level await, so the cards are in the server-rendered HTML (CLAUDE.md).
	 */
	let { date }: { date: string } = $props();

	const [weekly, places] = await Promise.all([weeklyActivities(), standingOffers()]);

	/** Enough to show what kind of thing meets; the rest are one link away, on the right day. */
	const SHOWN = 18;

	const rows = $derived(dayView(weekly.activities, date, null).periods.flatMap((p) => p.rows));
	const shown = $derived(rows.slice(0, SHOWN));
	const more = $derived(weeklyHref(weekdayIndex(date), null));
</script>

{#if rows.length > 0 || places.length > 0}
	<section class="also-day" aria-labelledby="h-also-day">
		<header class="also-day__top">
			<h2 id="h-also-day" class="also-day__h">
				Fast denne dagen{#if rows.length > 0}<span class="also-day__n">{rows.length}</span>{/if}
			</h2>
			<a class="also-day__more" href={more}>Alltid ope →</a>
		</header>

		{#if shown.length > 0}
			<ul class="also-day__grid">
				{#each shown as r (`${r.id}-${r.from}`)}
					<li class="mini">
						<p class="mini__time">
							{r.from}{#if r.to}<span class="mini__to">–{r.to}</span>{/if}
						</p>
						<a class="mini__t" href={eventPath(r.id, r.title)}>{r.title}</a>
						{#if r.organizer || r.venue}
							<p class="mini__meta">{[r.organizer, r.venue].filter(Boolean).join(' · ')}</p>
						{/if}
					</li>
				{/each}
			</ul>
			{#if rows.length > shown.length}
				<a class="also-day__rest" href={more}>+ {rows.length - shown.length} fleire →</a>
			{/if}
		{/if}

		{#if places.length > 0}
			<!-- Places have no time to sort by, so they are a row of names under the cards rather
			     than cards with an empty clock. -->
			<div class="also-day__places">
				<span class="label">Alltid ope</span>
				<ul>
					{#each places as place (place.id)}
						<li>
							<a class="place" href={eventPath(place.id, place.title)}>{place.title}</a>
						</li>
					{/each}
				</ul>
			</div>
		{/if}
	</section>
{/if}

<style>
	.also-day {
		border-block-start: var(--rule) solid var(--peach-line);
		padding-block-start: 1.25rem;
		margin-block-start: 2rem;
		display: grid;
		gap: 1rem;
	}
	.also-day__top {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		justify-content: space-between;
		gap: 0.5rem 1rem;
	}
	.also-day__h {
		margin: 0;
		font-family: var(--font-display);
		font-weight: 800;
		font-stretch: 108%;
		font-size: clamp(1.15rem, 2.4vw, 1.5rem);
		line-height: 1;
		text-transform: uppercase;
		display: flex;
		align-items: baseline;
		gap: 0.5rem;
	}
	.also-day__n {
		font-family: var(--font-mono);
		font-size: var(--step-micro);
		font-weight: 700;
		color: var(--peach-dim);
	}
	.also-day__more,
	.also-day__rest {
		font-family: var(--font-mono);
		font-size: var(--step-micro);
		font-weight: 700;
		letter-spacing: 0.16em;
		text-transform: uppercase;
		color: var(--peach);
	}
	.also-day__rest {
		justify-self: start;
	}

	/* Many small cards: two across on a phone, as many as fit at ~13rem elsewhere. */
	.also-day__grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(min(13rem, 45%), 1fr));
		gap: 0.5rem;
		list-style: none;
		margin: 0;
		padding: 0;
	}
	.mini {
		position: relative;
		display: grid;
		align-content: start;
		gap: 0.35rem;
		min-inline-size: 0;
		padding: 0.7rem 0.8rem;
		background: var(--navy-900);
		border: var(--rule) solid var(--peach-line);
		transition: border-color var(--dur-fast) ease;
	}
	.mini:hover {
		border-color: var(--peach);
	}
	.mini__time {
		margin: 0;
		font-family: var(--font-mono);
		font-size: var(--step-micro);
		font-weight: 700;
		font-variant-numeric: tabular-nums;
		color: var(--peach);
	}
	.mini__to {
		color: var(--peach-dim);
		font-weight: 400;
	}
	.mini__t {
		font-family: var(--font-display);
		font-weight: 800;
		font-stretch: 105%;
		font-size: 0.95rem;
		line-height: 1.1;
		color: var(--peach-hi);
		text-decoration: none;
		overflow-wrap: anywhere;
	}
	/* The whole card is the target; the link stays the one named, focusable thing in it. */
	.mini__t::after {
		content: '';
		position: absolute;
		inset: 0;
	}
	.mini__t:focus-visible {
		outline: none;
	}
	.mini:has(.mini__t:focus-visible) {
		outline: 2px solid var(--peach-hi);
		outline-offset: 2px;
	}
	.mini__meta {
		margin: 0;
		font-size: 0.8rem;
		line-height: 1.3;
		color: var(--peach-dim);
		overflow: hidden;
		display: -webkit-box;
		-webkit-line-clamp: 2;
		line-clamp: 2;
		-webkit-box-orient: vertical;
	}

	.also-day__places {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: 0.5rem 1rem;
	}
	.also-day__places ul {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
		list-style: none;
		margin: 0;
		padding: 0;
	}
	.place {
		display: inline-block;
		font-family: var(--font-mono);
		font-size: var(--step-micro);
		font-weight: 700;
		letter-spacing: 0.1em;
		text-transform: uppercase;
		text-decoration: none;
		color: var(--peach-dim);
		border: var(--rule) solid var(--peach-line);
		/* 0.75em block padding clears the 44px target at the 12px micro step. */
		padding: 0.75em 0.8em;
	}
	.place:hover {
		color: var(--peach-hi);
		border-color: var(--peach);
	}
</style>
