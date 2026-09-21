<script lang="ts">
	import { CHECK_COUNT_WORD } from '../../checks.ts';
	import { downscaleForUpload, type CapturedImage } from '../../poster.ts';
	import type { ExtractedEvent, ExtractedField } from '@hendingar/core/validation';
	import { CATEGORY_SLUGS } from '@hendingar/core/taxonomy';
	import { RECURRENCE_FREQUENCIES, WEEKDAYS } from '@hendingar/core/recurrence';

	let {
		enabled = true,
		onextract,
		onimage
	}: {
		enabled?: boolean;
		/**
		 * The image is handed up with the draft.
		 *
		 * It used to live only in this component, which sits inside the photo panel — and
		 * extraction switches to the form panel, so the poster someone had just pasted disappeared
		 * exactly when they needed it to check the fields against. The parent keeps it instead.
		 */
		onextract: (draft: ExtractedEvent, imageDataUrl: string | null) => void;
		/**
		 * The picture itself, handed up the moment it exists — before the model has seen it.
		 *
		 * Reading a poster and keeping a poster are two different things, and only one of them can
		 * fail. When the read failed, the person was told to fill in the form and their photograph
		 * was silently dropped on the way: an event whose sender had literally photographed it for
		 * us went out with a generated tile. The parent holds the image from here on, so a read
		 * that goes nowhere costs the draft and not the picture.
		 */
		onimage: (image: CapturedImage) => void;
	} = $props();

	/**
	 * Extraction takes three to fifteen seconds and used to show nothing at all, so the honest
	 * reading of the page was that upload was broken. The stages are real — shrink in the browser,
	 * upload, read — so they are reported rather than faked with a percentage we cannot know.
	 */
	let phase = $state<'idle' | 'shrinking' | 'reading' | 'error'>('idle');
	let elapsed = $state(0);
	let ticker: ReturnType<typeof setInterval> | undefined;

	const STAGE_TEXT: Record<'shrinking' | 'reading', string> = {
		shrinking: 'Krympar biletet i nettlesaren din…',
		reading: 'Les biletet'
	};

	/**
	 * What the model has finished writing, in the order it wrote it.
	 *
	 * This replaced a narration on a timer — "Les tittel og dato…" at three seconds, whether or not
	 * that had happened — and the note beside it saying there was no token stream to follow for a
	 * strict-schema extraction. There is. The answer is emitted in schema order, so the title is
	 * complete and correct while the organiser does not yet exist, and `partial.completed_fields` in
	 * the service reports a value only once it has been closed. Nothing shown here is ever corrected
	 * afterwards.
	 *
	 * **These are for reading and never for filling in.** `onextract` is called once, with the
	 * validated whole, and the person still reviews every field before anything is sent — that
	 * review step is what makes reading somebody's poster with a model defensible. A panel that
	 * populated inputs as the tokens arrived would have taken it away.
	 */
	let fields = $state<ExtractedField[]>([]);

	/** What each field is called where a reader can see it. Not the schema's name for it. */
	const FIELD_LABEL: Record<string, string> = {
		title: 'Tittel',
		description: 'Skildring',
		category: 'Kategori',
		date: 'Dato',
		startTime: 'Frå',
		endTime: 'Til',
		venueName: 'Stad',
		municipality: 'Kommune',
		organizerName: 'Arrangør',
		ticketUrl: 'Billettar'
	};

	/**
	 * How far along, from what has actually arrived.
	 *
	 * The bar used to follow `1 - 0.5^(t/8)` — an elapsed-time curve that slowed as it went and
	 * never reached the end, because we could not know where in a five-to-fifteen-second range a
	 * given read would land. We can now: a poster answers with six or seven of these fields, so
	 * counting them is a measurement rather than a shape. It still never claims to be finished —
	 * the last step is the validated object, which arrives after the last field.
	 */
	const EXPECTED_FIELDS = 7;
	const progress = $derived(Math.min(95, Math.round((fields.length / EXPECTED_FIELDS) * 100)));

	const busy = $derived(phase === 'shrinking' || phase === 'reading');

	function startTimer() {
		elapsed = 0;
		clearInterval(ticker);
		// An elapsed count, because a bar that only animates cannot distinguish slow from stuck.
		ticker = setInterval(() => (elapsed += 1), 1000);
	}

	function stopTimer() {
		clearInterval(ticker);
		ticker = undefined;
	}
	let message = $state('');
	let preview = $state<string | null>(null);
	let dragging = $state(false);
	// $state, not a plain let: the input now lives inside an {#if}, so bind:this reassigns it
	// after mount and a non-reactive binding would leave the button clicking nothing.
	let input = $state<HTMLInputElement | undefined>();
	let panel: HTMLElement | undefined = $state();

	/**
	 * Paste is bound to the window, because a paste has no target unless something is focused —
	 * and nobody focuses a drop zone before hitting ⌘V. The visibility check matters: this
	 * component stays mounted while the form tab is showing (the tabs switch with CSS), so without
	 * it a paste into the description field would kick off an extraction.
	 */
	function handlePaste(event: ClipboardEvent) {
		if (!enabled || !panel?.offsetParent) return;
		const file = Array.from(event.clipboardData?.files ?? []).find((f) =>
			f.type.startsWith('image/')
		);
		if (!file) return;
		event.preventDefault();
		handle(file);
	}

	function handleDrop(event: DragEvent) {
		dragging = false;
		if (!enabled) return;
		const file = Array.from(event.dataTransfer?.files ?? []).find((f) =>
			f.type.startsWith('image/')
		);
		if (file) handle(file);
	}

	/*
	 * Read out of the frame by hand rather than cast into shape.
	 *
	 * The route has already validated every frame against the shared Zod schema, so this is not a
	 * second guard against the service — it is how the values get a type without an `as` (CLAUDE.md
	 * rule 4) and without pulling the schemas, and Zod with them, into the browser bundle.
	 */
	function readField(data: unknown): ExtractedField | null {
		if (typeof data !== 'object' || data === null) return null;
		if (!('name' in data) || typeof data.name !== 'string') return null;
		if (!('value' in data) || typeof data.value !== 'string') return null;
		return { name: data.name, value: data.value };
	}

	/*
	 * The finished draft, read out field by field.
	 *
	 * Long, and deliberately so. The alternative is one `as ExtractedEvent` over data the route has
	 * already validated — which would be true today and is exactly the escape hatch CLAUDE.md rule 4
	 * refuses, because it stops being true the moment either side of the boundary moves. Validating
	 * again with the Zod schema is the other option and would put Zod in the browser bundle for the
	 * first time, on a page most visitors open and most never use this panel on.
	 *
	 * Null for anything missing or of the wrong type, so a malformed frame degrades to a form the
	 * person fills in themselves — which is this whole path's promise anyway.
	 */
	function text(source: object, key: string): string | null {
		return key in source && typeof (source as Record<string, unknown>)[key] === 'string'
			? ((source as Record<string, unknown>)[key] as string)
			: null;
	}

	function readEvent(data: unknown): ExtractedEvent | null {
		if (typeof data !== 'object' || data === null) return null;
		if (!('confidence' in data) || typeof data.confidence !== 'number') return null;

		return {
			title: text(data, 'title'),
			description: text(data, 'description'),
			category: readCategory(data),
			date: text(data, 'date'),
			startTime: text(data, 'startTime'),
			endTime: text(data, 'endTime'),
			recurrence: readRecurrence(data),
			venueName: text(data, 'venueName'),
			municipality: text(data, 'municipality'),
			organizerName: text(data, 'organizerName'),
			ticketUrl: text(data, 'ticketUrl'),
			confidence: data.confidence,
			unreadable: 'unreadable' in data ? strings(data.unreadable) : [],
			dates: 'dates' in data ? strings(data.dates) : [],
			note: text(data, 'note') ?? '',
			thumbnail: readThumbnail(data)
		};
	}

	function strings(value: unknown): string[] {
		return Array.isArray(value)
			? value.filter((item): item is string => typeof item === 'string')
			: [];
	}

	function readCategory(data: object): ExtractedEvent['category'] {
		const slug = text(data, 'category');
		return slug !== null && (CATEGORY_SLUGS as readonly string[]).includes(slug)
			? (slug as ExtractedEvent['category'])
			: null;
	}

	/*
	 * The two nested structures, each read only when it is whole.
	 *
	 * Both drive behaviour rather than display — `recurrence` opens the repeat fields and decides
	 * how many evenings get created, `thumbnail` decides how the card is cropped — so a partly-read
	 * one is worse than none. Either is a perfectly ordinary null: most posters state a single date
	 * and the crop is best-effort by design.
	 */
	function readRecurrence(data: object): ExtractedEvent['recurrence'] {
		const value = 'recurrence' in data ? (data as Record<string, unknown>).recurrence : null;
		if (typeof value !== 'object' || value === null) return null;
		const freq = text(value, 'freq');
		if (freq === null || !(RECURRENCE_FREQUENCIES as readonly string[]).includes(freq)) return null;
		const raw = value as Record<string, unknown>;
		return {
			freq: freq as (typeof RECURRENCE_FREQUENCIES)[number],
			interval: typeof raw.interval === 'number' ? raw.interval : 1,
			// Narrowed against the taxonomy rather than to `number`: the schema's weekdays are 1–7,
			// and a model that answered 0 or 8 would otherwise reach the recurrence expander as a
			// day that does not exist. The type was telling us that (CLAUDE.md rule 4).
			weekdays: Array.isArray(raw.weekdays)
				? raw.weekdays.filter((d): d is (typeof WEEKDAYS)[number] =>
						(WEEKDAYS as readonly number[]).includes(d as number)
					)
				: [],
			nth: typeof raw.nth === 'number' ? raw.nth : null,
			until: text(value, 'until')
		};
	}

	function readThumbnail(data: object): ExtractedEvent['thumbnail'] {
		const value = 'thumbnail' in data ? (data as Record<string, unknown>).thumbnail : null;
		if (typeof value !== 'object' || value === null) return null;
		const raw = value as Record<string, unknown>;
		const box = [raw.x, raw.y, raw.width, raw.height];
		if (!box.every((n): n is number => typeof n === 'number')) return null;
		return { x: box[0]!, y: box[1]!, width: box[2]!, height: box[3]! };
	}

	async function handle(file: File) {
		if (!file.type.startsWith('image/')) {
			phase = 'error';
			message = 'Det må vere eit bilete. Prøv ein JPEG eller PNG.';
			return;
		}
		phase = 'shrinking';
		message = '';
		fields = [];
		startTimer();
		try {
			const image = await downscaleForUpload(file);
			const { base64, mediaType, dataUrl } = image;
			preview = dataUrl;
			/*
			 * Handed up before the model is called, not after it answers.
			 *
			 * Everything below this line can fail — the service, the content filter, an image that
			 * turns out to be a cat — and none of it should cost somebody the picture they chose to
			 * send. From here the form holds it, whether or not a draft ever arrives.
			 */
			onimage(image);
			phase = 'reading';

			// The photographer's local date, so "laurdag 14." resolves to the right year.
			const today = new Date().toLocaleDateString('sv-SE'); // sv-SE renders as YYYY-MM-DD

			const response = await fetch('/send-inn/lesing', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ imageBase64: base64, mediaType, today })
			});

			if (!response.ok || !response.body) {
				phase = 'error';
				message = 'Kunne ikkje lese plakaten. Fyll inn skjemaet under.';
				return;
			}

			/*
			 * Read by hand rather than with `EventSource`, which only speaks GET — and this is a POST
			 * carrying the photograph. Frames are separated by a blank line, so whatever follows the
			 * last one is incomplete and stays in the buffer. Same reader as `AppealPanel.svelte`.
			 */
			const reader = response.body.getReader();
			const decoder = new TextDecoder();
			let buffer = '';
			let draft: ExtractedEvent | null = null;

			for (;;) {
				const { value, done } = await reader.read();
				if (done) break;
				buffer += decoder.decode(value, { stream: true });

				let split = buffer.indexOf('\n\n');
				while (split !== -1) {
					const frame = buffer.slice(0, split);
					buffer = buffer.slice(split + 2);
					const name = /^event: (.+)$/m.exec(frame)?.[1];
					const raw = /^data: (.+)$/m.exec(frame)?.[1];
					if (name && raw) {
						const data: unknown = JSON.parse(raw);
						if (name === 'field') {
							const field = readField(data);
							if (field) fields = [...fields, field];
						} else if (name === 'event') draft = readEvent(data);
						else if (name === 'error') draft = null;
					}
					split = buffer.indexOf('\n\n');
				}
			}

			if (!draft) {
				phase = 'error';
				message = 'Kunne ikkje lese plakaten. Fyll inn skjemaet under.';
				return;
			}

			phase = 'idle';
			onextract(draft, preview);
			message = draft.note;
		} catch (error) {
			phase = 'error';
			message =
				error instanceof Error ? error.message : 'Noko gjekk gale med biletet. Prøv skjemaet.';
		} finally {
			stopTimer();
		}
	}
