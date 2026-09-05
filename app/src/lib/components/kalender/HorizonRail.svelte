<script lang="ts">
	import { formatCalendarDate, formatWeekName, formatWeekRange } from '@hendingar/core/datetime';
	import type { HorizonWeek } from '../../events.remote';

	/**
	 * The next half-year, one bar per week.
	 *
	 * A month grid answers "what is on the 12th". It structurally cannot answer *when* — finding
	 * the busy weekend six weeks out means paging through four grids and remembering what you saw.
	 * The rail is that whole question in one glance, and it is the control the calendar was missing:
	 * every bar is a link into that week.
	 *
	 * **It stops where the data does.** A repeating event is materialised `HORIZON_WEEKS` ahead and
	 * no further (ADR 0009), so past the last bar the calendar still works but carries only one-off
	 * events and quietly under-reports. Drawing bars into that stretch would show a real decline in
	 * coverage as though it were a real decline in what is on. The rail ends, and says where.
	 *
	 * Bars are links rather than buttons because a week is a place — `?veke=2026-W37` is
	 * shareable, back-buttonable and server-rendered, the same decision `?maanad=` already made.
	 */
	let {
		weeks,
		total,
		horizonEnd,
		currentWeek,
		activeWeek = null
	}: {
		weeks: HorizonWeek[];
		total: number;
		/** Last day covered, so the rail can name where it stops rather than just stopping. */
		horizonEnd: string;
		currentWeek: string;
		/** The week being viewed, when there is one. Marked, but never the same mark as "now". */
		activeWeek?: string | null;
	} = $props();

	const peak = $derived(weeks.reduce((n, w) => Math.max(n, w.total), 0));

	/**
	 * Bar height as a percentage of the tallest week.
	 *
	 * Relative to the peak, unlike the month grid's fill: the rail's job is comparison between the
	 * bars in front of you, not an absolute reading, and every bar is labelled with its own figure
	 * anyway. A floor of a few percent so an empty week is still a visible tick — a gap in the row
	 * reads as a rendering fault, where a stub reads as a quiet week.
	 */
	function height(weekTotal: number): number {
		if (peak === 0) return 0;
		return Math.max(3, Math.round((weekTotal / peak) * 100));
	}

	/**
	 * The bar's accessible name, built here rather than in the attribute.
	 *
	 * A multi-line `aria-label={...}` in the markup keeps the template's newlines and tabs verbatim,
	 * so the name came out as "... - 4\n\t\t\t\t\t\t\thendingar - denne veka". Screen readers mostly
	 * normalise that, which is exactly why it survives review: it is invisible until something reads
	 * the attribute literally. One string, built once, with no whitespace to normalise.
	 */
	function barLabel(week: HorizonWeek): string {
		const events = week.total === 1 ? '1 hending' : `${week.total} hendingar`;
		const now = week.weekKey === currentWeek ? ' — denne veka' : '';
		return `${formatWeekName(week.weekKey)}, ${formatWeekRange(week.weekKey)} — ${events}${now}`;
	}

	/** Every fourth week gets a number under it. All 26 would be an unreadable smear. */
	function tick(index: number, weekKey: string): string {
		if (index === 0) return 'No';
		return index % 4 === 0 ? `V.${Number(weekKey.slice(6))}` : '';
	}
</script>

