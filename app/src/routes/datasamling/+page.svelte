<script lang="ts">
	import { onMount, untrack } from 'svelte';
	import { page } from '$app/state';
	import { afterNavigate, goto } from '$app/navigation';
	import { formatEventTime } from '@hendingar/core/datetime';
	import { jobHealth } from '@hendingar/core/ingest-job';
	import SourceRow from '../../lib/components/collection/SourceRow.svelte';
	import PageMeta from '../../lib/components/PageMeta.svelte';
	import { listCollection } from '../../lib/collection.remote';
	import { claimTypedBeforeHydration } from '../../lib/typed-before-hydration.ts';
	import {
		listSources,
		sourceListHref,
		sourceListParams,
		viewCounts,
		type SourceListParams,
		type SourceView
	} from '../../lib/source-list.ts';

	// Top-level await so the list is in the server-rendered HTML (CLAUDE.md).
	const data = await listCollection();
	const now = data.generatedAt;

	const INPUT_ID = 'kjelde-sok';

	/*
	 * The search box is local state; the view and the sort are the URL.
	 *
	 * Typing filters at once and writes `?q=` back with a shallow `goto`, so the address stays
	 * shareable without a navigation per keystroke.
	 *
	 * What was typed before hydration is read here, while the DOM still holds it
	 * (lib/typed-before-hydration.ts), but applied only once mounted. Starting `q` from it would
	 * make the first client render a different list from the server's, and hydrating a keyed list
	 * against rows it does not match left the wrong source on screen under the right count.
	 */
	const typedBefore = claimTypedBeforeHydration().get(INPUT_ID);
	const fromUrl = $derived(sourceListParams(page.url.searchParams));
	let q = $state(untrack(() => sourceListParams(page.url.searchParams).q));

	onMount(() => {
		if (typedBefore !== undefined && typedBefore !== q) search(typedBefore);
	});

	// Back and forward land on a different `?q=`; the box follows. Not on the first load, where
	// the value above may be what somebody typed before the script arrived.
	afterNavigate((navigation) => {
		if (navigation.type !== 'enter' && !navigation.shallow) q = fromUrl.q;
	});

	const params: SourceListParams = $derived({ ...fromUrl, q });
	const rows = $derived(listSources(data.sources, params, now));
	const counts = viewCounts(data.sources, now);
	const max = Math.max(1, ...data.sources.map((s) => s.eventsUpcoming));

	const collected = data.sources.filter((s) => s.active && s.kind !== 'link');
	const upcoming = data.sources.reduce((n, s) => n + s.eventsUpcoming, 0);
	const weekly = data.sources.reduce((n, s) => n + s.activitiesWeekly, 0);
	const job = data.latestJob;
	const health = jobHealth(job, now);
	const jobOk =
		health.state === 'running' ||
		(health.state === 'done' && health.status === 'success' && !health.overdue);
	const minutes = (ms: number | null) =>
		ms === null ? null : Math.max(1, Math.round(ms / 60_000));
	const at = (d: Date) => formatEventTime(d, 'Europe/Oslo', 'card');

	const latestRun = collected
		.map((s) => s.lastRunAt)
		.filter((d) => d !== null)
		.sort((a, b) => b.getTime() - a.getTime())[0];

	const VIEWS: { vis: SourceView | null; label: string; count: number }[] = [
		{ vis: null, label: 'Alle', count: data.sources.length },
		{ vis: 'tilsyn', label: 'Treng tilsyn', count: counts.tilsyn },
		{ vis: 'tomme', label: 'Ingenting framover', count: counts.tomme },
		{ vis: 'lenkje', label: 'Berre lenkje', count: counts.lenkje }
	];

	function search(value: string) {
		q = value;
		void goto(sourceListHref(params), { shallow: true, replace: true });
	}
</script>

<PageMeta
	title="Kjelder — hendingar.no"
	description="Alle kalendrane hendingar.no hentar frå, kor mykje kvar av dei bidreg med, og om hentinga går som ho skal."
	path="/datasamling"
/>

