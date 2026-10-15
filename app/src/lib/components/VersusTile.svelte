<script lang="ts">
	/**
	 * A fixture, drawn as a title card — and, once it scrolls into view, a boss fight.
	 *
	 * ## Why this is drawn and not fetched
	 *
	 * The card is made from what the feed already gave us: two club names and a grade. It costs
	 * no bytes, cannot 404 when somebody reorganises a CDN, and is the same card forever for the
	 * same match — the properties the generated tile beside it was built for. The crests are the
	 * one thing that is not ours, and `club-crests.ts` records how they were read and how to undo
	 * it: every card still works as a wordmark without them.
	 *
	 * ## The entrance
	 *
	 * A listing tile used to be the one thing on a page that never moved, on the argument that a
	 * hundred cards breathing at once is a grid that will not sit still. That argument is about
	 * *looping*, and it still holds — so the fight plays **once per tile**, when that tile is
	 * actually on screen, and then the card is still apart from a shine that passes every few
	 * seconds. Tiles arrive one at a time as somebody scrolls, so they never fire in unison.
	 *
	 * The page as rendered is the finished card. Nothing is hidden until the script has run and
	 * found the tile below the fold, so a crawler, a no-JS visitor and a tile you have already
	 * scrolled past all see the settled wordmark. `brand.css` collapses every animation under
	 * `prefers-reduced-motion`, and every keyframe here ends on the resting state, so that
	 * visitor gets the card without the fight.
	 *
	 * ## Crests on a listing, and what they cost
	 *
	 * NFF's crests average 33 KB and run to 82 KB, five to twenty times the rest of the card. So a
	 * listing tile asks for them only when it is about to scroll into view, never in the server
	 * HTML, and only when the tile is drawn wide enough for a crest to be a crest — on the 88px
	 * square a phone draws it would be four millimetres of mush, and the wordmark does the work.
	 */
	import type { Fixture } from '@hendingar/core/fixture';
	import { fixtureTile } from '../fixture-tile.ts';
	import { kitClass } from '../club-kits.ts';
	import { revealOnce } from '../reveal-once.ts';

	let {
		id,
		fixture,
		feature = false
	}: {
		/** The event id. Only used to keep the SVG's internal ids unique on a page full of tiles. */
		id: number;
		fixture: Fixture;
		/**
		 * The large card on an event's own page, rather than a thumbnail in a grid. It always
		 * carries its crests, and its mark keeps breathing after the entrance.
		 */
		feature?: boolean;
	} = $props();

	const tile = $derived(fixtureTile(fixture));
	/* The home club's colours, which every navy and peach token below then resolves to. */
	const kit = $derived(kitClass(fixture));

	/**
	 * Baselines, counted from the top for the home side and up from the bottom for the away one.
	 *
	 * The numbers clear the crest band, which is 72 units tall either side of the mark at y=112.
	 * Two lines of the largest size ink from 15 to 68 at the top and from 153 to 206 at the bottom,
	 * so a name never crosses a crest however long the club's name is.
	 */
	const LINE = 0.86;
	const homeLines = $derived(
		tile.home.lines.map((line, i) => ({ line, y: 40 + i * tile.home.fontSize * LINE }))
	);
	const awayLines = $derived(
		tile.away.lines.map((line, i) => ({
			line,
			y: 206 - (tile.away.lines.length - 1 - i) * tile.away.fontSize * LINE
		}))
	);

	/**
	 * Where the fight is.
	 *
	 * `rest` is the finished card, and what the server sends. `armed` is a tile the script found
	 * below the fold and set up off stage; `live` is the moment it is on screen and the fight runs.
	 */
	let stage = $state<'rest' | 'armed' | 'live'>('rest');
	/** Whether this tile is drawn big enough to carry crests. Measured once, when it nears view. */
	let roomy = $state(false);

	/** Narrower than this, a 56-unit crest renders under ~25 CSS px and stops being a crest. */
	const CREST_MIN_WIDTH = 200;

	const crests = $derived(
		feature || roomy ? { home: tile.home.crest, away: tile.away.crest } : null
	);

	/** Sparks thrown from the impact. Fixed, not random: the same match is the same card. */
	const SPARKS = Array.from({ length: 14 }, (_, i) => ({
		angle: i * (360 / 14) + (i % 2 ? 9 : -4),
		length: i % 3 === 0 ? 30 : 16,
		delay: (i % 4) * 22
	}));

	/** A sixteen-point starburst behind the mark, the "hit" frame of an arcade fighter. */
	const BURST = Array.from({ length: 32 }, (_, i) => {
		const r = i % 2 ? 26 : 118;
		const a = (i * Math.PI) / 16;
		return `${(Math.cos(a) * r).toFixed(1)},${(Math.sin(a) * r).toFixed(1)}`;
	}).join(' ');

	/** When to fight, and whether there is room for crests — measured as the tile nears view. */
	function reveal(node: HTMLElement) {
		const measure = () => (roomy = node.clientWidth >= CREST_MIN_WIDTH);
		return revealOnce(node, {
			settled: measure,
			armed: () => {
				measure();
				stage = 'armed';
			},
			live: () => {
				measure();
				stage = 'live';
			}
		});
	}
