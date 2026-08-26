<script lang="ts">
	/**
	 * Decorative only — proximity rings over a halftone field, standing in for the map. Duotone by
	 * construction: the SVG references only the two brand hues.
	 *
	 * OWNS these document-global ids: dot-lg, dot-md, dot-sm, core, mid, outer, m-core, m-mid,
	 * m-outer. SVG defs ids are global, so rendering this component twice on one page would make
	 * the second instance's masks collide with the first. If it ever needs to appear more than
	 * once, suffix the ids with $props.id().
	 */
</script>

<div class="art" aria-hidden="true">
	<svg viewBox="0 0 600 820" preserveAspectRatio="xMidYMid slice">
		<defs>
			<pattern id="dot-lg" width="12" height="12" patternUnits="userSpaceOnUse">
				<circle cx="3" cy="3" r="2.6" fill="var(--peach)" />
			</pattern>
			<pattern id="dot-md" width="10" height="10" patternUnits="userSpaceOnUse">
				<circle cx="2.5" cy="2.5" r="1.5" fill="var(--peach)" />
			</pattern>
			<pattern id="dot-sm" width="8" height="8" patternUnits="userSpaceOnUse">
				<circle cx="2" cy="2" r="0.8" fill="var(--peach)" />
			</pattern>

			<radialGradient id="core" cx="52%" cy="38%" r="34%">
				<stop offset="0%" stop-color="#fff" stop-opacity="1" />
				<stop offset="100%" stop-color="#fff" stop-opacity="0" />
			</radialGradient>
			<radialGradient id="mid" cx="52%" cy="38%" r="62%">
				<stop offset="20%" stop-color="#fff" stop-opacity="0" />
				<stop offset="60%" stop-color="#fff" stop-opacity="0.9" />
				<stop offset="100%" stop-color="#fff" stop-opacity="0" />
			</radialGradient>
			<radialGradient id="outer" cx="52%" cy="38%" r="95%">
				<stop offset="45%" stop-color="#fff" stop-opacity="0" />
				<stop offset="100%" stop-color="#fff" stop-opacity="0.75" />
			</radialGradient>

			<mask id="m-core"><rect width="600" height="820" fill="url(#core)" /></mask>
			<mask id="m-mid"><rect width="600" height="820" fill="url(#mid)" /></mask>
			<mask id="m-outer"><rect width="600" height="820" fill="url(#outer)" /></mask>
		</defs>

		<!-- halftone: dot size falls off from the centre, the way a real screen does -->
		<rect width="600" height="820" fill="url(#dot-lg)" mask="url(#m-core)" />
		<rect width="600" height="820" fill="url(#dot-md)" mask="url(#m-mid)" />
		<rect width="600" height="820" fill="url(#dot-sm)" mask="url(#m-outer)" />

		<!-- proximity: "hendingar nær deg" -->
		<g fill="none" stroke="var(--peach)" stroke-width="2">
			<circle cx="312" cy="312" r="72" />
			<circle cx="312" cy="312" r="132" stroke-opacity="0.75" />
			<circle cx="312" cy="312" r="198" stroke-opacity="0.5" />
			<circle cx="312" cy="312" r="272" stroke-opacity="0.28" />
		</g>

		<!-- pin -->
		<path
			d="M312 232c-30 0-54 24-54 54 0 38 54 96 54 96s54-58 54-96c0-30-24-54-54-54z"
			fill="var(--navy-900)"
			stroke="var(--peach)"
			stroke-width="3"
		/>
		<circle cx="312" cy="286" r="17" fill="var(--peach)" />

		<!-- sparkles, straight out of the poster vocabulary -->
		<g fill="var(--peach)">
			<path d="M470 150l7 26 26 7-26 7-7 26-7-26-26-7 26-7z" />
			<path d="M120 640l5 19 19 5-19 5-5 19-5-19-19-5 19-5z" />
		</g>

		<!-- oval, echoing the reference's badge -->
		<ellipse
			cx="312"
			cy="672"
			rx="176"
			ry="58"
			fill="var(--navy-900)"
			stroke="var(--peach)"
			stroke-width="2"
			stroke-opacity="0.6"
		/>
		<text
			x="312"
			y="682"
			text-anchor="middle"
			fill="var(--peach)"
			font-family="Space Mono, monospace"
			font-size="19"
			letter-spacing="5"
		>
			NÆR DEG
		</text>
	</svg>
</div>

<style>
	.art {
		border: var(--rule) solid var(--peach-line);
		background: var(--navy-900);
		aspect-ratio: 600 / 820;
		overflow: hidden;
	}
	.art :global(svg) {
		display: block;
		inline-size: 100%;
		block-size: 100%;
	}
</style>
