<script lang="ts">
	import { eventPath } from '@hendingar/core/slug';
	import { AGE_BANDS } from '@hendingar/core/weekly-hours';
	import {
		bandLabel,
		dayLabel,
		dayView,
		nextDateFor,
		weekStrip,
		weeklyHref,
		type WeeklyActivityRow,
		type WeeklyParams
	} from '../../weekly-view.ts';
	import { weekdayIndex } from '@hendingar/core/datetime';

	/**
	 * "Kva kan eg bli med på i dag?" — the weekly activities read by day.
	 *
	 * The page used to answer a different question: here are twenty-two clubs, open one and read.
	 * Nobody arrives asking that. They arrive with a free evening, or a child who wants to try
	 * something, so the lens leads with a number and a day, and the clubs come after.
	 *
	 * Every control is a link, not a button: the choice lives in the URL (`?dag=laurdag&for=born`),
	 * so it works without JavaScript, survives a reload, and can be sent to someone. The page
	 * computes what to show from that URL on the server, which is why this is real HTML for a
	 * crawler and not a placeholder (CLAUDE.md).
	 *
	 * Each weekday means its NEXT date, so a fortnightly service shows on the Sunday it meets and
	 * not on the one it does not — `slotsOn` decides, in `weekly-view.ts`.
	 */
	let {
		activities,
		today,
		params
	}: { activities: WeeklyActivityRow[]; today: string; params: WeeklyParams } = $props();

	const day = $derived(params.day ?? weekdayIndex(today));
	const date = $derived(nextDateFor(today, day));
	const isToday = $derived(date === today);
	const strip = $derived(weekStrip(activities, today, params.band));
	const view = $derived(dayView(activities, date, params.band));
	const band = $derived(bandLabel(params.band));
	const when = $derived(isToday ? 'i dag' : dayLabel(date));
</script>