</script>

{#snippet crest(href: string, x: number, side: 'home' | 'away', label: string)}
	<!--
		A light chip behind every crest.

		Club crests are drawn for white letterheads: several of these are navy-on-transparent and
		vanish on our navy. The chip is `--peach-hi`, the lightest thing in the palette, so the crest
		reads whatever it is made of — and a crest that 404s leaves a chip that still looks like part
		of the card rather than a broken image.
	-->
	<g class="vs__crest vs__crest--{side}">
		<rect {x} y="76" width="72" height="72" rx="12" fill="var(--peach-hi)" />
		<image
			{href}
			x={x + 8}
			y="84"
			width="56"
			height="56"
			preserveAspectRatio="xMidYMid meet"
			aria-label={label}
		/>
	</g>
{/snippet}

<!--
	`thumb` as well as `vs`: EventTile, StandingCard and WeekendPicks all reach into their thumbnail
	with `:global(.thumb)` — the hover scale, and the rule that turns the tile into a 5.5rem square
	beside the title below 34rem. A card that answered to `.vs` alone would keep its 16:9 box on a
	phone and push the row off the screen.

	`thumb--whole` says the opposite to EventTile: this picture is a composition, not a photograph,
	and cropped to that square it was the middle of two names and half a VS. So a listing tile keeps
	it whole on a phone and pays the height for it — see the rule at the end of EventTile.
-->
<div
	class={['thumb thumb--whole thumb-box vs', kit]}
	class:vs--feature={feature}
	class:vs--armed={stage === 'armed'}
	class:vs--live={stage === 'live'}
	role="img"
	aria-label={tile.label}
	{@attach reveal}
>
	<svg viewBox="0 0 400 225" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
		<defs>
			<pattern id={`vs-dots-${id}`} width="9" height="9" patternUnits="userSpaceOnUse">
				<circle cx="2.2" cy="2.2" r="1.7" fill="var(--peach)" />
			</pattern>
			<linearGradient id={`vs-sweep-${id}`} x1="0" y1="0" x2="1" y2="0">
				<stop offset="0%" stop-color="var(--peach)" stop-opacity="0" />
				<stop offset="50%" stop-color="var(--peach)" stop-opacity="0.22" />
				<stop offset="100%" stop-color="var(--peach)" stop-opacity="0" />
			</linearGradient>
			<linearGradient id={`vs-glint-${id}`} x1="0" y1="0" x2="1" y2="0">
				<stop offset="0%" stop-color="var(--peach-hi)" stop-opacity="0" />
				<stop offset="50%" stop-color="var(--peach-hi)" stop-opacity="0.5" />
				<stop offset="100%" stop-color="var(--peach-hi)" stop-opacity="0" />
			</linearGradient>
			<clipPath id={`vs-field-${id}`}>
				<rect width="400" height="225" />
			</clipPath>
		</defs>

		<g clip-path={`url(#vs-field-${id})`}>
			<!-- Everything that shakes on impact. The navy behind the tile fills the edges it opens. -->
			<g class="vs__stage">
				<rect x="-20" y="-20" width="440" height="265" fill="var(--navy-900)" />
				<!-- The home side's half, a shade nearer the surface. The diagonal is the fixture: two
				     corners, one seam, and the card reads as a confrontation before a word is read.
				     Drawn 20 units past every edge, on the same line, so the shake never shows a gap. -->
				<polygon points="-20,-20 420,-20 420,-11.25 -20,236.25" fill="var(--navy-700)" />
				<rect width="400" height="225" fill={`url(#vs-dots-${id})`} opacity="0.16" />
				<line
					class="vs__seam"
					x1="400"
					y1="0"
					x2="0"
					y2="225"
					pathLength="1"
					stroke="var(--peach)"
					stroke-width="2"
					opacity="0.5"
				/>

				<rect
					class="vs__sweep"
					width="150"
					height="320"
					x="-150"
					y="-48"
					fill={`url(#vs-sweep-${id})`}
				/>
				<rect
					class="vs__sweep vs__sweep--glint"
					width="34"
					height="320"
					x="-90"
					y="-48"
					fill={`url(#vs-glint-${id})`}
				/>

				<!-- Inset frame: the arcade border that says "title card" rather than "photograph". -->
				<rect
					class="vs__frame"
					x="7"
					y="7"
					width="386"
					height="211"
					fill="none"
					stroke="var(--peach)"
					stroke-width="1"
					opacity="0.35"
				/>

				<g transform="translate(200 112)">
					<polygon class="vs__burst" points={BURST} fill="var(--peach)" />
				</g>

				<text
					class="vs__name vs__name--home"
					x="20"
					text-anchor="start"
					style:font-size="{tile.home.fontSize}px"
				>
					{#each homeLines as line (line.line + line.y)}
						<tspan x="20" y={line.y}>{line.line}</tspan>
					{/each}
				</text>

				<text
					class="vs__name vs__name--away"
					x="380"
					text-anchor="end"
					style:font-size="{tile.away.fontSize}px"
				>
					{#each awayLines as line (line.line + line.y)}
						<tspan x="380" y={line.y}>{line.line}</tspan>
					{/each}
				</text>

				{#if tile.grade}
					<text class="vs__grade" x="380" y="30" text-anchor="end">{tile.grade.toUpperCase()}</text>
				{/if}

				{#if crests?.home}
					{@render crest(crests.home, 56, 'home', tile.home.lines.join(' '))}
				{/if}
				{#if crests?.away}
					{@render crest(crests.away, 272, 'away', tile.away.lines.join(' '))}
				{/if}

				<g transform="translate(200 112)">
					<circle class="vs__wave" r="10" fill="none" stroke="var(--peach-hi)" stroke-width="4" />
					<circle
						class="vs__wave vs__wave--late"
						r="10"
						fill="none"
						stroke="var(--peach)"
						stroke-width="2"
					/>
					{#each SPARKS as spark, i (i)}
						<g transform="rotate({spark.angle})">
							<line
								class="vs__spark"
								style:--spark-delay="{spark.delay}ms"
								x1="0"
								y1="0"
								x2={spark.length}
								y2="0"
								stroke="var(--peach-hi)"
								stroke-width="3"
								stroke-linecap="round"
							/>
						</g>
					{/each}

					<g class="vs__mark">
						<path d="M0 -44 L44 0 L0 44 L-44 0 Z" fill="var(--navy-900)" />
						<path
							d="M0 -44 L44 0 L0 44 L-44 0 Z"
							fill="none"
							stroke="var(--peach)"
							stroke-width="2.5"
						/>
						<path
							d="M0 -34 L34 0 L0 34 L-34 0 Z"
							fill="none"
							stroke="var(--peach)"
							stroke-width="1"
							opacity="0.45"
						/>
						<text class="vs__vs" y="13" text-anchor="middle">VS</text>
					</g>
				</g>
			</g>

			<rect class="vs__flash" width="400" height="225" fill="var(--peach-hi)" />
		</g>
	</svg>
</div>

<style>
	/*
	 * Classes, never the bare `text` element: a component rule on an element type outranks a shared
	 * utility in brand.css for every such element inside it, which is how two visually-hidden
	 * radios once got a width.
	 */
	.vs__name {
		font-family: var(--font-display);
		font-weight: 900;
		font-stretch: 125%;
		letter-spacing: -0.02em;
		fill: var(--peach);
	}
	.vs__vs {
		font-family: var(--font-display);
		font-weight: 900;
		font-stretch: 125%;
		font-size: 38px;
		letter-spacing: -0.03em;
		fill: var(--peach-hi);
	}
	.vs__grade {
		font-family: var(--font-mono);
		font-size: 11px;
		font-weight: 700;
		letter-spacing: 0.28em;
		fill: var(--peach-quiet);
	}

	/* Each side comes in from its own edge. */
	.vs__name--home,
	.vs__crest--home {
		--dir: -1;
	}
	.vs__name--away,
	.vs__crest--away {
		--dir: 1;
	}

	/* Spin and scale about their own middles, not the SVG's corner. */
	.vs__name,
	.vs__crest,
	.vs__mark,
	.vs__burst,
	.vs__wave {
		transform-box: fill-box;
		transform-origin: center;
	}
	.vs__seam {
		stroke-dasharray: 1;
		stroke-dashoffset: 0;
	}

	/* Only ever seen mid-animation; every one of them ends invisible. */
	.vs__sweep,
	.vs__burst,
	.vs__wave,
	.vs__spark,
	.vs__flash {
		opacity: 0;
		pointer-events: none;
	}
	.vs__wave {
		vector-effect: non-scaling-stroke;
	}

	/*
	 * Off stage: the script found this tile below the fold. Never in the server HTML — see the
	 * note at the top — so the only person who could see this state is nobody.
	 */
	.vs--armed .vs__name,
	.vs--armed .vs__crest,
	.vs--armed .vs__mark,
	.vs--armed .vs__grade {
		opacity: 0;
	}
	.vs--armed .vs__seam {
		stroke-dashoffset: 1;
	}

	/*
	 * The fight. One timeline, in milliseconds from the tile coming into view:
	 *
	 *     0    the seam slashes corner to corner
	 *     60   both names slam in from their own edges
	 *     160  the crests fly in spinning and collide in the middle
	 *     440  the VS lands from above
	 *     520  impact: flash, shockwave, sparks, starburst, the whole card shakes
	 *     1100 settled — then the shine, every seven seconds from here on
	 *
	 * `both` for what arrives, so a tile is in its first frame from the instant it is live and in
	 * its resting one the instant the keyframes end. `forwards` for the impact — flash, burst,
	 * wave, sparks — whose first frame is visible: under `both` they would hang in the middle of
	 * the card through their whole delay, before anything has hit anything.
	 */
	.vs--live .vs__seam {
		animation: vs-slash 320ms var(--ease-out) both;
	}
	.vs--live .vs__name {
		animation: vs-slam 520ms cubic-bezier(0.2, 0.9, 0.25, 1.15) 60ms both;
	}
	.vs--live .vs__crest {
		animation: vs-crest 760ms cubic-bezier(0.3, 0.7, 0.3, 1) 160ms both;
	}
	.vs--live .vs__mark {
		animation: vs-drop 560ms cubic-bezier(0.5, 0, 0.3, 1.4) 440ms both;
	}
	.vs--live .vs__grade {
		animation: vs-fade 300ms var(--ease-out) 950ms both;
	}
	.vs--live .vs__stage {
		animation: vs-shake 420ms linear 520ms both;
	}
	.vs--live .vs__flash {
		animation: vs-flash 340ms ease-out 520ms forwards;
	}
	.vs--live .vs__burst {
		animation: vs-burst 620ms var(--ease-out) 500ms forwards;
	}
	.vs--live .vs__wave {
		animation: vs-wave 640ms var(--ease-out) 520ms forwards;
	}
	.vs--live .vs__wave--late {
		animation-delay: 640ms;
		animation-duration: 760ms;
	}
	.vs--live .vs__spark {
		animation: vs-spark 520ms var(--ease-out) calc(520ms + var(--spark-delay, 0ms)) forwards;
	}
	.vs--live .vs__sweep {
		animation: vs-shine 7s linear 1100ms infinite both;
	}
	.vs--live .vs__sweep--glint {
		animation-delay: 1180ms;
	}

	/* The page's own card keeps breathing once the fight is over, as it always has. */
	.vs--feature .vs__mark {
		animation: vs-charge 2.6s ease-in-out infinite alternate;
	}
	.vs--feature.vs--live .vs__mark {
		animation:
			vs-drop 560ms cubic-bezier(0.5, 0, 0.3, 1.4) 440ms both,
			vs-charge 2.6s ease-in-out 1000ms infinite alternate;
	}
	.vs--feature .vs__sweep {
		opacity: 1;
		animation: vs-sweep 6s linear infinite;
	}
	.vs--feature .vs__sweep--glint {
		opacity: 0;
		animation: none;
	}
	.vs--feature.vs--live .vs__sweep {
		animation: vs-sweep 6s linear 1100ms infinite both;
	}
	.vs--feature.vs--live .vs__sweep--glint {
		animation: vs-shine 7s linear 1180ms infinite both;
	}

	@keyframes vs-slash {
		from {
			stroke-dashoffset: 1;
			opacity: 1;
		}
		to {
			stroke-dashoffset: 0;
		}
	}
	@keyframes vs-slam {
		from {
			opacity: 0;
			transform: translateX(calc(var(--dir) * 320px)) skewX(calc(var(--dir) * 24deg));
		}
		55% {
			opacity: 1;
			transform: translateX(calc(var(--dir) * -16px)) skewX(calc(var(--dir) * -6deg));
		}
		to {
			opacity: 1;
			transform: none;
		}
	}
	@keyframes vs-crest {
		from {
			opacity: 0;
			transform: translateX(calc(var(--dir) * 260px)) rotate(calc(var(--dir) * 720deg)) scale(0.2);
		}
		/* The collision: both crests overshoot into the mark... */
		48% {
			opacity: 1;
			transform: translateX(calc(var(--dir) * -46px)) rotate(0deg) scale(1.35);
		}
		/* ...and are thrown back by it. */
		68% {
			transform: translateX(calc(var(--dir) * 14px)) rotate(calc(var(--dir) * -8deg)) scale(0.9);
		}
		84% {
			transform: translateX(calc(var(--dir) * -4px)) rotate(calc(var(--dir) * 3deg)) scale(1.04);
		}
		to {
			opacity: 1;
			transform: none;
		}
	}
	@keyframes vs-drop {
		from {
			opacity: 0;
			transform: scale(3.4) rotate(-30deg);
		}
		50% {
			opacity: 1;
			transform: scale(0.82) rotate(6deg);
		}
		to {
			opacity: 1;
			transform: none;
		}
	}
	@keyframes vs-fade {
		from {
			opacity: 0;
		}
		to {
			opacity: 1;
		}
	}
	@keyframes vs-shake {
		0%,
		100% {
			transform: none;
		}
		12% {
			transform: translate(-7px, 4px) rotate(-0.6deg);
		}
		26% {
			transform: translate(6px, -5px) rotate(0.5deg);
		}
		42% {
			transform: translate(-5px, -2px);
		}
		58% {
			transform: translate(4px, 3px);
		}
		76% {
			transform: translate(-2px, 1px);
		}
	}
	@keyframes vs-flash {
		from {
			opacity: 0;
		}
		12% {
			opacity: 0.85;
		}
		to {
			opacity: 0;
		}
	}
	@keyframes vs-burst {
		from {
			opacity: 0;
			transform: scale(0.15) rotate(0deg);
		}
		30% {
			opacity: 0.55;
		}
		to {
			opacity: 0;
			transform: scale(1.7) rotate(24deg);
		}
	}
	@keyframes vs-wave {
		from {
			opacity: 0.95;
			transform: scale(1);
		}
		to {
			opacity: 0;
			transform: scale(26);
		}
	}
	/* Along its own rotated axis, so a translate is all it needs — no origin to get wrong. */
	@keyframes vs-spark {
		from {
			opacity: 1;
			transform: translateX(14px);
		}
		to {
			opacity: 0;
			transform: translateX(190px);
		}
	}
	/* One pass, then parked off the right edge for the rest of the cycle. */
	@keyframes vs-shine {
		from {
			opacity: 1;
			transform: translateX(0) skewX(-30deg);
		}
		16% {
			opacity: 1;
			transform: translateX(640px) skewX(-30deg);
		}
		to {
			opacity: 1;
			transform: translateX(640px) skewX(-30deg);
		}
	}
	@keyframes vs-charge {
		from {
			transform: scale(1);
		}
		to {
			transform: scale(1.06);
		}
	}
	@keyframes vs-sweep {
		from {
			transform: translateX(0) skewX(-30deg);
		}
		to {
			transform: translateX(620px) skewX(-30deg);
		}
	}
</style>
