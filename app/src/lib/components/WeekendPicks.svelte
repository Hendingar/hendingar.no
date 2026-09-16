<script lang="ts">
	import { formatEventTime } from '@hendingar/core/datetime';
	import { eventPath } from '@hendingar/core/slug';
	import EventThumb from './EventThumb.svelte';
	import type { WeekendPick } from '../server/kurator';

	/**
	 * What the kurator would go to this weekend, and why (ADR 0018).
	 *
	 * Presented as an opinion, because that is what it is. Every other ordering on this site is
	 * arithmetic — soonest first, most hearted, most opened — and each of those can be checked. This
	 * one cannot, so it carries its reasoning on its face: two or three sentences a reader can
	 * disagree with beat a badge saying "anbefalt" that explains nothing.
	 *
	 * **It has to look chosen.** The first version was a left rule and three paragraphs, which read
	 * as a bulleted list of the listing below rather than as a selection out of it — the one thing
	 * it must not look like, since the whole claim is that somebody went through 54 events and came
	 * back with three. So: the poster, framed, with the pick's number set large against it. The
	 * numeral is the oldest curation signal there is, and the vocabulary is already ours —
	 * `docs/brand.md` on hairline frames and `--peach-quiet` for large display numerals.
	 *
	 * The picture is `EventThumb`, the same component the listing uses, so a pick with no usable
	 * poster gets the generated duotone tile rather than a hole. That matters more here than on a
	 * tile: most sources report `imageRightsVerified: false`, so in practice the generated tile *is*
	 * the picture, and a design that only works with photographs would be a design that mostly does
	 * not work.
	 *
	 * Three deliberate absences. No score and no stars, because nothing here is measured. No heart
	 * or view counts, because the kurator was never told them and a number would imply it was. And
	 * no claim to completeness: this sits above the full listing and never replaces it.
	 */
	let { picks }: { picks: readonly WeekendPick[] } = $props();

	/**
	 * How wide a pick's poster is actually painted, per breakpoint — measured against the grid
	 * below, not guessed, and not the tile's numbers.
	 *
	 * The shell is `min(88rem, 100vw)` with `padding-inline: clamp(1.25rem, 4vw, 4rem)`. The grid
	 * is `auto-fit` over `minmax(17rem, 1fr)`, so it is one column until about 44rem, two until
	 * about 70rem, and three above that — where the card lands near 420px at the capped shell.
	 * Each entry rounds up so the browser never picks a candidate too small for the slot.
	 */
	const SIZES = '(width < 44rem) 92vw, (width < 70rem) 46vw, 420px';

	/**
	 * How many picks there are, in words — derived, never written into the sentence.
	 *
	 * The first version of this lede began "Tre av alt som skjer", and the first live selection had
	 * two: the kurator chose three and the fact-checker struck one for claiming a film had
	 * "internasjonal anerkjenning". So the page opened by miscounting the two things printed
	 * directly beneath it.
	 *
	 * That is the same failure as the note in `kurator.py`, which also described a selection made
	 * before the audit had spoken, and it is the second time a hardcoded count on this feature has
	 * been falsified by the feature working correctly. The section is three items long at most;
	 * there is no excuse for a number in it that was not counted.
	 */
	const COUNTS = ['Ingen', 'Éi hending', 'To hendingar', 'Tre hendingar'] as const;
	const counted = $derived(COUNTS[picks.length] ?? `${picks.length} hendingar`);
</script>