</script>

<svelte:window onpaste={handlePaste} />

<!-- The drop zone is a div, not an interactive element: the button and the file input are what
     keyboard and screen-reader users operate. Drag-and-drop is an addition for mouse users, never
     the only way in. -->
<div
	bind:this={panel}
	class="capture frame"
	class:capture--dragging={dragging}
	ondragover={(e) => {
		if (!enabled) return;
		e.preventDefault();
		dragging = true;
	}}
	ondragleave={() => (dragging = false)}
	ondrop={(e) => {
		e.preventDefault();
		handleDrop(e);
	}}
	role="presentation"
>
	<div class="capture__body">
		<p class="label">Snarveg</p>
		<h2 class="display display--md capture__h">Send inn med bilete</h2>
		<p class="capture__lede">
			Ta bilete av ein plakat, eller eit skjermbilete av ei Facebook-hending. Vi les det og gjev deg
			eit forslag til ferdig utfylt hending, som du sjekkar før noko blir sendt.
		</p>

		{#if !enabled}
			<!-- Say what is off and what still works. Someone who came here to upload a picture needs
			     to know the form is not a consolation prize but the same submission, through the same
			     checks. Vanishing silently taught them the feature did not exist. -->
			<p class="capture__off">
				Bilettolking er ikkje slått på i dette miljøet, så opplasting er mellombels av. Send inn med
				skjemaet — det går same vegen, gjennom dei same {CHECK_COUNT_WORD} kontrollane.
			</p>
		{:else}
			<!--
				No `capture` attribute, deliberately. `capture="environment"` opens the rear camera
				directly on a phone, which makes it impossible to pick a screenshot already in the
				photo library — and a screenshotted Facebook event is half the point of this panel.
				Without it the native picker offers both the camera and the library.
			-->
			<input
				bind:this={input}
				class="visually-hidden"
				type="file"
				accept="image/*"
				onchange={(e) => {
					const file = e.currentTarget.files?.[0];
					if (file) handle(file);
				}}
			/>

			<button class="btn btn--solid" type="button" onclick={() => input?.click()} disabled={busy}>
				{busy ? 'Arbeider…' : 'Ta bilete eller last opp'}
			</button>

			<p class="capture__drop">Du kan òg dra ei fil hit, eller lime inn eit skjermbilete.</p>

			{#if busy}
				<div class="prog">
					<div
						class="prog__bar"
						role="progressbar"
						aria-label="Les biletet"
						aria-valuemin="0"
						aria-valuemax="100"
						aria-valuenow={phase === 'reading' ? progress : undefined}
						style:--fill="{phase === 'reading' ? progress : 8}%"
					></div>
					<p class="prog__text">
						{phase === 'reading' ? STAGE_TEXT.reading : STAGE_TEXT.shrinking}
						<span class="prog__t">{elapsed}s</span>
					</p>
				</div>
			{:else if message}
				<p class="capture__status" aria-live="polite">{message}</p>
			{/if}

			{#if fields.length > 0}
				<!--
					What the model has actually written, as it writes it.

					Outside the `busy` branch on purpose, so it survives the read it belongs to. A read
					that dies halfway leaves whatever was already finished on screen — "we got this
					far" is worth more to somebody deciding whether to retry or type it in than an
					error alone, and every line of it was complete when it was shown.

					`aria-live="polite"` because a field landing is worth announcing and never urgent,
					and this sits inside a form somebody may be typing in.

					These are shown, never used. `onextract` is called once, with the validated whole,
					and the person reviews every field before anything is sent.
				-->
				<dl class="read" aria-live="polite">
					{#each fields as field (field.name)}
						<div class="read__row">
							<dt>{FIELD_LABEL[field.name] ?? field.name}</dt>
							<dd>{field.value}</dd>
						</div>
					{/each}
				</dl>
			{/if}

			{#if phase === 'error' && preview}
				<!--
					A read that failed is not a picture that failed.

					Before, this said "prøv skjemaet" and the photograph was dropped on the way there,
					so somebody who had gone out and photographed the poster got a generated tile.
					The image is now kept by the form; this says so, next to the error, because that
					is where the person decides what to do next.
				-->
				<p class="capture__kept">
					Biletet er teke vare på. Fyll inn skjemaet sjølv — blir hendinga publisert, brukar vi
					biletet som miniatyrbilete på kortet.
				</p>
			{/if}

			<ul class="capture__works">
				<li>Plakat på ein oppslagstavle</li>
				<li>Skjermbilete av ei Facebook-hending</li>
				<li>Annonse i avisa</li>
			</ul>

			<!--
				This used to promise we never kept the image, and we now keep some. Saying so plainly
				is the whole point: the condition is narrow and the reader can check it against what
				actually happens to their submission.
			-->
			<p class="capture__fine">
				Biletet blir krympa i nettlesaren din før det blir sendt, og posisjonsdata i biletet blir
				fjerna. Vi les det éin gong for å fylle ut skjemaet. Blir hendinga publisert, tek vi vare på
				eit utsnitt som miniatyrbilete på kortet — elles blir biletet ikkje lagra i det heile.
			</p>
		{/if}
	</div>

	{#if preview}
		<!--
			Beside the copy, not beneath it.
			
			The picture used to sit under a screenful of text, which meant that during the ten seconds
			someone is waiting — the one moment the image is the only thing worth looking at — it was
			off screen. Sticky, so it stays put while the panel scrolls.
		-->
		<figure class="capture__side">
			<img class="capture__preview" src={preview} alt="Plakaten du lasta opp" />
			{#if busy}
				<figcaption class="capture__reading">
					<span class="capture__scan" aria-hidden="true"></span>
					Les dette biletet
				</figcaption>
			{/if}
		</figure>
	{/if}
</div>

<style>
	.capture {
		display: grid;
		gap: 0;
		/*
		 * A container for the heading's `cqw` sizing, which asks about THIS element's width.
		 *
		 * The two-column rule below cannot use it — an element never matches a container query
		 * against itself — so that one is answered by the `.panel` wrapper in SubmitForm.
		 */
		container-type: inline-size;
		/* The fast path should look like the fast path. A faint fill is enough to rank it above
		   the form without a second colour entering the palette. */
		background: var(--peach-ghost);
	}

	/*
	 * Two columns once there is room, with the picture on the right.
	 *
	 * A container query rather than a viewport one: this panel sits in a column whose width depends
	 * on the page around it, and `cqw` is already how its heading is sized.
	 */
	@container (min-width: 44rem) {
		.capture:has(.capture__side) {
			grid-template-columns: minmax(0, 1.1fr) minmax(0, 0.9fr);
			align-items: start;
		}
	}

	.capture__side {
		margin: 0;
		padding: clamp(1rem, 3vw, 1.75rem);
		padding-inline-start: 0;
		display: grid;
		gap: 0.5rem;
		/* Stays in view while the copy beside it scrolls — the picture is the thing worth looking
		   at during the wait. */
		position: sticky;
		inset-block-start: 1rem;
	}

	@container (max-width: 44rem) {
		.capture__side {
			padding-inline-start: clamp(1rem, 3vw, 1.75rem);
			position: static;
		}
	}

	.capture__reading {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		font-family: var(--font-mono);
		font-size: var(--step-micro);
		color: var(--peach-dim);
	}

	/*
	 * The fields as they land.
	 *
	 * A definition list because that is what it is: a label and the value read off the poster. It
	 * grows downward while the read runs, which is the whole point — the answer assembling is the
	 * progress indicator, and by the time the request finishes most people have already read it.
	 */
	.read {
		margin: 0.75rem 0 0;
		display: grid;
		gap: 0.3rem;
		max-inline-size: 60ch;
	}
	.read__row {
		display: grid;
		grid-template-columns: 6rem minmax(0, 1fr);
		gap: 0.75rem;
		align-items: baseline;
	}
	.read dt {
		font-family: var(--font-mono);
		font-size: var(--step-micro);
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--peach-dim);
	}
	.read dd {
		margin: 0;
		font-size: 0.9375rem;
		/* A description can be a paragraph; it must not push the panel sideways. */
		overflow-wrap: anywhere;
	}

	/* A small travelling tick, so the caption reads as "in progress" and not as a label. */
	.capture__scan {
		inline-size: 2rem;
		block-size: 2px;
		background: linear-gradient(90deg, transparent, var(--peach), transparent);
		animation: scan 1.6s var(--ease-out) infinite;
	}

	@keyframes scan {
		0%,
		100% {
			transform: translateX(-0.4rem);
			opacity: 0.4;
		}
		50% {
			transform: translateX(0.4rem);
			opacity: 1;
		}
	}
	.capture__body {
		padding: clamp(1rem, 3vw, 1.75rem);
		display: grid;
		gap: 0.6rem;
		justify-items: start;
	}
	.capture__h {
		font-size: clamp(1.3rem, 8cqw, 2.75rem);
		margin: 0;
	}
	.capture__lede {
		margin: 0;
		font-size: var(--step-body);
		max-inline-size: 46ch;
	}
	.capture__status {
		margin: 0.4rem 0 0;
		min-block-size: 1.4em;
		font-size: 0.875rem;
		color: var(--peach-dim);
	}
	/* Beside the error, and brighter than it: this is the good half of the news. */
	.capture__kept {
		margin: 0.35rem 0 0;
		max-inline-size: 52ch;
		font-size: 0.875rem;
		color: var(--peach-hi);
	}
	.prog {
		display: grid;
		gap: 0.4rem;
		inline-size: min(100%, 26rem);
	}
	.prog__bar {
		block-size: 4px;
		background: var(--peach-ghost);
		overflow: hidden;
		position: relative;
	}
	/*
	 * Determinate, and deliberately asymptotic.
	 *
	 * The width follows an elapsed-time curve that slows as it goes and never reaches the end, so
	 * the bar keeps moving for as long as the request does. This replaced a looping indeterminate
	 * sweep, which after ten seconds is indistinguishable from a page that has stopped trying.
	 */
	.prog__bar::after {
		content: '';
		position: absolute;
		inset-block: 0;
		inset-inline-start: 0;
		inline-size: var(--fill, 8%);
		background: var(--peach);
		transition: inline-size 900ms linear;
	}
	.prog__text {
		margin: 0;
		font-family: var(--font-mono);
		font-size: 0.8125rem;
		color: var(--peach-dim);
	}
	.prog__t {
		opacity: 0.7;
	}
	.capture__off {
		margin: 0;
		max-inline-size: 52ch;
		color: var(--peach-hi);
	}
	.capture--dragging {
		border-color: var(--peach);
		background: color-mix(in srgb, var(--peach) 14%, transparent);
	}
	.capture__drop {
		margin: 0;
		font-size: 0.8125rem;
		color: var(--peach-dim);
	}
	.capture__works {
		list-style: none;
		margin: 0.2rem 0 0;
		padding: 0;
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem 0.5rem;
	}
	.capture__works li {
		font-family: var(--font-mono);
		font-size: 0.75rem;
		letter-spacing: 0.06em;
		color: var(--peach-dim);
		border: var(--rule) solid var(--peach-line);
		padding: 0.35em 0.7em;
	}
	.capture__fine {
		margin: 0;
		font-size: 0.8125rem;
		color: var(--peach-dim);
		max-inline-size: 52ch;
	}
	.capture__preview {
		inline-size: 100%;
		block-size: auto;
		max-block-size: 22rem;
		object-fit: contain;
		background: var(--navy-900);
		border-block-start: var(--rule) solid var(--peach-line);
	}
</style>