<section id="dag" class="lens" aria-labelledby="h-lens">
	<h2 id="h-lens" class="lens__answer">
		<span class="display display--outline lens__n">{view.count}</span>
		<span class="lens__words">
			{view.count === 1 ? 'fast aktivitet' : 'faste aktivitetar'}
			{when}{band ? ` for ${band.toLowerCase()}` : ''}
		</span>
	</h2>

	<nav class="lens__days" aria-label="Vel dag">
		{#each strip as d (d.slug)}
			<a
				class="day"
				class:day--on={d.index === day}
				href={weeklyHref(d.index, params.band)}
				aria-current={d.index === day ? 'date' : undefined}
				aria-label="{dayLabel(d.date)}, {d.count} aktivitetar"
			>
				<span class="day__short">{d.short}</span>
				<span class="day__n">{d.count}</span>
				<span class="day__date">{d.isToday ? 'I dag' : d.dayOfMonth + '.'}</span>
			</a>
		{/each}
	</nav>

	<nav class="lens__for" aria-label="Kven er det for">
		<span class="label">For</span>
		<a
			class="chip"
			class:chip--on={params.band === null}
			href={weeklyHref(params.day, null)}
			aria-current={params.band === null ? 'true' : undefined}>Alle</a
		>
		{#each AGE_BANDS as b (b.key)}
			<a
				class="chip"
				class:chip--on={params.band === b.key}
				href={weeklyHref(params.day, b.key)}
				aria-current={params.band === b.key ? 'true' : undefined}>{b.label}</a
			>
		{/each}
	</nav>

	{#if view.periods.length === 0}
		<p class="lens__empty">
			Ingenting fast {when}{band ? ` for ${band.toLowerCase()}` : ''}. Prøv ein annan dag.
		</p>
	{:else}
		<div class="lens__periods">
			{#each view.periods as period (period.name)}
				<div class="period">
					<h3 class="display display--md period__name">{period.name}</h3>
					<ul class="period__rows">
						{#each period.rows as r (`${r.id}-${r.from}`)}
							<li class="slot">
								<p class="slot__time">
									<span class="slot__from">{r.from}</span>
									{#if r.to}<span class="slot__to">til {r.to}</span>{/if}
								</p>
								<div class="slot__body">
									<p class="slot__head">
										<a class="slot__t" href={eventPath(r.id, r.title)}>{r.title}</a>
										{#if r.cadence}<span class="slot__cad">{r.cadence}</span>{/if}
									</p>
									<p class="slot__meta">
										{[r.organizer, r.venue].filter(Boolean).join(' · ')}
									</p>
								</div>
							</li>
						{/each}
					</ul>
				</div>
			{/each}
		</div>
	{/if}
</section>

<style>
	.lens {
		display: grid;
		gap: 1.75rem;
		container-type: inline-size;
		scroll-margin-block-start: 1rem;
	}
	.lens__answer {
		margin: 0;
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: 0.25rem 1rem;
	}
	.lens__n {
		/* cqw, never vw — docs/brand.md. */
		font-size: clamp(3.5rem, 14cqw, 7.5rem);
		-webkit-text-stroke-color: var(--peach-hi);
		line-height: 0.9;
	}
	.lens__words {
		font-family: var(--font-display);
		font-weight: 700;
		font-size: clamp(1.25rem, 3cqw, 1.75rem);
		line-height: 1.2;
		color: var(--peach-hi);
		max-inline-size: 22ch;
	}

	.lens__days {
		display: grid;
		grid-template-columns: repeat(7, minmax(0, 1fr));
		gap: 0.3rem;
	}
	.day {
		display: grid;
		justify-items: center;
		align-content: center;
		gap: 0.3rem;
		min-block-size: 4.5rem;
		padding: 0.5rem 0.1rem;
		background: var(--navy-900);
		border: var(--rule) solid var(--peach-line);
		color: var(--peach);
		text-decoration: none;
		font-family: var(--font-mono);
	}
	.day:hover {
		border-color: var(--peach);
	}
	.day:focus-visible,
	.chip:focus-visible,
	.slot__t:focus-visible {
		outline: 2px solid var(--peach-hi);
		outline-offset: 3px;
	}
	/* Filled peach: the one selected day, the inverted pairing at 8.29:1 (docs/brand.md). */
	.day--on {
		background: var(--peach);
		border-color: var(--peach);
		color: var(--navy-900);
	}
	.day__short {
		font-size: var(--step-micro);
		font-weight: 700;
		letter-spacing: 0.16em;
		text-transform: uppercase;
	}
	.day__n {
		font-family: var(--font-display);
		font-weight: 900;
		font-stretch: 125%;
		font-size: clamp(1.1rem, 4.5cqw, 2.25rem);
		line-height: 1;
	}
	.day__date {
		font-size: 0.6875rem;
		letter-spacing: 0.08em;
		text-transform: uppercase;
	}

	.lens__for {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.4rem;
	}
	.lens__for .label {
		margin-inline-end: 0.4rem;
	}
	.chip {
		display: inline-flex;
		align-items: center;
		min-block-size: 2.75rem;
		padding: 0 1rem;
		border: var(--rule) solid var(--peach-line);
		color: var(--peach);
		text-decoration: none;
		font-family: var(--font-mono);
		font-size: 0.8125rem;
		font-weight: 700;
	}
	.chip:hover {
		border-color: var(--peach);
	}
	.chip--on {
		background: var(--peach);
		border-color: var(--peach);
		color: var(--navy-900);
	}

	.lens__empty {
		margin: 0;
		font-family: var(--font-display);
		font-weight: 800;
		font-size: var(--step-mid);
	}

	.lens__periods {
		display: grid;
		gap: 2.25rem;
	}
	.period {
		display: grid;
		grid-template-columns: 1fr;
		gap: 0.75rem;
		border-block-start: var(--rule-fat) solid var(--peach);
		padding-block-start: 1rem;
	}
	@container (width >= 46rem) {
		.period {
			grid-template-columns: minmax(0, 15rem) minmax(0, 1fr);
			gap: 1rem 2.5rem;
		}
	}
	/*
	 * Sized to fit "Ettermiddag" whole in its column. At 125% width it broke mid-word
	 * ("ETTERMIDD / AG") — `overflow-wrap: anywhere` doing its job as a safety net, which means
	 * the size was wrong, not the net.
	 */
	.period__name {
		font-size: 1.375rem;
		line-height: 1;
	}
	.period__rows {
		list-style: none;
		margin: 0;
		padding: 0;
	}
	.slot {
		display: grid;
		grid-template-columns: 4.5rem minmax(0, 1fr);
		gap: 1rem;
		padding-block: 0.85rem;
		border-block-end: var(--rule) solid var(--peach-line);
	}
	.slot__time {
		margin: 0;
		display: grid;
		gap: 0.1rem;
		font-family: var(--font-mono);
		font-variant-numeric: tabular-nums;
	}
	.slot__from {
		font-size: 1.25rem;
		font-weight: 700;
		color: var(--peach-hi);
	}
	.slot__to {
		font-size: 0.8125rem;
		color: var(--peach-dim);
	}
	.slot__body {
		display: grid;
		gap: 0.3rem;
		min-inline-size: 0;
	}
	.slot__head {
		margin: 0;
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.3rem 0.75rem;
	}
	.slot__t {
		font-family: var(--font-display);
		font-weight: 800;
		font-size: 1.125rem;
		line-height: 1.2;
		color: var(--peach-hi);
		text-decoration: none;
		overflow-wrap: anywhere;
	}
	.slot__t:hover {
		text-decoration: underline;
		text-underline-offset: 0.2em;
	}
	/* Outlined, not filled: filled peach marks one fixed time; this qualifies a pattern. */
	.slot__cad {
		font-family: var(--font-mono);
		font-size: 0.6875rem;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		border: var(--rule) solid var(--peach);
		padding: 0.1rem 0.4rem;
	}
	.slot__meta {
		margin: 0;
		font-family: var(--font-mono);
		font-size: 0.8125rem;
		color: var(--peach-dim);
		overflow-wrap: anywhere;
	}
</style>