{#if picks.length > 0}
	<section class="picks" aria-labelledby="picks-h">
		<div class="picks__head">
			<p class="label" id="picks-h">Kuratoren si helg</p>
			<p class="picks__lede">
				<span class="picks__em">{counted}</span> valde ut av alt som skjer denne helga, av ein AI-kurator
				som ikkje veit kva som er populært — berre kva som står i oppføringane. Han grunngjev kvart val,
				så du kan vere usamd.
			</p>
		</div>

		<ol class="picks__list">
			{#each picks as pick (pick.eventId)}
				<li class="pick">
					<!--
						Poster and title share one stretched link, the way a tile does: the heading
						stays a heading, the anchor is named by the title rather than by "les meir",
						and the picture is clickable without a second link to the same place.

						The reason below is deliberately outside it. A tile stretches its link over
						the whole card, but there is no prose on a tile — here the reasoning is the
						offer, and text nobody can select or drag over is a poor way to present an
						argument somebody is meant to weigh.
					-->
					<div class="pick__head">
						<div class="pick__frame frame">
							<EventThumb
								id={pick.eventId}
								posterUrl={pick.posterUrl}
								posterSrcset={pick.posterSrcset}
								title={pick.title}
								sizes={SIZES}
							/>
							<!--
								The numeral sits on a solid chip, never straight on the picture.
								`docs/brand.md`: the halftone never sits behind text without a solid
								backing, and a poster is a less predictable ground than the halftone.
							-->
							<p class="pick__n" aria-hidden="true">{String(pick.rank).padStart(2, '0')}</p>
						</div>
						<h3 class="display display--md pick__title">
							<a class="pick__link" href={eventPath(pick.eventId, pick.title)}>{pick.title}</a>
						</h3>
					</div>
					<p class="pick__meta">
						{formatEventTime(pick.startsAt, pick.venueTimeZone) +
							(pick.venueName ? ` · ${pick.venueName}` : '')}
					</p>
					<p class="pick__reason">{pick.reason}</p>
				</li>
			{/each}
		</ol>
	</section>
{/if}

<style>
	.picks {
		display: grid;
		gap: clamp(1rem, 2.5vw, 1.75rem);
		margin-block: clamp(1rem, 3vw, 2rem) clamp(1.75rem, 4vw, 3rem);
		padding-block-start: clamp(1rem, 2.5vw, 1.5rem);
		border-top: var(--rule-fat) solid var(--peach);
		/* Display type is sized against its own container, never the viewport — docs/brand.md. */
		container-type: inline-size;
	}
	.picks__head {
		display: grid;
		gap: 0.5rem;
	}
	.picks__lede {
		margin: 0;
		max-inline-size: 58ch;
		color: var(--peach-dim);
	}
	.picks__em {
		/* The contrast the section turns on: this handful, out of everything below. */
		color: var(--peach);
		font-style: italic;
	}
	.picks__list {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: clamp(1.25rem, 3vw, 2rem);
		grid-template-columns: repeat(auto-fit, minmax(17rem, 1fr));
	}
	.pick {
		display: grid;
		gap: 0.45rem;
		align-content: start;
	}
	.pick__head {
		position: relative;
		display: grid;
		gap: 0.6rem;
	}
	.pick__link {
		color: inherit;
		text-decoration: none;
	}
	/* Stretched over the poster and the title, so the picture is part of the same one link. */
	.pick__link::after {
		content: '';
		position: absolute;
		inset: 0;
	}
	.pick__frame {
		position: relative;
		overflow: hidden;
		/* The poster is the point, so it gets the whole width and a real aspect. */
		aspect-ratio: 16 / 9;
	}
	.pick__frame :global(.thumb) {
		display: block;
		inline-size: 100%;
		block-size: 100%;
		object-fit: cover;
		/* The frame already draws the hairline; EventThumb's own bottom rule would double it. */
		border-block-end: 0;
		transition: transform var(--dur-base) ease;
	}
	.pick__head:hover .pick__frame :global(.thumb) {
		transform: scale(1.03);
	}
	.pick__n {
		position: absolute;
		inset-block-start: 0;
		inset-inline-start: 0;
		margin: 0;
		padding: 0.15em 0.5em 0.1em;
		background: var(--navy-900);
		font-family: var(--font-display);
		font-weight: 900;
		font-stretch: 112%;
		/* `--peach-quiet` is for large display numerals only — this is one. */
		color: var(--peach-quiet);
		font-size: clamp(1.75rem, 7cqw, 2.75rem);
		line-height: 1;
	}
	.pick__title {
		margin: 0;
		font-size: clamp(1.15rem, 3.4cqw, 1.6rem);
		line-height: 1.02;
		overflow-wrap: anywhere;
	}
	.pick__link:hover {
		color: var(--peach-hi);
	}
	.pick__meta {
		margin: 0;
		font-family: var(--font-mono);
		font-size: var(--step-micro);
		color: var(--peach-dim);
	}
	.pick__reason {
		margin: 0;
		max-inline-size: 46ch;
	}

	@media (prefers-reduced-motion: reduce) {
		.pick__frame :global(.thumb),
		.pick__head:hover .pick__frame :global(.thumb) {
			transition: none;
			transform: none;
		}
	}
</style>
