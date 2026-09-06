<script lang="ts">
	import { downscaleForUpload, type CapturedImage } from '../../poster.ts';

	/**
	 * The picture that becomes the card's thumbnail.
	 *
	 * Every submitted event can carry one now, not just the ones read from a photograph. Three
	 * things came together to make that the right shape:
	 *
	 * - A read that failed used to take the photograph down with it. Somebody who had walked over to
	 *   the noticeboard and photographed the poster ended up filling in the form by hand AND getting
	 *   a generated tile, because the only path that kept an image was the one where the model
	 *   answered.
	 * - Somebody typing the event in themselves had no way to offer a picture at all, however good
	 *   the one on their phone was.
	 * - A submitted event is the one kind of row where the image rights are not in doubt: the person
	 *   who took the picture chose to send it to us for this. Every imported poster is hotlinked
	 *   under someone else's terms; this one is ours to show.
	 *
	 * The image is held in the browser and sent only after the event is approved — see the upload
	 * effect in SubmitForm. Nothing here uploads anything.
	 */
	let {
		poster = null,
		readFromImage = false,
		onpick,
		onclear
	}: {
		/** The current image, as a `data:` URL, or null when none is attached. */
		poster?: string | null;
		/** Were the fields read from this image? Then the caption has a second job to do. */
		readFromImage?: boolean;
		onpick: (image: CapturedImage) => void;
		onclear: () => void;
	} = $props();

	let input = $state<HTMLInputElement | undefined>();
	let message = $state('');
	let busy = $state(false);

	async function handle(file: File) {
		if (!file.type.startsWith('image/')) {
			message = 'Det må vere eit bilete. Prøv ein JPEG eller PNG.';
			return;
		}
		message = '';
		busy = true;
		try {
			// Shrinks and re-encodes, which is also what strips the EXIF — including where the
			// photograph was taken. See `downscaleForUpload`.
			onpick(await downscaleForUpload(file));
		} catch {
			message = 'Klarte ikkje behandle biletet. Prøv eit anna.';
		} finally {
			busy = false;
		}
	}
</script>

<div class="poster">
	<p class="poster__label">
		Bilete <span class="poster__opt">valfritt</span>
	</p>

	<!--
		One input, both states. `hidden` rather than removed from the DOM, so `input.click()` from
		either button reaches the same element and the file list is not lost between renders.
	-->
	<input
		bind:this={input}
		class="visually-hidden"
		type="file"
		accept="image/*"
		aria-label="Vel eit bilete"
		onchange={(e) => {
			const file = e.currentTarget.files?.[0];
			if (file) handle(file);
			// Cleared so picking the SAME file twice still fires a change — which is exactly what
			// somebody does after pressing "Fjern" by mistake.
			e.currentTarget.value = '';
		}}
	/>

	{#if poster}
		<!--
			`<figure>` with a caption rather than a bare img: the relationship between the picture and
			what happens to it is the information, and a caption is where you say so.
		-->
		<figure class="poster__fig">
			<img src={poster} alt="Biletet du har lagt ved" />
			<figcaption>
				{#if readFromImage}
					Felta merkte <span aria-hidden="true">◧</span>
					<em>lese frå biletet</em> er lesne herifrå. Rett det som er feil — det du endrar blir ditt.
				{/if}
				Blir hendinga publisert, blir biletet miniatyrbilete på kortet.
			</figcaption>
		</figure>

		<p class="poster__acts">
			<button type="button" class="btn btn--sm" onclick={() => input?.click()} disabled={busy}>
				{busy ? 'Arbeider…' : 'Byt bilete'}
			</button>
			<button type="button" class="poster__drop" onclick={onclear} disabled={busy}>
				Fjern biletet
			</button>
		</p>
	{:else}
		<button type="button" class="btn btn--sm" onclick={() => input?.click()} disabled={busy}>
			{busy ? 'Arbeider…' : 'Legg ved eit bilete'}
		</button>
		<p class="poster__help">
			Plakat, skjermbilete eller foto. Blir hendinga publisert, blir det miniatyrbilete på kortet —
			elles blir det ikkje lagra. Vi krympar det i nettlesaren din og fjernar posisjonsdata.
		</p>
	{/if}

	{#if message}
		<p class="poster__err" aria-live="polite">{message}</p>
	{/if}
</div>

<style>
	.poster {
		border: var(--rule) solid var(--peach-line);
		padding: 0.9rem 1rem 1rem;
		display: grid;
		justify-items: start;
		gap: 0.6rem;
	}
	.poster__label {
		margin: 0;
		font-family: var(--font-mono);
		font-size: var(--step-micro);
		font-weight: 700;
		letter-spacing: 0.16em;
		text-transform: uppercase;
		color: var(--peach);
	}
	.poster__opt {
		font-weight: 400;
		letter-spacing: 0.1em;
		color: var(--peach-dim);
	}
	.poster__fig {
		margin: 0;
		display: grid;
		gap: 0.5rem;
		/*
		 * Fills its column, up to a point.
		 *
		 * `justify-items: start` on the field makes every child shrink to its content, which for a
		 * figure holding a percentage-width image means the image collapses to a thumbnail of a
		 * thumbnail — 55px of a 350px column, which is not a picture anybody can check a form
		 * against. The cap is what keeps it from becoming the form on a wide screen.
		 */
		inline-size: 100%;
		max-inline-size: 22rem;
	}
	.poster__fig img {
		display: block;
		inline-size: 100%;
		block-size: auto;
		border: var(--rule) solid var(--peach-line);
	}
	.poster__fig figcaption {
		font-size: 0.8125rem;
		line-height: 1.45;
		color: var(--peach-dim);
	}
	.poster__acts {
		margin: 0;
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.75rem;
	}
	/*
	 * Removing is a link, not a second button.
	 *
	 * Two buttons side by side read as a choice between two equal actions, and these are not equal:
	 * one changes the picture, the other throws it away.
	 */
	.poster__drop {
		background: none;
		border: 0;
		padding: 0;
		font: inherit;
		font-size: 0.8125rem;
		color: var(--peach-dim);
		text-decoration: underline;
		cursor: pointer;
	}
	.poster__drop:hover {
		color: var(--peach-hi);
	}
	.poster__help {
		margin: 0;
		max-inline-size: 56ch;
		font-size: 0.8125rem;
		line-height: 1.45;
		color: var(--peach-dim);
	}
	.poster__err {
		margin: 0;
		font-size: 0.875rem;
		color: var(--peach-hi);
	}
</style>
