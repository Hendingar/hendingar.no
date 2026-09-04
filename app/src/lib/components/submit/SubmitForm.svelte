<script lang="ts">
	import { CATEGORIES } from '@hendingar/core/taxonomy';
	import { DEFAULT_TIME_ZONE, formatEventTime, formatTimeDigits } from '@hendingar/core/datetime';
	import {
		WEEKDAY_NAMES,
		WEEKDAYS,
		describeRecurrence,
		expandRecurrence,
		type Weekday
	} from '@hendingar/core/recurrence';
	import type { ExtractedEvent } from '@hendingar/core/validation';
	import { findDuplicate, submitEvent } from '../../submit.remote';
	import { ensureClientId, existingClientId } from '../../client-id.ts';
	import { SvelteSet } from 'svelte/reactivity';
	import { photoFilledFields } from '../../provenance.ts';
	import PhotoCapture from './PhotoCapture.svelte';
	import VerdictPanel from './VerdictPanel.svelte';

	let {
		photoEnabled,
		revisionOf = null
	}: {
		photoEnabled: boolean;
		/** Set when this form is revising a submission that did not pass its checks. */
		revisionOf?: number | null;
	} = $props();

	/*
	 * Who is sending this, so they can find it again in /kø and revise it until it passes.
	 *
	 * Starts as whatever this browser already has, and is only *minted* once somebody actually
	 * types into the form. Merely opening /send-inn should not write an identifier for a person who
	 * then changes their mind — the first keystroke is the point at which they have asked to be
	 * remembered, and it is comfortably before they can submit.
	 *
	 * Empty during SSR, since there is no localStorage there. A submission without an id still goes
	 * through; it simply cannot be revised later.
	 */
	let submitterId = $state(existingClientId() ?? '');

	function claimIdentity() {
		if (!submitterId) submitterId = ensureClientId();
	}

	const f = submitEvent.fields;

	/** Provenance. Set once a photo actually fills the form, so /datasamling can count honestly. */
	let method = $state<'form' | 'photo'>('form');
	/** Fields the model admitted it could not read, so we can point at them instead of hiding it. */
	let unreadable = $state<string[]>([]);

	/**
	 * The poster the fields were read from, kept for the whole submission.
	 *
	 * Extraction switches to the form panel, which hides the panel the image was pasted into — so
	 * it used to vanish at the moment it became useful. Held here it stays beside the fields it
	 * produced, and is still on screen with the verdict afterwards.
	 */
	let poster = $state<string | null>(null);

	/**
	 * Which fields the image filled in.
	 *
	 * The form already said what it could NOT read; it never said what it DID. Without that, a
	 * reader cannot tell a value the model lifted off a poster from one they typed themselves,
	 * which is the difference between checking and re-entering.
	 *
	 * A field leaves the set the moment it is edited: once a person has corrected it, it is theirs
	 * and claiming otherwise would be worse than saying nothing.
	 */
	const fromPhoto = new SvelteSet<string>();

	/**
	 * A SvelteSet rather than `$state(new Set())`.
	 *
	 * This is real reactive state — ten badges read it and every keystroke can change it — so the
	 * reactive collection is the right tool, and it also lets the set be mutated in place instead
	 * of rebuilt on every edit. (The one place a plain built-in was correct was `filterHref`'s
	 * throwaway URLSearchParams, which nothing renders from.)
	 */
	function ownField(name: string) {
		fromPhoto.delete(name);
	}

	/**
	 * Which way the person is submitting.
	 *
	 * Backed by a real radio group rather than JavaScript tabs, so the panels switch with CSS
	 * `:checked` and both are present in the server-rendered HTML. With JavaScript off the tabs
	 * still work; with fake tabs the form would simply be unreachable.
	 */
	let mode = $state<'form' | 'photo'>('form');
	let intro: HTMLElement | undefined = $state();

	/**
	 * Keep the time fields in 24-hour form.
	 *
	 * A text input rather than `type="time"`: the native control renders in the *browser's* locale,
	 * so an English-locale browser showed "04:30 PM" on a Nynorsk form and nothing in HTML or CSS
	 * can override it. Formatting on input means a numeric keypad is enough — typing 1930 or 930
	 * both land correctly, so we lose the native clock picker but never the 24-hour clock.
	 */
	function onTimeInput(field: typeof f.startTime, value: string) {
		field.set(formatTimeDigits(value));
	}

	/**
	 * A likely duplicate, found before the form is filled in.
	 *
	 * Asked as soon as an extraction gives us a title and a time, which is before the person has
	 * typed anything. Finding out at the end — having written a description, a venue and an
	 * organiser — is the worst possible moment to learn the work was unnecessary.
	 *
	 * Advisory, never a block. They may well be looking at a different evening of the same show,
	 * and the server decides again from the values actually submitted.
	 */
	let likelyDuplicate = $state<Awaited<ReturnType<typeof findDuplicate>> | null>(null);
	let duplicateDismissed = $state(false);

	async function probeForDuplicate(
		date: string,
		startTime: string,
		venueName: string,
		title: string
	) {
		likelyDuplicate = null;
		duplicateDismissed = false;
		if (!date || !startTime || !title) return;
		try {
			likelyDuplicate = await findDuplicate({
				title,
				date,
				startTime,
				timeZone: DEFAULT_TIME_ZONE,
				venueName: venueName || null
			});
		} catch {
			// A failed probe is a missing courtesy, not a failed submission. The server checks again.
		}
	}

	function prefill(draft: ExtractedEvent, imageDataUrl: string | null = null) {
		poster = imageDataUrl;
		/*
		 * A non-null field is one the model read. `unreadable` is the model's own admission and is
		 * kept separate: "could not read" and "did not appear on the poster" look the same in the
		 * data but are different things to tell someone.
		 */
		fromPhoto.clear();
		for (const field of photoFilledFields(draft)) fromPhoto.add(field);
		method = 'photo';
		// A read poster is only a suggestion. Show the person the filled-in form immediately so
		// they can correct it — that review step is the whole reason this is safe.
		mode = 'form';
		intro?.focus();
		unreadable = draft.unreadable;

		/*
		 * A recurring poster states a rule and no date, so `date` came back empty on a required
		 * field: the poster read perfectly and the form was still a dead end. Fill the rule in and
		 * compute the first matching date from today, so there is something to submit. The
		 * expansion is pure, so it runs here in the browser.
		 */
		let firstDate = draft.date ?? undefined;
		if (draft.recurrence) {
			const today = new Date().toLocaleDateString('sv-SE'); // sv-SE renders as YYYY-MM-DD
			const [next] = expandRecurrence({
				recurrence: draft.recurrence,
				anchorDate: draft.date ?? today,
				startTime: draft.startTime ?? '12:00',
				from: today,
				to: `${Number(today.slice(0, 4)) + 1}${today.slice(4)}`,
				limit: 1
			});
			firstDate ??= next?.localDate;
		}
		// Only overwrite with what was actually read. A null from the model is "I could not tell",
		// not "clear the box the person already typed in".
		f.set({
			title: draft.title ?? undefined,
			description: draft.description ?? undefined,
			category: draft.category ?? undefined,
			date: firstDate,
			startTime: draft.startTime ?? undefined,
			endTime: draft.endTime ?? undefined,
			venueName: draft.venueName ?? undefined,
			municipality: draft.municipality ?? undefined,
			organizerName: draft.organizerName ?? undefined,
			ctaUrl: draft.ticketUrl ?? undefined,
			repeats: draft.recurrence?.freq ?? 'nei',
			repeatWeekdays: draft.recurrence?.weekdays.map(String) ?? [],
			// Narrowed to the option values the select offers, so an out-of-range nth from the model
			// is dropped rather than written into a field that cannot hold it.
			repeatNth: NTH_VALUES.find((v) => v === String(draft.recurrence?.nth ?? '')),
			repeatUntil: draft.recurrence?.until ?? undefined
		});

		/*
		 * Ask now, not at the end.
		 *
		 * Deliberately not awaited: the form is already usable and the answer, when it arrives,
		 * appears above it. Blocking the person from typing while we check would trade one wasted
		 * minute for another.
		 */
		void probeForDuplicate(
			firstDate ?? '',
			draft.startTime ?? '',
			draft.venueName ?? '',
			draft.title ?? ''
		);
	}

	/**
	 * And again whenever the fields say something new.
	 *
	 * The probe originally ran only after an extraction, which meant somebody typing the form by
	 * hand — the majority — never got the check at all until they pressed send. It watches the four
	 * fields the comparison actually uses, and debounces, so a title being typed one letter at a
	 * time is one request rather than thirty.
	 */
	let probeTimer: ReturnType<typeof setTimeout> | undefined;
	$effect(() => {
		const title = f.title.value() ?? '';
		const date = f.date.value() ?? '';
		const startTime = f.startTime.value() ?? '';
		const venueName = f.venueName.value() ?? '';

		clearTimeout(probeTimer);
		if (!title || !date || !startTime) {
			likelyDuplicate = null;
			return;
		}
		probeTimer = setTimeout(() => void probeForDuplicate(date, startTime, venueName, title), 500);
		return () => clearTimeout(probeTimer);
	});

	const NTH_VALUES = ['1', '2', '3', '4', '5', '-1'] as const;

	const repeating = $derived(Boolean(f.repeats.value()) && f.repeats.value() !== 'nei');

	/** Live echo of the chosen rule, so nobody has to reason about checkboxes in their head. */
	const repeatSummary = $derived.by(() => {
		const repeats = f.repeats.value();
		if (!repeats || repeats === 'nei') return null;
		const weekdays = (f.repeatWeekdays.value() ?? []).map(Number).filter(Boolean) as Weekday[];
		if (repeats !== 'daily' && weekdays.length === 0) return null;
		const nth = f.repeatNth.value();
		return describeRecurrence({
			freq: repeats as 'daily' | 'weekly' | 'monthly',
			interval: 1,
			weekdays,
			nth: nth ? Number(nth) : null,
			until: (f.repeatUntil.value() as string) || null
		});
	});
