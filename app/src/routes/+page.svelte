<script lang="ts">
	import { listEvents } from '../lib/events.remote';
	import { categoryLabel } from '@hendingar/core/taxonomy';

	const soon = listEvents({ limit: 4 });

	const doesNot = [
		['Billettar', 'Ingen kasse, ingen gebyr. Lenkje til der billettane faktisk finst.'],
		['Sosialt nettverk', 'Ingen følgjarar, ingen feed, ingen varsel som dreg deg tilbake.'],
		['Reklame', 'Ingen annonsar, ingen sporing, ingen datasal. Aldri.'],
		['Innhegning', 'Konto er frivillig. Alt kan eksporterast. Å gå er lett med vilje.']
	];

	const pipeline = [
		['Truverd', 'Er dette ei verkeleg hending, eller spam?'],
		['Duplikat', 'Same hending frå to kjelder blir éi.'],
		['Normalisering', 'Dato, tid og gjentaking blir struktur.'],
		['Geokoding', 'Frå stadnamn til koordinat — eller flagg.'],
		['Kategori', 'Konsert, teater, kulturhus, sport …'],
		['Kjelde', 'Finst hendinga der ho seier ho kjem frå?']
	];
</script>

<svelte:head>
	<title>hendingar.no — alt som skjer, der du er</title>
	<meta
		name="description"
		content="Open kjeldekode for lokale hendingar i Europa. Gratis, utan reklame, utan innlåsing."
	/>
</svelte:head>

