<script lang="ts">
	import UpcomingByDay from '../lib/components/landing/UpcomingByDay.svelte';
	import CoverageStatus from '../lib/components/landing/CoverageStatus.svelte';
	import Hero from '../lib/components/landing/Hero.svelte';
	import ManifestBand from '../lib/components/landing/ManifestBand.svelte';
	import VerifyPipeline from '../lib/components/landing/VerifyPipeline.svelte';
	import CallToAction from '../lib/components/landing/CallToAction.svelte';
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
	Events, then what the list actually is, then everything about us.

	The page used to run: events, hero, manifest, claims, pipeline, events AGAIN, call to action —
	seven sections, five of them about us, with the event list appearing twice either side of the
	manifesto. On a site whose job is answering "what is on", that ratio was inverted, and the
	second list was the same query with a smaller limit.

	The claims split ("Samlar alt" / "Og kva vi ikkje er") is gone for the same reason. It restated
	in two columns of prose what the page already demonstrates: every event carries its source, the
	filter is a link, and the manifest band says the three things we promise. Declaring "vi er ein
	indeks, ikkje ein erstatning" underneath a list that links every row to its source is the site
	explaining itself instead of working. The non-goals are still binding — they live in
	README.md#what-it-does-not-do, which is where they are load-bearing.

	`CoverageStatus` sits directly under the list rather than on /datasamling alone, because "is
	this everything?" is the first question the list provokes and the honest answer was two clicks
	away on a page most visitors never open.
-->
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

<Hero />
<ManifestBand />
<VerifyPipeline />
<CallToAction />
