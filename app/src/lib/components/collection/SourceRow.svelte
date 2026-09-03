<script lang="ts">
	import { formatEventTime } from '@hendingar/core/datetime';
	import { describeCron, freshness, nextCronRun } from '@hendingar/core/schedule';
	import RunStrip from './RunStrip.svelte';
	import SourceIcon from '../SourceIcon.svelte';
	import type { CollectedSource } from '../../collection.remote';

	/**
	 * One source as a compact row that expands.
	 *
	 * Replaces a card that spent a full screen on one source: four labelled facts, an endpoint, a
	 * run strip with a legend, three timestamps and a footnote, all at equal weight. With more than
	 * one source that page cannot be scanned at all. A row carries what you scan by — who, healthy
	 * or not, when last — and the rest is one click away.
	 *
	 * `<details>` rather than a JS toggle: it opens without JavaScript, is keyboard operable and
	 * announced as expandable for free, and survives Ctrl-F opening the section that matches.
	 */
	let { source, now }: { source: CollectedSource; now: Date } = $props();

	const KIND_LABEL: Record<string, string> = {
		'json-api': 'JSON-API',
		feed: 'iCal / RSS',
		html: 'HTML-parsing',
		manual: 'Manuell',
		link: 'Berre lenkje'
	};

	const STATE_LABEL: Record<string, string> = {
		fresh: 'Oppdatert',
		late: 'Forseinka',
		stale: 'Utdatert',
		never: 'Ikkje køyrt'
	};

	/*
	 * A linked source is not a broken one.
	 *
	 * `freshness` would call it 'never' and the row would read "Ikkje køyrt", which is the same
	 * words an importer that has silently stopped would show. These are different facts and the
	 * page must not blur them: one is a gap we have chosen and explained, the other is a failure.
	 */
	const linkOnly = $derived(source.kind === 'link');
	const state = $derived(freshness(source.lastRunAt, source.scheduleCron, now));
	const last = $derived(source.runs[0]);
	const next = $derived(nextCronRun(source.scheduleCron, now));
	const schedule = $derived(describeCron(source.scheduleCron));
</script>