<div class="shell head">
	<p class="label">Datasamling</p>
	<h1 class="display head__h">Kjelder</h1>
	<p class="head__lede">
		Hendingane her kjem frå {collected.length} kalendrar i Sunnhordland. Vi hentar frå kvar av dei éin
		gong i døgnet, og kvar hending lenkjer tilbake dit ho kom frå.
	</p>

	<!-- One line of status, in words. Trouble is named with a link straight to it. -->
	<p class="status" data-ok={counts.tilsyn === 0}>
		<span class="status__dot" aria-hidden="true"></span>
		{#if counts.tilsyn === 0}
			Alt går som det skal
		{:else}
			<a href={sourceListHref({ q: '', vis: 'tilsyn', sorter: null })} data-sveltekit-reset="false">
				{counts.tilsyn === 1 ? '1 kjelde treng' : `${counts.tilsyn} kjelder treng`} tilsyn
			</a>
		{/if}
		<span class="status__sep" aria-hidden="true">·</span>
		{upcoming} hendingar framover
		{#if weekly > 0}
			<span class="status__sep" aria-hidden="true">·</span>
			<a href="/alltid-ope">{weekly} faste aktivitetar</a>
		{/if}
		{#if latestRun}
			<span class="status__sep" aria-hidden="true">·</span>
			sist henta
			<time datetime={latestRun.toISOString()}
				>{formatEventTime(latestRun, 'Europe/Oslo', 'card')}</time
			>
		{/if}
	</p>

	<!--
		The night as a whole, from `ingest_jobs`. The line above is about sources; this one is about
		whether the collection happened — and a night that never ran is only visible here.
	-->
	{#if job && health.state !== 'none'}
		<p class="status job" data-ok={jobOk} data-testid="job-status">
			<span class="status__dot" aria-hidden="true"></span>
			{#if health.state === 'running'}
				Innsamling pågår, starta
				<time datetime={health.since.toISOString()}>{at(health.since)}</time>
			{:else if health.state === 'interrupted'}
				Innsamlinga som starta
				<time datetime={health.since.toISOString()}>{at(health.since)}</time>
				vart avbroten
			{:else}
				Siste innsamling
				<time datetime={health.at.toISOString()}>{at(health.at)}</time>
				{#if minutes(job.durationMs) !== null}
					<span class="status__sep" aria-hidden="true">·</span>
					{minutes(job.durationMs)} min
				{/if}
				<span class="status__sep" aria-hidden="true">·</span>
				{#if health.status === 'failed' && job.sourcesFailed < job.sourcesRun}
					feila
				{:else}
					{job.sourcesRun - job.sourcesFailed} av {job.sourcesRun} kjelder i orden
				{/if}
			{/if}
			{#if job.failed.length > 0 && health.state !== 'running'}
				<span class="status__sep" aria-hidden="true">·</span>
				<!-- One inline run of text: the line is a flex row, and a bare comma would be its own item. -->
				<span
					>feila: {#each job.failed as source, i (source.slug)}{i > 0 ? ', ' : ''}<a
							href={sourceListHref({ q: source.name, vis: null, sorter: null })}
							data-sveltekit-reset="false">{source.name}</a
						>{/each}</span
				>
			{/if}
			{#if health.state !== 'running' && health.overdue}
				<span class="status__sep" aria-hidden="true">·</span>
				<strong>neste innsamling er forseinka</strong>
			{/if}
		</p>
	{/if}
</div>

<section class="shell list" aria-labelledby="h-sources">
	<h2 id="h-sources" class="visually-hidden">Alle kjelder</h2>

	<!--
		A GET form, so search works with JavaScript off: Enter submits `?q=`, and the hidden fields
		carry the view and sort along. With JavaScript the list filters as you type.
	-->
	<form class="tools" method="get" action="/datasamling" role="search">
		<label class="tools__search">
			<span class="visually-hidden">Søk etter kjelde</span>
			<input
				id={INPUT_ID}
				name="q"
				type="search"
				placeholder="Søk etter kjelde eller plattform"
				autocomplete="off"
				value={q}
				oninput={(event) => search(event.currentTarget.value)}
			/>
		</label>
		{#if params.vis}<input type="hidden" name="vis" value={params.vis} />{/if}
		{#if params.sorter}<input type="hidden" name="sorter" value={params.sorter} />{/if}

		<nav class="tools__views" aria-label="Vis">
			{#each VIEWS as view (view.label)}
				{#if view.vis === null || view.count > 0}
					<a
						class="chip"
						href={sourceListHref({ ...params, vis: view.vis })}
						aria-current={params.vis === view.vis ? 'true' : undefined}
						data-sveltekit-reset="false"
					>
						{view.label} <span class="chip__n">{view.count}</span>
					</a>
				{/if}
			{/each}
		</nav>

		<p class="tools__sort">
			Sorter:
			<a
				href={sourceListHref({ ...params, sorter: null })}
				aria-current={params.sorter === null ? 'true' : undefined}
				data-sveltekit-reset="false">flest hendingar</a
			>
			/
			<a
				href={sourceListHref({ ...params, sorter: 'namn' })}
				aria-current={params.sorter === 'namn' ? 'true' : undefined}
				data-sveltekit-reset="false">A–Å</a
			>
		</p>
	</form>

	<p class="list__count" aria-live="polite">
		{rows.length === data.sources.length
			? `${rows.length} kjelder`
			: `Viser ${rows.length} av ${data.sources.length} kjelder`}
	</p>

	{#if rows.length === 0}
		<p class="empty">
			{#if data.sources.length === 0}
				Ingen kjelder registrerte enno.
			{:else}
				Ingen kjelder passar.
				<a href="/datasamling" data-sveltekit-reset="false" onclick={() => (q = '')}>Vis alle</a>
			{/if}
		</p>
	{:else}
		<div class="rows">
			{#each rows as source (source.slug)}
				<!--
					Wrapped, not bare. With the component as the each block's only child, the production
					build removed the wrong rows when the list was filtered after hydration — the right
					count, the wrong sources. An element per item gives the block a node of its own to
					key on. Measured; see the filter specs in e2e/collection.e2e.ts.
				-->
				<div class="rows__item"><SourceRow {source} {now} {max} /></div>
			{/each}
		</div>
	{/if}
</section>

<section class="shell more" aria-labelledby="h-more">
	<h2 id="h-more" class="visually-hidden">Meir om korleis hendingane kjem inn</h2>
	<a class="card" href="/innsendingar">
		<span class="label">Innsendingar</span>
		<span class="card__h">Sendt inn av folk</span>
		<span class="card__p">
			{data.submittedCount} hendingar er sende inn gjennom skjemaet{#if data.pendingCount > 0}, og
				{data.pendingCount} ventar på kontroll{/if}. Sjå kva som kom inn, og kva kontrollane
			avgjorde →
		</span>
	</a>

	<details class="how">
		<summary class="how__sum">Korleis hentinga fungerer</summary>
		<ol class="how__steps">
			<li><strong>Hent.</strong> Vi les kalenderen til kjelda, slik ho sjølv publiserer han.</li>
			<li>
				<strong>Sjekk.</strong> Kvart svar blir sjekka mot eit fast format. Endrar kjelda seg, stoppar
				hentinga i staden for å lagre feil.
			</li>
			<li>
				<strong>Omset.</strong> Tid, stad, kategori og arrangør blir gjort om til vårt format — same input
				gir alltid same resultat.
			</li>
			<li>
				<strong>Lagre.</strong> Ei hending vi har frå før blir oppdatert, ikkje lagra på nytt.
			</li>
		</ol>
		<p class="how__note">
			Ingen språkmodell hentar data. Vi respekterer <code>robots.txt</code>, seier kven vi er, og
			tek berre med plakatar når kjelda seier at bilderettane er avklarte.
		</p>
	</details>
</section>

<section class="cta invert" aria-labelledby="h-add">
	<div class="shell cta__inner">
		<h2 id="h-add" class="display cta__h">Manglar det ein kalender?</h2>
		<div class="cta__actions">
			<a
				class="btn btn--invert"
				href="https://github.com/Hendingar/hendingar.no/issues/new?template=event-source.yml"
			>
				Foreslå ei kjelde
			</a>
			<a
				class="btn btn--invert-ghost"
				href="https://github.com/Hendingar/hendingar.no/blob/main/docs/event-sources.md"
			>
				Les rettleiinga
			</a>
		</div>
	</div>
</section>

<style>
	.head {
		padding-block: var(--section-y) 0;
		container-type: inline-size;
	}
	.head__h {
		font-size: clamp(1.9rem, 13cqw, 7rem);
		margin-block: 0.25em 0.3em;
	}
	.head__lede {
		max-inline-size: 54ch;
		margin: 0 0 1.25rem;
	}

	.status {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.35rem 0.6rem;
		margin: 0;
		font-family: var(--font-mono);
		font-size: 0.8125rem;
		color: var(--peach-dim);
	}
	.status__dot {
		inline-size: 0.6rem;
		block-size: 0.6rem;
		border-radius: 50%;
		background: var(--peach);
	}
	/* Trouble is a hollow ring rather than a different colour — the palette is one hue. */
	.status[data-ok='false'] .status__dot {
		background: transparent;
		border: 2px solid var(--peach-hi);
	}
	.status[data-ok='false'] a {
		color: var(--peach-hi);
	}
	.job {
		margin-block-start: 0.4rem;
	}
	.job strong {
		font-weight: inherit;
		color: var(--peach-hi);
	}

	.list {
		padding-block: clamp(2rem, 5vw, 3.5rem) clamp(2.5rem, 6vw, 4.5rem);
	}
	.tools {
		display: grid;
		gap: 0.9rem;
		margin-block-end: 1rem;
	}
	.tools__search input {
		inline-size: 100%;
		box-sizing: border-box;
		padding: 0.8rem 1rem;
		font: inherit;
		color: var(--peach);
		background: var(--peach-ghost);
		border: var(--rule) solid var(--peach-line);
	}
	.tools__search input::placeholder {
		color: var(--peach-dim);
	}
	.tools__search input:focus-visible {
		outline: var(--rule-fat) solid var(--peach-hi);
		outline-offset: 0;
	}
	.tools__views {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
	}
	.chip {
		font-family: var(--font-mono);
		font-size: var(--step-micro);
		letter-spacing: 0.08em;
		text-transform: uppercase;
		text-decoration: none;
		padding: 0.45em 0.8em;
		border: var(--rule) solid var(--peach-line);
	}
	.chip:hover {
		border-color: var(--peach);
	}
	.chip[aria-current='true'] {
		background: var(--peach);
		color: var(--navy-900);
		border-color: var(--peach);
	}
	.chip__n {
		opacity: 0.75;
	}
	.tools__sort {
		margin: 0;
		font-family: var(--font-mono);
		font-size: 0.8125rem;
		color: var(--peach-dim);
	}
	.tools__sort a {
		color: var(--peach-dim);
	}
	.tools__sort a[aria-current='true'] {
		color: var(--peach-hi);
		text-decoration: none;
		font-weight: 700;
	}
	.list__count {
		margin: 0 0 0.5rem;
		font-family: var(--font-mono);
		font-size: var(--step-micro);
		letter-spacing: 0.14em;
		text-transform: uppercase;
		color: var(--peach-dim);
	}
	.rows {
		border-block-start: var(--rule) solid var(--peach-line);
	}
	.empty {
		padding-block: 1.5rem;
		margin: 0;
	}

	.more {
		display: grid;
		gap: 1.5rem;
		padding-block-end: var(--section-y);
	}
	.card {
		display: grid;
		gap: 0.35rem;
		padding: 1.4rem 1.5rem;
		text-decoration: none;
		border: var(--rule-fat) solid var(--peach);
		transition: background var(--dur-fast) ease;
	}
	.card:hover {
		background: var(--peach-ghost);
	}
	.card .label {
		margin: 0;
	}
	.card__h {
		font-family: var(--font-display);
		font-weight: 900;
		font-stretch: 112%;
		text-transform: uppercase;
		font-size: var(--step-mid);
	}
	.card__p {
		max-inline-size: 62ch;
		color: var(--peach-dim);
	}
	@media (prefers-reduced-motion: reduce) {
		.card {
			transition: none;
		}
	}

	.how {
		border-block: var(--rule) solid var(--peach-line);
	}
	.how__sum {
		padding: 1rem 0;
		cursor: pointer;
		font-family: var(--font-display);
		font-weight: 800;
		font-size: 1.0625rem;
	}
	.how__steps {
		margin: 0;
		padding-inline-start: 1.4rem;
		display: grid;
		gap: 0.5rem;
		max-inline-size: 62ch;
	}
	.how__note {
		margin: 1rem 0 1.25rem;
		max-inline-size: 62ch;
		font-size: 0.875rem;
		color: var(--peach-dim);
	}
	.how__note code {
		font-family: var(--font-mono);
		font-size: 0.8125rem;
	}

	.cta {
		padding-block: clamp(2.5rem, 6vw, 4.5rem);
		border-block-start: var(--rule-fat) solid var(--navy-900);
	}
	.cta__inner {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(min(100%, 20rem), 1fr));
		gap: var(--gutter);
		align-items: center;
		container-type: inline-size;
	}
	.cta__h {
		font-size: clamp(1.2rem, 5cqw, 2.5rem);
		margin: 0;
	}
	.cta__actions {
		display: flex;
		flex-wrap: wrap;
		gap: 0.75rem;
	}
</style>
