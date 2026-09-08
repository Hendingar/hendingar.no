<script lang="ts">
	import { formatEventTime } from '@hendingar/core/datetime';
	import { freshness } from '@hendingar/core/schedule';
	import SourceRow from '../../lib/components/collection/SourceRow.svelte';
	import PlatformGroup from '../../lib/components/collection/PlatformGroup.svelte';
	import { SOURCE_PLATFORMS, platformOf } from '@hendingar/core/directory';
	import SubmissionLog from '../../lib/components/collection/SubmissionLog.svelte';
	import PageMeta from '../../lib/components/PageMeta.svelte';
	import { listCollection } from '../../lib/collection.remote';
	import { CHECK_COUNT_WORD } from '../../lib/checks.ts';

	// Top-level await so the status board is in the server-rendered HTML (CLAUDE.md).
	const data = await listCollection();
	const now = data.generatedAt;

	const states = data.sources
		.filter((s) => s.active)
		.map((s) => freshness(s.lastRunAt, s.scheduleCron, now));
	const allFresh = states.length > 0 && states.every((s) => s === 'fresh');
	const anyBroken = states.some((s) => s === 'stale' || s === 'never');

	/*
	 * Platform organisers fold into their platform; everything else is a row of its own.
	 *
	 * Derived here rather than stored on the source, because the slug prefix every platform
	 * importer already uses IS the fact — so adding an organiser stays one config entry in its
	 * importer, with no second edit here and no chance of the two drifting apart. See
	 * `platformOf` in packages/core.
	 *
	 * Order is preserved from the query (by name), and a platform takes the position of its first
	 * organiser, so the page does not reshuffle when a profile is added.
	 */
	type CollectedRow = (typeof data.sources)[number];
	type Entry =
		| { kind: 'source'; source: CollectedRow }
		| {
				kind: 'platform';
				platform: (typeof SOURCE_PLATFORMS)[number];
				sources: CollectedRow[];
		  };

	const entries = $derived.by(() => {
		/*
		 * One pass, appending each organiser to its platform's entry if that entry already exists.
		 *
		 * A platform takes the position of its FIRST organiser, so the page keeps the query's
		 * ordering and does not reshuffle when a profile is added.
		 *
		 * No Map or Set to key the lookup on: the repo's lint rule asks for the reactive versions
		 * wherever a built-in collection appears in a component, and reaching for reactive state to
		 * deduplicate inside a derived would be answering a question nobody asked. A linear scan
		 * over what is currently eighteen sources is not the thing to optimise.
		 */
		const out: Entry[] = [];

		for (const source of data.sources) {
			const platform = platformOf(source.slug);
			if (!platform) {
				out.push({ kind: 'source', source });
				continue;
			}
			const existing = out.find(
				(entry) => entry.kind === 'platform' && entry.platform.slug === platform.slug
			);
			if (existing?.kind === 'platform') {
				existing.sources.push(source);
				continue;
			}
			out.push({ kind: 'platform', platform, sources: [source] });
		}
		return out;
	});

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

<PageMeta
	title="Kjelder og status — hendingar.no"
	description="Kvar hendingane kjem frå, kor ofte vi hentar dei, kva som skjedde sist — og kva kalendrar vi ikkje klarer å hente."
	path="/datasamling"
/>

<div class="shell head">
	<p class="label">Systemstatus</p>
	<h1 class="display head__h">Kjelder og status</h1>
	<p class="head__lede">
		Kvar hendingane kjem frå, kor ofte vi hentar dei, og kva som faktisk skjedde sist. Tala under
		kjem frå køyringane sjølve, ikkje frå ei liste nokon har skrive — og kalendrar vi ikkje klarer å
		hente står her òg, med grunnen.
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
		<div class="stat">
			<p class="stat__n display">{data.pendingCount}</p>
			<p class="stat__l">ikkje avgjort enno</p>
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

