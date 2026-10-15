<script lang="ts">
	import { listSentence } from '@hendingar/core/prose';
	/**
	 * A graded trip with no photo, drawn as the mountain it climbs.
	 *
	 * DNT tells us two things about every trip before anyone reads its description: how hard it is
	 * (Enkel, Middels, Krevjande, Ekspert) and who it suits. This card is those two facts made into
	 * a picture. The grade picks the mountain — rolling hills for Enkel, a snow-capped jag for
	 * Krevjande — and the number of turns in the path up it; the grade's own trail-sign colour is on
	 * the chip and the summit flag; the audiences are drawn as figures beside it. See
	 * `trail-scene.ts` for the geometry and core's `trail.ts` for the vocabulary.
	 *
	 * It plays once when it scrolls into view — the ridges rise, the path draws itself from the
	 * trailhead, the red T marks are painted on in walking order and the flag goes up on the top —
	 * and then only a cloud drifts and the flag stirs. The rules for when, and why nobody without
	 * JavaScript ever sees a half-drawn card, are in `reveal-once.ts`.
	 */
	import {
		TRAIL_AUDIENCE_LABELS,
		TRAIL_GRADE_LABELS,
		type Trail,
		type TrailAudience
	} from '@hendingar/core/trail';
	import { revealOnce } from '../reveal-once.ts';
	import { SAFE, trailScene } from '../trail-scene.ts';

	let {
		id,
		trail,
		feature = false
	}: {
		/** The event id: seeds the mountain, and keeps the SVG's internal ids unique on a page. */
		id: number;
		trail: Trail;
		/** The large card on an event's own page rather than a thumbnail in a grid. */
		feature?: boolean;
	} = $props();

	const scene = $derived(trailScene(id, trail));
	const gradeLabel = $derived(trail.grade ? TRAIL_GRADE_LABELS[trail.grade] : null);

	/** "Tur, middels, for vaksne og seniorar" — every glyph on the card, said once. */
	const label = $derived.by(() => {
		const who = trail.audiences.map((a) => TRAIL_AUDIENCE_LABELS[a].toLowerCase());
		const list = listSentence(who);
		return ['Tur', gradeLabel?.toLowerCase(), list ? `for ${list}` : null]
			.filter(Boolean)
			.join(', ');
	});

	/*
	 * The grade chip's width, from the label: Space Mono advances 0.6em, and the letter-spacing
	 * adds its own. Estimated wide so the word never touches the edge of its chip.
	 */
	const CHIP_FONT = 10;
	const chipWidth = $derived(gradeLabel ? gradeLabel.length * CHIP_FONT * 0.82 + 18 : 0);
	const ICON = 22;

	/** The path draws from 600ms for 900ms; a T mark is painted the moment the path reaches it. */
	const WALK_START = 600;
	const WALK_MS = 900;

	/*
	 * The chips sit bottom-right, right-aligned to the safe band: the top-left of every card holds
	 * the "om 2 t" badge and the top-right the heart, and both cover whatever is drawn under them.
	 */
	const chipsWidth = $derived(
		(gradeLabel ? chipWidth : 0) +
			(gradeLabel && trail.audiences.length > 0 ? 6 : 0) +
			trail.audiences.length * (ICON + 4) -
			(trail.audiences.length > 0 ? 4 : 0)
	);
	const chipsX = $derived(SAFE.right - chipsWidth);
	const CHIPS_Y = 191;

	let stage = $state<'rest' | 'armed' | 'live'>('rest');

	function reveal(node: HTMLElement) {
		return revealOnce(node, {
			settled: () => {},
			armed: () => (stage = 'armed'),
			live: () => (stage = 'live')
		});
	}
</script>

<!--
	One glyph per audience, drawn on a 16-unit grid in plain strokes. Figures rather than words:
	"Seniorar" does not fit beside "Krevjande" on a 300px card, and a person with a walking stick
	does. The words are in the card's label, and on the event page.
