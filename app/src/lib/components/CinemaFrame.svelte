<script lang="ts">
	/**
	 * A film's thumbnail, framed as a screen.
	 *
	 * A cinema card already has its poster — what it lacked was anything saying *this is a film*
	 * rather than a concert with a dramatic photo. So the poster sits in the frame a film is shown
	 * in: letterboxed between black bars, the bars carrying the sprocket holes of the strip, and a
	 * clapperboard on the lower bar with the screening's time chalked on its slate.
	 *
	 * - **Scrolling in**, once (`reveal-once.ts`): the bars close in from outside the frame, the
	 *   clapper snaps shut, and the picture flickers up like a projector catching.
	 * - **Hovering**: the clapper claps, the bars slide away and the picture opens to the full
	 *   16:9, the strip runs, and a warm projector light falls across it. Leaving puts the bars
	 *   back.
	 *
	 * Nothing here is information: the time on the slate is the time printed in the card's body,
	 * and the frame is `aria-hidden`. The poster underneath — and its view-transition morph into
	 * the event page — is untouched; this only lays things over it.
	 */
	import type { Snippet } from 'svelte';
	import { revealOnce } from '../reveal-once.ts';

	let { slate, children }: { slate: string; children: Snippet } = $props();

	/*
	 * `done` once the entrance has finished. It matters: a finished animation that fills `both`
	 * keeps holding its last frame's `transform`, and an animation outranks a transition — so the
	 * bars would sit there on hover, refusing to open. Dropping the class drops the animations.
	 */
	let stage = $state<'rest' | 'armed' | 'live' | 'done'>('rest');

	function reveal(node: HTMLElement) {
		return revealOnce(node, {
			settled: () => {},
			armed: () => (stage = 'armed'),
			live: () => (stage = 'live')
		});
	}
</script>

<!--
	`thumb` so the tile's own rules place and size this box exactly as they placed the bare
	thumbnail — including the phone row's 5.5rem square. The thumbnail inside is told to fill it.
-->
<div
	class="thumb cine"
	class:cine--armed={stage === 'armed'}
	class:cine--live={stage === 'live'}
	{@attach reveal}
>
	<!-- The projector's start-up is the last of the entrance to finish, so its end is the end. -->
	<div
		class="cine__picture"
		onanimationend={(event) => {
			if (event.target === event.currentTarget && stage === 'live') stage = 'done';
		}}
	>
		{@render children()}
	</div>

	<div class="cine__beam" aria-hidden="true"></div>

	<div class="cine__bar cine__bar--top" aria-hidden="true">
		<span class="cine__holes"></span>
	</div>
	<div class="cine__bar cine__bar--bottom" aria-hidden="true">
		<span class="cine__holes"></span>
	</div>

	<svg class="cine__clapper" viewBox="0 0 64 52" aria-hidden="true">
		<!-- The slate. -->
		<rect x="2" y="16" width="60" height="34" rx="2" fill="var(--screen-black)" />
		<rect x="2" y="16" width="60" height="34" rx="2" fill="none" stroke="var(--paper)" />
		<line x1="6" y1="30" x2="58" y2="30" stroke="var(--paper)" stroke-width="0.8" opacity="0.6" />
		<text class="cine__slate" x="32" y="44" text-anchor="middle">{slate}</text>
		<!-- The fixed stripe along the top of the slate. -->
		<g>
			<rect x="2" y="9" width="60" height="7" fill="var(--paper)" />
			<path
				d="M8 9h7l-5 7H3zM22 9h7l-5 7h-7zM36 9h7l-5 7h-7zM50 9h7l-5 7h-7z"
				fill="var(--screen-black)"
			/>
		</g>
		<!-- The arm, hinged at its left end, which is what claps. -->
		<g class="cine__arm">
			<rect x="2" y="1" width="60" height="7" fill="var(--paper)" />
			<path
				d="M10 1h7l-5 7H5zM24 1h7l-5 7h-7zM38 1h7l-5 7h-7zM52 1h7l-5 7h-7z"
				fill="var(--screen-black)"
			/>
			<circle cx="4.5" cy="8" r="2" fill="var(--screen-hole)" />
		</g>
	</svg>
</div>