<section class="rail" aria-labelledby="rail-h">
	<div class="rail__head">
		<h2 class="label" id="rail-h">Framover</h2>
		{#if total > 0}
			<p class="rail__note">
				{total}
				{total === 1 ? 'hending' : 'hendingar'} fram til {formatCalendarDate(
					horizonEnd
				).toLowerCase()}
			</p>
		{/if}
	</div>

	{#if total === 0}
		<p class="rail__empty">
			Ingenting registrert dei neste {weeks.length} vekene.
			<a href="/send-inn">Send inn ei hending</a>.
		</p>
	{:else}
		<!--
			One scroller holding both rows, so the ticks can never drift out of line with the bars
			they name. Below ~34rem the bars stop shrinking and the row scrolls instead — 26 bars
			across a 320px screen would be 12px each, under the 24px minimum target size, and the
			same sideways-scrolling row the category filters already use is the answer here.
		-->
		<div class="rail__scroll">
			<ul class="rail__bars">
				{#each weeks as week (week.weekKey)}
					<li class="rail__slot">
						<a
							class="rail__bar"
							class:rail__bar--now={week.weekKey === currentWeek}
							href="/kalender?veke={week.weekKey}"
							aria-current={week.weekKey === activeWeek ? 'page' : undefined}
							aria-label={barLabel(week)}
						>
							<span class="rail__fill" style:--fill={height(week.total)}></span>
						</a>
					</li>
				{/each}
			</ul>
			<!-- Decorative: every bar is already named in full by its own link. -->
			<p class="rail__ticks" aria-hidden="true">
				{#each weeks as week, i (week.weekKey)}
					<span class="rail__slot rail__tick">{tick(i, week.weekKey)}</span>
				{/each}
			</p>
		</div>
		<p class="rail__end">
			Slutten er ikkje slutten på det som skjer — det er så langt fram vi reknar ut faste,
			gjentakande hendingar. <a href="/datasamling">Sjå kva vi hentar inn</a>.
		</p>
	{/if}
</section>

<style>
	.rail {
		margin-block-end: clamp(1.5rem, 3vw, 2.25rem);
		padding-block-start: 1.1rem;
		border-block-start: var(--rule) solid var(--peach-line);
	}
	.rail__head {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		justify-content: space-between;
		gap: 0.5rem 1.5rem;
		margin-block-end: 0.85rem;
	}
	.rail__head .label {
		margin: 0;
	}
	.rail__note,
	.rail__end {
		margin: 0;
		font-family: var(--font-mono);
		font-size: var(--step-micro);
		letter-spacing: 0.08em;
		color: var(--peach-dim);
	}
	.rail__end {
		margin-block-start: 0.85rem;
		max-inline-size: 68ch;
		line-height: 1.7;
	}
	.rail__empty {
		margin: 0;
		font-family: var(--font-display);
		font-weight: 800;
		font-stretch: 108%;
		font-size: var(--step-mid);
		max-inline-size: 30ch;
	}

	.rail__scroll {
		overflow-x: auto;
		overscroll-behavior-x: contain;
		/* The row runs off the screen edge rather than stopping short of it — the affordance that
		   says "there is more this way", same as the filter chips on /hendingar. */
		margin-inline: calc(var(--gutter, 1rem) * -1);
		padding-inline: var(--gutter, 1rem);
		scrollbar-width: none;
	}
	.rail__scroll::-webkit-scrollbar {
		display: none;
	}

	.rail__bars,
	.rail__ticks {
		display: flex;
		gap: 0.3rem;
		list-style: none;
		margin: 0;
		padding: 0;
	}

	/*
	 * The one rule that keeps the two rows aligned: identical slot sizing on both.
	 *
	 * `min-inline-size: 1.5rem` is a target-size floor (WCAG 2.5.8), not a look — 26 bars sharing
	 * a 320px screen would be 12px wide. When they no longer fit, the parent scrolls.
	 */
	.rail .rail__slot {
		flex: 1 0 auto;
		min-inline-size: 1.5rem;
		max-inline-size: 4rem;
	}

	.rail__bar {
		display: flex;
		align-items: flex-end;
		block-size: 5rem;
		border-block-end: var(--rule) solid var(--peach-line);
	}
	.rail__fill {
		display: block;
		inline-size: 100%;
		block-size: calc(var(--fill) * 1%);
		background: var(--peach);
		opacity: 0.72;
		transition: opacity var(--dur-fast) ease;
	}
	.rail__bar:hover .rail__fill {
		opacity: 1;
		background: var(--peach-hi);
	}

	/* This week. Brighter and fully opaque, and its tick reads "No" rather than a number. */
	.rail__bar--now .rail__fill {
		background: var(--peach-hi);
		opacity: 1;
	}

	/*
	 * The week you are looking at, marked differently from "now" — they are frequently not the
	 * same week, and one mark for two meanings would say they were. An outline rather than a fill
	 * change, so it survives on top of the "now" bar too.
	 */
	.rail__bar[aria-current='page'] {
		outline: var(--rule-fat) solid var(--peach-hi);
		outline-offset: 2px;
	}

	.rail__ticks {
		margin-block-start: 0.45rem;
	}
	.rail .rail__tick {
		font-family: var(--font-mono);
		font-size: 0.625rem;
		font-weight: 700;
		letter-spacing: 0.06em;
		color: var(--peach-dim);
		white-space: nowrap;
	}

	@media (prefers-reduced-motion: reduce) {
		.rail__fill {
			transition: none;
		}
	}
</style>
