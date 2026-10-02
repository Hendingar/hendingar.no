<script lang="ts">
	/**
	 * A fixture, drawn as a title card.
	 *
	 * ## Why this is drawn and not fetched
	 *
	 * The obvious thumbnail for a match is the two club crests, and fotball.no serves them from
	 * `images.fotball.no/clublogos/<id>.png`. We do not take them. The club ids are only published
	 * on the match page, and `fotball.no/robots.txt` ends with `User-agent: * / Disallow: /` — the
	 * reason `importers/fotball` reads a calendar subscription and never the site. That rule is the
	 * whole basis on which this source is collected, and a thumbnail is not worth spending it.
	 *
	 * So the card is made from what the feed already gave us: two club names and a grade. It costs
	 * no bytes, cannot 404 when somebody reorganises a CDN, and is the same card forever for the
	 * same match — the properties the generated tile beside it was built for.
	 */
	import type { Fixture } from '@hendingar/core/fixture';
	import { fixtureTile } from '../fixture-tile.ts';

	let {
		id,
		fixture,
		feature = false
	}: {
		/** The event id. Only used to keep the SVG's internal ids unique on a page full of tiles. */
		id: number;
		fixture: Fixture;
		/**
		 * The large card on an event's own page, rather than a thumbnail in a grid.
		 *
		 * It is the only one that moves. A hundred cards breathing at once in a listing is not
		 * atmosphere, it is a grid that will not sit still — and `brand.css` already stops all of
		 * it under `prefers-reduced-motion`.
		 */
		feature?: boolean;
	} = $props();

	const tile = $derived(fixtureTile(fixture));

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
	 * Crests only on the card an event page shows, never on a thumbnail in a listing.
	 *
	 * Measured, not taste: NFF's crests are PNGs averaging 33 KB and running to 82 KB, so a pair of
	 * them is five to twenty times what the whole rest of this card costs — and on the 88px row a
	 * phone draws, a crest is four millimetres of mush. The listing keeps the wordmark it already
	 * had, and the page somebody chose to open gets the full thing.
	 */
	const crests = $derived(feature ? { home: tile.home.crest, away: tile.away.crest } : null);
</script>

{#snippet crest(href: string, x: number, label: string)}
	<!--
		A light chip behind every crest.

		Club crests are drawn for white letterheads: several of these are navy-on-transparent and
		vanish on our navy. The chip is `--peach-hi`, the lightest thing in the palette, so the crest
		reads whatever it is made of — and a crest that 404s leaves a chip that still looks like part
		of the card rather than a broken image.
	-->
	<g>
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
-->
<div class="thumb vs" class:vs--feature={feature} role="img" aria-label={tile.label}>
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
			<clipPath id={`vs-field-${id}`}>
				<rect width="400" height="225" />
			</clipPath>
		</defs>

		<g clip-path={`url(#vs-field-${id})`}>
			<rect width="400" height="225" fill="var(--navy-900)" />
			<!-- The home side's half, a shade nearer the surface. The diagonal is the fixture: two
			     corners, one seam, and the card reads as a confrontation before a word is read. -->
			<polygon points="0,0 400,0 0,225" fill="var(--navy-700)" />
			<rect width="400" height="225" fill={`url(#vs-dots-${id})`} opacity="0.16" />
			<line x1="400" y1="0" x2="0" y2="225" stroke="var(--peach)" stroke-width="2" opacity="0.5" />

			<rect
				class="vs__sweep"
				width="150"
				height="320"
				x="-150"
				y="-48"
				fill={`url(#vs-sweep-${id})`}
			/>

			<!-- Inset frame: the arcade border that says "title card" rather than "photograph". -->
			<rect
				x="7"
				y="7"
				width="386"
				height="211"
				fill="none"
				stroke="var(--peach)"
				stroke-width="1"
				opacity="0.35"
			/>

			<text class="vs__name" x="20" text-anchor="start" style:font-size="{tile.home.fontSize}px">
				{#each homeLines as line (line.line + line.y)}
					<tspan x="20" y={line.y}>{line.line}</tspan>
				{/each}
			</text>

			<text class="vs__name" x="380" text-anchor="end" style:font-size="{tile.away.fontSize}px">
				{#each awayLines as line (line.line + line.y)}
					<tspan x="380" y={line.y}>{line.line}</tspan>
				{/each}
			</text>

			{#if tile.grade}
				<text class="vs__grade" x="380" y="30" text-anchor="end">{tile.grade.toUpperCase()}</text>
			{/if}

			{#if crests?.home}
				{@render crest(crests.home, 56, tile.home.lines.join(' '))}
			{/if}
			{#if crests?.away}
				{@render crest(crests.away, 272, tile.away.lines.join(' '))}
			{/if}

			<g transform="translate(200 112)">
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
	</svg>
</div>

<style>
	/*
	 * The box, copied rather than shared.
	 *
	 * `.thumb` is declared in EventThumb's scoped stylesheet, which does not reach an element in
	 * this component — scoping is per component, and the class on the root is only there for the
	 * parents' `:global` rules. These four declarations are the ones a thumbnail needs to be the
	 * same shape as the posters it sits beside.
	 */
	.vs {
		display: block;
		inline-size: 100%;
		block-size: auto;
		aspect-ratio: 16 / 9;
		overflow: hidden;
		background: var(--navy-900);
		border-block-end: var(--rule) solid var(--peach-line);
	}
	.vs svg {
		display: block;
		inline-size: 100%;
		block-size: 100%;
	}

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

	/* Parked off the left edge and still until this is the card on an event's own page. */
	.vs__sweep {
		opacity: 0;
	}

	.vs--feature .vs__mark {
		transform-box: fill-box;
		transform-origin: center;
		animation: vs-charge 2.6s ease-in-out infinite alternate;
	}
	.vs--feature .vs__sweep {
		opacity: 1;
		animation: vs-sweep 6s linear infinite;
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
