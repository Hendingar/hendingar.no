<script lang="ts">
	import { page } from '$app/state';
	import { SUBMISSION_TTL_HOURS } from '@hendingar/core/submissions';
	import VerdictPanel from '../../../../lib/components/submit/VerdictPanel.svelte';
	import { existingClientId } from '../../../../lib/client-id.ts';
	import { submissionVerdict, type SubmissionVerdict } from '../../../../lib/submit.remote';

	/**
	 * The answer to one submission, at a URL.
	 *
	 * It used to live only in the form component's state, which meant a reload lost it, the back
	 * button lost it, and there was nothing to keep open in a tab while fixing something. The form
	 * now pushes this URL when a verdict arrives, so the address bar says what is on screen; this
	 * page is what that URL resolves to when somebody actually loads it.
	 *
	 * Rendered in the browser, not on the server, for the same reason /kø is: whether a submission
	 * is yours is a fact your browser holds and the server cannot know before the page loads. There
	 * is nothing here for a crawler, and `noindex` says so.
	 */
	const id = $derived(Number(page.params.id));

	let phase = $state<'loading' | 'ready' | 'notmine' | 'failed'>('loading');
	let verdict = $state<SubmissionVerdict | null>(null);

	$effect(() => {
		const clientId = existingClientId();
		if (!clientId || !Number.isSafeInteger(id) || id <= 0) {
			phase = 'notmine';
			return;
		}
		void submissionVerdict({ id, clientId })
			.then((result) => {
				verdict = result;
				phase = result ? 'ready' : 'notmine';
			})
			.catch(() => (phase = 'failed'));
	});
</script>

<svelte:head>
	<title>Kvittering — hendingar.no</title>
	<!-- Somebody else's submission is not ours to index, and it is not readable to them anyway. -->
	<meta name="robots" content="noindex" />
</svelte:head>

<section class="receipt shell">
	<p class="label">Kvittering</p>

	{#if phase === 'loading'}
		<p class="receipt__note">Hentar…</p>
	{:else if phase === 'failed'}
		<h1 class="display display--md">Klarte ikkje hente kvitteringa</h1>
		<p class="receipt__note">
			Prøv å lasta sida på nytt. Innsendinga di ligg trygt i <a href="/ko">køen din</a>.
		</p>
	{:else if phase === 'notmine' || !verdict}
		<!--
			One message for "no such submission" and for "not this browser's", deliberately.

			Telling them apart would turn the id into a way of asking whether a given submission
			exists, and the id is a bearer token rather than a credential. It is also the honest
			message: from this browser, there is nothing here either way.
		-->
		<h1 class="display display--md">Fann ikkje denne kvitteringa</h1>
		<p class="receipt__note">
			Ho høyrer til ein annan nettlesar, eller innsendinga er borte — ei hending som ikkje blir
			retta innan {SUBMISSION_TTL_HOURS} timar blir sletta. Dine eigne ligg i
			<a href="/ko">køen din</a>.
		</p>
	{:else}
		<h1 class="visually-hidden">Kvittering for {verdict.title}</h1>
		<!--
			No `poster` prop.

			The image the fields were read from lives in the browser that sent it, and it is only
			ever uploaded after a verdict of `approved`. So on this page — which is reached by
			reload or by opening the URL later — an approved submission shows its stored poster and
			an unapproved one shows none, which is exactly what the panel's copy promises.
		-->
		<VerdictPanel
			status={verdict.status}
			outcome={verdict.outcome}
			duplicateOf={verdict.duplicateOf}
			summary={verdict.summary}
			checks={verdict.checks}
			sourceUrl={verdict.sourceUrl}
			poster={verdict.posterUrl}
		/>

		<p class="receipt__actions">
			{#if verdict.outcome === 'approved'}
				<a class="btn btn--solid" href={verdict.path}>Sjå hendinga</a>
			{:else}
				<a class="btn btn--solid" href="/send-inn?rett={verdict.id}">Rett og send inn på nytt</a>
			{/if}
			<a class="btn" href="/ko">Køen din</a>
		</p>
	{/if}
</section>

<style>
	.receipt {
		padding-block: clamp(2rem, 6vw, 4rem);
		display: grid;
		gap: 1rem;
		container-type: inline-size;
	}
	.receipt__note {
		margin: 0;
		max-inline-size: 60ch;
	}
	.receipt__actions {
		margin: 0;
		display: flex;
		flex-wrap: wrap;
		gap: 0.6rem;
	}
</style>
