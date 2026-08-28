<script lang="ts">
	import { formatEventTime } from '@hendingar/core/datetime';
	import { describeCron, freshness, nextCronRun } from '@hendingar/core/schedule';
	import RunStrip from './RunStrip.svelte';
	import type { CollectedSource } from '../../collection.remote';

	let { source, now }: { source: CollectedSource; now: Date } = $props();

	const KIND_LABEL: Record<string, string> = {
		'json-api': 'JSON-API',
		feed: 'iCal / RSS',
		html: 'HTML-parsing',
		manual: 'Manuell'
	};

	const STATE_LABEL: Record<string, string> = {
		fresh: 'Oppdatert',
		late: 'Forseinka',
		stale: 'Utdatert',
		never: 'Ikkje køyrt'
	};

	const state = $derived(freshness(source.lastRunAt, source.scheduleCron, now));
	const last = $derived(source.runs[0]);
	const next = $derived(nextCronRun(source.scheduleCron, now));
	const schedule = $derived(describeCron(source.scheduleCron));
</script>

<article class="src frame" aria-labelledby={`src-${source.slug}`}>
	<header class="src__head">
		<div>
			<p class="label">{source.region}</p>
			<h3 id={`src-${source.slug}`} class="display display--md src__name">{source.name}</h3>
		</div>
		<!-- The word carries the state, not the shape — the palette is a single hue. -->
		<p class="state" data-state={state}>{STATE_LABEL[state]}</p>
	</header>

	<dl class="facts">
		<div>
			<dt>Metode</dt>
			<dd>{KIND_LABEL[source.kind] ?? source.kind}</dd>
		</div>
		<div>
			<dt>Rytme</dt>
			<dd>{schedule ?? 'ikkje planlagt'}</dd>
		</div>
		<div>
			<dt>Hendingar</dt>
			<dd>{source.eventsTotal} <span class="muted">({source.eventsUpcoming} framover)</span></dd>
		</div>
		<div>
			<dt>Publisering</dt>
			<dd>{source.trusted ? 'direkte' : 'til verifisering'}</dd>
		</div>
	</dl>

	{#if source.endpoint}
		<p class="endpoint">
			<span class="visually-hidden">Endepunkt: </span><code>{source.endpoint}</code>
		</p>
	{/if}

	<div class="runs">
		<p class="label">Siste 14 køyringar</p>
		<RunStrip runs={source.runs} />
	</div>

	<dl class="facts facts--wide">
		<div>
			<dt>Sist henta</dt>
			<dd>
				{#if source.lastRunAt}
					<time datetime={source.lastRunAt.toISOString()}>
						{formatEventTime(source.lastRunAt, 'Europe/Oslo', 'full')}
					</time>
				{:else}
					aldri
				{/if}
			</dd>
		</div>
		<div>
			<dt>Neste</dt>
			<dd>
				{#if next}
					<time datetime={next.toISOString()}>
						{formatEventTime(next, 'Europe/Oslo', 'full')}
					</time>
				{:else}
					—
				{/if}
			</dd>
		</div>
		{#if last}
			<div>
				<dt>Resultat</dt>
				<dd>
					{last.created} nye · {last.updated} endra · {last.unchanged} uendra
					{#if last.rejected > 0}
						· <strong>{last.rejected} avviste</strong>
					{/if}
					{#if last.durationMs}
						<span class="muted">({(last.durationMs / 1000).toFixed(1)} s)</span>
					{/if}
				</dd>
			</div>
		{/if}
	</dl>

	{#if last?.message}
		<!-- Shown verbatim. A source that changes shape should be visible to everyone, not buried
		     in a job log only we can read. -->
		<p class="note">{last.message}</p>
	{/if}

	<p class="attrib">
		Data frå <a href={source.url} rel="noopener">{source.attribution}</a>. Kvar hending lenkjer
		tilbake til kjelda.
	</p>
</article>

<style>
	.src {
		padding: clamp(1rem, 2.5vw, 1.75rem);
		min-inline-size: 0;
		display: grid;
		gap: 1.25rem;
		align-content: start;
		container-type: inline-size;
	}
	.src__head {
		display: flex;
		flex-wrap: wrap;
		gap: 0.75rem 1rem;
		align-items: start;
		justify-content: space-between;
	}
	.src__name {
		font-size: clamp(1.1rem, 6cqw, 2rem);
		margin: 0.15em 0 0;
	}
	.state {
		margin: 0;
		font-family: var(--font-mono);
		font-size: var(--step-micro);
		font-weight: 700;
		letter-spacing: 0.2em;
		text-transform: uppercase;
		padding: 0.5em 0.8em;
		border: var(--rule) solid var(--peach);
		white-space: nowrap;
	}
	.state[data-state='fresh'] {
		background: var(--peach);
		color: var(--navy-900);
	}
	.state[data-state='late'] {
		background: linear-gradient(to top, var(--peach) 50%, transparent 50%);
	}
	.state[data-state='stale'],
	.state[data-state='never'] {
		border-style: dashed;
	}

	.facts {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(min(100%, 8rem), 1fr));
		gap: 0.9rem 1rem;
		margin: 0;
	}
	.facts--wide {
		grid-template-columns: repeat(auto-fit, minmax(min(100%, 14rem), 1fr));
	}
	.facts dt {
		font-family: var(--font-mono);
		font-size: var(--step-micro);
		letter-spacing: 0.2em;
		text-transform: uppercase;
		color: var(--peach-dim);
	}
	.facts dd {
		margin: 0.25rem 0 0;
		font-family: var(--font-display);
		font-weight: 900;
		font-stretch: 112%;
		text-transform: uppercase;
		font-size: 1rem;
	}
	.muted {
		font-family: var(--font-mono);
		font-weight: 400;
		font-stretch: normal;
		text-transform: none;
		font-size: 0.8125rem;
		color: var(--peach-dim);
	}
	.endpoint {
		margin: 0;
		/* A grid child defaults to min-width:auto, so a nowrap URL pushed the whole card — and the
		   page — wider than the viewport at 320px. Let the URL wrap instead of scrolling it. */
		min-inline-size: 0;
	}
	.endpoint code {
		font-family: var(--font-mono);
		font-size: 0.8125rem;
		color: var(--peach-dim);
		overflow-wrap: anywhere;
	}
	.runs {
		display: grid;
		gap: 0.5rem;
	}
	.note {
		margin: 0;
		font-size: 0.8125rem;
		line-height: 1.6;
		color: var(--peach-dim);
		border-inline-start: var(--rule-fat) solid var(--peach-line);
		padding-inline-start: 0.9rem;
	}
	.attrib {
		margin: 0;
		font-size: 0.8125rem;
		color: var(--peach-dim);
	}
</style>
