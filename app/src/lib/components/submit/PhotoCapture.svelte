<script lang="ts">
	import { extractFromPhoto } from '../../submit.remote';
	import type { ExtractedEvent } from '@hendingar/core/validation';

	let { onextract }: { onextract: (draft: ExtractedEvent) => void } = $props();

	let phase = $state<'idle' | 'reading' | 'error'>('idle');
	let message = $state('');
	let preview = $state<string | null>(null);
	let input: HTMLInputElement;

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

	async function handle(file: File) {
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

<div class="capture frame">
	<div class="capture__body">
		<p class="label">Snarveg</p>
		<h2 class="display display--md capture__h">Ta bilete av ein plakat</h2>
		<p class="capture__lede">
			Vi les plakaten og fyller ut skjemaet for deg. Du får sjå alt før noko blir sendt.
		</p>

		<!-- capture="environment" opens the rear camera directly on a phone, and is ignored on
		     desktop, where this stays an ordinary file picker. -->
		<input
			bind:this={input}
			class="visually-hidden"
			type="file"
			accept="image/*"
			capture="environment"
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
			{phase === 'reading' ? 'Les plakaten…' : 'Vel eller ta bilete'}
		</button>

		<p class="capture__status" aria-live="polite">
			{#if phase === 'reading'}
				Les plakaten. Dette tek nokre sekund.
			{:else if message}
				{message}
			{/if}
		</p>

		<p class="capture__fine">
			Biletet blir krympa i nettlesaren din før det blir sendt, og posisjonsdata i biletet blir
			fjerna. Vi lagrar ikkje biletet.
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
