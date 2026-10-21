<script lang="ts">
	import { TREND_DAYS, type Trend } from '../../trend.ts';

	/**
	 * Where a card stands on /poppis/vist and which way it is going: its place, a fortnight of
	 * daily opens as bars, its move since last night, and today's opens.
	 *
	 * Bars rather than a line: these are small whole numbers per day, and a line between 0 and 2
	 * draws a slope nobody walked. A day nobody opened it is an empty slot, visibly.
	 *
	 * Only /poppis/vist draws it. The same reasoning as the open count on the tile: on any other
	 * listing it would turn "what is on" into a ranking.
	 */
	let { trend, place }: { trend: Trend; place: number } = $props();

	const W = 4;
	const GAP = 1;
	const H = 18;
	const peak = $derived(Math.max(1, ...trend.series));
	const total = $derived(trend.series.reduce((sum, n) => sum + n, 0));
	// A bar for a day with any opens is at least two units tall, so one open is never invisible.
	const height = (n: number) => (n === 0 ? 0 : Math.max(2, Math.round((n / peak) * H)));

	const move = $derived.by(() => {
		const m = trend.move;
		if (m === null) return null;
		if (m === 'ny') return { mark: '✦', text: 'ny på lista i dag', up: true };
		if (m > 0)
			return { mark: '▲', text: `${m} ${m === 1 ? 'plass' : 'plassar'} opp sidan i går`, up: true };
		if (m < 0)
			return {
				mark: '▼',
				text: `${-m} ${m === -1 ? 'plass' : 'plassar'} ned sidan i går`,
				up: false
			};
		return { mark: '=', text: 'same plass som i går', up: false };
	});
</script>

<div class="trend">
	<span class="trend__place" aria-label="Plass {place}">{place}</span>
	<svg
		class="trend__bars"
		viewBox="0 0 {TREND_DAYS * (W + GAP) - GAP} {H}"
		width={TREND_DAYS * (W + GAP) - GAP}
		height={H}
		aria-hidden="true"
	>
		{#each trend.series as n, i (i)}
			<rect class="trend__floor" x={i * (W + GAP)} y={H - 1} width={W} height="1" />
			{#if n > 0}
				<rect
					class="trend__bar"
					class:trend__bar--today={i === trend.series.length - 1}
					x={i * (W + GAP)}
					y={H - height(n)}
					width={W}
					height={height(n)}
				/>
			{/if}
		{/each}
	</svg>
	<span class="visually-hidden">{total} opningar dei siste {TREND_DAYS} dagane.</span>
	{#if move}
		<span class="trend__move" class:trend__move--up={move.up}>
			<span aria-hidden="true">{move.mark}</span>
			{move.text}
		</span>
	{/if}
	{#if trend.today > 0}
		<span class="trend__today">+{trend.today} i dag</span>
	{/if}
</div>

<style>
	.trend {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.25rem 0.5rem;
		margin-block-start: 0.35rem;
		font-family: var(--font-mono);
		font-size: var(--step-micro);
		color: var(--peach-dim);
	}
	/* The place is the one number a glance should land on, so it is the loudest thing here. */
	.trend__place {
		min-inline-size: 1.6rem;
		padding: 0.05rem 0.35rem;
		border: 1px solid var(--peach-line);
		border-radius: 999px;
		text-align: center;
		color: var(--peach-hi);
	}
	.trend__floor {
		fill: var(--peach-line);
	}
	.trend__bar {
		fill: var(--peach-dim);
	}
	.trend__bar--today {
		fill: var(--peach-hi);
	}
	.trend__move--up {
		color: var(--peach-hi);
	}
</style>
