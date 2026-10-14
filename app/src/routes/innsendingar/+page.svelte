<script lang="ts">
	import SubmissionLog from '../../lib/components/collection/SubmissionLog.svelte';
	import CheckLedger from '../../lib/components/collection/CheckLedger.svelte';
	import PageMeta from '../../lib/components/PageMeta.svelte';
	import { listSubmissions } from '../../lib/collection.remote';
	import { CHECK_COUNT_WORD_LEADING } from '../../lib/checks.ts';

	// Top-level await so the log is in the server-rendered HTML (CLAUDE.md).
	const data = await listSubmissions();
</script>

<PageMeta
	title="Innsendingar — hendingar.no"
	description="Hendingar folk har sendt inn, og kva dei automatiske kontrollane avgjorde om kvar av dei."
	path="/innsendingar"
/>

<div class="shell head">
	<p class="label"><a href="/datasamling">← Kjelder</a></p>
	<h1 class="display head__h">Innsendingar</h1>
	<p class="head__lede">
		Alle kan <a href="/send-inn">sende inn ei hending</a>. {CHECK_COUNT_WORD_LEADING} automatiske kontrollar
		les kvar innsending med ein gong og avgjer om ho kan publiserast. Blir ho ikkje publisert, kan avsendaren
		rette og prøve igjen innan 48 timar.
	</p>

	<dl class="stats">
		<div>
			<dt>Sendt inn</dt>
			<dd>{data.submittedCount}</dd>
		</div>
		<div>
			<dt>Ligg ute no</dt>
			<dd>{data.submittedLiveCount}</dd>
		</div>
		<div>
			<dt>Ventar på kontroll</dt>
			<dd>{data.pendingCount}</dd>
		</div>
	</dl>
</div>

<section class="shell block" aria-labelledby="h-submissions">
	<h2 id="h-submissions" class="display block__h">Siste innsendingar</h2>
	<p class="block__lede">
		Det nyaste først. Titlar på det som vart stoppa blir ikkje viste — det er ofte reklame.
	</p>
	<SubmissionLog submissions={data.submissions} />

	{#if data.submittedLiveCount > 0}
		<!--
			Rendered only when the filter has something in it. An unknown or empty `kjelde` is dropped
			rather than refused, so a link to nothing would quietly show the whole listing.
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

<section class="shell block block--last" aria-labelledby="h-checks">
	<h2 id="h-checks" class="display block__h">Kva kontrollane har avgjort</h2>
	<p class="block__lede">
		Alle avgjerdene til no, talde opp per kontroll. Den som sender inn, får lese grunngjevinga for
		si eiga hending.
	</p>
	<CheckLedger checks={data.checks} curator={data.curator} />
</section>

<section class="cta invert" aria-labelledby="h-send">
	<div class="shell cta__inner">
		<h2 id="h-send" class="display cta__h">Veit du om noko som skjer?</h2>
		<div class="cta__actions">
			<a class="btn btn--invert" href="/send-inn">Send inn ei hending</a>
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
		max-inline-size: 58ch;
		margin: 0 0 1.75rem;
	}
	.stats {
		display: flex;
		flex-wrap: wrap;
		gap: 1rem 2.5rem;
		margin: 0;
	}
	.stats div {
		display: grid;
		gap: 0.2rem;
	}
	.stats dt {
		order: 2;
		font-family: var(--font-mono);
		font-size: var(--step-micro);
		letter-spacing: 0.14em;
		text-transform: uppercase;
		color: var(--peach-dim);
	}
	.stats dd {
		margin: 0;
		font-family: var(--font-display);
		font-weight: 900;
		font-size: clamp(1.75rem, 5cqw, 3rem);
		line-height: 1;
		font-variant-numeric: tabular-nums;
	}

	.block {
		padding-block: clamp(2.5rem, 6vw, 4.5rem) 0;
		container-type: inline-size;
	}
	.block--last {
		padding-block-end: var(--section-y);
	}
	.block__h {
		font-size: clamp(1.5rem, 6cqw, 2.5rem);
		margin-block: 0 0.4em;
	}
	.block__lede {
		margin: 0 0 1.5rem;
		max-inline-size: 62ch;
		color: var(--peach-dim);
	}
	.block__more {
		margin: 1.25rem 0 0;
		font-family: var(--font-mono);
		font-size: var(--step-micro);
		letter-spacing: 0.14em;
		text-transform: uppercase;
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
