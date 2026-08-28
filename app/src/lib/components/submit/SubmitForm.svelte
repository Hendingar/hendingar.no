<script lang="ts">
	import { CATEGORIES } from '@hendingar/core/taxonomy';
	import type { ExtractedEvent } from '@hendingar/core/validation';
	import { submitEvent } from '../../submit.remote';
	import PhotoCapture from './PhotoCapture.svelte';
	import VerdictPanel from './VerdictPanel.svelte';

	let { photoEnabled }: { photoEnabled: boolean } = $props();

	const f = submitEvent.fields;

	/** Provenance. Set once a photo actually fills the form, so /datasamling can count honestly. */
	let method = $state<'form' | 'photo'>('form');
	/** Fields the model admitted it could not read, so we can point at them instead of hiding it. */
	let unreadable = $state<string[]>([]);

	/**
	 * Which way the person is submitting.
	 *
	 * Backed by a real radio group rather than JavaScript tabs, so the panels switch with CSS
	 * `:checked` and both are present in the server-rendered HTML. With JavaScript off the tabs
	 * still work; with fake tabs the form would simply be unreachable.
	 */
	let mode = $state<'form' | 'photo'>('form');
	let intro: HTMLElement | undefined = $state();

	function prefill(draft: ExtractedEvent) {
		method = 'photo';
		// A read poster is only a suggestion. Show the person the filled-in form immediately so
		// they can correct it — that review step is the whole reason this is safe.
		mode = 'form';
		intro?.focus();
		unreadable = draft.unreadable;
		// Only overwrite with what was actually read. A null from the model is "I could not tell",
		// not "clear the box the person already typed in".
		f.set({
			title: draft.title ?? undefined,
			description: draft.description ?? undefined,
			category: draft.category ?? undefined,
			date: draft.date ?? undefined,
			startTime: draft.startTime ?? undefined,
			endTime: draft.endTime ?? undefined,
			venueName: draft.venueName ?? undefined,
			municipality: draft.municipality ?? undefined,
			organizerName: draft.organizerName ?? undefined,
			ctaUrl: draft.ticketUrl ?? undefined
		});
	}
</script>

