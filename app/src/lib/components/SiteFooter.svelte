<script lang="ts">
	// Page chrome belongs to the layout, so both routes get the same footer. Previously the footer
	// lived inside the landing page and /hendingar simply had none.
</script>

<footer class="shell foot">
	<hr class="rule" />
	<div class="foot__grid">
		<p>
			<strong>hendingar.no</strong> — <em>hendingar</em> = arrangement på nynorsk
			<span aria-hidden="true">🇳🇴</span>
		</p>
		<p class="label">
			<a href="/datasamling">Kjelder og status</a> ·
			<a href="/hendingar">Alle hendingar</a> ·
			<a href="/send-inn">Send inn</a>
		</p>
		<p class="label">AGPL-3.0 · Tidleg utvikling</p>
		<p class="label">Utviklingsinfrastruktur sponsa av Nordlo</p>
	</div>
</footer>

<style>
	.foot {
		padding-block: 2.5rem 4rem;
	}
	.foot__grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(min(100%, 16rem), 1fr));
		gap: 1rem var(--gutter);
		margin-block-start: 1.5rem;
	}
	.foot p {
		margin: 0;
	}
</style>
