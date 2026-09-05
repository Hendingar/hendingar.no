<script lang="ts">
	import { MONTH_NAMES, WEEKDAY_ABBR, weekdayIndex } from '@hendingar/core/datetime';
	import { busiestDays } from '../../calendar.ts';
	import type { DayCount, PlaceCount } from '../../events.remote';

	/**
	 * Where a month is busy — in time, and in place.
	 *
	 * Two questions the grid cannot answer by being read. "Which Saturday is worth the drive" means
	 * comparing thirty squares, and "is anything happening in Kvinnherad" means knowing which venue
	 * is where before you start. Both are one sort away from data the page already has, so both are
	 * stated outright.
	 *
	 * The days come from the counts the grid is already rendering rather than from a second query:
	 * a ranking is arithmetic over numbers that are on the page by the time anyone can read them.
	 * The places need the database, because which municipality a venue is in is not in the grid.
	 */
	let {
		monthKey,
		counts,
		places,
		today
	}: {
		monthKey: string;
		counts: DayCount[];
		places: PlaceCount[];
		today: string;
	} = $props();

	const days = $derived(busiestDays(counts, 3));
	const dayPeak = $derived(days.reduce((n, d) => Math.max(n, d.total), 0));

	/**
	 * Four places, then a count of the rest.
	 *
	 * Not the whole list: a dozen municipalities with two events each is a table, not a signal, and
	 * the tail is what `/hendingar` filters are for. The remainder is stated rather than dropped —
	 * a list that silently ends is how a page starts under-reporting itself.
	 */
	const shown = $derived(places.slice(0, 4));
	const rest = $derived(places.slice(4));
	const restTotal = $derived(rest.reduce((n, p) => n + p.total, 0));
	const placePeak = $derived(shown.reduce((n, p) => Math.max(n, p.total), 0));

	const monthName = $derived(MONTH_NAMES[Number(monthKey.slice(5, 7)) - 1] ?? '');

	function share(value: number, peak: number): number {
		return peak === 0 ? 0 : Math.max(4, Math.round((value / peak) * 100));
	}
</script>