</script>

{#if submitEvent.result}
	<VerdictPanel
		status={submitEvent.result.status}
		outcome={submitEvent.result.outcome}
		duplicateOf={submitEvent.result.duplicateOf}
		summary={submitEvent.result.summary}
		checks={submitEvent.result.checks}
		{poster}
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

<!--
	One badge, used by every field that the image filled.

	`aria-hidden` on the mark plus a visually-hidden sentence: a screen reader gets "lese frå
	biletet" once as words, rather than a decorative glyph read out as punctuation on ten fields.
-->
{#snippet readFrom(name: string)}
	{#if fromPhoto.has(name)}
		<span class="field__from">
			<span aria-hidden="true">◧</span>
			<span class="visually-hidden">Lese frå biletet: </span>lese frå biletet
		</span>
	{/if}
{/snippet}

{#snippet formPanel()}
	<!-- `oninput` mints the browser id on the first keystroke — see `claimIdentity`. -->
	<form {...submitEvent} class="form frame" oninput={claimIdentity}>
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

		{#if likelyDuplicate && !duplicateDismissed}
			<!--
				Advisory, and above the fields it would save someone filling in.

				Never a block. Two showings of the same play on consecutive evenings score alike on
				title and venue, and the person in front of us knows which one they went to — so this
				names what we found, links to it, and gets out of the way.
			-->
			<aside class="dupe-warn">
				<p class="label">Finst denne alt?</p>
				<p class="dupe-warn__lede">
					Vi har ei hending som liknar. Er det den same, treng du ikkje sende inn på nytt.
				</p>
				<a class="dupe-warn__link" href={likelyDuplicate.path} target="_blank" rel="noopener">
					{likelyDuplicate.title} →
				</a>
				<p class="dupe-warn__meta">
					{formatEventTime(new Date(likelyDuplicate.startsAt), likelyDuplicate.venueTimeZone) +
						(likelyDuplicate.venueName ? ` · ${likelyDuplicate.venueName}` : '')}
				</p>
				<button
					type="button"
					class="dupe-warn__dismiss"
					onclick={() => (duplicateDismissed = true)}
				>
					Nei, dette er ei anna hending — hald fram
				</button>
			</aside>
		{/if}

		{#if poster}
			<!--
				The poster, beside the fields it produced.

				It used to live in the photo panel, which extraction switches away from — so the
				image someone had just pasted disappeared at the moment they needed to check the
				fields against it. Checking a suggestion without being able to see what it was read
				from is not checking.

				`<figure>` with a caption rather than a bare img: the relationship between the
				picture and the marked fields is the information, and a caption is where you say so.
			-->
			<figure class="form__poster">
				<img src={poster} alt="Biletet du sende inn" />
				<figcaption>
					Felta merkte <span aria-hidden="true">◧</span> <em>lese frå biletet</em> er lesne herifrå. Rett
					det som er feil — det du endrar blir ditt.
				</figcaption>
			</figure>
		{/if}

		<!--
		How the event reached us. Not user-editable, but it must go through the fields API: remote
		forms namespace every input name (`method/<hash>/submitEvent`), so a plain `name="method"`
		is silently dropped on submit. `as('text')` rather than `as('hidden', …)` — the hidden
		accessor crashes Svelte's dev SSR renderer on this version.
	-->
		<input {...f.method.as('text')} type="hidden" value={method} />
		<!--
			Who sent this, so they can find it again in /kø and revise it until it passes.

			Minted only when somebody actually submits — a reader who never sends anything in never
			has an identifier written for them. Same opaque browser id the hearts use; it is not an
			account and carries nothing about the person.
		-->
		<input {...f.clientId.as('text')} type="hidden" value={submitterId} />
		<input {...f.revisionOf.as('text')} type="hidden" value={revisionOf ?? ''} />

		<fieldset class="group">
			<legend class="group__legend">Hendinga</legend>
			<p class="group__hint">Kva er det, og kva slag hending er det?</p>
			<div class="grid">
				<p class="field field--wide">
					<label for="title">Tittel</label>
					{@render readFrom('title')}
					<input
						id="title"
						{...f.title.as('text')}
						required
						maxlength="200"
						autocomplete="off"
						oninput={() => ownField('title')}
					/>
					{#each f.title.issues() ?? [] as issue (issue.message)}
						<span class="field__error">{issue.message}</span>
					{/each}
				</p>
				<p class="field field--wide">
					<label for="description">Beskriving <span class="field__opt">valfritt</span></label>
					{@render readFrom('description')}
					<textarea
						id="description"
						{...f.description.as('text')}
						rows="4"
						maxlength="5000"
						oninput={() => ownField('description')}
					></textarea>
					{#each f.description.issues() ?? [] as issue (issue.message)}
						<span class="field__error">{issue.message}</span>
					{/each}
				</p>
				<p class="field">
					<label for="category">Kategori</label>
					{@render readFrom('category')}
					<select
						id="category"
						{...f.category.as('select')}
						required
						oninput={() => ownField('category')}
					>
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
					<label for="date">{repeating ? 'Første dato' : 'Dato'}</label>
					{@render readFrom('date')}
					<input id="date" {...f.date.as('date')} required oninput={() => ownField('date')} />
					{#each f.date.issues() ?? [] as issue (issue.message)}
						<span class="field__error">{issue.message}</span>
					{/each}
				</p>
				<p class="field">
					<label for="startTime">Startar</label>
					{@render readFrom('startTime')}
					<input
						id="startTime"
						{...f.startTime.as('text')}
						required
						inputmode="numeric"
						maxlength="5"
						placeholder="19:30"
						autocomplete="off"
						pattern="([01][0-9]|2[0-3]):[0-5][0-9]"
						title="Klokkeslett på 24-timarsform, til dømes 19:30"
						oninput={(e) => {
							ownField('startTime');
							onTimeInput(f.startTime, e.currentTarget.value);
						}}
					/>
					{#each f.startTime.issues() ?? [] as issue (issue.message)}
						<span class="field__error">{issue.message}</span>
					{/each}
				</p>
				<p class="field">
					<label for="endTime">Sluttar <span class="field__opt">valfritt</span></label>
					{@render readFrom('endTime')}
					<input
						id="endTime"
						{...f.endTime.as('text')}
						inputmode="numeric"
						maxlength="5"
						placeholder="19:30"
						autocomplete="off"
						pattern="([01][0-9]|2[0-3]):[0-5][0-9]"
						title="Klokkeslett på 24-timarsform, til dømes 19:30"
						oninput={(e) => {
							ownField('endTime');
							onTimeInput(f.endTime, e.currentTarget.value);
						}}
					/>
					{#each f.endTime.issues() ?? [] as issue (issue.message)}
						<span class="field__error">{issue.message}</span>
					{/each}
				</p>
			</div>
		</fieldset>

		<fieldset class="group">
			<legend class="group__legend">Gjentaking</legend>
			<p class="group__hint">
				Skjer det fleire gonger? Ein plakat som seier «torsdager» er ei gjentaking, ikkje ein dato.
			</p>
			<div class="grid">
				<p class="field">
					<label for="repeats">Skjer det fleire gonger?</label>
					<select id="repeats" {...f.repeats.as('select')}>
						<option value="nei">Nei, éin gong</option>
						<option value="weekly">Kvar veke</option>
						<option value="monthly">Kvar månad</option>
						<option value="daily">Kvar dag</option>
					</select>
				</p>

				{#if repeating && f.repeats.value() !== 'daily'}
					<fieldset class="days field--wide">
						<legend>Vekedagar</legend>
						<div class="days__row">
							{#each WEEKDAYS as day (day)}
								<label class="day">
									<input {...f.repeatWeekdays.as('checkbox', String(day))} />
									<span>{WEEKDAY_NAMES[day].slice(0, 3)}</span>
								</label>
							{/each}
						</div>
						{#each f.repeatWeekdays.issues() ?? [] as issue (issue.message)}
							<span class="field__error">{issue.message}</span>
						{/each}
					</fieldset>
				{/if}

				{#if f.repeats.value() === 'monthly'}
					<p class="field">
						<label for="repeatNth">Kva veke i månaden</label>
						<select id="repeatNth" {...f.repeatNth.as('select')}>
							<option value="1">Første</option>
							<option value="2">Andre</option>
							<option value="3">Tredje</option>
							<option value="4">Fjerde</option>
							<option value="-1">Siste</option>
						</select>
					</p>
				{/if}

				{#if repeating}
					<p class="field">
						<label for="repeatUntil">Til og med <span class="field__opt">valfritt</span></label>
						<input id="repeatUntil" {...f.repeatUntil.as('date')} />
						<span class="field__hint">
							Står det ingen sluttdato, lagrar vi eit halvår framover.
						</span>
						{#each f.repeatUntil.issues() ?? [] as issue (issue.message)}
							<span class="field__error">{issue.message}</span>
						{/each}
					</p>
				{/if}

				{#if repeatSummary}
					<p class="repeat__echo field--wide">
						Blir lagra som: <strong>{repeatSummary}</strong>
					</p>
				{/if}
			</div>
		</fieldset>

		<fieldset class="group">
			<legend class="group__legend">Kvar</legend>
			<p class="group__hint">Staden hendinga går føre seg.</p>
			<div class="grid">
				<p class="field">
					<label for="venueName">Stad</label>
					{@render readFrom('venueName')}
					<input
						id="venueName"
						{...f.venueName.as('text')}
						required
						maxlength="200"
						oninput={() => ownField('venueName')}
					/>
					{#each f.venueName.issues() ?? [] as issue (issue.message)}
						<span class="field__error">{issue.message}</span>
					{/each}
				</p>
				<p class="field">
					<label for="municipality">Kommune <span class="field__opt">valfritt</span></label>
					{@render readFrom('municipality')}
					<input
						id="municipality"
						{...f.municipality.as('text')}
						maxlength="100"
						oninput={() => ownField('municipality')}
					/>
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
					{@render readFrom('organizerName')}
					<input
						id="organizerName"
						{...f.organizerName.as('text')}
						maxlength="200"
						oninput={() => ownField('organizerName')}
					/>
					{#each f.organizerName.issues() ?? [] as issue (issue.message)}
						<span class="field__error">{issue.message}</span>
					{/each}
				</p>
				<p class="field">
					<label for="ctaUrl">Billettar <span class="field__opt">valfritt</span></label>
					{@render readFrom('ctaUrl')}
					<input id="ctaUrl" {...f.ctaUrl.as('url')} oninput={() => ownField('ctaUrl')} />
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
				Fem kontrollar går med ein gong — ingen kø, ingen som ventar. Går alt gjennom, ligg hendinga
				ute med det same. Gjer ho ikkje det, finn du henne i <a href="/ko">køen din</a> med grunnen, og
				kan rette og sende inn på nytt. Rører du henne ikkje på 48 timar, blir ho sletta.
			</p>
		</div>
	</form>
{/snippet}

<style>
	/*
	 * The poster sits between the intro and the fields, full width of the form.
	 *
	 * Capped in height because a portrait phone photo is otherwise taller than the screen and
	 * pushes every field it is meant to be checked against out of view.
	 */
	/*
	 * Beside the fields once there is room, above them when there is not.
	 *
	 * It sat full-width above the form, which pushed every field a screenful down and meant that
	 * checking the last field against the picture required scrolling the picture off screen —
	 * exactly the comparison the panel exists to make possible.
	 *
	 * The grid trick: the poster is placed in a second column spanning every row, and everything
	 * else is pinned to the first. `grid-row: 1 / -1` is what lets it stay tall enough to be sticky
	 * against the whole form rather than against one field.
	 */
	/* An advisory, not an error: a left rule and dim type, not a red box. */
	.dupe-warn {
		margin: 0 0 1.25rem;
		padding-inline-start: 1rem;
		border-inline-start: var(--rule-fat) solid var(--peach);
		display: grid;
		gap: 0.3rem;
		justify-items: start;
	}
	.dupe-warn__lede {
		margin: 0;
		font-size: 0.9375rem;
	}
	.dupe-warn__link {
		font-family: var(--font-display);
		font-weight: 900;
		font-stretch: 112%;
		text-transform: uppercase;
		font-size: var(--step-mid);
		line-height: 1;
		overflow-wrap: anywhere;
	}
	.dupe-warn__meta {
		margin: 0;
		font-family: var(--font-mono);
		font-size: var(--step-micro);
		color: var(--peach-dim);
	}
	.dupe-warn__dismiss {
		margin-block-start: 0.4rem;
		background: none;
		border: 0;
		padding: 0;
		font-family: var(--font-mono);
		font-size: var(--step-micro);
		color: var(--peach-dim);
		text-decoration: underline;
		text-underline-offset: 0.25em;
		cursor: pointer;
	}
	.dupe-warn__dismiss:hover {
		color: var(--peach-hi);
	}

	.form__poster {
		margin: 0 0 1.25rem;
		border: var(--rule) solid var(--peach-line);
		background: var(--navy-900);
	}

	@container (min-width: 46rem) {
		.form:has(.form__poster) {
			grid-template-columns: minmax(0, 1fr) minmax(0, 17rem);
			column-gap: clamp(1rem, 3vw, 1.75rem);
		}
		.form:has(.form__poster) > :not(.form__poster) {
			grid-column: 1;
		}
		.form__poster {
			grid-column: 2;
			grid-row: 1 / -1;
			margin: 0;
			position: sticky;
			inset-block-start: 1rem;
			align-self: start;
		}
	}
	.form__poster img {
		display: block;
		inline-size: 100%;
		block-size: auto;
		max-block-size: 18rem;
		object-fit: contain;
	}
	.form__poster figcaption {
		padding: 0.6rem 0.75rem;
		border-block-start: var(--rule) solid var(--peach-line);
		font-size: var(--step-micro);
		color: var(--peach-dim);
	}

	/*
	 * The provenance mark.
	 *
	 * Dim and small on purpose: it is context for a value, not a warning about it. A person is
	 * checking a suggestion, and a loud badge on ten fields would read as ten problems.
	 */
	.field__from {
		display: inline-flex;
		align-items: baseline;
		gap: 0.3em;
		margin-inline-start: 0.5em;
		font-family: var(--font-mono);
		font-size: var(--step-micro);
		letter-spacing: 0.06em;
		text-transform: uppercase;
		color: var(--peach-dim);
	}

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
	/*
	 * The query container for both panels.
	 *
	 * On the wrapper, not on `.form` or `.capture` themselves: an element cannot match a container
	 * query against its own size, so a `container-type` declared on the thing being queried does
	 * nothing at all — silently, which is the trap.
	 */
	.panel {
		container-type: inline-size;
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
	.days {
		border: 0;
		margin: 0;
		padding: 0;
		min-inline-size: 0;
	}
	.days legend {
		font-family: var(--font-mono);
		font-size: var(--step-micro);
		letter-spacing: 0.16em;
		text-transform: uppercase;
		color: var(--peach-dim);
		padding: 0;
		margin-block-end: 0.35rem;
	}
	.days__row {
		display: flex;
		flex-wrap: wrap;
		gap: 0.35rem;
	}
	.day {
		position: relative;
		display: inline-flex;
		align-items: center;
		gap: 0.35em;
		font-family: var(--font-mono);
		font-size: var(--step-micro);
		text-transform: uppercase;
		letter-spacing: 0.1em;
		border: var(--rule) solid var(--peach-line);
		padding: 0.5em 0.7em;
		cursor: pointer;
	}
	.day:has(input:checked) {
		background: var(--peach);
		color: var(--navy-900);
		border-color: var(--peach);
	}
	.day:has(input:focus-visible) {
		outline: 2px solid var(--peach);
		outline-offset: 2px;
	}
	.day input {
		/* The label carries the visual state; the box only needs to stay operable and focusable. */
		position: absolute;
		inset: 0;
		opacity: 0;
		margin: 0;
		cursor: pointer;
	}
	.repeat__echo {
		margin: 0;
		font-family: var(--font-mono);
		font-size: 0.8125rem;
		color: var(--peach-hi);
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