{#if submitEvent.result}
	<VerdictPanel
		status={submitEvent.result.status}
		summary={submitEvent.result.summary}
		checks={submitEvent.result.checks}
	/>
{/if}

<!--
	The tabs are unconditional. Hiding the photo entry point when no verifier is configured made
	half the page's purpose invisible with nothing to explain the absence — someone looking for
	"upload a picture" simply could not find it. The panel now says why it is unavailable instead
	of disappearing, which is the difference between a degraded feature and a missing one.
-->
<div class="modes">
	<!-- The radios must be siblings of the panels for the `:checked ~ .panel` rules to reach
	     them, so they sit here rather than inside the bar they visually belong to. -->
	<input
		class="visually-hidden"
		type="radio"
		id="mode-skjema"
		name="submit-mode"
		value="form"
		bind:group={mode}
	/>
	<input
		class="visually-hidden"
		type="radio"
		id="mode-bilete"
		name="submit-mode"
		value="photo"
		bind:group={mode}
	/>

	<div class="modes__bar">
		<label class="mode" for="mode-skjema">Med skjema</label>
		<label class="mode" for="mode-bilete">Med bilete</label>
	</div>

	<div class="panel panel--photo">
		<PhotoCapture enabled={photoEnabled} onextract={prefill} />
	</div>
	<div class="panel panel--form">
		{@render formPanel()}
	</div>
</div>

{#snippet formPanel()}
	<form {...submitEvent} class="form frame">
		<div bind:this={intro} class="form__intro" tabindex="-1">
			<p class="label">{method === 'photo' ? 'Forslag frå biletet' : 'Skjema'}</p>
			<h2 class="display display--md">
				{method === 'photo' ? 'Sjekk at dette stemmer' : 'Skriv det inn'}
			</h2>
			{#if method === 'photo'}
				<p class="form__read">
					Dette er eit forslag, lese ut av biletet. Rett det som er feil og fyll inn resten —
					ingenting blir sendt før du trykkjer send.
				</p>
			{/if}
			{#if unreadable.length > 0}
				<p class="form__unread">Klarte ikkje lese: {unreadable.join(', ')}. Fyll inn sjølv.</p>
			{/if}
		</div>

		<!--
		How the event reached us. Not user-editable, but it must go through the fields API: remote
		forms namespace every input name (`method/<hash>/submitEvent`), so a plain `name="method"`
		is silently dropped on submit. `as('text')` rather than `as('hidden', …)` — the hidden
		accessor crashes Svelte's dev SSR renderer on this version.
	-->
		<input {...f.method.as('text')} type="hidden" value={method} />

		<fieldset class="group">
			<legend class="group__legend">Hendinga</legend>
			<p class="group__hint">Kva er det, og kva slag hending er det?</p>
			<div class="grid">
				<p class="field field--wide">
					<label for="title">Tittel</label>
					<input id="title" {...f.title.as('text')} required maxlength="200" autocomplete="off" />
					{#each f.title.issues() ?? [] as issue (issue.message)}
						<span class="field__error">{issue.message}</span>
					{/each}
				</p>
				<p class="field field--wide">
					<label for="description">Beskriving <span class="field__opt">valfritt</span></label>
					<textarea id="description" {...f.description.as('text')} rows="4" maxlength="5000"
					></textarea>
					{#each f.description.issues() ?? [] as issue (issue.message)}
						<span class="field__error">{issue.message}</span>
					{/each}
				</p>
				<p class="field">
					<label for="category">Kategori</label>
					<select id="category" {...f.category.as('select')} required>
						<option value="">Vel kategori</option>
						{#each CATEGORIES as category (category.slug)}
							<option value={category.slug}>{category.label}</option>
						{/each}
					</select>
					{#each f.category.issues() ?? [] as issue (issue.message)}
						<span class="field__error">{issue.message}</span>
					{/each}
				</p>
			</div>
		</fieldset>

		<fieldset class="group">
			<legend class="group__legend">Når</legend>
			<p class="group__hint">Dato og klokkeslett i lokal tid, slik dei er oppgitte.</p>
			<div class="grid">
				<p class="field">
					<label for="date">Dato</label>
					<input id="date" {...f.date.as('date')} required />
					{#each f.date.issues() ?? [] as issue (issue.message)}
						<span class="field__error">{issue.message}</span>
					{/each}
				</p>
				<p class="field">
					<label for="startTime">Startar</label>
					<input id="startTime" {...f.startTime.as('time')} required />
					{#each f.startTime.issues() ?? [] as issue (issue.message)}
						<span class="field__error">{issue.message}</span>
					{/each}
				</p>
				<p class="field">
					<label for="endTime">Sluttar <span class="field__opt">valfritt</span></label>
					<input id="endTime" {...f.endTime.as('time')} />
					{#each f.endTime.issues() ?? [] as issue (issue.message)}
						<span class="field__error">{issue.message}</span>
					{/each}
				</p>
			</div>
		</fieldset>

		<fieldset class="group">
			<legend class="group__legend">Kvar</legend>
			<p class="group__hint">Staden hendinga går føre seg.</p>
			<div class="grid">
				<p class="field">
					<label for="venueName">Stad</label>
					<input id="venueName" {...f.venueName.as('text')} required maxlength="200" />
					{#each f.venueName.issues() ?? [] as issue (issue.message)}
						<span class="field__error">{issue.message}</span>
					{/each}
				</p>
				<p class="field">
					<label for="municipality">Kommune <span class="field__opt">valfritt</span></label>
					<input id="municipality" {...f.municipality.as('text')} maxlength="100" />
					{#each f.municipality.issues() ?? [] as issue (issue.message)}
						<span class="field__error">{issue.message}</span>
					{/each}
				</p>
			</div>
		</fieldset>

		<fieldset class="group">
			<legend class="group__legend">Kven og kjelde</legend>
			<p class="group__hint">Kven står bak, og kvar kan vi lese meir?</p>
			<div class="grid">
				<p class="field">
					<label for="organizerName">Arrangør <span class="field__opt">valfritt</span></label>
					<input id="organizerName" {...f.organizerName.as('text')} maxlength="200" />
					{#each f.organizerName.issues() ?? [] as issue (issue.message)}
						<span class="field__error">{issue.message}</span>
					{/each}
				</p>
				<p class="field">
					<label for="ctaUrl">Billettar <span class="field__opt">valfritt</span></label>
					<input id="ctaUrl" {...f.ctaUrl.as('url')} />
					{#each f.ctaUrl.issues() ?? [] as issue (issue.message)}
						<span class="field__error">{issue.message}</span>
					{/each}
				</p>
				<p class="field field--wide">
					<label for="sourceUrl">
						Lenkje til kjelde <span class="field__opt">valfritt, men hjelper</span>
					</label>
					<input id="sourceUrl" {...f.sourceUrl.as('url')} />
					<span class="field__hint">
						Ei side som omtalar hendinga. Vi lenkjer alltid tilbake til kjelda, og ei lenkje gjer at
						kontrollen kan stadfeste hendinga i staden for å gjette.
					</span>
					{#each f.sourceUrl.issues() ?? [] as issue (issue.message)}
						<span class="field__error">{issue.message}</span>
					{/each}
				</p>
			</div>
		</fieldset>

		<div class="form__foot">
			<button class="btn btn--solid" type="submit" disabled={submitEvent.pending > 0}>
				{submitEvent.pending > 0 ? 'Kontrollerer…' : 'Send inn hendinga'}
			</button>
			<p class="form__fine fineprint">
				Innsendinga går gjennom fem kontrollar. Er noko usikkert, går ho til eit menneske — ikkje i
				søpla.
			</p>
		</div>
	</form>
{/snippet}

<style>
	.modes {
		display: grid;
	}
	.modes__bar {
		display: flex;
		flex-wrap: wrap;
		gap: 0;
		margin-block-end: -1px; /* the active tab's edge meets the panel border */
	}
	.mode {
		font-family: var(--font-mono);
		font-size: var(--step-micro);
		font-weight: 700;
		letter-spacing: 0.18em;
		text-transform: uppercase;
		padding: 1em 1.5em;
		cursor: pointer;
		color: var(--peach-dim);
		border: var(--rule) solid var(--peach-line);
		border-block-end-color: transparent;
	}
	.mode + .mode {
		border-inline-start: 0;
	}
	.mode:hover {
		color: var(--peach-hi);
	}

	/*
	 * CSS drives the switch, not JavaScript: both panels are in the server-rendered HTML and the
	 * radios carry the state, so the tabs work with scripting off. The `bind:group` in the script
	 * exists only so a finished extraction can flip to the form.
	 */
	#mode-skjema:checked ~ .modes__bar .mode[for='mode-skjema'],
	#mode-bilete:checked ~ .modes__bar .mode[for='mode-bilete'] {
		color: var(--navy-900);
		background: var(--peach);
		border-color: var(--peach);
	}
	#mode-skjema:focus-visible ~ .modes__bar .mode[for='mode-skjema'],
	#mode-bilete:focus-visible ~ .modes__bar .mode[for='mode-bilete'] {
		outline: 2px solid var(--peach-hi);
		outline-offset: 2px;
	}
	#mode-skjema:checked ~ .panel--photo,
	#mode-bilete:checked ~ .panel--form {
		display: none;
	}
	.form {
		display: grid;
	}
	.form__intro:focus {
		outline: none; /* focused programmatically after an extraction, not by the user */
	}
	.form__intro {
		padding: clamp(1rem, 3vw, 1.75rem);
		display: grid;
		gap: 0.5rem;
		border-block-end: var(--rule) solid var(--peach-line);
	}
	.form__read,
	.form__unread {
		margin: 0;
		max-inline-size: 60ch;
	}
	.form__unread {
		font-family: var(--font-mono);
		font-size: 0.875rem;
		color: var(--peach-hi);
	}
	.group {
		border: 0;
		border-block-end: var(--rule) solid var(--peach-line);
		margin: 0;
		padding: clamp(1rem, 3vw, 1.75rem);
		min-inline-size: 0;
	}
	/* The footer already draws a rule; a second one here reads as a 2px seam. */
	.group:last-of-type {
		border-block-end: 0;
	}
	.group__legend {
		font-family: var(--font-mono);
		font-size: var(--step-micro);
		font-weight: 700;
		letter-spacing: 0.22em;
		text-transform: uppercase;
		padding: 0;
	}
	.group__hint {
		margin: 0.15rem 0 0.9rem;
		font-size: 0.8125rem;
		color: var(--peach-dim);
		max-inline-size: 60ch;
	}
	.grid {
		display: grid;
		/* auto-fit, not span-2 tricks: a single-column grid with `grid-column: span 2` invents a
		   second implicit column and doubles the page width at 320px. */
		grid-template-columns: repeat(auto-fit, minmax(min(100%, 15rem), 1fr));
		gap: 1.1rem 1.5rem;
	}
	.field {
		display: grid;
		gap: 0.35rem;
		margin: 0;
		min-inline-size: 0;
	}
	.field--wide {
		grid-column: 1 / -1;
	}
	label {
		font-family: var(--font-mono);
		font-size: var(--step-micro);
		letter-spacing: 0.16em;
		text-transform: uppercase;
		color: var(--peach-dim);
	}
	.field__opt {
		text-transform: none;
		letter-spacing: 0.04em;
		opacity: 0.75;
	}
	.field__hint {
		font-size: 0.8125rem;
		color: var(--peach-dim);
		max-inline-size: 60ch;
	}
	.field__error {
		font-family: var(--font-mono);
		font-size: 0.8125rem;
		color: var(--peach-hi);
	}
	/*
	 * Scoped to .field, not bare `input`/`select`/`textarea`.
	 *
	 * Svelte scoping rewrites a bare element selector to `input.svelte-hash`, which is
	 * specificity (0,1,1) — higher than the shared `.visually-hidden` utility at (0,1,0). So a
	 * component rule on an element type silently overrides brand.css. Here that gave the hidden
	 * mode radios `inline-size: 100%`, and two absolutely-positioned 320px-wide inputs pushed the
	 * page 25px past the viewport at 320px. Selecting on the wrapper avoids the whole class of bug.
	 */
	.field input,
	.field select,
	.field textarea {
		inline-size: 100%;
		min-inline-size: 0;
		font: inherit;
		font-size: 1rem; /* below 16px, iOS Safari zooms the page on focus */
		color: var(--peach-hi);
		background: var(--navy-900);
		border: var(--rule) solid var(--peach-line);
		padding: 0.7em 0.8em;
	}
	.field textarea {
		resize: vertical;
	}
	.field input:focus-visible,
	.field select:focus-visible,
	.field textarea:focus-visible {
		outline: 2px solid var(--peach);
		outline-offset: 2px;
	}
	.field input[aria-invalid='true'],
	.field select[aria-invalid='true'],
	.field textarea[aria-invalid='true'] {
		border-color: var(--peach);
		border-inline-start-width: var(--rule-fat);
	}
	.form__foot {
		padding: clamp(1rem, 3vw, 1.75rem);
		border-block-start: var(--rule) solid var(--peach-line);
		display: grid;
		gap: 0.75rem;
		justify-items: start;
	}
	.form__fine {
		margin: 0;
		max-inline-size: 58ch;
	}
</style>
