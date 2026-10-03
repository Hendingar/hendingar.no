<script lang="ts">
	/**
	 * How the last answer was made, in numbers.
	 *
	 * Which model, how many events it was asked about, how long it took inside the model, on our
	 * server and all the way to this browser, how many tokens, and whether it came from an earlier
	 * identical question. Then every score as a histogram: the whole pile classified, not just the
	 * handful that floated.
	 *
	 * The point is that nothing on this page is magic. A pile that floats things with no visible
	 * reason asks to be trusted; this shows the working instead. Every number is about the
	 * question and the pile — none is about the visitor, and none is kept.
	 */
	import { FLOAT, SINK, type PileTrace } from '../../haugen.ts';

	let {
		trace,
		scores,
		clientMs
	}: {
		trace: PileTrace;
		scores: readonly number[];
		/** From pressing a key to the answer arriving, measured in this browser. */
		clientMs: number;
	} = $props();

	const BINS = 10;

	/** Ten bins from 0 to 1, each with how many events scored inside it. */
	const histogram = $derived.by(() => {
		const counts = Array.from({ length: BINS }, () => 0);
		for (const s of scores) counts[Math.min(BINS - 1, Math.floor(s * BINS))]! += 1;
		const max = Math.max(1, ...counts);
		return counts.map((count, i) => ({
			count,
			from: i / BINS,
			height: count / max,
			band: (i + 1) / BINS <= SINK ? 'sunk' : i / BINS >= FLOAT ? 'answer' : 'unsure'
		}));
	});

	const answers = $derived(scores.filter((s) => s >= FLOAT).length);
	const unsure = $derived(scores.filter((s) => s >= SINK && s < FLOAT).length);
	const sunk = $derived(scores.length - answers - unsure);

	const ms = (n: number) => `${Math.round(n).toLocaleString('nb-NO')} ms`;
	const tokens = (n: number) => n.toLocaleString('nb-NO');
</script>

<section class="hood" aria-label="Under panseret">
	<h2 class="hood__h">Under panseret</h2>

	{#if trace.model}
		<p class="hood__line">
			<strong>{trace.model}</strong> vurderte <strong>{trace.considered}</strong> hendingar, eitt
			ja/nei-spørsmål kvar, i <strong>{trace.requests}</strong>
			{trace.requests === 1 ? 'førespurnad' : 'førespurnader'} samstundes.
			{#if trace.cached}<span class="hood__tag">frå mellomlageret</span>{/if}
		</p>
		<dl class="hood__timings">
			<div>
				<dt>{trace.cached ? 'i modellen (då)' : 'i modellen'}</dt>
				<dd>{ms(trace.modelMs)}</dd>
			</div>
			<div>
				<dt>på serveren</dt>
				<dd>{ms(trace.serverMs)}</dd>
			</div>
			<div>
				<dt>heilt til deg</dt>
				<dd>{ms(clientMs)}</dd>
			</div>
			<div>
				<dt>token inn</dt>
				<dd>{tokens(trace.inputTokens)}</dd>
			</div>
		</dl>
	{:else}
		<p class="hood__line">
			<strong>Tekstsøk</strong> over {trace.considered} hendingar — {trace.fallback === 'budsjett'
				? 'haugen har svart på mange spørsmål det siste minuttet, og tek ein pause'
				: 'modellen svarte ikkje no'}. Berre hendingar som inneheld orda dine, flyt opp.
		</p>
		<dl class="hood__timings">
			<div>
				<dt>på serveren</dt>
				<dd>{ms(trace.serverMs)}</dd>
			</div>
			<div>
				<dt>heilt til deg</dt>
				<dd>{ms(clientMs)}</dd>
			</div>
		</dl>
	{/if}

	{#if trace.model}
		<figure class="hood__fig">
			<div class="hood__bars" aria-hidden="true">
				{#each histogram as bin (bin.from)}
					<span
						class="hood__bar hood__bar--{bin.band}"
						style:block-size={`${Math.max(bin.count ? 6 : 1, bin.height * 100)}%`}
						title={`${bin.count} med sannsyn ${Math.round(bin.from * 100)}–${Math.round((bin.from + 0.1) * 100)} %`}
					></span>
				{/each}
			</div>
			<div class="hood__axis" aria-hidden="true"><span>0 %</span><span>100 %</span></div>
			<figcaption>
				Kor sikker modellen var på kvar hending: <strong>{answers}</strong> svar flyt opp,
				<strong>{unsure}</strong> er usikre og svevar, <strong>{sunk}</strong> søkk.
			</figcaption>
		</figure>
	{/if}
</section>

<style>
	.hood {
		margin-block: 1.25rem;
		padding: 1rem 1.25rem;
		border: var(--rule) dashed var(--peach-line);
		font-family: var(--font-mono);
		font-size: var(--step-micro);
		color: var(--peach-dim);
	}

	.hood__h {
		margin: 0 0 0.5rem;
		font-size: var(--step-micro);
		letter-spacing: 0.2em;
		text-transform: uppercase;
		color: var(--peach);
	}

	.hood__line {
		margin: 0;
		max-inline-size: 70ch;
	}

	.hood strong {
		color: var(--peach-hi);
		font-weight: 700;
	}

	.hood__tag {
		margin-inline-start: 0.5rem;
		padding: 0.05rem 0.4rem;
		color: var(--navy-900);
		background: var(--peach);
	}

	.hood__timings {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem 1.5rem;
		margin: 0.75rem 0 0;
	}

	.hood__timings dt {
		color: var(--peach-dim);
	}

	.hood__timings dd {
		margin: 0;
		font-size: var(--step-body);
		color: var(--peach-hi);
	}

	.hood__fig {
		margin: 1rem 0 0;
	}

	.hood__bars {
		display: grid;
		grid-template-columns: repeat(10, 1fr);
		align-items: end;
		gap: 3px;
		block-size: 3.5rem;
		border-block-end: var(--rule) solid var(--peach-line);
	}

	.hood__bar {
		display: block;
		background: var(--peach-wash-4);
	}

	.hood__bar--unsure {
		background: var(--peach-quiet);
	}

	.hood__bar--answer {
		background: var(--peach);
	}

	.hood__axis {
		display: flex;
		justify-content: space-between;
		margin-block: 0.25rem 0.5rem;
	}

	.hood figcaption {
		max-inline-size: 70ch;
	}
</style>
