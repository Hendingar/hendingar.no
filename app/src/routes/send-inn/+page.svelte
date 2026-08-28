<script lang="ts">
	import {
		VERIFICATION_CHECKS,
		VERIFICATION_CHECK_LABELS,
		VERIFICATION_CHECK_QUESTIONS
	} from '@hendingar/core/verification';
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
		content="Legg til ei hending på hendingar.no. Ta bilete av ein plakat, eller fyll ut skjemaet. Alle innsendingar går gjennom fem opne kontrollar."
	/>
</svelte:head>

<section class="hero shell">
	<p class="label">Send inn</p>
	<h1 class="display hero__h">
		<span class="hero__line">Veit du om</span>
		<span class="hero__line hero__line--slant">noko som skjer?</span>
	</h1>
	<p class="hero__lede">
		Ta eit bilete av plakaten, eller skriv det inn sjølv. Du treng ingen konto. Vi lenkjer alltid
		tilbake til kjelda — vi tek ikkje over hendinga di.
	</p>
</section>

<div class="rule shell"></div>

<section class="submit shell">
	<SubmitForm photoEnabled={capabilities.photo} />
</section>

<section class="how shell" aria-labelledby="how-h">
	<p class="label">Kva skjer så</p>
	<h2 class="display display--md" id="how-h">Fem kontrollar, og eit menneske når det trengst</h2>
	<p class="how__lede">
		Ingen betaler for å bli synleg her, så alt vi kan gjere er å kontrollere. Tre av kontrollane er
		reglar — kode med same svar kvar gong. To krev skjøn, og der spør vi ein språkmodell. Modellen
		får aldri siste ordet: er noko usikkert, hamnar hendinga i kø til ein person, ikkje i søpla. Du
		får sjå kvart svar og grunngjevinga med ein gong du har sendt inn.
	</p>
	<ol class="how__list">
		{#each VERIFICATION_CHECKS as check, index (check)}
			<li class="how__item">
				<span class="how__num display" aria-hidden="true">{String(index + 1).padStart(2, '0')}</span
				>
				<div>
					<h3 class="how__name">{VERIFICATION_CHECK_LABELS[check]}</h3>
					<p class="how__q">{VERIFICATION_CHECK_QUESTIONS[check]}</p>
				</div>
			</li>
		{/each}
	</ol>
	<p class="fineprint">
		Biletet av plakaten blir aldri lagra. Det blir krympa i nettlesaren din, lese éin gong, og
		kasta. Det vi tek vare på, er teksten du godkjenner.
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
		padding-block: clamp(2rem, 5vw, 3.5rem) var(--section-y);
		display: grid;
		gap: 0.75rem;
		border-block-start: var(--rule) solid var(--peach-line);
	}
	.how__lede {
		margin: 0 0 0.75rem;
		max-inline-size: 64ch;
	}
	.how__list {
		list-style: none;
		margin: 0 0 0.75rem;
		padding: 0;
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(min(100%, 17rem), 1fr));
		gap: 1.25rem 2rem;
	}
	.how__item {
		display: flex;
		gap: 0.9rem;
		align-items: baseline;
	}
	.how__num {
		font-size: 1.6rem;
		color: var(--peach-quiet);
		flex: none;
	}
	.how__name {
		margin: 0;
		font-family: var(--font-mono);
		font-size: 0.875rem;
		font-weight: 700;
		letter-spacing: 0.14em;
		text-transform: uppercase;
	}
	.how__q {
		margin: 0.25rem 0 0;
		color: var(--peach-dim);
		max-inline-size: 40ch;
	}
</style>
