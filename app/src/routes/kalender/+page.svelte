<script lang="ts">
	import { page } from '$app/state';
	import { formatMonthName } from '@hendingar/core/datetime';
	import MonthGrid from '../../lib/components/kalender/MonthGrid.svelte';
	import { isMonthKey, shiftMonth } from '../../lib/calendar.ts';
	import { calendarRange, monthEventCounts } from '../../lib/events.remote';

	/**
	 * The month view: one square per day, carrying how many events fall on it.
	 *
	 * The month is a URL (`?maanad=2026-09`), not component state — the same decision `/hendingar`
	 * made about its filters and for the same reasons. A month is linkable, shareable and
	 * back-buttonable, it survives JavaScript being off, and the server renders exactly what the
	 * address bar asks for instead of a January that a client-side effect corrects afterwards.
	 *
	 * A query string rather than `/kalender/2026-09`, because `/kalender/<dato>` is already the day
	 * page and two dynamic segments under one directory could not tell a month from a day without
	 * a matcher that exists only to disambiguate the developer's own URLs.
	 */
	const range = await calendarRange();

	/*
	 * An unparseable or out-of-range month falls back to the current one rather than erroring.
	 *
	 * A hand-edited `?maanad=` deserves the same treatment `?kategori=finnesikkje` gets on
	 * /hendingar: show the reader something useful. Clamping to the range also means the arrows can
	 * never hand out a URL that this page then refuses.
	 */
	const month = $derived.by((): string => {
		const raw = page.url.searchParams.get('maanad');
		if (!raw || !isMonthKey(raw)) return range.current;
		if (raw < range.first) return range.first;
		if (raw > range.last) return range.last;
		return raw;
	});

	/*
	 * Derived and awaited in the markup, not a top-level await.
	 *
	 * A top-level `await monthEventCounts(month)` captures the month once, so the grid would never
	 * change when you pressed an arrow. Awaiting the derived promise in the template keeps the
	 * dependency live and still suspends the component on the server, so every month is
	 * server-rendered — which matters on a page whose whole job is to be crawlable by date.
	 */
	const counts = $derived(monthEventCounts(month));

	const previous = $derived(month > range.first ? shiftMonth(month, -1) : null);
	const next = $derived(month < range.last ? shiftMonth(month, 1) : null);
	const monthName = $derived(formatMonthName(month));
</script>

<svelte:head>
	<title>{monthName} — kalender — hendingar.no</title>
	<meta
		name="description"
		content="Kalender over hendingar i Sunnhordland i {monthName}. Tal på hendingar per dag — trykk på ein dag for å sjå kva som skjer."
	/>
</svelte:head>

<div class="shell cal-page">
	<p class="label">Månad for månad</p>
	<h1 class="display cal-page__h">Kalender</h1>
	<p class="cal-page__lead">
		Kor mykje som skjer, dag for dag. Trykk på ein dag for å sjå kva det er.
	</p>

	<nav class="months" aria-label="Bytt månad">
		<!--
			An arrow only exists when there is a month behind it. Rendering a disabled control at
			the edge of the data would be a button that says "there is more this way" and then
			refuses — the placeholder keeps the month name centred either way.
		-->
		{#if previous}
			<!-- The month is named in aria-label as well as on screen, so the visible name can be
			     dropped on a phone without leaving a link whose only name is an arrow. -->
			<a
				class="months__step"
				href="/kalender?maanad={previous}"
				rel="prev"
				aria-label="Førre månad: {formatMonthName(previous)}"
			>
				<span class="months__arrow" aria-hidden="true">←</span>
				<span class="months__label">{formatMonthName(previous)}</span>
			</a>
		{:else}
			<span class="months__step months__step--none" aria-hidden="true"></span>
		{/if}

		<h2 class="display display--md months__now">{monthName}</h2>

		{#if next}
			<a
				class="months__step months__step--next"
				href="/kalender?maanad={next}"
				rel="next"
				aria-label="Neste månad: {formatMonthName(next)}"
			>
				<span class="months__label">{formatMonthName(next)}</span>
				<span class="months__arrow" aria-hidden="true">→</span>
			</a>
		{:else}
			<span class="months__step months__step--none" aria-hidden="true"></span>
		{/if}
	</nav>

	<MonthGrid monthKey={month} counts={await counts} today={range.today} />

	<p class="cal-page__foot">
		{#if month !== range.current}
			<a href="/kalender">Tilbake til {formatMonthName(range.current)}</a> ·
		{/if}
		<a href="/hendingar">Sjå heile lista</a> ·
		<a href="/send-inn">Send inn ei hending</a>
	</p>
</div>

<style>
	.cal-page {
		padding-block: clamp(2rem, 5vw, 4rem) var(--section-y);
		container-type: inline-size;
	}
	.cal-page__h {
		/* cqw, never vw: sized against this column so it survives 320px and does not overflow on a
		   wide desktop. */
		font-size: clamp(1.75rem, 11cqw, 5rem);
		margin-block: 0.4rem 0.6rem;
	}
	.cal-page__lead {
		max-inline-size: 48ch;
		color: var(--peach-dim);
		margin-block: 0 clamp(1.5rem, 3vw, 2.5rem);
	}

	.months {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 0.75rem;
		margin-block-end: 1rem;
	}
	.months__now {
		font-size: clamp(1.1rem, 5cqw, 2rem);
		text-align: center;
		flex: 1;
	}
	.months .months__step {
		font-family: var(--font-mono);
		font-size: var(--step-micro);
		font-weight: 700;
		letter-spacing: 0.14em;
		text-transform: uppercase;
		text-decoration: none;
		color: var(--peach-dim);
		flex: 0 1 auto;
		min-inline-size: 1.5rem;
	}
	.months .months__step:hover {
		color: var(--peach-hi);
	}
	.months .months__step--next {
		text-align: end;
	}

	.months .months__arrow {
		font-size: var(--step-body);
	}

	/*
	 * On a phone the neighbouring month names cost more room than they earn — three month names
	 * across 320px wraps the row and pushes the grid below the fold. The arrows stay, and the
	 * links keep their full names through aria-label.
	 */
	@media (width < 34rem) {
		.months .months__label {
			display: none;
		}
	}

	.cal-page__foot {
		margin-block-start: clamp(1.5rem, 3vw, 2.5rem);
		font-family: var(--font-mono);
		font-size: var(--step-micro);
		letter-spacing: 0.08em;
		color: var(--peach-dim);
	}
</style>
