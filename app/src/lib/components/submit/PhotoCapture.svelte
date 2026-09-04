<script lang="ts">
	import { extractFromPhoto } from '../../submit.remote';
	import type { ExtractedEvent } from '@hendingar/core/validation';

	let {
		enabled = true,
		onextract
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
	 * What the wait is actually doing, told in order.
	 *
	 * The model gives us one answer at the end and nothing in between — there is no token stream to
	 * follow for a strict-schema extraction — so this narrates the stages we genuinely know the
	 * request passes through rather than inventing sub-progress. It changes because a line of text
	 * that never moves for fifteen seconds is how a page reads as hung.
	 */
	const READING_STEPS: readonly { at: number; text: string }[] = [
		{ at: 0, text: 'Sender biletet til tolkinga…' },
		{ at: 3, text: 'Les tittel og dato…' },
		{ at: 7, text: 'Finn stad og arrangør…' },
		{ at: 12, text: 'Ryddar og set saman forslaget…' },
		{ at: 20, text: 'Tek lengre tid enn vanleg. Vi held på.' }
	];

	const readingStep = $derived(
		[...READING_STEPS].reverse().find((step) => elapsed >= step.at)?.text ?? READING_STEPS[0]!.text
	);

	/**
	 * A bar that approaches the end without reaching it.
	 *
	 * Extraction usually lands between five and fifteen seconds, and we cannot know where in that
	 * range a given request will fall — so the fill follows `1 - 0.5^(t/8)`, which is fast early,
	 * slows as it goes, and never claims to be finished. A bar that sticks at 90% is a lie a reader
	 * learns to distrust; one that keeps creeping is honest about "still working".
	 */
	const progress = $derived(Math.round((1 - Math.pow(0.5, elapsed / 8)) * 100));

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

	/** Longest edge of the image we send. A poster is legible well below phone-camera resolution. */
	const MAX_EDGE = 1600;
	const JPEG_QUALITY = 0.82;

	/**
	 * Downscale in the browser before uploading.
	 *
	 * A modern phone photo is 4–12 MB. Sending that raw would be slow on the rural mobile
	 * connections this is for, and would cost image tokens for detail no one needs to read a
	 * poster. Re-encoding also strips EXIF — including the GPS coordinates of wherever the person
	 * was standing, which we neither need nor want.
	 */
	async function downscale(file: File): Promise<{ base64: string; mediaType: 'image/jpeg' }> {
		const bitmap = await createImageBitmap(file);
		const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
		const canvas = document.createElement('canvas');
		canvas.width = Math.round(bitmap.width * scale);
		canvas.height = Math.round(bitmap.height * scale);
		const ctx = canvas.getContext('2d');
		if (!ctx) throw new Error('kunne ikkje behandle biletet');
		ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
		bitmap.close();

		const dataUrl = canvas.toDataURL('image/jpeg', JPEG_QUALITY);
		return { base64: dataUrl.split(',')[1] ?? '', mediaType: 'image/jpeg' };
	}

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

	async function handle(file: File) {
		if (!file.type.startsWith('image/')) {
			phase = 'error';
			message = 'Det må vere eit bilete. Prøv ein JPEG eller PNG.';
			return;
		}
		phase = 'shrinking';
		message = '';
		startTimer();
		try {
			const { base64, mediaType } = await downscale(file);
			preview = `data:${mediaType};base64,${base64}`;
			phase = 'reading';

			// The photographer's local date, so "laurdag 14." resolves to the right year.
			const today = new Date().toLocaleDateString('sv-SE'); // sv-SE renders as YYYY-MM-DD
			const result = await extractFromPhoto({ imageBase64: base64, mediaType, today });

			if (!result.ok) {
				phase = 'error';
				message = result.error;
				return;
			}
			phase = 'idle';
			onextract(result.draft, preview);
			message = result.draft.note;
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
				skjemaet — det går same vegen, gjennom dei same fem kontrollane.
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
					<p class="prog__text" aria-live="polite">
						{phase === 'reading' ? readingStep : STAGE_TEXT.shrinking}
						<span class="prog__t">{elapsed}s</span>
					</p>
				</div>
			{:else if message}
				<p class="capture__status" aria-live="polite">{message}</p>
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