<section class="shell block" aria-labelledby="h-submissions">
	<p class="label">Innsendingar</p>
	<h2 id="h-submissions" class="display block__h">Sendt inn av folk</h2>
	<p class="block__lede">
		Kva som er kome inn gjennom <a href="/send-inn">skjemaet</a> eller frå eit bilete, og kva dei
		{CHECK_COUNT_WORD} kontrollane avgjorde. Alt blir avgjort med ein gong — kom hendinga ikkje ut, kan
		den som sende henne rette og prøve igjen, og ho blir sletta om ingen gjer det innan 48 timar.
	</p>
	<SubmissionLog submissions={data.submissions} />

	{#if data.submittedLiveCount > 0}
		<!--
			The log is the last five, decisions and all. This is where the ones that went out live.

			`/hendingar?kjelde=innsendt` is not a new page: the listing already treats submissions as
			a source of their own, because they have no `sources` row and the join could not see
			them. It simply had no way in from here — the page that talks about submissions all the
			way down and then pointed at nothing.

			Rendered only when the filter has something in it. An unknown or empty `kjelde` is
			dropped rather than refused, so a link to nothing would quietly show the whole listing,
			which is the one outcome a reader could not tell from a bug.
		-->
		<p class="block__more">
			<a href="/hendingar?kjelde=innsendt">
				<!-- "alle 1" is not a sentence. One is a different word here, as it is on /alltid-ope. -->
				{data.submittedLiveCount === 1
					? 'Sjå den eine innsende hendinga som ligg ute'
					: `Sjå alle dei ${data.submittedLiveCount} innsende hendingane som ligg ute`} →
			</a>
		</p>
	{/if}
</section>

<section class="shell block" aria-labelledby="h-sources">
	<p class="label">Kjelder</p>
	<h2 id="h-sources" class="display block__h">Kvar det kjem frå</h2>
	<p class="block__lede">
		Éi linje per kjelde. Opne ei av dei for rytme, endepunkt og køyringshistorikk. Nokre kjelder er
		plattformer der fleire arrangørar legg ut kvar for seg — dei ligg samla under plattforma.
	</p>

	{#if data.sources.length === 0}
		<p class="empty">Ingen kjelder registrerte enno.</p>
	{:else}
		<div class="rows">
			{#each entries as entry (entry.kind === 'platform' ? entry.platform.slug : entry.source.slug)}
				{#if entry.kind === 'platform'}
					<PlatformGroup platform={entry.platform} sources={entry.sources} {now} />
				{:else}
					<SourceRow source={entry.source} {now} />
				{/if}
			{/each}
		</div>
	{/if}
</section>

<section class="method" aria-labelledby="h-method">
	<div class="shell">
		<p class="label">Metode</p>
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
			innsende hendingar seinare i løypa — på data som allereie er strukturert, og med eit svar til den
			som sende inn på alt som ikkje går gjennom.
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

	.block {
		/* Was --section-y (up to 9rem) per section. With two list sections plus the method band
		   that put most of the page's height into empty space between headings. */
		padding-block: clamp(2.5rem, 6vw, 4.5rem);
		container-type: inline-size;
	}
	.block__h {
		/* Was 11cqw, up to 5rem — a heading taller than the list it introduced. The lists are the
		   content here; the headings only have to separate them. */
		font-size: clamp(1.5rem, 6cqw, 2.5rem);
		margin-block: 0.25em 0.4em;
	}
	.block__lede {
		margin: 0 0 1.75rem;
		max-inline-size: 62ch;
		color: var(--peach-dim);
	}
	/* Under the list it belongs to, in the same mono the log's own timestamps use. */
	.block__more {
		margin: 1.25rem 0 0;
		font-family: var(--font-mono);
		font-size: var(--step-micro);
		letter-spacing: 0.14em;
		text-transform: uppercase;
	}
	.rows {
		border-block-start: var(--rule) solid var(--peach-line);
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
