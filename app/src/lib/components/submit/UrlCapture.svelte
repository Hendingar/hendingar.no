<script module lang="ts">
	import type { ExtractedEvent as Extracted } from '@hendingar/core/validation';

	/** Nothing read, so nothing claimed. Only the link travels to the form. */
	function emptyDraft(): Extracted {
		return {
			title: null,
			description: null,
			category: null,
			date: null,
			startTime: null,
			endTime: null,
			recurrence: null,
			venueName: null,
			municipality: null,
			organizerName: null,
			ticketUrl: null,
			confidence: 0,
			unreadable: [],
			dates: [],
			note: ''
		};
	}
</script>

<script lang="ts">
	import type { ExtractedEvent } from '@hendingar/core/validation';
	import { extractFromUrl } from '../../submit.remote';

	let {
		onextract
	}: {
		/**
		 * The draft, plus the URL we actually read.
		 *
		 * Not the URL that was typed: it may have redirected, and the address that answered is the
		 * one worth keeping as the event's source. The parent puts it in the form's source field.
		 */
		onextract: (draft: ExtractedEvent, sourceUrl: string) => void;
	} = $props();

	let url = $state('');
	let phase = $state<'idle' | 'reading' | 'error'>('idle');
	let message = $state('');

	/**
	 * Fill the source field even when the read failed.
	 *
	 * A page with nothing on it is the common case on the open web, and the person still pasted a
	 * real link to a real event. Losing it and making them find it again would be the worst part of
	 * an already-disappointing answer.
	 */
	let keepUrl = $state('');

	async function read(event: SubmitEvent) {
		event.preventDefault();
		const value = url.trim();
		if (value === '' || phase === 'reading') return;

		phase = 'reading';
		message = '';
		keepUrl = '';

		// sv-SE renders as YYYY-MM-DD, which is what the schema wants — and the date has to come
		// from here, because "laurdag 14." on the page resolves against the reader's today.
		const today = new Date().toLocaleDateString('sv-SE');
		const result = await extractFromUrl({ url: value, today }).catch(() => null);

		if (!result) {
			phase = 'error';
			message = 'Klarte ikkje lese sida. Fyll inn skjemaet under.';
			return;
		}
		if (!result.ok) {
			phase = 'error';
			message = result.error;
			keepUrl = result.sourceUrl ?? value;
			return;
		}

		phase = 'idle';
		onextract(result.draft, result.sourceUrl);
	}
</script>

<div class="link frame">
	<div class="link__body">
		<p class="label">Snarveg</p>
		<h2 class="display display--md link__h">Send inn med lenkje</h2>
		<p class="link__lede">
			Har hendinga alt ei side ein annan stad? Lim inn adressa, så les vi ho og gjev deg eit forslag
			til ferdig utfylt skjema, som du sjekkar før noko blir sendt.
		</p>

		<!--
			A real form with a submit button, not an input that reacts as you type.
			
			Every read makes our server fetch the address, so it happens when somebody asks for it
			once — not on the keystroke after pasting half a URL.
		-->
		<form class="link__form" onsubmit={read}>
			<div class="field">
				<label for="crawl-url">Adressa til hendinga</label>
				<input
					id="crawl-url"
					type="url"
					inputmode="url"
					autocomplete="url"
					placeholder="https://…"
					bind:value={url}
					disabled={phase === 'reading'}
				/>
			</div>
			<button
				class="btn btn--solid"
				type="submit"
				disabled={phase === 'reading' || url.trim() === ''}
			>
				{phase === 'reading' ? 'Les sida…' : 'Les sida'}
			</button>
		</form>

		{#if phase === 'reading'}
			<p class="link__status" aria-live="polite">Hentar sida og ser etter tittel, dato og stad…</p>
		{:else if message}
			<p class="link__status link__status--bad" aria-live="polite">
				{message}
				{#if keepUrl}
					<button class="link__keep" type="button" onclick={() => onextract(emptyDraft(), keepUrl)}>
						Ta med lenkja i skjemaet
					</button>
				{/if}
			</p>
		{/if}

		<ul class="link__works">
			<li>Ei hendingsside hos ein arrangør</li>
			<li>Ei side i ein aktivitetskalender</li>
			<li>Ei billettside</li>
		</ul>

		<!--
			Says what actually happens, including the part that is a limitation rather than a
			feature. A page behind a login is the common disappointment here — Facebook above all —
			and being told that up front beats finding out by pasting one.
		-->
		<p class="link__fine">
			Vi hentar sida éin gong og les ut det ho sjølv oppgjev om hendinga. Sider som krev innlogging
			— Facebook mellom anna — kan vi ikkje lese. Ingenting blir sendt før du har sett over
			skjemaet.
		</p>
	</div>
</div>

<style>
	.link {
		padding: clamp(1.25rem, 4vw, 2rem);
	}
	.link__body {
		display: grid;
		gap: 0.75rem;
	}
	.link__h {
		margin: 0;
	}
	.link__lede {
		margin: 0;
		max-inline-size: 52ch;
	}
	.link__form {
		display: grid;
		gap: 0.75rem;
		align-items: end;
		margin-block: 0.5rem;
	}
	@container (min-inline-size: 34rem) {
		.link__form {
			grid-template-columns: 1fr auto;
		}
	}
	/*
	 * On the wrapper, never on `input` itself.
	 *
	 * A component rule on a bare element is (0,1,1) and outranks a shared single-class utility in
	 * brand.css — which is how two visually-hidden radios once got a full-width inline size and
	 * pushed this page past the viewport.
	 */
	.field {
		display: grid;
		gap: 0.3rem;
	}
	.field label {
		font-family: var(--font-mono);
		font-size: var(--step-micro);
		letter-spacing: 0.18em;
		text-transform: uppercase;
		color: var(--peach-dim);
	}
	.field input {
		font: inherit;
		padding: 0.7em 0.8em;
		color: var(--peach);
		background: transparent;
		border: var(--rule) solid var(--peach-line);
		inline-size: 100%;
	}
	.field input:focus-visible {
		outline: 2px solid var(--peach-hi);
		outline-offset: 1px;
	}
	.link__status {
		margin: 0;
		font-family: var(--font-mono);
		font-size: var(--step-micro);
		color: var(--peach-dim);
	}
	.link__status--bad {
		color: var(--peach-hi);
	}
	.link__keep {
		display: block;
		margin-block-start: 0.5rem;
		font: inherit;
		color: var(--peach);
		background: transparent;
		border: 0;
		padding: 0;
		text-decoration: underline;
		cursor: pointer;
	}
	.link__works {
		margin: 0;
		padding-inline-start: 1.1rem;
		color: var(--peach-dim);
		font-size: 0.9375rem;
		display: grid;
		gap: 0.2rem;
	}
	.link__fine {
		margin: 0;
		font-size: 0.8125rem;
		color: var(--peach-dim);
		max-inline-size: 56ch;
	}
</style>
