<script lang="ts">
	import SubmitForm from '../../lib/components/submit/SubmitForm.svelte';
	import { submissionCapabilities } from '../../lib/submit.remote';

	// Top-level await, not `.loading` — the form and the explanation must exist in the server-
	// rendered HTML, or someone with JavaScript off can neither read nor submit. See CLAUDE.md.
	const capabilities = await submissionCapabilities();
</script>

<svelte:head>
	<title>Send inn ei hending — hendingar.no</title>
	<meta
		name="description"
		content="Legg til ei hending på hendingar.no. Ta bilete av ein plakat eller ei Facebook-hending, eller fyll ut skjemaet. Alle innsendingar går gjennom fem opne kontrollar."
	/>
</svelte:head>

<section class="hero shell">
	<p class="label">Send inn</p>
	<h1 class="display hero__h">
		<span class="hero__line">Veit du om</span>
		<span class="hero__line hero__line--slant">noko som skjer?</span>
	</h1>
	<p class="hero__lede">
		Ta eit bilete av plakaten — eller av ei Facebook-hending på skjermen — og få eit ferdig utfylt
		forslag. Eller skriv det inn sjølv. Du treng ingen konto, og vi lenkjer alltid tilbake til
		kjelda.
	</p>
</section>

<div class="rule shell"></div>

<section class="submit shell">
	<SubmitForm photoEnabled={capabilities.photo} />
</section>

<section class="how shell" aria-labelledby="how-h">
	<p class="label">Kva skjer så</p>
	<h2 class="display display--md" id="how-h">Ein agent sjekkar, så går ho ut</h2>
	<p class="how__lede">
		Ser innsendinga greitt ut, blir hendinga publisert med ein gong. Er noko uklart, ser eit
		menneske på henne først. Du får sjå kva som vart avgjort, og kvifor.
	</p>
</section>

<style>
	.hero {
		padding-block: clamp(2.5rem, 7vw, 5rem) clamp(1.5rem, 4vw, 3rem);
		container-type: inline-size;
	}
	.hero__h {
		margin: 0.2em 0 0.4em;
		display: grid;
		font-size: clamp(2.1rem, 13cqw, 6.5rem);
		line-height: 0.92;
	}
	.hero__line--slant {
		color: var(--peach-hi);
	}
	.hero__lede {
		margin: 0;
		font-size: var(--step-mid);
		max-inline-size: 34ch;
		text-wrap: balance;
	}
	.submit {
		padding-block: clamp(2rem, 5vw, 3.5rem);
		display: grid;
		gap: clamp(1rem, 3vw, 1.75rem);
	}
	.how {
		padding-block: clamp(1.75rem, 4vw, 3rem);
		display: grid;
		gap: 0.5rem;
		border-block-start: var(--rule) solid var(--peach-line);
	}
	.how__lede {
		margin: 0;
		max-inline-size: 60ch;
	}
</style>