{#if days.length > 0 || shown.length > 0}
	<section class="hot" aria-labelledby="hot-h">
		<h2 class="visually-hidden" id="hot-h">Kvar det er mest å gjere i {monthName}</h2>

		<div class="hot__cols">
			{#if days.length > 0}
				<div class="hot__col">
					<h3 class="label hot__h">Travlaste dagar</h3>
					<ul class="hot__list">
						{#each days as day (day.date)}
							<li class="hot__row">
								<a class="hot__key" href="/kalender/{day.date}">
									<span class="hot__n display display--md">{Number(day.date.slice(8))}</span>
									<span class="hot__wd">{WEEKDAY_ABBR[weekdayIndex(day.date)]}</span>
									{#if day.date === today}<span class="visually-hidden">, i dag</span>{/if}
								</a>
								<!-- Decorative: the figure is in the link text beside it. A bar that a screen
								     reader announces as "graphic" adds nothing but noise. -->
								<span class="hot__track" aria-hidden="true">
									<span class="hot__bar" style:--share={share(day.total, dayPeak)}></span>
								</span>
								<span class="hot__total hot__total--strong">{day.total}</span>
							</li>
						{/each}
					</ul>
				</div>
			{/if}

			{#if shown.length > 0}
				<div class="hot__col">
					<h3 class="label hot__h">Tettast stad</h3>
					<ul class="hot__list">
						{#each shown as place (place.municipality ?? 'ukjend')}
							<li class="hot__row">
								<!--
									Not a link, deliberately.

									`/hendingar` filters on category and source, not on municipality — the
									query accepts one but no URL exposes it. Linking here would hand the
									reader a control that silently ignores what they asked for, which is
									worse than a control that was never offered. Make these links in the
									same change that gives the listing a `?kommune=`, not before.

									A venue we have not placed is counted rather than dropped: a list that
									omits it stops adding up to the month it claims to describe.
								-->
								<span
									class="hot__key hot__key--place"
									class:hot__key--unknown={!place.municipality}
								>
									{place.municipality ?? 'Utan kommune'}
								</span>
								<span class="hot__track" aria-hidden="true">
									<span class="hot__bar" style:--share={share(place.total, placePeak)}></span>
								</span>
								<span class="hot__total">{place.total}</span>
							</li>
						{/each}
					</ul>
					{#if rest.length > 0}
						<p class="hot__rest">
							og {restTotal}
							{restTotal === 1 ? 'hending' : 'hendingar'} i {rest.length}
							{rest.length === 1 ? 'kommune' : 'kommunar'} til
						</p>
					{/if}
				</div>
			{/if}
		</div>

		<p class="fineprint hot__note">
			Tala er det vi faktisk har samla inn, ikkje eit oversyn over alt som skjer. Ein stad utan
			kjelde er ikkje ein stille stad — <a href="/datasamling">sjå kva vi hentar inn</a>.
		</p>
	</section>
{/if}

<style>
	.hot {
		margin-block-start: clamp(2rem, 4vw, 3rem);
		padding-block-start: 1.25rem;
		border-block-start: var(--rule) solid var(--peach-line);
	}
	.hot__cols {
		display: grid;
		gap: clamp(1.5rem, 4vw, 3rem);
	}
	@media (width >= 48rem) {
		.hot__cols {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}
	}
	.hot__h {
		margin-block: 0 0.9rem;
	}
	.hot__list {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: 0.55rem;
	}
	.hot__row {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		min-inline-size: 0;
	}

	.hot .hot__key {
		display: flex;
		align-items: baseline;
		gap: 0.45rem;
		/* A fixed key column so the bars start on one line and are comparable by length alone —
		   ragged starts turn a chart back into a list of numbers. */
		inline-size: 8.5rem;
		flex: none;
		text-decoration: none;
	}
	.hot .hot__key--place {
		font-family: var(--font-mono);
		font-size: var(--step-micro);
		font-weight: 700;
		letter-spacing: 0.14em;
		text-transform: uppercase;
		overflow-wrap: anywhere;
	}
	.hot .hot__key--unknown {
		color: var(--peach-dim);
	}
	.hot a.hot__key:hover {
		color: var(--peach-hi);
	}
	/* Only the days are links. The places are text until the listing can actually filter by one. */
	.hot .hot__n {
		font-size: 1.5rem;
	}
	.hot .hot__wd {
		font-family: var(--font-mono);
		font-size: var(--step-micro);
		letter-spacing: 0.16em;
		text-transform: uppercase;
		color: var(--peach-dim);
	}

	.hot__track {
		flex: 1;
		min-inline-size: 0;
		block-size: 0.75rem;
		border: var(--rule) solid var(--peach-line);
	}
	.hot__bar {
		display: block;
		block-size: 100%;
		inline-size: calc(var(--share) * 1%);
		background: var(--peach);
		opacity: 0.78;
	}

	.hot__total {
		flex: none;
		inline-size: 3ch;
		text-align: end;
		font-family: var(--font-mono);
		font-size: var(--step-micro);
		font-weight: 700;
		letter-spacing: 0.12em;
		color: var(--peach-dim);
	}
	/* The busiest days carry the same inverted chip the grid marks a hotspot with, so the two
	   readings of "busy" look like one idea rather than two. navy-900 on peach is 8.29:1. */
	.hot .hot__total--strong {
		background: var(--peach);
		color: var(--navy-900);
		inline-size: auto;
		padding: 0.15em 0.45em;
		letter-spacing: 0.16em;
	}

	.hot__rest {
		margin-block: 0.85rem 0;
		font-family: var(--font-mono);
		font-size: var(--step-micro);
		letter-spacing: 0.08em;
		color: var(--peach-dim);
	}
	.hot__note {
		margin-block-start: clamp(1.25rem, 3vw, 2rem);
	}
</style>
