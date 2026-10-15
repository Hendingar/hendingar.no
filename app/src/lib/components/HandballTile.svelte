<script lang="ts">
	/**
	 * A handball match, drawn as a shot on goal — and, once it scrolls into view, thrown.
	 *
	 * ## A different picture from the football card, on purpose
	 *
	 * VersusTile is two clubs colliding across a diagonal. This one is a moment of the game itself:
	 * the camera stands behind the shooter, the throwing hand fills the bottom right, the goal is
	 * top right, and the ball is already where every handball shot wants to be — up in the corner,
	 * *i krysset*. The names stack down the left like a scoreboard. Nothing in it but the two club
	 * names and the team is data, and none of it is a claim: the ball is in the net on every card,
	 * whoever wins.
	 *
	 * ## The throw
	 *
	 * The same contract as the versus tile, through the same `revealOnce`: the server sends the
	 * finished card, the throw plays **once per tile** when it is actually on screen, and every
	 * keyframe ends on the resting state, so `prefers-reduced-motion` (collapsed in brand.css) and
	 * a tile already scrolled past both get the poster without the movement. After that only the
	 * foil shine and a glint on the ball recur, every seven seconds.
	 *
	 * ## Colours
	 *
	 * Tokens only, so a home club's kit (ADR 0023) dresses this card exactly as it dresses the
	 * football one — Stord in black and white. The "shine" is opacity on `--peach-hi`, never a
	 * third hue.
	 */
	import type { HandballMatch } from '@hendingar/core/handball';
	import { handballTile, TAG_Y } from '../handball-tile.ts';
	import { kitClass } from '../club-kits.ts';
	import { revealOnce } from '../reveal-once.ts';

	let {
		id,
		match,
		feature = false
	}: {
		/** The event id. Only used to keep the SVG's internal ids unique on a page full of tiles. */
		id: number;
		match: HandballMatch;
		/** The large card on an event's own page: the shine keeps passing after the throw. */
		feature?: boolean;
	} = $props();

	const tile = $derived(handballTile(match));
	const kit = $derived(kitClass(match));

	let stage = $state<'rest' | 'armed' | 'live'>('rest');

	/** Where the ball rests: top right of the goal, under the bar and inside the post. */
	const BALL = { x: 358, y: 46 };
	/** The corner of the frame the rays come from — the point the whole card looks at. */
	const CORNER = { x: 384, y: 18 };

	/** Light thrown back across the court from the corner. Fixed: the same match, the same card. */
	const RAYS = Array.from({ length: 9 }, (_, i) => {
		const a = ((112 + i * 11) * Math.PI) / 180;
		const w = ((1.4 + (i % 3) * 0.6) * Math.PI) / 180;
		const far = 520;
		const p = (angle: number) =>
			`${(CORNER.x + Math.cos(angle) * far).toFixed(1)},${(CORNER.y + Math.sin(angle) * far).toFixed(1)}`;
		return `${CORNER.x},${CORNER.y} ${p(a - w)} ${p(a + w)}`;
	}).join(' M');

	/** Four-pointed glints thrown out of the net on impact. */
	const SPARKLES = Array.from({ length: 10 }, (_, i) => ({
		angle: i * 36 + (i % 2 ? 11 : -7),
		reach: i % 3 === 0 ? 98 : 62,
		size: i % 3 === 0 ? 2.2 : 1.4,
		delay: (i % 4) * 26
	}));

	const STAR = 'M0 -7 L1.5 -1.5 L7 0 L1.5 1.5 L0 7 L-1.5 1.5 L-7 0 L-1.5 -1.5 Z';

	function reveal(node: HTMLElement) {
		return revealOnce(node, {
			settled: () => {},
			armed: () => (stage = 'armed'),
			live: () => (stage = 'live')
		});
	}
</script>

