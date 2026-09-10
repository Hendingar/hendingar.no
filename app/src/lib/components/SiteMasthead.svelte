<script lang="ts">
	import { page } from '$app/state';
	import { heartedCount, loadHearts } from '../hearts.svelte.ts';
	import { existingClientId } from '../client-id.ts';
	import { mySubmissions } from '../submit.remote';

	type NavItem = { href: string; label: string; count?: number };

	/**
	 * Rank one: the same list, asked four ways.
	 *
	 * The masthead used to be seven links at one size, one colour and one spacing, which said
	 * these were seven unrelated places. They are not. `/hendingar`, `/denne-helga`, `/kalender`
	 * and `/poppis` are four views of one question — what is on — so they read as one group, in
	 * the display face, at full peach.
	 */
	const views: NavItem[] = [
		{ href: '/hendingar', label: 'Hendingar' },
		/*
		 * First after the full list, because it is the question this site is asked most often and
		 * the one it was worst at answering: "what is on this weekend" previously meant opening the
		 * calendar, working out which squares were the weekend, and visiting three day pages.
		 *
		 * A tab rather than a filter on /hendingar. A filter would have to be a URL to be
		 * shareable, and a URL that answers a different question every Monday is not a filter — it
		 * is a page.
		 */
		// One weekend entry, not two. The pair lives as tabs on the weekend pages themselves and as
		// two of the five ways in on the front page; an extra nav item would spend the masthead's
		// width saying "helg" twice. This is the one people ask for — what is on now.
		{ href: '/denne-helga', label: 'Denne helga' },
		// The same events, asked the other way round: "what is on that Saturday" rather than "what
		// is next". Next to Hendingar because they are two views of one list, not two features.
		{ href: '/kalender', label: 'Kalender' },
		// A third view of the same list, ordered by what people engaged with rather than by when.
		// After Kalender because it answers "what is worth going to", which only makes sense once
		// you know what is on at all.
		{ href: '/poppis', label: 'Poppis' }
	];

	/**
	 * Rank two: pages that answer a different question, in the site's micro label.
	 *
	 * Quieter, not lesser. Sitting these beside the four views at the same weight was most of what
	 * made the row unreadable — nothing in it said which links were alternatives to each other.
	 */
	const meta: NavItem[] = [
		// Places rather than events: "what can I do" rather than "what is on". It is exactly that
		// difference that moves it out of rank one.
		{ href: '/alltid-ope', label: 'Alltid ope' },
		// "Datasamling" reads as data collection in the GDPR sense — the wrong question entirely.
		// "Kjelder" is what the page is actually about. The URL is unchanged so existing links hold.
		{ href: '/datasamling', label: 'Kjelder' }
	];

	/**
	 * A section stays marked while you are anywhere inside it.
	 *
	 * `/kalender/2026-09-12` is still the calendar, and an exact pathname match would drop the
	 * marker the moment a reader opened a day — telling them, wrongly, that they had left the
	 * section they are plainly still in.
	 */
	function isCurrent(href: string): boolean {
		const path = page.url.pathname;
		return path === href || path.startsWith(`${href}/`);
	}

	/*
	 * "Hjarta" appears only once this browser has hearted something.
	 *
	 * A permanent empty item would be a promise of a feature the reader has not used, on every page,
	 * forever. It is also client-only by nature: what is hearted lives in localStorage, so the
	 * server cannot know and the item is simply absent from the HTML a crawler sees. That is the
	 * right answer — it is nobody's content but this reader's.
	 */
	$effect(() => loadHearts());
	const hearted = $derived(heartedCount());

	/*
	 * "Kø" appears only when this browser has a submission still waiting on something.
	 *
	 * Same reasoning as Hjarta: an item that is always there, always empty, is a standing promise
	 * of a feature nobody has used. Once everything you sent in is live, the queue is empty and the
	 * item goes away — which is the correct end state, not a missing link.
	 */
	let waiting = $state(0);
	$effect(() => {
		const id = existingClientId();
		if (!id) return;
		void mySubmissions({ clientId: id })
			.then((rows) => {
				waiting = rows.filter((r) => r.outcome !== 'approved').length;
			})
			.catch(() => {
				// A masthead must render. If the count cannot be fetched the item simply stays away.
			});
	});

	/*
	 * The two personal items join rank two rather than getting a rank of their own: they ask a
	 * third kind of question ("what did *I* do here"), but there are at most two of them and they
	 * are usually absent, so a rank that is empty on most visits would be a rank in name only.
	 */
	const secondRank: NavItem[] = $derived([
		...meta,
		...(waiting > 0 ? [{ href: '/ko', label: 'Kø', count: waiting }] : []),
		...(hearted > 0 ? [{ href: '/hjarta', label: 'Hjarta', count: hearted }] : [])
	]);
