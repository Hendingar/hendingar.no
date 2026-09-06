<script lang="ts">
	// Page chrome belongs to the layout, so both routes get the same footer. Previously the footer
	// lived inside the landing page and /hendingar simply had none.
	import { MANIFEST } from '../content/landing.ts';
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
		<!--
			The three promises, moved down here from a full-screen band on the front page.

			They are still the things this project rests on — they are just not what somebody
			arrives asking, and they were taking a screen to say what a line can say. Fine print is
			not a demotion: it is where a reader looks for exactly this, on every page rather than
			on one.
		-->
		<p class="label">{MANIFEST.join(' · ')}</p>
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
