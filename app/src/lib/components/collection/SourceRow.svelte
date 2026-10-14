<script lang="ts">
	import { formatEventTime } from '@hendingar/core/datetime';
	import { describeCron, freshness, nextCronRun } from '@hendingar/core/schedule';
	import { platformOf } from '@hendingar/core/directory';
	import RunStrip from './RunStrip.svelte';
	import SourceIcon from '../SourceIcon.svelte';
	import type { CollectedSource } from '../../collection.remote';

	/**
	 * One source as a compact row that expands.
	 *
	 * The row carries what you scan by — who, how much it contributes, healthy or not — and the
	 * rest is one click away. A platform (AllEvents, Billetto…) is named on the row as "via X"
	 * rather than nesting its organisers in a group of their own: nested folds hid most of the
	 * list behind a second click, and broke the sort by how much each source contributes.
	 *
	 * `<details>` rather than a JS toggle: it opens without JavaScript, is keyboard operable and
	 * announced as expandable for free, and survives Ctrl-F opening the section that matches.
	 */
	let {
		source,
		now,
		/** The largest upcoming count on the page, so the bar is a share of something. */
		max
	}: { source: CollectedSource; now: Date; max: number } = $props();

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
		never: 'Ikkje køyrt',
		failed: 'Feila sist'
	};

	/*
	 * A linked source is not a broken one.
	 *
	 * `freshness` would call it 'never' and the row would read "Ikkje køyrt", which is the same
	 * words an importer that has silently stopped would show. One is a gap we have chosen and
	 * explained, the other is a failure.
	 */
	const linkOnly = $derived(source.kind === 'link');
	const last = $derived(source.runs[0]);
	const state = $derived.by(() => {
		const fresh = freshness(source.lastRunAt, source.scheduleCron, now);
		return fresh === 'fresh' && last?.status === 'failed' ? 'failed' : fresh;
	});
	const next = $derived(nextCronRun(source.scheduleCron, now));
	const schedule = $derived(describeCron(source.scheduleCron));
	const platform = $derived(platformOf(source.slug));
	const share = $derived(max > 0 ? source.eventsUpcoming / max : 0);
</script>

