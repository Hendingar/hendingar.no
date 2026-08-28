<script lang="ts">
	import TodayGrid from '../lib/components/landing/TodayGrid.svelte';
	import Hero from '../lib/components/landing/Hero.svelte';
	import ManifestBand from '../lib/components/landing/ManifestBand.svelte';
	import ClaimsSplit from '../lib/components/landing/ClaimsSplit.svelte';
	import VerifyPipeline from '../lib/components/landing/VerifyPipeline.svelte';
	import UpcomingPreview from '../lib/components/landing/UpcomingPreview.svelte';
	import CallToAction from '../lib/components/landing/CallToAction.svelte';
</script>

<svelte:head>
	<title>hendingar.no — alt som skjer, der du er</title>
	<meta
		name="description"
		content="Open kjeldekode for lokale hendingar i Europa. Gratis, utan reklame, utan innlåsing."
	/>
</svelte:head>

<!-- What is on today comes first: someone arriving wants the answer, not the manifesto. The
     brand statement follows underneath. -->
<svelte:boundary>
	<TodayGrid />
	{#snippet failed()}
		<section class="shell"><p>Kunne ikkje laste hendingar.</p></section>
	{/snippet}
</svelte:boundary>

<Hero />
<ManifestBand />
<ClaimsSplit />
<VerifyPipeline />
<!-- Boundary with only a `failed` snippet: no `pending`, because a pending snippet would be
     what the server renders. -->
<svelte:boundary>
	<UpcomingPreview />
	{#snippet failed()}
		<section class="shell"><p>Kunne ikkje laste hendingar.</p></section>
	{/snippet}
</svelte:boundary>
<CallToAction />
