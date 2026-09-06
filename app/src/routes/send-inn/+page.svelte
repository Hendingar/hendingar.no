<script lang="ts">
	import { page } from '$app/state';
	import CheckRail from '../../lib/components/CheckRail.svelte';
	import SubmitForm from '../../lib/components/submit/SubmitForm.svelte';
	import PageMeta from '../../lib/components/PageMeta.svelte';
	import { submissionCapabilities } from '../../lib/submit.remote';

	// Top-level await, not `.loading` — the form and the explanation must exist in the server-
	// rendered HTML, or someone with JavaScript off can neither read nor submit. See CLAUDE.md.
	const capabilities = await submissionCapabilities();

	/** Null unless `?rett=` names a positive integer — anything else is ignored, not an error. */
	const revising = $derived.by(() => {
		const raw = page.url.searchParams.get('rett');
		const id = Number(raw);
		return raw && Number.isSafeInteger(id) && id > 0 ? id : null;
	});
</script>

<PageMeta
	title="Send inn ei hending — hendingar.no"
	description="Legg til ei hending på hendingar.no. Ta bilete av ein plakat eller ei Facebook-hending, eller fyll ut skjemaet. Alle innsendingar går gjennom fem opne kontrollar."
	path="/send-inn"
/>

<section class="hero shell">
	<p class="label">Send inn</p>
	<h1 class="display hero__h">
		<span class="hero__line">Veit du om</span>
		<span class="hero__line hero__line--slant">noko som skjer?</span>
	</h1>
	<!--
		Two sentences, not five.

		The old lede described the photo shortcut, the form, the account-free promise and the
		source link — and then the panels below described the shortcuts again, and the section at
		the bottom described the checks a third time. What the shortcuts do is stated on the
		shortcuts; this only has to say what the page is for.
	-->
	<p class="hero__lede">
		Ta eit bilete av plakaten, så les vi det og fyller ut skjemaet for deg. Du treng ingen konto.
	</p>
</section>

<div class="rule shell"></div>

<section class="submit shell">
	<!--
		`?rett=<id>` opens the form as a revision of a submission that did not pass.

		The id is only a hint about which row to replace; the server checks that the row belongs to
		this browser and is not already published before touching anything.
	-->
	<SubmitForm photoEnabled={capabilities.photo} revisionOf={revising} />
</section>

<!--
	The five checks, named rather than described.

	They used to be a paragraph here that said "fem kontrollar" without saying what any of them
	was — so the one thing that makes an open submission form trustworthy was the least legible
	thing on the page. This is the same rail the landing page renders, from the same source in
	core, so the names cannot drift from the ones the verdict prints back.
-->
<section class="how shell" aria-labelledby="how-h">
	<p class="label">Kva skjer i det du trykkjer send</p>
	<h2 class="display how__h" id="how-h">Fem kontrollar,<br />ingen kø</h2>
	<CheckRail />
	<p class="fineprint how__fine">
		Går alt gjennom, ligg hendinga ute same sekund. Gjer ho ikkje det, får du vite kva som stoppa
		henne og kvifor — og ho ventar på deg i <a href="/ko">køen din</a> til du har retta det. Ingen sit
		og ser på henne: rører du henne ikkje på 48 timar, blir ho sletta.
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
		padding-block: clamp(2rem, 5vw, 3.5rem);
		border-block-start: var(--rule) solid var(--peach-line);
		container-type: inline-size;
	}
	/* cqw, not vw: the rail is the container, and a shared viewport step is what overflowed the
	   hero on desktop and clipped the CTA at 320px. See docs/brand.md. */
	.how__h {
		font-size: clamp(1.75rem, 5.5cqw, 3.75rem);
		margin-block: 0.3em 0.7em;
	}
	.how__fine {
		max-inline-size: 74ch;
		margin-block-start: 2rem;
	}
</style>