<!-- ============================ HERO ============================ -->
<header class="hero">
	<div class="hero__rail" aria-hidden="true">
		<span class="label label--vertical">AGPL · EU-hosta</span>
	</div>

	<div class="hero__type">
		<p class="label">Lokale hendingar · Europa</p>

		<ul class="pips" aria-hidden="true">
			{#each [0, 1, 2, 3, 4, 5] as i (i)}
				<li class="pip" data-on={i < 2}></li>
			{/each}
		</ul>
		<p class="label phase">Fase 2 — MVP</p>

		<h1 class="display hero__word">
			<span class="hero__line">Hend</span><span class="hero__line display--outline">ingar</span>
		</h1>

		<p class="hero__lede">
			Alt som skjer i lokalsamfunnet ditt. <em>Éin</em> stad.
		</p>

		<p class="hero__body">
			Kvart lokalsamfunn har konsertar på pub, teater, gardsbesøk, kulturhus, kurs og møte. Å finne
			dei krev at du leitar gjennom eit titals Facebook-sider. Det held ikkje.
		</p>

		<div class="hero__actions">
			<a class="btn btn--solid" href="/hendingar">Sjå hendingar</a>
			<a class="btn" href="https://github.com/Hendingar/hendingar.no">Bidra på GitHub</a>
		</div>
	</div>

	<!-- Decorative: proximity rings over a halftone field. Duotone by construction —
	     the SVG only ever references the two brand hues. -->
	<div class="hero__art" aria-hidden="true">
		<svg viewBox="0 0 600 820" preserveAspectRatio="xMidYMid slice">
			<defs>
				<pattern id="dot-lg" width="12" height="12" patternUnits="userSpaceOnUse">
					<circle cx="3" cy="3" r="2.6" fill="var(--peach)" />
				</pattern>
				<pattern id="dot-md" width="10" height="10" patternUnits="userSpaceOnUse">
					<circle cx="2.5" cy="2.5" r="1.5" fill="var(--peach)" />
				</pattern>
				<pattern id="dot-sm" width="8" height="8" patternUnits="userSpaceOnUse">
					<circle cx="2" cy="2" r="0.8" fill="var(--peach)" />
				</pattern>

				<radialGradient id="core" cx="52%" cy="38%" r="34%">
					<stop offset="0%" stop-color="#fff" stop-opacity="1" />
					<stop offset="100%" stop-color="#fff" stop-opacity="0" />
				</radialGradient>
				<radialGradient id="mid" cx="52%" cy="38%" r="62%">
					<stop offset="20%" stop-color="#fff" stop-opacity="0" />
					<stop offset="60%" stop-color="#fff" stop-opacity="0.9" />
					<stop offset="100%" stop-color="#fff" stop-opacity="0" />
				</radialGradient>
				<radialGradient id="outer" cx="52%" cy="38%" r="95%">
					<stop offset="45%" stop-color="#fff" stop-opacity="0" />
					<stop offset="100%" stop-color="#fff" stop-opacity="0.75" />
				</radialGradient>

				<mask id="m-core"><rect width="600" height="820" fill="url(#core)" /></mask>
				<mask id="m-mid"><rect width="600" height="820" fill="url(#mid)" /></mask>
				<mask id="m-outer"><rect width="600" height="820" fill="url(#outer)" /></mask>
			</defs>

			<!-- halftone: dot size falls off from the centre, the way a real screen does -->
			<rect width="600" height="820" fill="url(#dot-lg)" mask="url(#m-core)" />
			<rect width="600" height="820" fill="url(#dot-md)" mask="url(#m-mid)" />
			<rect width="600" height="820" fill="url(#dot-sm)" mask="url(#m-outer)" />

			<!-- proximity: "hendingar nær deg" -->
			<g fill="none" stroke="var(--peach)" stroke-width="2">
				<circle cx="312" cy="312" r="72" />
				<circle cx="312" cy="312" r="132" stroke-opacity="0.75" />
				<circle cx="312" cy="312" r="198" stroke-opacity="0.5" />
				<circle cx="312" cy="312" r="272" stroke-opacity="0.28" />
			</g>

			<!-- pin -->
			<path
				d="M312 232c-30 0-54 24-54 54 0 38 54 96 54 96s54-58 54-96c0-30-24-54-54-54z"
				fill="var(--navy-900)"
				stroke="var(--peach)"
				stroke-width="3"
			/>
			<circle cx="312" cy="286" r="17" fill="var(--peach)" />

			<!-- sparkles, straight out of the poster vocabulary -->
			<g fill="var(--peach)">
				<path d="M470 150l7 26 26 7-26 7-7 26-7-26-26-7 26-7z" />
				<path d="M120 640l5 19 19 5-19 5-5 19-5-19-19-5 19-5z" />
			</g>

			<!-- oval, echoing the reference's badge -->
			<ellipse
				cx="312"
				cy="672"
				rx="176"
				ry="58"
				fill="var(--navy-900)"
				stroke="var(--peach)"
				stroke-width="2"
				stroke-opacity="0.6"
			/>
			<text
				x="312"
				y="682"
				text-anchor="middle"
				fill="var(--peach)"
				font-family="Space Mono, monospace"
				font-size="19"
				letter-spacing="5"
			>
				NÆR DEG
			</text>
		</svg>
	</div>
</header>

<!-- ============================ MANIFEST ============================ -->
<section class="manifest invert">
	<ul class="shell manifest__grid">
		<li class="manifest__row">
			<span class="label">01</span>
			<p class="display manifest__line">Gratis for alltid</p>
		</li>
		<li class="manifest__row">
			<span class="label">02</span>
			<p class="display manifest__line manifest__line--slant">Ingen reklame</p>
		</li>
		<li class="manifest__row">
			<span class="label">03</span>
			<p class="display manifest__line">Data blir i Europa</p>
		</li>
	</ul>
</section>

<!-- ============================ KVA / KVA IKKJE ============================ -->
<section class="shell split" aria-labelledby="h-kva">
	<div>
		<p class="label">01 — Kva det gjer</p>
		<h2 id="h-kva" class="display split__h">Samlar<br />alt</h2>
		<ul class="listy">
			<li>Éi søkbar, geotagga liste i staden for tolv silo-ar.</li>
			<li>Kven som helst kan leggje inn ei hending. Ingen konto.</li>
			<li>Kart, så du ser kva som skjer nær deg.</li>
			<li>RSS og iCal per stad — kalenderen din er ein førsteklasses klient.</li>
			<li>Data i EU. GDPR ved arkitektur, ikkje ved personvernerklæring.</li>
		</ul>
	</div>

	<div>
		<p class="label">02 — Kva det ikkje gjer</p>
		<h2 class="display split__h split__h--outline">Nektar<br />resten</h2>
		<dl class="nots">
			{#each doesNot as [term, def] (term)}
				<div class="not">
					<dt>{term}</dt>
					<dd>{def}</dd>
				</div>
			{/each}
		</dl>
		<p class="fineprint">
			Presisjon er ein funksjon. Ei hending skal føre folk saman — ikkje vere ein bomstasjon.
		</p>
	</div>
</section>

<!-- ============================ VERIFISERING ============================ -->
<section class="verify" aria-labelledby="h-verify">
	<div class="shell">
		<p class="label">03 — Verifisering</p>
		<h2 id="h-verify" class="display verify__h">Open innsending,<br />utan søppel</h2>
		<p class="verify__lede">
			Innsende hendingar går gjennom eit agent-steg før dei blir synlege. Er noko usikkert, går det
			til eit menneske. Agenten sorterer, folk avgjer.
		</p>
		<ol class="steps">
			{#each pipeline as [name, what], i (name)}
				<li class="step">
					<span class="step__n">{String(i + 1).padStart(2, '0')}</span>
					<span class="step__name">{name}</span>
					<span class="step__what">{what}</span>
				</li>
			{/each}
		</ol>
		<p class="fineprint">
			Importørar er derimot heilt deterministiske — ingen språkmodell hentar data. Oppdikta
			hendingar er verre enn ingen hendingar.
		</p>
	</div>
</section>

<!-- ============================ KVA SKJER NÅ ============================ -->
<section class="shell now" aria-labelledby="h-now">
	<p class="label">04 — Nett no</p>
	<h2 id="h-now" class="display now__h">Kva skjer?</h2>

	{#if soon.error}
		<p class="now__empty">Kunne ikkje laste hendingar.</p>
	{:else if soon.loading}
		<p class="now__empty">Lastar…</p>
	{:else if soon.current}
		{#if soon.current.length === 0}
			<p class="now__empty">
				Ingen hendingar enno. <a href="https://github.com/Hendingar/hendingar.no/issues"
					>Kjenner du ein kalender vi bør hente frå?</a
				>
			</p>
		{:else}
			<ul class="cards">
				{#each soon.current as event (event.id)}
					<li class="card frame">
						<p class="label">{categoryLabel(event.category)}</p>
						<h3 class="display card__t">{event.title}</h3>
						<p class="card__meta">
							{#if event.venueName}{event.venueName} ·
							{/if}
							<time datetime={event.startsAt.toISOString()}>
								{event.startsAt.toLocaleString('nn-NO', {
									timeZone: 'Europe/Oslo',
									day: '2-digit',
									month: 'short',
									hour: '2-digit',
									minute: '2-digit'
								})}
							</time>
						</p>
					</li>
				{/each}
			</ul>
			<p><a href="/hendingar">Alle hendingar →</a></p>
		{/if}
	{/if}
</section>

<!-- ============================ CTA ============================ -->
<section class="cta invert">
	<div class="shell cta__inner">
		<div>
			<p class="label">Ver med</p>
			<p class="display cta__h">Lokalsamfunn veit best kva som skjer</p>
		</div>
		<div class="cta__actions">
			<a class="btn btn--invert" href="https://github.com/Hendingar/hendingar.no/issues/new/choose"
				>Foreslå ei kjelde</a
			>
			<a class="btn btn--invert-ghost" href="https://github.com/Hendingar/hendingar.no"
				>Kjeldekode</a
			>
		</div>
	</div>
</section>

<footer class="shell foot">
	<hr class="rule" />
	<div class="foot__grid">
		<p><strong>hendingar.no</strong> — <em>hendingar</em> = arrangement på nynorsk 🇳🇴</p>
		<p class="label">AGPL-3.0 · Tidleg utvikling</p>
		<p class="label">Utviklingsinfrastruktur sponsa av Nordlo</p>
	</div>
</footer>

<style>
	/* ---------------- hero ---------------- */
	.hero {
		display: grid;
		grid-template-columns: auto minmax(0, 1fr) minmax(0, 0.85fr);
		gap: var(--gutter);
		align-items: start;
		max-inline-size: 88rem;
		margin-inline: auto;
		padding: clamp(1.5rem, 4vw, 3rem) var(--gutter) clamp(2.5rem, 6vw, 5rem);
	}

	.hero__type {
		container-type: inline-size;
	}

	.hero__rail {
		border-inline-end: var(--rule) solid var(--peach-line);
		padding-inline-end: 0.9rem;
		align-self: stretch;
		display: flex;
		align-items: center;
		justify-content: center;
		min-block-size: 22rem;
	}

	.pips {
		margin-block-start: 1.75rem;
	}
	.phase {
		margin-block: 0.6rem 0;
	}

	.hero__word {
		/* cqw = percentage of .hero__type's inline size. Fits by construction. */
		font-size: clamp(3.5rem, 23.5cqw, 13rem);
		margin-block-start: 0.35em;
	}
	.hero__line {
		display: block;
	}

	.hero__lede {
		font-family: var(--font-display);
		font-weight: 800;
		font-stretch: 110%;
		/* ch units don't constrain an expanded face — size against the column instead. */
		font-size: clamp(1.6rem, 8.2cqw, 3.1rem);
		line-height: 1.02;
		text-transform: uppercase;
		margin-block: 1.1em 0.6em;
	}
	.hero__lede em {
		font-style: italic;
		color: var(--peach-hi);
	}

	.hero__body {
		max-inline-size: 42ch;
		margin: 0;
	}

	.hero__actions {
		display: flex;
		flex-wrap: wrap;
		gap: 0.75rem;
		margin-block-start: 2rem;
	}

	.hero__art {
		border: var(--rule) solid var(--peach-line);
		background: var(--navy-900);
		aspect-ratio: 600 / 820;
		overflow: hidden;
	}
	.hero__art svg {
		display: block;
		inline-size: 100%;
		block-size: 100%;
	}

	/* ---------------- buttons ---------------- */
	.btn {
		display: inline-block;
		font-family: var(--font-mono);
		font-size: var(--step-micro);
		font-weight: 700;
		letter-spacing: 0.22em;
		text-transform: uppercase;
		text-decoration: none;
		padding: 1.05em 1.6em;
		border: var(--rule-fat) solid var(--peach);
		color: var(--peach);
	}
	.btn--solid {
		background: var(--peach);
		color: var(--navy-900);
	}
	.btn--invert {
		background: var(--navy-900);
		color: var(--peach);
		border-color: var(--navy-900);
	}
	.btn--invert-ghost {
		color: var(--navy-900);
		border-color: var(--navy-900);
	}
	.btn:hover {
		background: var(--peach-hi);
		color: var(--navy-900);
		border-color: var(--peach-hi);
	}
	.btn--invert:hover,
	.btn--invert-ghost:hover {
		background: var(--navy-900);
		color: var(--peach-hi);
		border-color: var(--navy-900);
	}

	/* ---------------- manifest band ---------------- */
	.manifest {
		padding-block: clamp(2rem, 5vw, 3.5rem);
		border-block: var(--rule-fat) solid var(--navy-900);
	}
	.manifest__grid {
		display: grid;
		list-style: none;
		padding-inline: var(--gutter);
		margin: 0;
	}
	.manifest__row {
		display: grid;
		grid-template-columns: 2.5rem 1fr;
		gap: 0 1rem;
		align-items: start;
		padding-block: 0.5rem;
	}
	.manifest__row + .manifest__row {
		border-block-start: var(--rule) solid rgb(22 34 59 / 25%);
	}
	.manifest__row .label {
		padding-block-start: 0.85em;
	}
	.manifest__line {
		/* Sized so each statement holds one line at desktop — the ragged two-line wrap made
		   three punchy claims look like one lumpy paragraph. */
		font-size: clamp(1.75rem, 5.4vw, 4.25rem);
		margin: 0;
	}
	/* Alternate the alignment so the band uses its full width instead of leaving
	   half the poster empty. */
	.manifest__row:nth-child(2) {
		grid-template-columns: 1fr 2.5rem;
	}
	.manifest__row:nth-child(2) .label {
		grid-column: 2;
		text-align: end;
	}
	.manifest__row:nth-child(2) .manifest__line {
		grid-column: 1;
		grid-row: 1;
		text-align: end;
	}
	.manifest__line--slant {
		font-style: italic;
	}

	/* ---------------- split ---------------- */
	.split {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(min(100%, 21rem), 1fr));
		gap: var(--section-y) var(--gutter);
		padding-block: var(--section-y);
	}
	.split__h {
		font-size: var(--step-huge);
		margin-block: 0.25em 0.55em;
	}
	.split__h--outline {
		color: transparent;
		-webkit-text-stroke: 2px var(--peach);
	}

	.listy {
		list-style: none;
		padding: 0;
		margin: 0;
	}
	.listy li {
		padding-block: 0.9rem;
		border-block-start: var(--rule) solid var(--peach-line);
	}

	.nots {
		margin: 0;
	}
	.not {
		padding-block: 0.9rem;
		border-block-start: var(--rule) solid var(--peach-line);
	}
	.not dt {
		font-family: var(--font-display);
		font-weight: 900;
		font-stretch: 118%;
		text-transform: uppercase;
		font-size: var(--step-mid);
		line-height: 1;
	}
	.not dd {
		margin: 0.35rem 0 0;
		color: var(--peach-dim);
	}

	.fineprint {
		margin-block-start: 1.5rem;
		font-size: 0.8125rem;
		line-height: 1.7;
		color: var(--peach-dim);
		border-inline-start: var(--rule-fat) solid var(--peach-line);
		padding-inline-start: 1rem;
	}

	/* ---------------- verify ---------------- */
	.verify {
		background: var(--navy-900);
		border-block: var(--rule) solid var(--peach-line);
		padding-block: var(--section-y);
	}
	.verify__h {
		font-size: var(--step-big);
		margin-block: 0.3em 0.8em;
	}
	.verify__lede {
		max-inline-size: 52ch;
		margin: 0 0 2.5rem;
	}
	.steps {
		list-style: none;
		padding: 0;
		margin: 0;
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(min(100%, 17rem), 1fr));
		gap: 0;
	}
	.step {
		display: grid;
		gap: 0.3rem;
		padding: 1.4rem 1.4rem 1.6rem 0;
		border-block-start: var(--rule) solid var(--peach-line);
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
		letter-spacing: 0.01em;
	}
	.step__what {
		color: var(--peach-dim);
		font-size: 0.875rem;
	}

	/* ---------------- now ---------------- */
	.now {
		padding-block: var(--section-y);
	}
	.now__h {
		font-size: var(--step-huge);
		margin-block: 0.25em 1.2em;
	}
	.now__empty {
		font-family: var(--font-display);
		font-weight: 800;
		font-stretch: 108%;
		font-size: var(--step-mid);
		text-transform: uppercase;
		line-height: 1.15;
		max-inline-size: 30ch;
	}
	.cards {
		list-style: none;
		padding: 0;
		margin: 0 0 2rem;
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(min(100%, 15rem), 1fr));
		gap: var(--gutter);
	}
	.card {
		padding: 1.2rem;
		display: grid;
		gap: 0.5rem;
		align-content: start;
	}
	.card__t {
		font-size: var(--step-mid);
		margin: 0;
	}
	.card__meta {
		margin: 0;
		font-size: var(--step-micro);
		letter-spacing: 0.18em;
		text-transform: uppercase;
		color: var(--peach-dim);
	}

	/* ---------------- cta ---------------- */
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
	.cta__h {
		font-size: var(--step-big);
		margin-block-start: 0.3em;
		max-inline-size: 26ch;
	}
	.cta__actions {
		display: flex;
		flex-wrap: wrap;
		gap: 0.75rem;
	}

	/* ---------------- footer ---------------- */
	.foot {
		padding-block: 2.5rem 4rem;
	}
	.foot__grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(min(100%, 16rem), 1fr));
		gap: 1rem var(--gutter);
		margin-block-start: 1.5rem;
	}
	.foot p {
		margin: 0;
	}

	/* ---------------- narrow ---------------- */
	@media (width < 60rem) {
		.hero {
			grid-template-columns: 1fr;
		}
		.hero__rail {
			display: none;
		}
		.hero__art {
			order: -1;
			aspect-ratio: 4 / 3;
		}
	}
</style>