<!-- data-kind so a collected row and a linked one are distinguishable without reading text. -->
<details class="row" data-kind={source.kind}>
	<summary class="row__summary">
		<SourceIcon src={source.iconUrl} name={source.name} />
		<span class="row__id">
			<span class="row__name">{source.name}</span>
			<span class="row__meta">
				{source.region} · {KIND_LABEL[source.kind] ?? source.kind}
				{#if !linkOnly}
					· {source.eventsUpcoming} framover
				{/if}
			</span>
		</span>
		<span class="row__when">
			{#if linkOnly}
				—
			{:else if source.lastRunAt}
				<time datetime={source.lastRunAt.toISOString()}>
					{formatEventTime(source.lastRunAt, 'Europe/Oslo', 'card')}
				</time>
			{:else}
				aldri
			{/if}
		</span>
		<!-- The word carries the state, not colour alone — the palette is a single hue. -->
		{#if linkOnly}
			<span class="state" data-state="link">Ikkje henta</span>
		{:else}
			<span class="state" data-state={state}>{STATE_LABEL[state]}</span>
		{/if}
	</summary>

	<div class="row__body">
		{#if linkOnly}
			<p class="why">{source.note}</p>
			<p class="visit">
				<a class="btn" href={source.url} rel="noopener">Opne {source.name}</a>
			</p>
			<p class="attribution">
				Vi hentar ikkje herifrå. Lenkja går til kjelda si eiga side, som er den einaste oppdaterte
				staden for desse hendingane.
			</p>
		{:else}
			<dl class="facts">
				<div>
					<dt>Rytme</dt>
					<dd>{schedule ?? 'ikkje planlagt'}</dd>
				</div>
				<div>
					<dt>Neste</dt>
					<dd>
						{#if next}
							<time datetime={next.toISOString()}
								>{formatEventTime(next, 'Europe/Oslo', 'card')}</time
							>
						{:else}
							—
						{/if}
					</dd>
				</div>
				<div>
					<dt>Hendingar</dt>
					<dd>{source.eventsTotal} totalt</dd>
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

			{#if source.runs.length > 0}
				<div class="runs">
					<p class="label">Siste {source.runs.length} køyringar</p>
					<RunStrip runs={source.runs} />
					{#if last}
						<p class="runs__last">
							{last.created} nye · {last.updated} endra · {last.unchanged} uendra
							{#if last.rejected > 0}
								· <strong>{last.rejected} avviste</strong>
							{/if}
							{#if last.durationMs}
								<span class="muted">({(last.durationMs / 1000).toFixed(1)} s)</span>
							{/if}
						</p>
					{/if}
					{#if last?.message}
						<p class="runs__msg">{last.message}</p>
					{/if}
				</div>
			{/if}

			<p class="attribution">
				Data frå <a href={source.url}>{source.attribution}</a>. Kvar hending lenkjer tilbake til
				kjelda.
			</p>
		{/if}
	</div>
</details>

<style>
	.why {
		margin: 0 0 0.9rem;
		max-inline-size: 62ch;
	}
	.visit {
		margin: 0 0 0.9rem;
	}
	.row {
		border-block-end: var(--rule) solid var(--peach-line);
	}
	.row__summary {
		display: grid;
		grid-template-columns: auto minmax(0, 1fr) auto auto;
		align-items: center;
		gap: 0.9rem;
		padding: 0.85rem 0.25rem;
		cursor: pointer;
		list-style: none;
	}
	/* Safari still paints the default triangle without this. */
	.row__summary::-webkit-details-marker {
		display: none;
	}
	.row__summary:hover .row__name,
	.row[open] .row__name {
		color: var(--peach-hi);
	}
	.row__summary:focus-visible {
		outline: 2px solid var(--peach);
		outline-offset: -2px;
	}
	.row__id {
		display: grid;
		gap: 0.1rem;
		min-inline-size: 0;
	}
	.row__name {
		font-family: var(--font-display);
		font-weight: 800;
		font-stretch: 108%;
		font-size: 1.0625rem;
		letter-spacing: -0.005em;
	}
	.row__meta,
	.row__when {
		font-family: var(--font-mono);
		font-size: 0.75rem;
		color: var(--peach-dim);
	}
	.state {
		font-family: var(--font-mono);
		font-size: var(--step-micro);
		letter-spacing: 0.14em;
		text-transform: uppercase;
		padding: 0.3em 0.6em;
		border: var(--rule) solid var(--peach-line);
		white-space: nowrap;
	}
	/*
	 * Outlined, not filled: a linked source is neither healthy nor broken, and giving it the peach
	 * fill of 'fresh' would read as "collected and fine" at a glance — exactly the wrong claim.
	 */
	.state[data-state='link'] {
		border-style: dashed;
		opacity: 0.75;
	}
	.state[data-state='fresh'] {
		background: var(--peach);
		color: var(--navy-900);
		border-color: var(--peach);
	}
	.state[data-state='stale'],
	.state[data-state='never'] {
		background: var(--peach-ghost);
		border-color: var(--peach);
	}

	.row__body {
		display: grid;
		gap: 1rem;
		padding: 0.25rem 0.25rem 1.4rem;
		/* Indented to the icon's edge, so the expansion reads as belonging to the row above it. */
		padding-inline-start: calc(2rem + 0.9rem + 0.25rem);
	}
	.facts {
		margin: 0;
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(min(100%, 10rem), 1fr));
		gap: 0.7rem 1.5rem;
	}
	.facts div {
		display: grid;
		gap: 0.15rem;
	}
	dt {
		font-family: var(--font-mono);
		font-size: var(--step-micro);
		letter-spacing: 0.14em;
		text-transform: uppercase;
		color: var(--peach-dim);
	}
	dd {
		margin: 0;
		font-size: 0.9375rem;
	}
	.endpoint {
		margin: 0;
		overflow-x: auto;
	}
	code {
		font-family: var(--font-mono);
		font-size: 0.75rem;
		color: var(--peach-dim);
		white-space: nowrap;
	}
	.runs {
		display: grid;
		gap: 0.45rem;
		justify-items: start;
	}
	.runs__last,
	.runs__msg,
	.attribution {
		margin: 0;
		font-size: 0.8125rem;
	}
	.runs__last {
		font-family: var(--font-mono);
	}
	.runs__msg {
		color: var(--peach-hi);
	}
	.attribution {
		color: var(--peach-dim);
	}
	.muted {
		color: var(--peach-dim);
	}

	@media (max-width: 34rem) {
		/* The timestamp is the first thing to go: it is also inside the expansion. */
		.row__summary {
			grid-template-columns: auto minmax(0, 1fr) auto;
		}
		.row__when {
			display: none;
		}
		.row__body {
			padding-inline-start: 0.25rem;
		}
	}
</style>