</script>

<!--
	The whole bar is the navigation landmark, wordmark included.

	It has to be: `Send inn` is styled as the one filled thing in a row of destinations, so it has
	to sit at the far end of the row while being the last thing in the DOM — and grid placement
	only reaches direct children. Putting the wordmark inside `nav` buys that freedom, and a home
	link in the primary menu is where a reader looking for one would go anyway. Three e2e specs
	reach for `Send inn`, `Kjelder` and `Kalender` *inside* this landmark; keep them here.
-->
<header class="mast">
	<nav class="shell mast__inner" aria-label="Hovudmeny">
		<a class="mast__mark display" href="/">hendingar<span class="mast__dot">.no</span></a>

		<ul class="mast__rank mast__rank--views">
			{#each views as link (link.href)}
				<li>
					<a
						class="display display--sm"
						href={link.href}
						aria-current={isCurrent(link.href) ? 'page' : undefined}>{link.label}</a
					>
				</li>
			{/each}
		</ul>

		<ul class="mast__rank mast__rank--meta">
			{#each secondRank as link (link.href)}
				<li>
					<a href={link.href} aria-current={isCurrent(link.href) ? 'page' : undefined}
						>{link.label}{#if link.count !== undefined}<span class="mast__count">{link.count}</span
							>{/if}</a
					>
				</li>
			{/each}
		</ul>

		<!--
			The only action in a bar of destinations, so it is the only filled thing in it. The arrow
			is decorative: the accessible name stays exactly "Send inn", which is what the specs click.
		-->
		<a class="btn btn--solid mast__cta" href="/send-inn">
			Send inn
			<svg
				width="16"
				height="16"
				viewBox="0 0 16 16"
				fill="none"
				stroke="currentColor"
				stroke-width="2.2"
				stroke-linecap="square"
				aria-hidden="true"
			>
				<path d="M2 8h11" />
				<path d="M8.5 3.5 13 8l-4.5 4.5" />
			</svg>
		</a>
	</nav>
</header>

<style>
	.mast {
		border-block-end: var(--rule) solid var(--peach-line);
		padding-block: 0.85rem;
	}

	/*
	 * A grid, not a flex row, and every item placed by area — that is what lets the same four
	 * children be one row on a desktop and three on a phone without reordering the DOM. A flex
	 * `order` would have put keyboard focus somewhere the eye is not.
	 */
	.mast__inner {
		display: grid;
		grid-template-columns: auto auto minmax(0, 1fr) auto;
		grid-template-areas: 'mark views meta cta';
		align-items: center;
		column-gap: 1.5rem;
		row-gap: 0.4rem;
	}

	.mast__mark {
		grid-area: mark;
		font-size: 1.25rem;
		text-decoration: none;
		letter-spacing: -0.01em;
	}
	.mast__dot {
		color: var(--peach-dim);
	}

	.mast__rank {
		position: relative;
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0 1.375rem;
		list-style: none;
		margin: 0;
		padding: 0 0 0 1.5rem;
	}
	.mast__rank--views {
		grid-area: views;
	}
	.mast__rank--meta {
		grid-area: meta;
		justify-self: start;
	}

	/*
	 * The hairline ticks between the three groups.
	 *
	 * Generated content rather than markup — an empty <span> in a menu is one more thing a screen
	 * reader steps over for nothing — and absolutely positioned, so the rule is the height of the
	 * text rather than of the whole row, and so the lists stay free to be placed by grid area.
	 */
	.mast__rank::before {
		content: '';
		position: absolute;
		inset-inline-start: 0;
		inset-block-start: 50%;
		translate: 0 -50%;
		inline-size: var(--rule);
		block-size: 1.5rem;
		background: var(--peach-line);
	}

	.mast__rank a {
		display: block;
		text-decoration: none;
	}

	/* Rank one carries the display face. `.display--sm` sets the weight and width; the size and
	   tracking are the masthead's own, because a nav item is not a heading. */
	.mast__rank--views a {
		padding-block: 0.9rem;
		font-size: 0.9375rem;
		letter-spacing: -0.01em;
	}

	.mast__rank--meta a {
		padding-block: 0.75rem;
		font-family: var(--font-mono);
		/*
		 * A flat 12px, not `--step-micro`, and for the same reason display type is sized in `cqw`
		 * rather than `vw` (docs/brand.md). `--step-micro` is a `vw` step: it grows from 12px to
		 * 13px between 1440px and 1600px while `.shell` stops widening at 1408px, so the row got
		 * *tighter* as the monitor got bigger — measured, this bar was one clean line at 1440 and a
		 * wrapped two at 1920.
		 */
		font-size: 0.75rem;
		font-weight: 700;
		/* 0.16em rather than the label's 0.28em: at 0.22em the second rank alone inked 356px, and
		   the one row it has to share is only 1280px wide at its widest. */
		letter-spacing: 0.16em;
		text-transform: uppercase;
		color: var(--peach-dim);
	}

	.mast__rank a:hover {
		color: var(--peach-hi);
	}

	/* Never colour alone — every one of these also carries aria-current="page". The marker is
	   drawn out of the link's own padding so nothing on the row moves when it appears. */
	.mast__rank a[aria-current='page'] {
		color: var(--peach);
		border-block-end: var(--rule-fat) solid var(--peach);
	}
	.mast__rank--views a[aria-current='page'] {
		padding-block-end: calc(0.9rem - var(--rule-fat));
	}
	.mast__rank--meta a[aria-current='page'] {
		padding-block-end: calc(0.75rem - var(--rule-fat));
	}

	.mast__count {
		margin-inline-start: 0.5em;
		font-weight: 400;
		letter-spacing: 0;
	}

	.mast__cta {
		grid-area: cta;
		display: inline-flex;
		align-items: center;
		gap: 0.75rem;
		/* Same reason as rank two above: `.btn` is sized in `--step-micro`, and a button that grows
		   past 1440px eats the slack this row has none of. */
		font-size: 0.75rem;
	}
	.mast__cta svg {
		flex-shrink: 0;
	}

	/*
	 * One row is a wide-screen layout and cannot be anything else, and the width is measured rather
	 * than guessed. The wordmark, both ranks and the button fit on one line from a 1360px viewport
	 * with Kø and Hjarta both showing (1320px without them); `.shell` caps at 1280px of content
	 * however big the display gets, so this row never has room to spare. 85rem is that 1360px,
	 * which a 1366px laptop clears by six pixels.
	 *
	 * Below it the mark and the button keep the top row — the button is the whole point of the
	 * change, so it does not go under the two ranks — and the ranks stack beneath them. The ticks
	 * go with the row they were dividing: a divider between two things no longer side by side
	 * points at nothing.
	 */
	@media (width < 85rem) {
		.mast__inner {
			grid-template-columns: minmax(0, 1fr) auto;
			grid-template-areas:
				'mark cta'
				'views views'
				'meta meta';
		}
		.mast__rank {
			padding-inline-start: 0;
		}
		.mast__rank::before {
			display: none;
		}
		.mast__rank--meta {
			justify-self: stretch;
		}
	}

	/* Sharing the top row with the wordmark costs the arrow and the fat border first. */
	@media (width < 48rem) {
		.mast__cta {
			gap: 0.5rem;
			padding: 0.65em 1em;
			letter-spacing: 0.16em;
			border-width: var(--rule);
		}
		.mast__cta svg {
			display: none;
		}

		/*
		 * Rank one cannot be one line on a phone — the four labels in the display face want 450px at
		 * 320 — so it is always two, and every pixel of link padding is paid for twice. 0.7rem puts
		 * the masthead at 183px instead of 201px while leaving a 35px target, which is still twice
		 * what the flat row of seven offered.
		 */
		.mast__rank--views a {
			padding-block: 0.7rem;
		}
		.mast__rank--views a[aria-current='page'] {
			padding-block-end: calc(0.7rem - var(--rule-fat));
		}
		.mast__rank--meta a {
			padding-block: 0.65rem;
		}
		.mast__rank--meta a[aria-current='page'] {
			padding-block-end: calc(0.65rem - var(--rule-fat));
		}
	}

	/*
	 * 320px, where "HENDINGAR.NO" at 20px inks 205px of the 280 available and leaves the button
	 * nowhere to go. Only the very narrowest phones pay this; 360px keeps the full mark.
	 */
	@media (width < 22.5rem) {
		.mast__mark {
			font-size: 0.9375rem;
		}
	}
</style>
