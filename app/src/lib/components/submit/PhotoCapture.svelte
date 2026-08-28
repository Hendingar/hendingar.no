<script lang="ts">
	import { extractFromPhoto } from '../../submit.remote';
	import type { ExtractedEvent } from '@hendingar/core/validation';

	let { onextract }: { onextract: (draft: ExtractedEvent) => void } = $props();

	let phase = $state<'idle' | 'reading' | 'error'>('idle');
	let message = $state('');
	let preview = $state<string | null>(null);
	let dragging = $state(false);
	let input: HTMLInputElement;
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
		if (!panel?.offsetParent) return;
		const file = Array.from(event.clipboardData?.files ?? []).find((f) =>
			f.type.startsWith('image/')
		);
		if (!file) return;
		event.preventDefault();
		handle(file);
	}

	function handleDrop(event: DragEvent) {
		dragging = false;
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
		phase = 'reading';
		message = '';
		try {
			const { base64, mediaType } = await downscale(file);
			preview = `data:${mediaType};base64,${base64}`;

			// The photographer's local date, so "laurdag 14." resolves to the right year.
			const today = new Date().toLocaleDateString('sv-SE'); // sv-SE renders as YYYY-MM-DD
			const result = await extractFromPhoto({ imageBase64: base64, mediaType, today });

			if (!result.ok) {
				phase = 'error';
				message = result.error;
				return;
			}
			phase = 'idle';
			onextract(result.draft);
			message = result.draft.note;
		} catch (error) {
			phase = 'error';
			message =
				error instanceof Error ? error.message : 'Noko gjekk gale med biletet. Prøv skjemaet.';
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

		<button
			class="btn btn--solid"
			type="button"
			onclick={() => input.click()}
			disabled={phase === 'reading'}
		>
			{phase === 'reading' ? 'Les biletet…' : 'Ta bilete eller last opp'}
		</button>

		<p class="capture__drop">Du kan òg dra ei fil hit, eller lime inn eit skjermbilete.</p>

		<p class="capture__status" aria-live="polite">
			{#if phase === 'reading'}
				Les biletet. Dette tek nokre sekund.
			{:else if message}
				{message}
			{/if}
		</p>

		<ul class="capture__works">
			<li>Plakat på ein oppslagstavle</li>
			<li>Skjermbilete av ei Facebook-hending</li>
			<li>Annonse i avisa</li>
		</ul>

		<p class="capture__fine">
			Biletet blir krympa i nettlesaren din før det blir sendt, og posisjonsdata i biletet blir
			fjerna. Vi lagrar ikkje biletet — det blir lese éin gong og kasta.
		</p>
	</div>

	{#if preview}
		<img class="capture__preview" src={preview} alt="Plakaten du lasta opp" />
	{/if}
</div>

<style>
	.capture {
		display: grid;
		gap: 0;
		container-type: inline-size;
		/* The fast path should look like the fast path. A faint fill is enough to rank it above
		   the form without a second colour entering the palette. */
		background: var(--peach-ghost);
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
