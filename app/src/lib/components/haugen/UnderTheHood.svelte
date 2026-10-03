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
	import type { PileComparison, PileComparisonSide } from '@hendingar/core/validation';
	import { FLOAT, SINK, type PileTrace } from '../../haugen.ts';
	import { comparePile } from '../../haugen.remote';

	type Pick = { id: number; title: string; score: number };

	let {
		trace,
		scores,
		clientMs,
		query,
		picks
	}: {
		trace: PileTrace;
		scores: readonly number[];
		/** From pressing a key to the answer arriving, measured in this browser. */
		clientMs: number;
		/** The question the current answer is for. */
		query: string;
		/** Three events for the comparison: the best answer, the most unsure, the least likely. */
		picks: readonly Pick[];
	} = $props();

	/** The id of the question in the example, e.g. `e1405`, so the expected answer can name it. */
	const exampleId = $derived(trace.example?.match(/"(e\d+)": \{/)?.[1] ?? 'e1');
	const exampleScore = $derived(
		picks.find((p) => `e${p.id}` === exampleId)?.score ?? picks[0]?.score ?? 0.87
	);
	const expected = $derived(
		JSON.stringify(
			{
				model: trace.model,
				answers: {
					[exampleId]: { type: 'noul', noul: Number(exampleScore.toFixed(2)) },
					'…': `${trace.considered - 1} til, same form`
				}
			},
			null,
			2
		)
	);

	/*
	 * Jev against an ordinary chat model, three events each, pressed for.
	 *
	 * Kept with the question it was made for, so a comparison from "konsertar" is not shown under
	 * an answer to "ute".
	 */
	let comparison = $state<{ query: string; result: PileComparison } | null>(null);
	let comparing = $state(false);
	let compareNote = $state<string | null>(null);
	const shown = $derived(comparison?.query === query ? comparison.result : null);

	async function compare() {
		comparing = true;
		compareNote = null;
		const asked = query;
		try {
			const outcome = await comparePile({ q: asked, ids: picks.map((p) => p.id) });
			if (outcome.status === 'ok') comparison = { query: asked, result: outcome.result };
			else
				compareNote =
					outcome.status === 'budsjett'
						? 'Haugen har svart på mange spørsmål det siste minuttet. Prøv igjen om litt.'
						: 'Modellane svarte ikkje no. Prøv igjen om litt.';
		} catch {
			compareNote = 'Samanlikninga feila. Prøv igjen om litt.';
		} finally {
			comparing = false;
		}
	}

	function sideScore(side: PileComparisonSide, id: number) {
		return side.scores.find((s) => s.eventId === id);
	}

	const percent = (n: number) => `${Math.round(n * 100)} %`;

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

	{#if trace.model && trace.example}
		<h3 class="hood__sub">Spørjinga, slik Jev fekk ho</h3>
		<p class="hood__line">
			Alle {trace.considered} spørsmåla deler same <code>state</code> — det du skreiv. Kvar hending får
			sitt eige ja/nei-spørsmål, med hendinga, spørsmålet og kva ja og nei tyder. Her er eitt av dei,
			for hendinga som skåra høgast, nøyaktig slik det vart sendt:
		</p>
		<pre class="hood__code"><code>{trace.example}</code></pre>

		<h3 class="hood__sub">Svaret vi ventar</h3>
		<p class="hood__line">
			Jev skriv ikkje tekst. Spørsmåla er av typen <code>noul</code>, og svaret på kvart av dei er
			eitt tal frå 0 til 1: kor sannsynleg det er at svaret er ja. Typen er fastsett på førehand, så
			svaret kan ikkje bli noko anna, og alle {trace.considered} kjem tilbake i same pakke. Det er koden
			vår, ikkje modellen, som bestemmer kva som flyt opp (0,5 og over).
		</p>
		<pre class="hood__code"><code>{expected}</code></pre>

		{#if picks.length > 0}
			<h3 class="hood__sub">Samanlikn med ein vanleg språkmodell</h3>
			<p class="hood__line">
				Same spørsmål, med same ord, om tre hendingar — den beste, den mest usikre og den minst
				sannsynlege — sendt til Jev og til ein vanleg språkmodell samstundes. Språkmodellen må
				skrive svaret sitt som tekst etter eit skjema; Jev svarar med eitt tal per hending.
			</p>
			<button class="btn hood__compare" type="button" onclick={compare} disabled={comparing}>
				{#if comparing}<span class="hood__spinner" aria-hidden="true"></span>{/if}
				Samanlikn 3 mot 3
			</button>
			{#if compareNote}<p class="hood__line">{compareNote}</p>{/if}

			{#if shown}
				<table class="hood__table">
					<thead>
						<tr>
							<th scope="col">Hending</th>
							<th scope="col">{shown.jev.model}</th>
							<th scope="col">{shown.llm.model}</th>
						</tr>
					</thead>
					<tbody>
						{#each picks as pick (pick.id)}
							{@const j = sideScore(shown.jev, pick.id)}
							{@const l = sideScore(shown.llm, pick.id)}
							<tr>
								<th scope="row">{pick.title}</th>
								<td>{j ? percent(j.score) : '–'}</td>
								<td>{l ? `${l.ja ? 'ja' : 'nei'} · ${percent(l.score)}` : '–'}</td>
							</tr>
						{/each}
					</tbody>
					<tfoot>
						<tr>
							<th scope="row">Tid</th>
							<td><strong>{ms(shown.jev.elapsedMs)}</strong></td>
							<td><strong>{ms(shown.llm.elapsedMs)}</strong></td>
						</tr>
						<tr>
							<th scope="row">Token inn</th>
							<td>{shown.jev.inputTokens === null ? '–' : tokens(shown.jev.inputTokens)}</td>
							<td>{shown.llm.inputTokens === null ? '–' : tokens(shown.llm.inputTokens)}</td>
						</tr>
						<tr>
							<th scope="row">Token ut</th>
							<td>ingen — svarar med tal</td>
							<td>{shown.llm.outputTokens === null ? '–' : tokens(shown.llm.outputTokens)}</td>
						</tr>
						{#if shown.jev.error || shown.llm.error}
							<tr>
								<th scope="row">Feil</th>
								<td>{shown.jev.error ?? ''}</td>
								<td>{shown.llm.error ?? ''}</td>
							</tr>
						{/if}
					</tfoot>
				</table>
				<p class="hood__line">
					Språkmodellen gjev eit ja/nei og eit tal den har skrive sjølv; talet er ikkje kalibrert.
					Jev sitt tal er sjølve svaret, trena for å vere eit sannsyn.
				</p>
			{/if}
		{/if}
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

	.hood__sub {
		margin: 1.5rem 0 0.4rem;
		font-size: var(--step-micro);
		letter-spacing: 0.12em;
		text-transform: uppercase;
		color: var(--peach);
	}

	.hood code {
		color: var(--peach-hi);
	}

	.hood__code {
		max-block-size: 22rem;
		margin: 0.6rem 0 0;
		padding: 0.75rem 1rem;
		overflow: auto;
		font-size: var(--step-micro);
		line-height: 1.5;
		white-space: pre-wrap;
		overflow-wrap: anywhere;
		background: var(--navy-900);
		border: var(--rule) solid var(--peach-line);
	}

	.hood__compare {
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
		margin-block: 0.75rem 0.25rem;
	}

	.hood__spinner {
		inline-size: 0.9em;
		block-size: 0.9em;
		border: 2px solid currentColor;
		border-inline-end-color: transparent;
		border-radius: 50%;
		animation: hood-spin 0.7s linear infinite;
	}

	@keyframes hood-spin {
		to {
			rotate: 1turn;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.hood__spinner {
			animation: none;
		}
	}

	.hood__table {
		inline-size: 100%;
		max-inline-size: 44rem;
		margin-block: 0.75rem;
		border-collapse: collapse;
	}

	.hood__table th,
	.hood__table td {
		padding: 0.35rem 0.6rem;
		text-align: start;
		border-block-end: var(--rule) solid var(--peach-line);
	}

	.hood__table thead th,
	.hood__table tfoot th {
		color: var(--peach);
		font-weight: 400;
	}

	.hood__table tbody th {
		color: var(--peach-hi);
		font-weight: 400;
	}

	.hood figcaption {
		max-inline-size: 70ch;
	}
</style>
