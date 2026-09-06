<script lang="ts">
	import Ask from '../lib/components/landing/Ask.svelte';
	import CategoryLinks from '../lib/components/landing/CategoryLinks.svelte';
	import UpcomingByDay from '../lib/components/landing/UpcomingByDay.svelte';
	import CoverageStatus from '../lib/components/landing/CoverageStatus.svelte';
	import JoinStrip from '../lib/components/landing/JoinStrip.svelte';
	import PageMeta from '../lib/components/PageMeta.svelte';
	import { page } from '$app/state';
	import { originFor } from '../lib/origin.ts';
	import { jsonLdScript, siteJsonLd } from '../lib/jsonld.ts';
</script>

<svelte:head>
	<!--
		Who we are and what this site is, said once, on the page a crawler reaches first. Everywhere
		else would be a second copy to keep in step.
	-->
	<!-- eslint-disable-next-line svelte/no-at-html-tags -- JSON.stringify output, escaped in jsonLdScript -->
	{@html `<script type="application/ld+json">${jsonLdScript(siteJsonLd(originFor(page.url)))}</${'script'}>`}
</svelte:head>

<PageMeta
	title="hendingar.no — kva skjer i Sunnhordland"
	description="Hendingar frå lokale kalendrar samla i éi liste. Vi seier kvar dei kjem frå og når vi henta dei sist. Gratis, utan reklame."
	path="/"
/>

<!--
	The question, the ways in, the events. Nothing else.

	The page used to run: events, coverage, hero, manifest, verification pipeline, call to action.
	Four of those six sections were about us — a full-screen wordmark the masthead already carries,
	three promises in display type, the five submission checks described to people who had not
	submitted anything, and two links to GitHub. A visitor arrived asking what was on this evening
	and got five screens about the project on the way past.

	What replaced them answers the same questions with things a reader can act on. `Ask` states the
	three facts that decide whether this list is worth trusting — how many events, how many sources,
	how recently collected — read from the data rather than written as copy, so they cannot drift
	the way "vi samlar alt" can. `WaysIn` inside it is the primary control, and every one of its
	four is a real link to a page that already exists rather than a filter holding client state:
	`/kalender/<dato>` twice, `/neste-helg`, `/hendingar`. #81 recorded exactly why when it built
	the weekend as a route — a filter has to be a URL to be shareable, and a URL that answers a
	different question every Monday is a page, not a filter.

	The promises are not gone, they are in the footer, on every page instead of one. The five checks
	are on `/send-inn`, stated before you submit, which is where they change what somebody does.

	`CoverageStatus` still sits directly under the list: "is this everything?" is the first question
	the list provokes, and the honest answer was two clicks away on a page most visitors never open.
-->
<svelte:boundary>
	<Ask />
	{#snippet failed()}
		<!-- The counts are context for the list below, not the content. A heading with no numbers is
		     better than an error where a fact should be — and the events still render. -->
		<header class="shell ask-fallback">
			<p class="label">Sunnhordland</p>
			<h1 class="display">Kva skjer</h1>
		</header>
	{/snippet}
</svelte:boundary>

<svelte:boundary>
	<CategoryLinks />
	{#snippet failed()}
		<!-- A navigation row that cannot load is simply absent. Every category is still reachable
		     from /hendingar, which is one of the four ways in above. -->
	{/snippet}
</svelte:boundary>

<svelte:boundary>
	<UpcomingByDay />
	{#snippet failed()}
		<section class="shell">
			<p>Kunne ikkje laste hendingar akkurat no. Prøv igjen om litt.</p>
		</section>
	{/snippet}
</svelte:boundary>

<svelte:boundary>
	<div class="shell"><CoverageStatus /></div>
	{#snippet failed()}
		<!-- The status strip is context for the list above, not the content. If it cannot load,
		     saying nothing is better than an error where a fact should be. -->
	{/snippet}
</svelte:boundary>

<JoinStrip />

<style>
	.ask-fallback {
		padding-block: clamp(1.75rem, 4vw, 2.75rem) clamp(1.5rem, 3vw, 2.25rem);
		container-type: inline-size;
	}
	.ask-fallback .display {
		font-size: clamp(2.25rem, 13cqw, 6rem);
		margin-block-start: 0.22em;
	}
</style>
