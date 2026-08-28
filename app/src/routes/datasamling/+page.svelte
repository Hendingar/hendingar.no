<script lang="ts">
	import { formatEventTime } from '@hendingar/core/datetime';
	import { freshness } from '@hendingar/core/schedule';
	import SourceCard from '../../lib/components/collection/SourceCard.svelte';
	import { listCollection } from '../../lib/collection.remote';

	// Top-level await so the status board is in the server-rendered HTML (CLAUDE.md).
	const data = await listCollection();
	const now = data.generatedAt;

	const states = data.sources
		.filter((s) => s.active)
		.map((s) => freshness(s.lastRunAt, s.scheduleCron, now));
	const allFresh = states.length > 0 && states.every((s) => s === 'fresh');
	const anyBroken = states.some((s) => s === 'stale' || s === 'never');

	const totalEvents = data.sources.reduce((n, s) => n + s.eventsTotal, 0);
	const totalUpcoming = data.sources.reduce((n, s) => n + s.eventsUpcoming, 0);

	const method = [
		{
			n: '01',
			name: 'Hent',
			what: 'Vi kallar eit JSON-endepunkt med eigen User-Agent, og følgjer sidevindauga til dei tek slutt. Ingen innlogging, ingenting bak betalingsmur.'
		},
		{
			n: '02',
			name: 'Valider',
			what: 'Kvart svar blir sjekka mot eit skjema. Endrar kjelda form, stoppar køyringa med ein presis feil i staden for å skrive tull i databasen.'
		},
		{
			n: '03',
			name: 'Kartlegg',
			what: 'Rein omforming til vår modell: kategori, tidspunkt med tidssone, stad, arrangør. Same input gir alltid same output.'
		},
		{
			n: '04',
			name: 'Skriv',
			what: 'Upsert på (kjelde, ekstern id). Ei ny køyring oppdaterer, ho duplikerer ikkje. Difor er dagleg henting trygt.'
		}
	];
</script>

<svelte:head>
	<title>Datasamling — hendingar.no</title>
	<meta
		name="description"
		content="Kva vi hentar inn, kvar frå, kor ofte og korleis. Open status for datainnsamlinga i hendingar.no."
	/>
</svelte:head>

<div class="shell head">
	<p class="label">Systemstatus</p>
	<h1 class="display head__h">Datasamling</h1>
	<p class="head__lede">
		Kva vi hentar, kvar frå, kor ofte — og kva som faktisk skjedde sist. Tala under kjem frå
		køyringane sjølve, ikkje frå ei liste nokon har skrive.
	</p>
</div>

