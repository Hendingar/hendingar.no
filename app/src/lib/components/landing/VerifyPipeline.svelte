<script lang="ts">
	import CheckRail from '../CheckRail.svelte';
</script>

<section class="verify" aria-labelledby="h-verify">
	<div class="shell">
		<p class="label">Innsending</p>
		<h2 id="h-verify" class="display verify__h">Open innsending,<br />utan søppel</h2>
		<!-- Short on purpose. The five checks below say what the checks are; a lede that also
		     described them was the same information twice, and the second telling is the one a
		     reader skips. -->
		<p class="verify__lede">
			Alle kan sende inn, utan konto. Fem kontrollar før hendinga blir synleg. Stoppar noko henne,
			seier vi kva — og du kan rette og prøve igjen.
		</p>
		<!-- The rail itself is shared with /send-inn, which states the same five checks before you
		     submit rather than describing them in prose afterwards. -->
		<CheckRail />
		<p class="verify__cta">
			<a class="btn btn--solid" href="/send-inn">Send inn ei hending</a>
		</p>
		<!-- Kept, shortened: the checks above involve a model, imports never do, and a reader who
		     has just read "fem kontrollar" has no way to know that distinction unless we draw it. -->
		<p class="fineprint">
			Import frå ein kalender er rein kopiering — ingen språkmodell.
			<a href="/datasamling">Sjå kva vi hentar inn, og når →</a>
		</p>
	</div>
</section>

<style>
	.verify {
		background: var(--navy-900);
		border-block: var(--rule) solid var(--peach-line);
		padding-block: var(--section-y);
		container-type: inline-size;
	}
	.verify__h {
		font-size: clamp(1.75rem, 5.5cqw, 3.75rem);
		margin-block: 0.3em 0.8em;
	}
	.verify__lede {
		max-inline-size: 52ch;
		margin: 0 0 2.5rem;
	}
	.verify__cta {
		margin: 2rem 0 1.5rem;
	}
</style>