<style>
	.cine {
		position: relative;
		display: block;
		inline-size: 100%;
		aspect-ratio: 16 / 9;
		overflow: hidden;
		background: var(--screen-black);
		border-block-end: var(--rule) solid var(--peach-line);
		/* The bars, clapper and holes are sized from the frame, so a 5.5rem square and a 434px
		   card both look like the same screen. */
		container-type: inline-size;
		--bar: 13%;
	}

	/*
	 * The thumbnail fills the frame, and holds still inside it: the tile scales `.thumb` on hover,
	 * and this box is the `.thumb` that should move — scaling the one inside as well would
	 * compound to 1.06.
	 */
	.cine__picture {
		position: absolute;
		inset: 0;
	}
	.cine__picture > :global(.thumb) {
		inline-size: 100%;
		block-size: 100%;
		aspect-ratio: auto;
		object-fit: cover;
		border: none;
	}
	:global(.tile:hover) .cine__picture > :global(.thumb) {
		transform: none;
	}

	.cine__bar {
		position: absolute;
		inset-inline: 0;
		block-size: var(--bar);
		background: var(--screen-black);
		display: grid;
		align-items: center;
		transition: transform 420ms var(--ease-out) 160ms;
	}
	.cine__bar--top {
		inset-block-start: 0;
	}
	.cine__bar--bottom {
		inset-block-end: 0;
	}

	/* Sprocket holes: a row of rounded-off squares, run along the strip on hover. */
	.cine__holes {
		block-size: 38%;
		max-block-size: 7px;
		min-block-size: 3px;
		background-image: linear-gradient(90deg, var(--screen-hole) 0 55%, transparent 55% 100%);
		background-size: max(8px, 3.2cqi) 100%;
		background-repeat: repeat-x;
		border-radius: 1px;
		opacity: 0.9;
	}

	.cine__clapper {
		position: absolute;
		inset-inline-start: 4%;
		inset-block-end: calc(var(--bar) * 0.35);
		inline-size: max(30px, 17%);
		overflow: visible;
		filter: drop-shadow(0 2px 3px var(--screen-black));
		transition:
			transform 420ms var(--ease-out) 160ms,
			opacity 300ms ease 200ms;
	}
	.cine__arm {
		transform-box: fill-box;
		transform-origin: 4.5px 7px;
		transform: rotate(-24deg);
	}
	.cine__slate {
		font-family: var(--font-mono);
		font-size: 11px;
		font-weight: 700;
		letter-spacing: 0.06em;
		fill: var(--paper);
	}

	/* Warm light from the booth, only while the projector runs. */
	.cine__beam {
		position: absolute;
		inset: 0;
		background: radial-gradient(
			ellipse 70% 90% at 50% -10%,
			var(--screen-light) 0%,
			transparent 70%
		);
		mix-blend-mode: soft-light;
		opacity: 0;
		transition: opacity 400ms ease 200ms;
		pointer-events: none;
	}

	/* ---- Scrolling in, once ---------------------------------------------------------------- */

	/* Off stage below the fold — never in the server HTML (see reveal-once.ts). */
	.cine--armed .cine__bar--top {
		transform: translateY(-100%);
	}
	.cine--armed .cine__bar--bottom,
	.cine--armed .cine__clapper {
		transform: translateY(260%);
	}
	.cine--armed .cine__picture {
		opacity: 0;
	}

	.cine--live .cine__bar--top {
		animation: cine-close-top 520ms var(--ease-out) both;
	}
	.cine--live .cine__bar--bottom {
		animation: cine-close-bottom 520ms var(--ease-out) both;
	}
	.cine--live .cine__clapper {
		animation: cine-drop 460ms var(--ease-spring) 140ms both;
	}
	.cine--live .cine__arm {
		animation: cine-clap 300ms cubic-bezier(0.6, 0, 1, 1) 560ms both;
	}
	.cine--live .cine__picture {
		animation: cine-project 900ms steps(1, end) 760ms both;
	}

	/* ---- Hover: the projector runs --------------------------------------------------------- */

	:global(.tile:hover) .cine__bar--top {
		transform: translateY(-101%);
	}
	:global(.tile:hover) .cine__bar--bottom,
	:global(.tile:hover) .cine__clapper {
		transform: translateY(260%);
	}
	:global(.tile:hover) .cine__clapper {
		opacity: 0;
	}
	:global(.tile:hover) .cine__arm {
		animation: cine-clap-again 260ms cubic-bezier(0.6, 0, 1, 1) both;
	}
	:global(.tile:hover) .cine__holes {
		animation: cine-run 0.5s linear infinite;
	}
	:global(.tile:hover) .cine__beam {
		opacity: 0.55;
	}
	:global(.tile:hover) .cine__picture {
		animation: cine-flicker 2.4s steps(1, end) 300ms infinite;
	}

	@keyframes cine-close-top {
		from {
			transform: translateY(-100%);
		}
		to {
			transform: none;
		}
	}
	@keyframes cine-close-bottom {
		from {
			transform: translateY(100%);
		}
		to {
			transform: none;
		}
	}
	@keyframes cine-drop {
		from {
			transform: translateY(260%) rotate(-12deg);
		}
		to {
			transform: none;
		}
	}
	@keyframes cine-clap {
		from {
			transform: rotate(-24deg);
		}
		60% {
			transform: rotate(2deg);
		}
		to {
			transform: rotate(0deg);
		}
	}
	@keyframes cine-clap-again {
		from {
			transform: rotate(-30deg);
		}
		to {
			transform: rotate(0deg);
		}
	}
	/* A projector catching: dark, a burst too bright, a dip, then the picture. */
	@keyframes cine-project {
		0% {
			opacity: 0;
		}
		12% {
			opacity: 1;
			filter: brightness(1.8) contrast(0.8);
		}
		24% {
			opacity: 0.35;
			filter: none;
		}
		36% {
			opacity: 1;
			filter: brightness(1.25);
		}
		52% {
			opacity: 0.8;
			filter: none;
		}
		64%,
		100% {
			opacity: 1;
			filter: none;
		}
	}
	/* The gate's faint unevenness while it runs — a few percent, never a strobe. */
	@keyframes cine-flicker {
		0%,
		100% {
			filter: none;
		}
		31% {
			filter: brightness(1.06);
		}
		33% {
			filter: brightness(0.96);
		}
		70% {
			filter: brightness(1.04);
		}
		72% {
			filter: none;
		}
	}
	@keyframes cine-run {
		from {
			background-position-x: 0;
		}
		to {
			background-position-x: max(8px, 3.2cqi);
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.cine__bar,
		.cine__clapper,
		.cine__beam {
			transition: none;
		}
	}
</style>
