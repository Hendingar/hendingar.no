<script lang="ts">
	import UpcomingByDay from '../lib/components/landing/UpcomingByDay.svelte';
	import CoverageStatus from '../lib/components/landing/CoverageStatus.svelte';
	import Hero from '../lib/components/landing/Hero.svelte';
	import ManifestBand from '../lib/components/landing/ManifestBand.svelte';
	import ClaimsSplit from '../lib/components/landing/ClaimsSplit.svelte';
	import VerifyPipeline from '../lib/components/landing/VerifyPipeline.svelte';
	import CallToAction from '../lib/components/landing/CallToAction.svelte';
</script>

<svelte:head>
	<title>hendingar.no — kva skjer i Sunnhordland</title>
	<meta
		name="description"
		content="Hendingar frå lokale kalendrar samla i éi liste. Vi seier kvar dei kjem frå og når vi henta dei sist. Gratis, utan reklame."
	/>
</svelte:head>

<!--
	Events, then what the list actually is, then everything about us.

	The page used to run: events, hero, manifest, claims, pipeline, events AGAIN, call to action —
	seven sections, five of them about us, with the event list appearing twice either side of the
	manifesto. On a site whose job is answering "what is on", that ratio was inverted, and the
	second list was the same query with a smaller limit.

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
<ClaimsSplit />
<VerifyPipeline />
<CallToAction />
