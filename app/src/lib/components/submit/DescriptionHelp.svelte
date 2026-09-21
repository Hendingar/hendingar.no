<script lang="ts">
	import type { ImproveDraft, ImproveReview, ImproveSuggestion } from '@hendingar/core/validation';

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
	 *
	 * **The turns are shown as they happen.** Up to four sequential model calls stand between the
	 * button and the usual answer, which is no text — so as one response this was fifteen seconds of
	 * nothing ending in a refusal. Watching the writer draft and the fact-checker strike is the same
	 * refusal with its argument attached, which is what ADR 0017 means by the reasoning being the
	 * product.
	 *
	 * **A turn on screen is a report and never an offer.** The draft in one may be the very draft
	 * the fact-checker goes on to strike, or one the number rule refuses after the checker waved it
	 * through. Nothing in `turns` is ever put behind the accept button; only `suggestion` is, and it
	 * is the one that survived every rule.
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

	type Turn = { kind: 'draft'; draft: ImproveDraft } | { kind: 'review'; review: ImproveReview };

	let pending = $state(false);
	let failure = $state<string | null>(null);
	let suggestion = $state<ImproveSuggestion | null>(null);
	let accepted = $state(false);
	let turns = $state<Turn[]>([]);

	/** One sentence, and always the same one: whatever went wrong, their text is still theirs. */
	const UNAVAILABLE = 'Skrivehjelpa er ikkje tilgjengeleg no. Teksten din står som han er.';

	/**
	 * What the service needs before it can say anything useful.
	 *
	 * The title is what the draft is about, and the date and time are what let the fact-checker
	 * tell a time the sender gave from one a draft invented. Asking before they exist would spend
	 * four model calls to be told the submission is empty.
	 *
	 * The category is here for a less obvious reason: the form's select starts on an empty option,
	 * and the route validates it against the taxonomy — so without this the button was
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
		turns = [];
		const v = values();

		try {
			const response = await fetch('/send-inn/skrivehjelp', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					title: v.title.trim(),
					description: v.description || null,
					// The form's own select, so it is always one of the slugs; the route validates it
					// again because a server cannot trust its caller.
					category: v.category,
					date: v.date,
					startTime: v.startTime,
					venueName: v.venueName || null,
					municipality: v.municipality || null,
					organizerName: v.organizerName || null,
					sourceUrl: v.sourceUrl || null
				})
			});

			if (!response.ok || !response.body) {
				failure = UNAVAILABLE;
				return;
			}

			/*
			 * Parsed by hand rather than with `EventSource`, which only speaks GET — and this has to
			 * be a POST carrying the submission. Events are separated by a blank line, so anything
			 * after the last one is an incomplete frame and stays in the buffer. Same reader as
			 * `AppealPanel.svelte`.
			 */
			const reader = response.body.getReader();
			const decoder = new TextDecoder();
			let buffer = '';

			for (;;) {
				const { value, done } = await reader.read();
				if (done) break;
				buffer += decoder.decode(value, { stream: true });

				let split = buffer.indexOf('\n\n');
				while (split !== -1) {
					handle(buffer.slice(0, split));
					buffer = buffer.slice(split + 2);
					split = buffer.indexOf('\n\n');
				}
			}

			// A stream that ended without deciding is a failure, not an empty answer. Saying nothing
			// here would leave the panel showing two turns and no verdict, which reads as a hang.
			if (!suggestion && !failure) failure = UNAVAILABLE;
		} catch {
			// Never the submission's problem. The box still holds whatever they typed.
			failure = UNAVAILABLE;
		} finally {
			pending = false;
		}
	}

	function handle(frame: string) {
		const name = /^event: (.+)$/m.exec(frame)?.[1];
		const raw = /^data: (.+)$/m.exec(frame)?.[1];
		if (!name || !raw) return;

		const data: unknown = JSON.parse(raw);
		if (name === 'error') failure = UNAVAILABLE;
		else if (name === 'draft') {
			const draft = readDraft(data);
			if (draft) turns = [...turns, { kind: 'draft', draft }];
		} else if (name === 'review') {
			const review = readReview(data);
			if (review) turns = [...turns, { kind: 'review', review }];
		} else if (name === 'suggestion') suggestion = readSuggestion(data);
	}

	/*
	 * Read out of the frame by hand rather than cast into shape.
	 *
	 * The route has already validated every frame against the shared Zod schema, so this is not a
	 * second guard against the service — it is how the values get a type without an `as` (CLAUDE.md
	 * rule 4) and without pulling the schemas, and Zod with them, into the browser bundle for a
	 * panel most visitors never open.
	 */
	function strings(value: unknown): string[] {
		return Array.isArray(value)
			? value.filter((item): item is string => typeof item === 'string')
			: [];
	}

	function readDraft(data: unknown): ImproveDraft | null {
		if (typeof data !== 'object' || data === null) return null;
		if (!('description' in data) || typeof data.description !== 'string') return null;
		return {
			description: data.description,
			missing: 'missing' in data ? strings(data.missing) : []
		};
	}

	function readReview(data: unknown): ImproveReview | null {
		if (typeof data !== 'object' || data === null) return null;
		if (!('approved' in data) || typeof data.approved !== 'boolean') return null;
		return { approved: data.approved, problems: 'problems' in data ? strings(data.problems) : [] };
	}

	function readSuggestion(data: unknown): ImproveSuggestion | null {
		if (typeof data !== 'object' || data === null) return null;
		const description =
			'description' in data && typeof data.description === 'string' ? data.description : null;
		return {
			description,
			removed: 'removed' in data ? strings(data.removed) : [],
			missing: 'missing' in data ? strings(data.missing) : [],
			note: 'note' in data && typeof data.note === 'string' ? data.note : '',
			rounds: 'rounds' in data && typeof data.rounds === 'number' ? data.rounds : 0
		};
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

	{#if turns.length > 0}
		<!--
			The argument, as it happens.

			`aria-live="polite"` rather than `assertive`: a turn landing is worth announcing and is
			never urgent, and this panel sits inside a form somebody may still be typing in. The list
			stays on screen after the verdict, because when the verdict is "no text" — which it
			usually is — this is the entire answer.
		-->
		<ol class="help__turns" aria-live="polite">
			{#each turns as turn, i (i)}
				<li class="turn">
					{#if turn.kind === 'draft'}
						<p class="help__label">Skribenten skreiv</p>
						<blockquote class="turn__draft">{turn.draft.description}</blockquote>
					{:else}
						<p class="help__label">Faktasjekkaren</p>
						{#if turn.review.approved}
							<p class="turn__note">Fann ingen påstandar utan dekning i innsendinga.</p>
						{:else if turn.review.problems.length > 0}
							<ul class="help__list">
								{#each turn.review.problems as problem (problem)}
									<li>{problem}</li>
								{/each}
							</ul>
						{:else}
							<p class="turn__note">Sende utkastet tilbake.</p>
						{/if}
					{/if}
				</li>
			{/each}
		</ol>
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
	/*
	 * The turns, set back from the result below them.
	 *
	 * A numbered list because the order is the argument — draft, objection, draft — and a reader
	 * arriving at "we held this back" needs to be able to see what it was held back from. Its own
	 * marker is suppressed: the labels already name who spoke, and a digit beside "Skribenten skreiv"
	 * counts rounds nobody asked about.
	 */
	.help__turns {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: 0.75rem;
		max-inline-size: 60ch;
	}
	.turn {
		display: grid;
		gap: 0.25rem;
		padding-inline-start: 1rem;
		border-inline-start: var(--rule) solid var(--peach-line);
	}
	.turn__draft {
		margin: 0;
		font-size: 0.9375rem;
		color: var(--peach-dim);
		white-space: pre-wrap;
	}
	.turn__note {
		margin: 0;
		font-size: 0.875rem;
		color: var(--peach-dim);
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