-->
{#snippet figure(audience: TrailAudience)}
	{#if audience === 'barn'}
		<circle cx="5.5" cy="3.4" r="2" />
		<path d="M5.5 5.8v5M5.5 10.8 3 15M5.5 10.8 8 15M2.6 8h5.8" />
		<circle cx="12" cy="7.6" r="1.5" />
		<path d="M12 9.4v3.2M12 12.6l-1.6 2.4M12 12.6l1.6 2.4M10.2 10.8h3.6" />
	{:else if audience === 'ungdom'}
		<circle cx="8" cy="3.2" r="2" />
		<path d="M8 5.6v5.4M8 11l-2.6 4M8 11l2.6 4M5 8.2h6" />
		<rect x="9.6" y="5.8" width="3.4" height="4.6" rx="0.8" />
	{:else if audience === 'seniorar'}
		<circle cx="7" cy="3.2" r="2" />
		<path d="M7.4 5.6l.6 5.4M8 11l-2.4 4M8 11l2 4M7.6 8.2l4.2 1.2" />
		<path d="M12 9.2 13 15" />
	{:else if audience === 'tilrettelagt'}
		<circle cx="7.4" cy="2.8" r="1.8" />
		<path d="M7.4 5v4.6h4l1.6 4" />
		<circle cx="7.2" cy="11.4" r="3.6" />
	{:else}
		<circle cx="8" cy="3.2" r="2" />
		<path d="M8 5.6v5.4M8 11l-2.6 4M8 11l2.6 4M5 8.2h6" />
	{/if}
{/snippet}

<!-- `thumb` for the parents' `:global(.thumb)` rules — see VersusTile for the whole reason. -->
<div
	class={['thumb tt', trail.grade ? `tt--${trail.grade}` : 'tt--ungraded']}
	class:tt--feature={feature}
	class:tt--armed={stage === 'armed'}
	class:tt--live={stage === 'live'}
	role="img"
	aria-label={label}
	{@attach reveal}
>
	<svg viewBox="0 0 400 225" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
		<defs>
			<pattern id={`tt-dots-${id}`} width="9" height="9" patternUnits="userSpaceOnUse">
				<circle cx="2.2" cy="2.2" r="1.2" fill="var(--peach)" />
			</pattern>
			<linearGradient id={`tt-sky-${id}`} x1="0" y1="0" x2="0" y2="1">
				<stop offset="0%" stop-color="var(--navy-900)" />
				<stop offset="100%" stop-color="var(--navy-700)" />
			</linearGradient>
			<!-- The path is dashed, so it cannot draw itself with its own dash offset. A solid
			     twin in a mask does the drawing, and the dashes show through it. -->
			<mask id={`tt-walk-${id}`} maskUnits="userSpaceOnUse" x="0" y="0" width="400" height="225">
				<path
					class="tt__walk"
					d={scene.path}
					pathLength="1"
					fill="none"
					stroke="white"
					stroke-width="10"
					stroke-linecap="round"
					stroke-linejoin="round"
				/>
			</mask>
			<clipPath id={`tt-field-${id}`}>
				<rect width="400" height="225" />
			</clipPath>
		</defs>

		<g clip-path={`url(#tt-field-${id})`}>
			<rect width="400" height="225" fill={`url(#tt-sky-${id})`} />
			<rect width="400" height="225" fill={`url(#tt-dots-${id})`} opacity="0.08" />

			<circle class="tt__sun" cx={scene.sun.x} cy={scene.sun.y} r="15" fill="var(--peach)" />

			<!-- Placed by the attribute, moved by CSS: a CSS transform replaces an SVG one outright. -->
			<g transform="translate({scene.cloud.x} {scene.cloud.y})">
				<g class="tt__cloud">
					<ellipse rx="26" ry="7" fill="var(--peach-wash-3)" />
					<ellipse cx="-10" cy="-5" rx="12" ry="7" fill="var(--peach-wash-3)" />
					<ellipse cx="9" cy="-6" rx="10" ry="6" fill="var(--peach-wash-2)" />
				</g>
			</g>

			<path class="tt__ridge tt__ridge--far" d={scene.far} fill="var(--navy-700)" />
			<g class="tt__ridge tt__ridge--mid">
				<path d={scene.mid} fill="var(--navy-600)" stroke="var(--peach-line)" stroke-width="1" />
				{#each scene.snow as cap, i (i)}
					<path class="tt__snow" d={cap} fill="var(--paper)" opacity="0.9" />
				{/each}
				<path
					d={scene.path}
					fill="none"
					stroke="var(--peach-hi)"
					stroke-width="2.4"
					stroke-dasharray="5 4"
					stroke-linecap="round"
					mask={`url(#tt-walk-${id})`}
				/>
				{#each scene.marks as mark, i (i)}
					<g transform="translate({mark.x} {mark.y})">
						<g class="tt__mark" style:--mark-delay="{Math.round(WALK_START + WALK_MS * mark.at)}ms">
							<rect x="-5" y="-5" width="10" height="10" rx="2" fill="var(--paper)" />
							<path d="M-3 -2.6h6M0 -2.6v5.4" stroke="var(--trail-mark)" stroke-width="2.2" />
						</g>
					</g>
				{/each}
				<g transform="translate({scene.summit.x} {scene.summit.y})">
					<g class="tt__flag">
						<line y1="0" y2="-24" stroke="var(--peach-hi)" stroke-width="1.6" />
						<path class="tt__cloth" d="M0 -24 L16 -19 L0 -14 Z" fill="var(--grade)" />
					</g>
				</g>
			</g>
			<path class="tt__ridge tt__ridge--near" d={scene.near} fill="var(--navy-900)" />

			<g class="tt__chips">
				{#if gradeLabel}
					<rect
						class="tt__chip"
						x={chipsX}
						y={CHIPS_Y}
						width={chipWidth}
						height={ICON}
						rx="3"
						fill="var(--grade)"
					/>
					<text class="tt__grade" x={chipsX + 9} y={CHIPS_Y + 15}>{gradeLabel.toUpperCase()}</text>
				{/if}
				{#each trail.audiences as audience, i (audience)}
					<g
						transform="translate({chipsX +
							(gradeLabel ? chipWidth + 6 : 0) +
							i * (ICON + 4)} {CHIPS_Y})"
					>
						<rect
							width={ICON}
							height={ICON}
							rx="3"
							fill="var(--navy-900)"
							stroke="var(--peach-line)"
						/>
						<g
							class="tt__figure"
							transform="translate(3 3)"
							fill="none"
							stroke="var(--peach-hi)"
							stroke-width="1.5"
							stroke-linecap="round"
							stroke-linejoin="round"
						>
							{@render figure(audience)}
						</g>
					</g>
				{/each}
			</g>
		</g>
	</svg>
</div>

<style>
	/* The box, as VersusTile has it: same shape as the posters beside it. */
	.tt {
		display: block;
		inline-size: 100%;
		block-size: auto;
		aspect-ratio: 16 / 9;
		overflow: hidden;
		background: var(--navy-900);
		border-block-end: var(--rule) solid var(--peach-line);
	}
	.tt svg {
		display: block;
		inline-size: 100%;
		block-size: 100%;
	}

	.tt--enkel {
		--grade: var(--trail-enkel);
	}
	.tt--middels {
		--grade: var(--trail-middels);
	}
	.tt--krevende {
		--grade: var(--trail-krevende);
	}
	.tt--ekspert {
		--grade: var(--trail-ekspert);
	}
	.tt--ungraded {
		--grade: var(--peach);
	}

	/* Black is DNT's Ekspert, and black on navy needs an edge to be a chip at all. */
	.tt--ekspert .tt__chip,
	.tt--ekspert .tt__cloth {
		stroke: var(--peach);
		stroke-width: 1;
	}

	.tt__grade {
		font-family: var(--font-mono);
		font-size: 10px;
		font-weight: 700;
		letter-spacing: 0.16em;
		fill: var(--paper);
	}
	.tt--ungraded .tt__grade {
		fill: var(--navy-900);
	}

	.tt__ridge,
	.tt__mark,
	.tt__flag,
	.tt__sun,
	.tt__chips {
		transform-box: fill-box;
	}
	.tt__mark {
		transform-origin: center;
	}
	.tt__flag {
		transform-origin: bottom center;
	}
	.tt__cloth {
		transform-box: fill-box;
		transform-origin: left center;
	}
	.tt__walk {
		stroke-dasharray: 1;
		stroke-dashoffset: 0;
	}

	/* Off stage, below the fold: see reveal-once.ts for why nobody can see this state. */
	.tt--armed .tt__ridge,
	.tt--armed .tt__sun,
	.tt--armed .tt__mark,
	.tt--armed .tt__flag,
	.tt--armed .tt__chips,
	.tt--armed .tt__snow {
		opacity: 0;
	}
	.tt--armed .tt__walk {
		stroke-dashoffset: 1;
	}

	/*
	 * The climb, in milliseconds from the tile coming into view:
	 *
	 *     0    the far ridge and the sun rise
	 *     120  the mountain rises
	 *     240  the foreground hill rises
	 *     300  the chips slide in
	 *     520  snow settles on the tops
	 *     600  the path draws itself from the trailhead
	 *     600+ each T mark is painted as the drawn path reaches it
	 *     1500 the flag goes up on the summit — and from then on it stirs, and the cloud drifts
	 */
	.tt--live .tt__ridge {
		animation: tt-rise 700ms var(--ease-out) both;
	}
	.tt--live .tt__ridge--mid {
		animation-delay: 120ms;
		animation-duration: 820ms;
	}
	.tt--live .tt__ridge--near {
		animation-delay: 240ms;
	}
	.tt--live .tt__sun {
		animation: tt-sun 1400ms var(--ease-out) both;
	}
	.tt--live .tt__chips {
		animation: tt-chips 520ms var(--ease-spring) 300ms both;
	}
	.tt--live .tt__snow {
		animation: tt-fade 500ms var(--ease-out) 520ms both;
	}
	.tt--live .tt__walk {
		animation: tt-walk 900ms cubic-bezier(0.45, 0, 0.35, 1) 600ms both;
	}
	.tt--live .tt__mark {
		animation: tt-paint 360ms var(--ease-spring) var(--mark-delay, 700ms) both;
	}
	.tt--live .tt__flag {
		animation: tt-flag 460ms var(--ease-spring) 1500ms both;
	}
	.tt--live .tt__cloth,
	.tt--feature .tt__cloth {
		animation: tt-stir 1.8s ease-in-out 1960ms infinite alternate;
	}
	.tt--live .tt__cloud,
	.tt--feature .tt__cloud {
		animation: tt-drift 14s ease-in-out infinite alternate;
	}

	@keyframes tt-rise {
		from {
			opacity: 0;
			transform: translateY(60px);
		}
		to {
			opacity: 1;
			transform: none;
		}
	}
	@keyframes tt-sun {
		from {
			opacity: 0;
			transform: translateY(70px);
		}
		to {
			opacity: 1;
			transform: none;
		}
	}
	@keyframes tt-chips {
		from {
			opacity: 0;
			transform: translateX(-40px);
		}
		to {
			opacity: 1;
			transform: none;
		}
	}
	@keyframes tt-fade {
		from {
			opacity: 0;
		}
		to {
			opacity: 0.9;
		}
	}
	@keyframes tt-walk {
		from {
			stroke-dashoffset: 1;
		}
		to {
			stroke-dashoffset: 0;
		}
	}
	@keyframes tt-paint {
		from {
			opacity: 0;
			transform: scale(0) rotate(-40deg);
		}
		to {
			opacity: 1;
			transform: none;
		}
	}
	@keyframes tt-flag {
		from {
			opacity: 0;
			transform: scaleY(0);
		}
		to {
			opacity: 1;
			transform: none;
		}
	}
	@keyframes tt-stir {
		from {
			transform: skewY(0deg) scaleX(1);
		}
		to {
			transform: skewY(-8deg) scaleX(0.86);
		}
	}
	@keyframes tt-drift {
		from {
			transform: translateX(-24px);
		}
		to {
			transform: translateX(24px);
		}
	}
</style>