<!-- data-kind so a collected row and a linked one are distinguishable without reading text. -->
<details class="row" data-kind={source.kind}>
	<summary class="row__summary">
		<SourceIcon src={source.iconUrl} name={source.name} />
		<span class="row__id">
			<span class="row__name">{source.name}</span>
			<span class="row__meta">
				{#if platform}via {platform.name} ·{/if}
				{#if linkOnly}
					vi lenkjer berre hit
				{:else if source.lastRunAt}
					henta
					<time datetime={source.lastRunAt.toISOString()}>
						{formatEventTime(source.lastRunAt, 'Europe/Oslo', 'card')}
					</time>
				{:else}
					aldri henta
				{/if}
			</span>
		</span>
		<span class="row__count">
			{#if linkOnly}
				<span class="row__n row__n--none" aria-hidden="true">—</span>
			{:else}
				<span class="row__n">{source.eventsUpcoming}</span>
				<span class="row__unit">framover</span>
				<!-- Decorative: the number beside it says the same thing in words. -->
				<span class="row__bar" aria-hidden="true">
					<span class="row__fill" style:inline-size="{Math.max(share * 100, share ? 3 : 0)}%"
					></span>
				</span>
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
			<p class="actions">
				<a class="btn btn--sm" href={source.url} rel="noopener">Opne {source.name}</a>
			</p>
		{:else}
			{#if platform}
				<p class="why">{platform.note}</p>
			{/if}

			<p class="actions">
				{#if source.eventsUpcoming > 0}
					<!-- The name is in the link text, not just the row above it, so a screen reader's
					     list of links does not read as forty identical entries. -->
					<span class="see">
						<a
							class="btn btn--sm btn--solid"
							href="/hendingar?kjelde={encodeURIComponent(source.slug)}"
						>
							Sjå hendingane frå {source.name}
						</a>
					</span>
				{:else}
					<!-- No link when there is nothing to open: the filtered listing would be empty. -->
					<span class="see see--none">Ingenting framover herifrå akkurat no.</span>
				{/if}
				<a class="btn btn--sm" href={source.url} rel="noopener">Opne kjelda ↗</a>
			</p>

			<dl class="facts">
				<div>
					<dt>Hentar</dt>
					<dd>{schedule ?? 'ikkje planlagt'}</dd>
				</div>
				<div>
					<dt>Neste gong</dt>
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
					<dt>Totalt henta</dt>
					<dd>{source.eventsTotal} hendingar</dd>
				</div>
				<div>
					<dt>Publiserast</dt>
					<dd>{source.trusted ? 'direkte' : 'etter kontroll'}</dd>
				</div>
			</dl>

			{#if source.runs.length > 0}
				<div class="runs">
					<p class="label">Siste {source.runs.length} hentingar</p>
					<RunStrip runs={source.runs} />
					{#if last}
						<p class="runs__last">
							Sist: {last.created} nye · {last.updated} endra · {last.unchanged} uendra
							{#if last.rejected > 0}
								· <strong>{last.rejected} avviste</strong>
							{/if}
						</p>
					{/if}
					{#if last?.message}
						<p class="runs__msg">{last.message}</p>
					{/if}
				</div>
			{/if}

			<p class="tech">
				{KIND_LABEL[source.kind] ?? source.kind}
				{#if source.endpoint}
					· <span class="visually-hidden">Endepunkt: </span><code>{source.endpoint}</code>
				{/if}
			</p>
		{/if}
	</div>
</details>

<style>
	.row {
		border-block-end: var(--rule) solid var(--peach-line);
	}
	.row__summary {
		display: grid;
		grid-template-columns: auto minmax(0, 1fr) 7.5rem 7.5rem;
		align-items: center;
		gap: 0.9rem;
		padding: 0.8rem 0.25rem;
		cursor: pointer;
		list-style: none;
	}
	/* Safari still paints the default triangle without this. */
	.row__summary::-webkit-details-marker {
		display: none;
	}
	.row__summary:hover {
		background: var(--peach-ghost);
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
		gap: 0.15rem;
		min-inline-size: 0;
	}
	.row__name {
		font-family: var(--font-display);
		font-weight: 800;
		font-stretch: 108%;
		font-size: 1.0625rem;
		letter-spacing: -0.005em;
	}
	/* The disclosure marker hangs off the name, so it stays beside the word it opens. */
	.row__name::after {
		content: ' ▸';
		color: var(--peach-dim);
		font-weight: 400;
	}
	.row[open] .row__name::after {
		content: ' ▾';
	}
	.row__meta {
		font-family: var(--font-mono);
		font-size: 0.75rem;
		color: var(--peach-dim);
	}
	.row__count {
		display: grid;
		grid-template-columns: auto 1fr;
		align-items: baseline;
		gap: 0.1rem 0.4rem;
	}
	.row__n {
		font-family: var(--font-display);
		font-weight: 800;
		font-size: 1.25rem;
		font-variant-numeric: tabular-nums;
		text-align: end;
	}
	.row__n--none {
		color: var(--peach-dim);
	}
	.row__unit {
		font-family: var(--font-mono);
		font-size: var(--step-micro);
		color: var(--peach-dim);
	}
	.row__bar {
		grid-column: 1 / -1;
		block-size: 4px;
		background: var(--peach-ghost);
	}
	.row__fill {
		display: block;
		block-size: 100%;
		background: var(--peach);
	}
	.state {
		justify-self: end;
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
		color: var(--peach-dim);
	}
	/* Only trouble is filled, so it is what the eye lands on in a list of forty. */
	.state[data-state='late'],
	.state[data-state='stale'],
	.state[data-state='never'],
	.state[data-state='failed'] {
		background: var(--peach);
		color: var(--navy-900);
		border-color: var(--peach);
	}

	.row__body {
		display: grid;
		gap: 1.1rem;
		padding: 0.5rem 0.25rem 1.6rem;
		/* Indented to the icon's edge, so the expansion reads as belonging to the row above it. */
		padding-inline-start: calc(2rem + 0.9rem + 0.25rem);
	}
	.why {
		margin: 0;
		max-inline-size: 62ch;
		font-size: 0.9375rem;
	}
	.actions {
		display: flex;
		flex-wrap: wrap;
		gap: 0.6rem;
		align-items: center;
		margin: 0;
	}
	.see--none {
		font-family: var(--font-mono);
		font-size: 0.8125rem;
		color: var(--peach-dim);
	}
	.facts {
		margin: 0;
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(min(100%, 9rem), 1fr));
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
	.runs {
		display: grid;
		gap: 0.45rem;
		justify-items: start;
	}
	.runs .label {
		margin: 0;
	}
	.runs__last,
	.runs__msg,
	.tech {
		margin: 0;
		font-size: 0.8125rem;
	}
	.runs__last {
		font-family: var(--font-mono);
	}
	.runs__msg {
		color: var(--peach-hi);
	}
	.tech {
		font-family: var(--font-mono);
		color: var(--peach-dim);
		overflow-x: auto;
	}
	code {
		font-family: var(--font-mono);
		font-size: 0.75rem;
		white-space: nowrap;
	}

	@media (max-width: 40rem) {
		/* Name over count: the state chip moves under the name's row, the count stays visible. */
		.row__summary {
			grid-template-columns: auto minmax(0, 1fr) auto;
			grid-template-areas:
				'icon id count'
				'icon state count';
			row-gap: 0.35rem;
		}
		.row__summary > :global(.icon) {
			grid-area: icon;
		}
		.row__id {
			grid-area: id;
		}
		.row__count {
			grid-area: count;
			inline-size: 5.5rem;
		}
		.state {
			grid-area: state;
			justify-self: start;
		}
		.row__body {
			padding-inline-start: 0.25rem;
		}
	}
</style>