{#snippet hand()}
	<!-- The back of a right hand, wrist at the origin, fingers up. Fingers first, so the palm's
	     edge draws the knuckle line across them. -->
	<rect x="-19" y="-6" width="38" height="70" rx="10" />
	<rect x="-25" y="-98" width="12" height="52" rx="6" />
	<rect x="-12" y="-108" width="12" height="60" rx="6" />
	<rect x="1" y="-104" width="12" height="56" rx="6" />
	<rect x="14" y="-90" width="11" height="44" rx="5.5" />
	<g transform="translate(-22 -26) rotate(-48)">
		<rect x="-6" y="-38" width="12" height="40" rx="6" />
	</g>
	<rect x="-26" y="-62" width="52" height="64" rx="17" />
{/snippet}

<!-- `thumb` as well as `hb`: the parents reach into a thumbnail with `:global(.thumb)` for the
     hover scale and the phone-width square, and `thumb--whole` to be let out of that square again.
     See VersusTile for the whole reason. -->
<div
	class={['thumb thumb--whole thumb-box hb', kit]}
	class:hb--feature={feature}
	class:hb--armed={stage === 'armed'}
	class:hb--live={stage === 'live'}
	role="img"
	aria-label={tile.label}
	{@attach reveal}
>
	<!--
		Cropped from the right, not the middle, wherever a parent paints this in a box that is not
		16:9. The listing no longer does — `thumb--whole` keeps it whole on a phone — but a square
		crop of the middle is the end of a name and a goalpost, and the right of it is the goal, the
		ball and the hand, which is the picture on its own.
	-->
	<svg viewBox="0 0 400 225" preserveAspectRatio="xMaxYMid slice" aria-hidden="true">
		<defs>
			<pattern id={`hb-net-${id}`} width="9" height="9" patternUnits="userSpaceOnUse">
				<path d="M0 0 L9 9 M9 0 L0 9" stroke="var(--peach)" stroke-width="0.7" fill="none" />
			</pattern>
			<pattern id={`hb-post-${id}`} width="16" height="16" patternUnits="userSpaceOnUse">
				<rect width="16" height="16" fill="var(--navy-600)" />
				<rect width="16" height="8" fill="var(--peach-hi)" />
			</pattern>
			<radialGradient id={`hb-ball-${id}`} cx="36%" cy="32%" r="72%">
				<stop offset="0%" stop-color="var(--peach-hi)" />
				<stop offset="55%" stop-color="var(--peach)" />
				<stop offset="100%" stop-color="var(--navy-600)" />
			</radialGradient>
			<radialGradient id={`hb-flare-${id}`}>
				<stop offset="0%" stop-color="var(--peach-hi)" stop-opacity="1" />
				<stop offset="35%" stop-color="var(--peach-hi)" stop-opacity="0.5" />
				<stop offset="100%" stop-color="var(--peach-hi)" stop-opacity="0" />
			</radialGradient>
			<linearGradient id={`hb-trail-${id}`} x1="0" y1="1" x2="1" y2="0">
				<stop offset="0%" stop-color="var(--peach-hi)" stop-opacity="0" />
				<stop offset="100%" stop-color="var(--peach-hi)" stop-opacity="0.9" />
			</linearGradient>
			<!-- Foil: a soft band with a hard glint inside it, the way light runs over a holo card. -->
			<linearGradient id={`hb-foil-${id}`} x1="0" y1="0" x2="1" y2="0">
				<stop offset="0%" stop-color="var(--peach-hi)" stop-opacity="0" />
				<stop offset="38%" stop-color="var(--peach-hi)" stop-opacity="0.14" />
				<stop offset="47%" stop-color="var(--peach-hi)" stop-opacity="0.5" />
				<stop offset="50%" stop-color="var(--peach-hi)" stop-opacity="0.08" />
				<stop offset="56%" stop-color="var(--peach)" stop-opacity="0.3" />
				<stop offset="100%" stop-color="var(--peach-hi)" stop-opacity="0" />
			</linearGradient>
			<g id={`hb-hand-${id}`}>{@render hand()}</g>
			<clipPath id={`hb-field-${id}`}>
				<rect width="400" height="225" />
			</clipPath>
		</defs>

		<g clip-path={`url(#hb-field-${id})`}>
			<g class="hb__stage">
				<rect x="-20" y="-20" width="440" height="265" fill="var(--navy-900)" />
				<path class="hb__rays" d={`M${RAYS}`} fill="var(--peach-hi)" />

				<!-- The court: floor from the goal line down, and the 6 m and 9 m lines in
				     perspective, centred on the goal. -->
				<rect x="-20" y="120" width="440" height="125" fill="var(--navy-800)" />
				<line
					x1="-20"
					y1="120"
					x2="420"
					y2="120"
					stroke="var(--peach)"
					stroke-width="1"
					opacity="0.3"
				/>
				<path
					d="M189 120 A130 34 0 0 0 449 120"
					fill="none"
					stroke="var(--peach)"
					stroke-width="1.5"
					opacity="0.32"
				/>
				<path
					d="M119 120 A200 62 0 0 0 519 120"
					fill="none"
					stroke="var(--peach)"
					stroke-width="1.2"
					stroke-dasharray="7 6"
					opacity="0.22"
				/>

				<g class="hb__goal">
					<rect x="260" y="22" width="118" height="98" fill="var(--navy-900)" opacity="0.6" />
					<rect
						class="hb__net"
						x="260"
						y="22"
						width="118"
						height="98"
						fill={`url(#hb-net-${id})`}
					/>
					<rect x="252" y="14" width="8" height="106" fill={`url(#hb-post-${id})`} />
					<rect x="378" y="14" width="8" height="106" fill={`url(#hb-post-${id})`} />
					<rect x="252" y="14" width="134" height="8" fill={`url(#hb-post-${id})`} />
				</g>

				<path
					class="hb__trail"
					d="M296 150 Q300 72 {BALL.x} {BALL.y}"
					pathLength="1"
					fill="none"
					stroke={`url(#hb-trail-${id})`}
					stroke-width="7"
					stroke-linecap="round"
				/>
				<path
					class="hb__trail hb__trail--core"
					d="M296 150 Q300 72 {BALL.x} {BALL.y}"
					pathLength="1"
					fill="none"
					stroke="var(--peach-hi)"
					stroke-width="1.5"
					stroke-linecap="round"
				/>

				<g transform="translate({BALL.x} {BALL.y})">
					<circle class="hb__flare" r="66" fill={`url(#hb-flare-${id})`} />
					<circle class="hb__wave" r="10" fill="none" stroke="var(--peach-hi)" stroke-width="3" />
				</g>
				{#each SPARKLES as s, i (i)}
					<g transform="translate({BALL.x} {BALL.y}) rotate({s.angle})">
						<path
							class="hb__spark"
							style:--reach="{s.reach}px"
							style:--size={s.size}
							style:--spark-delay="{s.delay}ms"
							d={STAR}
							fill="var(--peach-hi)"
						/>
					</g>
				{/each}

				<g transform="translate({BALL.x} {BALL.y})">
					<g class="hb__ball">
						<circle r="12" fill={`url(#hb-ball-${id})`} />
						<g fill="none" stroke="var(--navy-700)" stroke-width="1.3" opacity="0.75">
							<path d="M-11.5 -3 Q0 3 11.5 -3" />
							<path d="M-3 -11.6 Q4 0 -3 11.6" />
							<path d="M4 -11 Q10 -2 6 10" />
						</g>
						<ellipse cx="-4.5" cy="-5" rx="3.6" ry="2.2" fill="var(--peach-hi)" opacity="0.85" />
					</g>
					<!-- Wrapped: a CSS transform on the path would replace a `transform` attribute. -->
					<g transform="translate(-5 -6)">
						<path class="hb__glint" d={STAR} fill="var(--peach-hi)" />
					</g>
				</g>

				<!-- The throwing hand, in follow-through. Ghosts trail it during the whip. -->
				<g transform="translate(318 252) rotate(14)">
					<path
						class="hb__whoosh"
						d="M-96 -52 A112 112 0 0 1 34 -110"
						pathLength="1"
						fill="none"
						stroke="var(--peach-hi)"
						stroke-width="3"
						stroke-linecap="round"
					/>
					<use
						class="hb__ghost hb__ghost--far"
						href={`#hb-hand-${id}`}
						fill="none"
						stroke="var(--peach)"
						stroke-width="1"
					/>
					<use
						class="hb__ghost hb__ghost--near"
						href={`#hb-hand-${id}`}
						fill="none"
						stroke="var(--peach)"
						stroke-width="1"
					/>
					<use
						class="hb__hand"
						href={`#hb-hand-${id}`}
						fill="var(--navy-700)"
						stroke="var(--peach)"
						stroke-width="1.6"
					/>
				</g>

				<text class="hb__tag" x="20" y={TAG_Y}>{tile.tag}</text>

				<text class="hb__name hb__name--home" x="20" style:font-size="{tile.home.fontSize}px">
					{#each tile.home.lines as line, i (i)}
						<tspan x="20" y={tile.home.baselines[i]}>{line}</tspan>
					{/each}
				</text>
				<g class="hb__mot">
					<text class="hb__mot-text" x="20" y={tile.motY}>MOT</text>
					<line
						x1="56"
						y1={tile.motY - 3.5}
						x2="132"
						y2={tile.motY - 3.5}
						stroke="var(--peach)"
						stroke-width="1"
						opacity="0.45"
					/>
				</g>
				<text class="hb__name hb__name--away" x="20" style:font-size="{tile.away.fontSize}px">
					{#each tile.away.lines as line, i (i)}
						<tspan x="20" y={tile.away.baselines[i]}>{line}</tspan>
					{/each}
				</text>

				<rect
					x="7"
					y="7"
					width="386"
					height="211"
					fill="none"
					stroke="var(--peach)"
					stroke-width="1"
					opacity="0.3"
				/>

				<rect class="hb__flash" x="-20" y="-20" width="440" height="265" fill="var(--peach-hi)" />

				<rect
					class="hb__foil"
					x="-180"
					y="-60"
					width="170"
					height="345"
					fill={`url(#hb-foil-${id})`}
				/>
			</g>
		</g>
	</svg>
</div>

<style>
	/* Classes, never a bare element type — see "A component rule on a bare element" in CLAUDE.md. */
	.hb__name {
		font-family: var(--font-display);
		font-weight: 900;
		font-stretch: 125%;
		letter-spacing: -0.02em;
		fill: var(--peach);
	}
	.hb__name--away {
		fill: var(--peach-dim);
	}
	.hb__tag,
	.hb__mot-text {
		font-family: var(--font-mono);
		font-size: 10px;
		font-weight: 700;
		letter-spacing: 0.28em;
		fill: var(--peach-quiet);
	}
	.hb__mot-text {
		fill: var(--peach-hi);
	}

	.hb__rays {
		opacity: 0.06;
	}

	/* Scale and spin about their own middles. */
	.hb__name,
	.hb__ball,
	.hb__flare,
	.hb__wave,
	.hb__spark,
	.hb__glint,
	.hb__tag,
	.hb__mot {
		transform-box: fill-box;
		transform-origin: center;
	}
	.hb__name {
		transform-origin: left center;
	}
	/* About the wrist, which is the origin the hand is drawn around. */
	.hb__hand,
	.hb__ghost,
	.hb__whoosh {
		transform-box: view-box;
		transform-origin: 0 0;
	}
	/* About the ball, so the net bulges where it was hit. */
	.hb__net,
	.hb__stage {
		transform-box: view-box;
		transform-origin: 358px 46px;
	}
	.hb__trail,
	.hb__whoosh {
		stroke-dasharray: 1;
		stroke-dashoffset: 1;
	}

	/* Only ever seen mid-animation; every one of them ends invisible. */
	.hb__trail,
	.hb__whoosh,
	.hb__ghost,
	.hb__flare,
	.hb__wave,
	.hb__spark,
	.hb__glint,
	.hb__flash,
	.hb__foil {
		opacity: 0;
		pointer-events: none;
	}
	.hb__wave {
		vector-effect: non-scaling-stroke;
	}

	/* Off stage: found below the fold by the script, never in the server HTML. */
	.hb--armed .hb__name,
	.hb--armed .hb__mot,
	.hb--armed .hb__tag,
	.hb--armed .hb__ball {
		opacity: 0;
	}

	/*
	 * The throw. One timeline, in milliseconds from the tile coming into view:
	 *
	 *     0    the hand is cocked back with the ball in it
	 *     250  the whip: hand, ghosts and a whoosh arc snap forward; the ball leaves
	 *     700  the ball hits the corner: flash, flare, shockwave, glints, the net bulges, the frame
	 *          rattles and the camera punches in on the corner
	 *     720  the home name slides in, the away name 80 ms behind it
	 *     1250 settled — then the foil shine and a glint on the ball, every seven seconds
	 *
	 * `both` for what arrives; `forwards` for the flashes whose first frame is visible, so they
	 * do not hang on the card through their delay.
	 */
	.hb--live .hb__hand {
		animation: hb-throw 900ms cubic-bezier(0.3, 0, 0.3, 1) both;
	}
	.hb--live .hb__ghost--near {
		animation: hb-ghost-near 900ms cubic-bezier(0.3, 0, 0.3, 1) forwards;
	}
	.hb--live .hb__ghost--far {
		animation: hb-ghost-far 900ms cubic-bezier(0.3, 0, 0.3, 1) forwards;
	}
	.hb--live .hb__whoosh {
		animation: hb-whoosh 420ms var(--ease-out) 220ms forwards;
	}
	.hb--live .hb__ball {
		animation: hb-shot 900ms linear both;
	}
	.hb--live .hb__trail {
		animation: hb-trail 640ms var(--ease-out) 380ms forwards;
	}
	.hb--live .hb__trail--core {
		animation-delay: 400ms;
	}
	.hb--live .hb__flare {
		animation: hb-flare 560ms var(--ease-out) 690ms forwards;
	}
	.hb--live .hb__flash {
		animation: hb-flash 300ms ease-out 700ms forwards;
	}
	.hb--live .hb__wave {
		animation: hb-wave 620ms var(--ease-out) 700ms forwards;
	}
	.hb--live .hb__spark {
		animation: hb-spark 620ms var(--ease-out) calc(700ms + var(--spark-delay, 0ms)) forwards;
	}
	.hb--live .hb__net {
		animation: hb-bulge 560ms cubic-bezier(0.2, 0.9, 0.3, 1.2) 700ms both;
	}
	.hb--live .hb__goal {
		animation: hb-rattle 380ms linear 700ms both;
	}
	.hb--live .hb__stage {
		animation: hb-punch 520ms var(--ease-out) 690ms both;
	}
	.hb--live .hb__rays {
		animation: hb-rays 900ms var(--ease-out) 690ms both;
	}
	.hb--live .hb__name--home {
		animation: hb-slide 520ms cubic-bezier(0.2, 0.9, 0.25, 1.1) 720ms both;
	}
	.hb--live .hb__name--away {
		animation: hb-slide 520ms cubic-bezier(0.2, 0.9, 0.25, 1.1) 800ms both;
	}
	.hb--live .hb__mot {
		animation: hb-fade 300ms var(--ease-out) 880ms both;
	}
	.hb--live .hb__tag {
		animation: hb-fade 300ms var(--ease-out) 960ms both;
	}
	.hb--live .hb__foil {
		animation: hb-foil 7s linear 1250ms infinite both;
	}
	.hb--live .hb__glint {
		animation: hb-twinkle 7s linear 1650ms infinite both;
	}

	/* The event's own page keeps the foil moving, as the football card keeps breathing. */
	.hb--feature .hb__foil {
		animation: hb-foil 4.5s linear infinite;
	}
	.hb--feature .hb__glint {
		animation: hb-twinkle 4.5s linear 400ms infinite;
	}
	.hb--feature.hb--live .hb__foil {
		animation: hb-foil 4.5s linear 1250ms infinite both;
	}
	.hb--feature.hb--live .hb__glint {
		animation: hb-twinkle 4.5s linear 1650ms infinite both;
	}

	@keyframes hb-throw {
		from {
			transform: rotate(-34deg) translate(-6px, 14px);
		}
		28% {
			transform: rotate(-46deg) translate(-10px, 20px);
		}
		44% {
			transform: rotate(30deg) translate(4px, -8px);
		}
		60% {
			transform: rotate(8deg);
		}
		76% {
			transform: rotate(-3deg);
		}
		to {
			transform: none;
		}
	}
	/* Copies of the hand a beat behind it, lit only while it whips through. */
	@keyframes hb-ghost-near {
		from,
		30% {
			opacity: 0;
			transform: rotate(-46deg) translate(-10px, 20px);
		}
		44% {
			opacity: 0.55;
			transform: rotate(4deg);
		}
		to {
			opacity: 0;
			transform: rotate(-8deg);
		}
	}
	@keyframes hb-ghost-far {
		from,
		30% {
			opacity: 0;
			transform: rotate(-46deg) translate(-10px, 20px);
		}
		44% {
			opacity: 0.3;
			transform: rotate(-20deg) translate(-4px, 8px);
		}
		to {
			opacity: 0;
			transform: rotate(-26deg);
		}
	}
	@keyframes hb-whoosh {
		from {
			opacity: 0.95;
			stroke-dashoffset: 1;
		}
		55% {
			opacity: 0.8;
			stroke-dashoffset: 0;
		}
		to {
			opacity: 0;
			stroke-dashoffset: -1;
		}
	}
	/*
	 * In the hand, back with the wind-up, then out and away — shrinking as it leaves the camera,
	 * spinning, and into the corner at 78%, where it pushes the net and sits.
	 */
	@keyframes hb-shot {
		from {
			transform: translate(-74px, 120px) rotate(-200deg) scale(2.3);
		}
		28% {
			transform: translate(-84px, 126px) rotate(-220deg) scale(2.3);
		}
		44% {
			transform: translate(-60px, 100px) rotate(-260deg) scale(2.1);
		}
		58% {
			transform: translate(-36px, 50px) rotate(-420deg) scale(1.6);
		}
		70% {
			transform: translate(-14px, 14px) rotate(-560deg) scale(1.2);
		}
		78% {
			transform: translate(0, 0) rotate(-640deg) scale(1);
		}
		84% {
			transform: translate(5px, -4px) rotate(-680deg) scale(0.86);
		}
		92% {
			transform: translate(-1px, 1px) rotate(-710deg) scale(1.03);
		}
		to {
			transform: none;
		}
	}
	@keyframes hb-trail {
		from {
			opacity: 1;
			stroke-dashoffset: 1;
		}
		45% {
			opacity: 1;
			stroke-dashoffset: 0;
		}
		to {
			opacity: 0;
			stroke-dashoffset: -0.6;
		}
	}
	@keyframes hb-flare {
		from {
			opacity: 0;
			transform: scale(0.2);
		}
		16% {
			opacity: 1;
			transform: scale(1);
		}
		to {
			opacity: 0;
			transform: scale(1.6);
		}
	}
	@keyframes hb-flash {
		from {
			opacity: 0;
		}
		14% {
			opacity: 0.32;
		}
		to {
			opacity: 0;
		}
	}
	@keyframes hb-wave {
		from {
			opacity: 0.95;
			transform: scale(1);
		}
		to {
			opacity: 0;
			transform: scale(11);
		}
	}
	/* Along the rotated axis of its group, spinning as it goes. */
	@keyframes hb-spark {
		from {
			opacity: 1;
			transform: translateX(6px) rotate(0deg) scale(var(--size));
		}
		to {
			opacity: 0;
			transform: translateX(var(--reach)) rotate(180deg) scale(calc(var(--size) * 0.3));
		}
	}
	@keyframes hb-bulge {
		from {
			transform: none;
		}
		30% {
			transform: scale(1.08);
		}
		60% {
			transform: scale(0.98);
		}
		to {
			transform: none;
		}
	}
	@keyframes hb-rattle {
		0%,
		100% {
			transform: none;
		}
		20% {
			transform: translate(2px, -1.5px);
		}
		45% {
			transform: translate(-1.5px, 1px);
		}
		70% {
			transform: translate(1px, 0);
		}
	}
	@keyframes hb-punch {
		from {
			transform: none;
		}
		22% {
			transform: scale(1.04);
		}
		to {
			transform: none;
		}
	}
	@keyframes hb-rays {
		from {
			opacity: 0.06;
		}
		14% {
			opacity: 0.38;
		}
		to {
			opacity: 0.06;
		}
	}
	@keyframes hb-slide {
		from {
			opacity: 0;
			transform: translateX(-150px) skewX(-18deg);
		}
		60% {
			opacity: 1;
			transform: translateX(8px) skewX(4deg);
		}
		to {
			opacity: 1;
			transform: none;
		}
	}
	@keyframes hb-fade {
		from {
			opacity: 0;
		}
		to {
			opacity: 1;
		}
	}
	/* One pass across the whole card, then parked off the right edge for the rest of the cycle. */
	@keyframes hb-foil {
		from {
			opacity: 1;
			transform: translateX(0) skewX(-24deg);
		}
		18% {
			opacity: 1;
			transform: translateX(760px) skewX(-24deg);
		}
		to {
			opacity: 1;
			transform: translateX(760px) skewX(-24deg);
		}
	}
	/* Timed so it catches the ball just after the foil has passed over it. */
	@keyframes hb-twinkle {
		from,
		8% {
			opacity: 0;
			transform: scale(0) rotate(0deg);
		}
		11% {
			opacity: 1;
			transform: scale(1.3) rotate(45deg);
		}
		15%,
		to {
			opacity: 0;
			transform: scale(0) rotate(90deg);
		}
	}
</style>
