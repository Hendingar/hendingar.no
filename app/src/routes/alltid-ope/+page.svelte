<script lang="ts">
	import { page } from '$app/state';
	import { eventPath } from '@hendingar/core/slug';
	import StandingGrid from '../../lib/components/StandingGrid.svelte';
	import PageMeta from '../../lib/components/PageMeta.svelte';
	import { canonicalUrl } from '../../lib/origin.ts';
	import { breadcrumbJsonLd, itemListJsonLd, jsonLdScript } from '../../lib/jsonld.ts';
	import { standingOffers } from '../../lib/events.remote';

	/**
	 * Everything that is open rather than happening.
	 *
	 * These rows have no meaningful start time, so they cannot be sorted into a day without claiming
	 * one — which is precisely what went wrong before this page existed: "Sunnhordland Escape" runs
	 * 2023 to 2027, and the listing filed it under TODAY, above the concerts, every day for five
	 * years.
	 *
	 * Its own page rather than a longer front-page band: this is a different question. "What is on
	 * tonight" is answered by a list ordered by time; "what can I do" is answered by a list of
	 * places, and mixing them makes both worse.
	 *
	 * Top-level await, so it is real HTML for crawlers and for readers without JavaScript.
	 */
	const offers = await standingOffers();

	const jsonLd = $derived([
		itemListJsonLd(
			'Stader som alltid er opne i Sunnhordland',
			offers.map((o) => canonicalUrl(page.url, eventPath(o.id, o.title)))
		),
		breadcrumbJsonLd([
			{ name: 'Framsida', url: canonicalUrl(page.url, '/') },
			{ name: 'Alltid ope', url: canonicalUrl(page.url, '/alltid-ope') }
		])
	]);
</script>

<PageMeta
	title="Alltid ope — hendingar.no"
	description="Museum, galleri, symjehallar og faste aktivitetar i Sunnhordland. Ting du kan gjere når som helst, ikkje bunde til ein bestemt dag."
	path="/alltid-ope"
/>

<svelte:head>
	{#each jsonLd as node, i (i)}
		<!-- eslint-disable-next-line svelte/no-at-html-tags -- JSON.stringify output, escaped in jsonLdScript -->
		{@html `<script type="application/ld+json">${jsonLdScript(node)}</${'script'}>`}
	{/each}
</svelte:head>

<div class="shell open">
	<p class="label">Ikkje bunde til ein dag</p>
	<h1 class="display open__h">Alltid ope</h1>
	<p class="open__lede">
		Museum, galleri, symjehallar og faste aktivitetar. Desse står ikkje i dagslista, fordi dei er
		opne kvar dag og ville fylt henne kvar dag.
	</p>

	{#if offers.length > 0}
		<p class="open__count">
			{offers.length === 1 ? 'Éin stad' : `${offers.length} stader`}
		</p>
		<StandingGrid {offers} />
	{:else}
		<!--
			Empty means we have not collected any yet, not that the region has none.

			Most feeds publish an opening as an ordinary event with a short date range, and only some
			state a season. Saying "ingenting er ope" would be a claim about Sunnhordland where the
			truth is a claim about our data — the same distinction `/neste-helg` draws.
		-->
		<p class="open__empty">Vi har ikkje registrert nokon faste stader enno.</p>
		<p class="open__note">
			Veit du om eit museum, eit galleri eller ein symjehall som burde stå her?
			<a href="/send-inn">Send det inn</a> — eller <a href="/datasamling">sjå kva vi hentar inn</a>.
		</p>
	{/if}
</div>

<style>
	.open {
		padding-block: clamp(2rem, 5vw, 4rem) var(--section-y);
		container-type: inline-size;
	}
	.open__h {
		/* cqw rather than vw, and floored low enough to survive 320px — docs/brand.md. */
		font-size: clamp(1.75rem, 13cqw, 5.5rem);
		margin-block: 0.4rem 0.5rem;
	}
	.open__lede {
		max-inline-size: 56ch;
		color: var(--peach-dim);
		margin: 0 0 1.5rem;
	}
	.open__count {
		font-family: var(--font-mono);
		font-size: var(--step-micro);
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--peach-dim);
		margin-block-end: 1.25rem;
	}
	.open__empty {
		font-family: var(--font-display);
		font-weight: 800;
		font-stretch: 108%;
		font-size: var(--step-mid);
		max-inline-size: 34ch;
	}
	.open__note {
		max-inline-size: 48ch;
		color: var(--peach-dim);
	}
</style>
