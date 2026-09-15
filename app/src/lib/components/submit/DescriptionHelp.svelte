<script lang="ts">
	import type { ImproveSuggestion } from '@hendingar/core/validation';
	import { improveText } from '../../submit.remote';

	/**
	 * Two agents' opinion of the description somebody is writing, offered beside the box.
	 *
	 * The service writes a draft and then audits it, and refuses to hand over any sentence making a
	 * claim the submission does not contain (ADR 0017). So the common answer is *no text* plus a
	 * reason — which is why this panel is built around showing `removed` and `missing` as first-class
	 * results rather than as an error state. "We could not do this safely, and here is what you could
	 * add yourself" is a useful answer; a spinner that resolves to nothing is not.
	 *
	 * Nothing is ever written into the form by this component. It reports what came back and calls
	 * `onaccept` if — and only if — the person presses the button that says so. That is the same
	 * review step that makes reading a poster with a model safe, and it is the reason generating
	 * prose about somebody else's event is defensible at all.
	 */
	let {
		values,
		onaccept
	}: {
		/** Read from the live form at the moment the button is pressed, never cached. */
		values: () => {
			title: string;
			description: string;
			category: string;
			date: string;
			startTime: string;
			venueName: string;
			municipality: string;
			organizerName: string;
			sourceUrl: string;
		};
		onaccept: (description: string) => void;
	} = $props();

	let pending = $state(false);
	let failure = $state<string | null>(null);
	let suggestion = $state<ImproveSuggestion | null>(null);
	let accepted = $state(false);

	/**
	 * What the service needs before it can say anything useful.
	 *
	 * The title is what the draft is about, and the date and time are what let the fact-checker
	 * tell a time the sender gave from one a draft invented. Asking before they exist would spend
	 * four model calls to be told the submission is empty.
	 *
	 * The category is here for a less obvious reason: the form's select starts on an empty option,
	 * and the remote command validates it against the taxonomy — so without this the button was
	 * pressable and answered "skrivehjelpa er ikkje tilgjengeleg", which is a lie about a dropdown
	 * nobody had touched. Found by reading what the server logged during the e2e run, not by the
	 * spec, which was perfectly happy with the right message for the wrong reason.
	 */
	const current = $derived(values());
	const ready = $derived(
		Boolean(
			current.title.trim() &&
			current.category &&
			current.date &&
			/^\d{2}:\d{2}$/.test(current.startTime)
		)
	);

	async function ask() {
		pending = true;
		failure = null;
		suggestion = null;
		accepted = false;
		const v = values();
		try {
			const result = await improveText({
				title: v.title.trim(),
				description: v.description || null,
				// The form's own select, so it is always one of the slugs; the command validates it
				// again because a remote function cannot trust its caller.
				category: v.category as never,
				date: v.date,
				startTime: v.startTime,
				venueName: v.venueName || null,
				municipality: v.municipality || null,
				organizerName: v.organizerName || null,
				sourceUrl: v.sourceUrl || null
			});
			if (result.ok) suggestion = result.suggestion;
			else failure = result.error;
		} catch {
			// Never the submission's problem. The box still holds whatever they typed.
			failure = 'Skrivehjelpa er ikkje tilgjengeleg no. Teksten din står som han er.';
		} finally {
			pending = false;
		}
	}

	function accept() {
		if (!suggestion?.description) return;
		onaccept(suggestion.description);
		accepted = true;
	}
</script>

<div class="help">
	<button class="btn btn--sm help__ask" type="button" onclick={ask} disabled={pending || !ready}>
		{pending ? 'Skriv og kontrollerer…' : 'Få hjelp med teksten'}
	</button>
	{#if !ready}
		<p class="help__hint">Fyll inn tittel, kategori, dato og klokkeslett først.</p>
	{/if}

	{#if failure}
		<p class="help__note" role="alert">{failure}</p>
	{/if}

	{#if suggestion}
		<div class="help__out">
			<p class="help__note">{suggestion.note}</p>

			{#if suggestion.description && !accepted}
				<!--
					The draft is shown as text to read, not as a preview of a change already made.
					Nothing moves until the button below is pressed.
				-->
				<blockquote class="help__draft">{suggestion.description}</blockquote>
				<p class="help__actions">
					<button class="btn btn--solid btn--sm" type="button" onclick={accept}>
						Bruk denne teksten
					</button>
					<button class="btn btn--sm" type="button" onclick={() => (suggestion = null)}>
						Nei takk
					</button>
				</p>
			{/if}

			{#if accepted}
				<p class="help__note">Teksten er sett inn. Du kan endre han som du vil før du sender.</p>
			{/if}

			{#if suggestion.removed.length > 0}
				<!--
					What the fact-checker struck, whether or not a draft survived it.

					This is the part that earns the feature its trust: somebody reading a suggestion can
					see that it was checked, and what the check caught.
				-->
				<p class="help__label">Dette tok faktasjekken bort</p>
				<ul class="help__list">
					{#each suggestion.removed as problem (problem)}
						<li>{problem}</li>
					{/each}
				</ul>
			{/if}

			{#if suggestion.missing.length > 0}
				<p class="help__label">Dette kan du leggje til sjølv</p>
				<ul class="help__list">
					{#each suggestion.missing as gap (gap)}
						<li>{gap}</li>
					{/each}
				</ul>
			{/if}
		</div>
	{/if}
</div>

<style>
	.help {
		display: grid;
		gap: 0.4rem;
		justify-items: start;
		margin-block-start: 0.4rem;
	}
	.help__ask {
		/* A form control's own type selector would outrank a shared utility inside this component
		   (see CLAUDE.md), so everything here selects on a class. */
		margin: 0;
	}
	.help__hint,
	.help__note {
		margin: 0;
		font-size: 0.875rem;
		color: var(--peach-dim);
		max-inline-size: 60ch;
	}
	.help__out {
		display: grid;
		gap: 0.5rem;
		justify-items: start;
		padding-inline-start: 1rem;
		border-inline-start: var(--rule-fat) solid var(--peach-line);
	}
	.help__draft {
		margin: 0;
		max-inline-size: 60ch;
		white-space: pre-wrap;
	}
	.help__actions {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
		margin: 0;
	}
	.help__label {
		margin: 0;
		font-family: var(--font-mono);
		font-size: var(--step-micro);
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--peach-dim);
	}
	.help__list {
		margin: 0;
		padding-inline-start: 1.1rem;
		font-size: 0.875rem;
		color: var(--peach-dim);
		max-inline-size: 60ch;
		display: grid;
		gap: 0.2rem;
	}
</style>