<section class="summary invert" aria-labelledby="h-summary">
	<h2 id="h-summary" class="visually-hidden">Samandrag</h2>
	<div class="shell summary__grid">
		<div class="stat">
			<p class="stat__n display">{data.sources.filter((s) => s.active).length}</p>
			<p class="stat__l">aktive kjelder</p>
		</div>
		<div class="stat">
			<p class="stat__n display">{totalEvents}</p>
			<p class="stat__l">hendingar henta</p>
		</div>
		<div class="stat">
			<p class="stat__n display">{totalUpcoming}</p>
			<p class="stat__l">framover i tid</p>
		</div>
		<div class="stat">
			<p class="stat__n display">{data.submittedCount}</p>
			<p class="stat__l">sendt inn av folk</p>
		</div>
		<div class="stat stat--wide">
			<p class="stat__n display stat__n--sm">
				{#if anyBroken}Treng tilsyn{:else if allFresh}Alt går som det skal{:else}Noko heng etter{/if}
			</p>
			<p class="stat__l">
				oppdatert
				<time datetime={now.toISOString()}>{formatEventTime(now, 'Europe/Oslo', 'full')}</time>
			</p>
		</div>
	</div>
</section>

<section class="shell sources" aria-labelledby="h-sources">
	<p class="label">01 — Kjelder</p>
	<h2 id="h-sources" class="display sources__h">Kvar det kjem frå</h2>

	{#if data.sources.length === 0}
		<p class="empty">Ingen kjelder registrerte enno.</p>
	{:else}
		<div class="grid">
			{#each data.sources as source (source.slug)}
				<SourceCard {source} {now} />
			{/each}
		</div>
	{/if}
</section>

<section class="method" aria-labelledby="h-method">
	<div class="shell">
		<p class="label">02 — Metode</p>
		<h2 id="h-method" class="display method__h">Korleis vi gjer det</h2>
		<p class="method__lede">
			Innhentinga er heilt deterministisk. Same kjelde inn gir same resultat ut, kvar gong.
		</p>
		<ol class="steps">
			{#each method as step (step.n)}
				<li class="step">
					<span class="step__n" aria-hidden="true">{step.n}</span>
					<span class="step__name">{step.name}</span>
					<span class="step__what">{step.what}</span>
				</li>
			{/each}
		</ol>
		<p class="fineprint">
			<strong>Ingen språkmodell hentar data.</strong> Ein importør som gir ulikt svar på same input er
			ikkje mogleg å feilsøkje, og oppdikta hendingar er verre enn ingen hendingar. Agentar verifiserer
			innsende hendingar seinare i løypa — på data som allereie er strukturert, og med eit menneske på
			alt som er usikkert.
		</p>
		<p class="fineprint">
			Vi respekterer <code>robots.txt</code>, oppgir kven vi er i User-Agent, og hentar éin gong i
			døgnet. Plakatar blir berre tekne med når kjelda seier at bilderettane er avklarte.
		</p>
	</div>
</section>

<section class="cta invert" aria-labelledby="h-add">
	<div class="shell cta__inner">
		<div>
			<p class="label">Ver med</p>
			<h2 id="h-add" class="display cta__h">Kjenner du ein kalender vi bør hente frå?</h2>
		</div>
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
		margin-block: 0.25em 0.4em;
	}
	.head__lede {
		max-inline-size: 54ch;
		margin: 0 0 var(--section-y);
	}

	.summary {
		padding-block: clamp(1.5rem, 4vw, 2.5rem);
		border-block: var(--rule-fat) solid var(--navy-900);
	}
	.summary__grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(min(100%, 9rem), 1fr));
		gap: 1.25rem var(--gutter);
	}
	.stat {
		container-type: inline-size;
	}
	/*
	 * `span 2` inside a single-column grid does not clamp — it creates an implicit second column
	 * and doubles the grid's width, which pushed the whole page 66px past a 320px viewport. Only
	 * span once there are genuinely two columns to span.
	 */
	@media (width >= 34rem) {
		.stat--wide {
			grid-column: span 2;
		}
	}
	.stat__n {
		font-size: clamp(1.75rem, 30cqw, 3.5rem);
		margin: 0;
	}
	.stat__n--sm {
		font-size: clamp(1rem, 11cqw, 1.6rem);
	}
	.stat__l {
		margin: 0.4rem 0 0;
		font-family: var(--font-mono);
		font-size: var(--step-micro);
		letter-spacing: 0.18em;
		text-transform: uppercase;
		color: rgb(22 34 59 / 78%);
	}

	.sources {
		padding-block: var(--section-y);
		container-type: inline-size;
	}
	.sources__h {
		font-size: clamp(1.75rem, 11cqw, 5rem);
		margin-block: 0.25em 1em;
	}
	.grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(min(100%, 24rem), 1fr));
		gap: var(--gutter);
	}
	.empty {
		font-family: var(--font-display);
		font-weight: 800;
		text-transform: uppercase;
	}

	.method {
		background: var(--navy-900);
		border-block: var(--rule) solid var(--peach-line);
		padding-block: var(--section-y);
		container-type: inline-size;
	}
	.method__h {
		font-size: clamp(1.75rem, 8cqw, 4rem);
		margin-block: 0.3em 0.6em;
	}
	.method__lede {
		max-inline-size: 52ch;
		margin: 0 0 2.5rem;
	}
	.steps {
		list-style: none;
		padding: 0;
		margin: 0 0 1.5rem;
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(min(100%, 16rem), 1fr));
	}
	.step {
		display: grid;
		gap: 0.3rem;
		padding: 1.4rem 1.4rem 1.6rem 0;
		border-block-start: var(--rule) solid var(--peach-line);
		align-content: start;
	}
	.step__n {
		font-family: var(--font-display);
		font-weight: 900;
		font-stretch: 125%;
		font-size: 2.6rem;
		line-height: 0.8;
		color: var(--peach-quiet);
	}
	.step__name {
		font-family: var(--font-display);
		font-weight: 900;
		font-stretch: 112%;
		text-transform: uppercase;
		font-size: 1.1rem;
	}
	.step__what {
		color: var(--peach-dim);
		font-size: 0.875rem;
		line-height: 1.6;
	}

	.cta {
		padding-block: var(--section-y);
		border-block-start: var(--rule-fat) solid var(--navy-900);
	}
	.cta__inner {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(min(100%, 20rem), 1fr));
		gap: var(--gutter);
		align-items: end;
	}
	.cta__inner > div:first-child {
		container-type: inline-size;
	}
	.cta__h {
		font-size: clamp(1.2rem, 7.5cqw, 2.75rem);
		margin-block: 0.3em 0;
	}
	.cta__actions {
		display: flex;
		flex-wrap: wrap;
		gap: 0.75rem;
	}
</style>
