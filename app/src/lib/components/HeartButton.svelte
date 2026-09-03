<script lang="ts">
	import {
		ensureClientId,
		forgetHeart,
		isHearted,
		loadHearts,
		rememberHeart
	} from '../hearts.svelte.ts';
	import { toggleHeart } from '../hearts.remote';

	/**
	 * Heart an event, and show how many others have.
	 *
	 * Optimistic: the tap flips the mark and the count immediately, then tells the server. Waiting
	 * for a round trip to acknowledge a heart makes a listing feel broken on a slow connection, and
	 * the worst case here is a number that was briefly off by one.
	 */
	let {
		eventId,
		hearts = 0,
		size = 'normal'
	}: {
		eventId: number;
		hearts?: number;
		size?: 'normal' | 'large';
	} = $props();

	// Read once on the client. During SSR there is no localStorage, so nothing is hearted yet and
	// the button renders in its resting state — which is also what a crawler should see.
	$effect(() => loadHearts());

	/*
	 * Derived from the prop, with a local override once the reader touches it.
	 *
	 * Copying the prop into state would freeze the first value: a listing fetches its counts in bulk
	 * *after* the tiles mount, so every card would sit at zero forever. The override exists only so
	 * an optimistic tap can win over the prop until the server answers.
	 */
	let override = $state<number | null>(null);
	const count = $derived(override ?? hearts);

	const on = $derived(isHearted(eventId));
	const label = $derived(on ? 'Fjern frå hjarta' : 'Legg til i hjarta');

	async function toggle(mouse: MouseEvent) {
		/*
		 * The tile is one big link, so a heart inside it must claim the click for itself or tapping
		 * it navigates to the event instead.
		 */
		mouse.preventDefault();
		mouse.stopPropagation();

		/*
		 * The local list changes immediately, every time, and is never rolled back.
		 *
		 * This used to drop a tap that arrived while a request was in flight, and to undo the local
		 * change if that request failed. Both were wrong, and together they made hearting then
		 * un-hearting quickly leave the event hearted — caught by CI, not locally, because it needs
		 * a slow enough round trip.
		 *
		 * The two halves of this feature are not equal partners. The list is the reader's, and they
		 * just told us what they want it to say; the count is a shared tally we keep on their
		 * behalf. So the tap always wins locally, and only the number waits on the server.
		 */
		const next = !on;
		const changed = next ? rememberHeart(eventId) : forgetHeart(eventId);
		if (!changed) return;

		override = Math.max(0, count + (next ? 1 : -1));

		try {
			const result = await toggleHeart({ eventId, clientId: ensureClientId(), hearted: next });
			/*
			 * Only if this is still the tap being answered.
			 *
			 * Two taps in quick succession produce two requests, and they can land out of order. The
			 * one that matches what the reader currently wants is the one whose number to believe.
			 */
			if (isHearted(eventId) === next) override = result.hearts;
		} catch {
			// The list is already correct. The count may be stale until the next load, which is a
			// far smaller wrong than silently undoing what the reader asked for.
		}
	}
</script>

<button
	type="button"
	class="heart"
	class:heart--on={on}
	class:heart--large={size === 'large'}
	aria-pressed={on}
	aria-label={label}
	title={label}
	onclick={toggle}
>
	<svg class="heart__mark" viewBox="0 0 24 24" aria-hidden="true">
		<path
			d="M12 20.5s-7.5-4.7-7.5-10A4.5 4.5 0 0 1 12 7.6a4.5 4.5 0 0 1 7.5 2.9c0 5.3-7.5 10-7.5 10z"
		/>
	</svg>
	<!-- Zero is not shown. A count of nothing reads as a judgement on the event rather than as an
	     absence of taps, and every event starts there. -->
	{#if count > 0}
		<span class="heart__n">{count}</span>
	{/if}
</button>

<style>
	.heart {
		display: inline-flex;
		align-items: center;
		gap: 0.3rem;
		background: none;
		border: 0;
		padding: 0.25rem;
		cursor: pointer;
		color: var(--peach-dim);
		font-family: var(--font-mono);
		font-size: var(--step-micro);
		line-height: 1;
		transition: color var(--dur-fast) ease;
	}
	.heart:hover,
	.heart:focus-visible {
		color: var(--peach-hi);
	}
	.heart--on {
		color: var(--peach);
	}
	.heart__mark {
		inline-size: 1.15rem;
		block-size: 1.15rem;
		/* Outline until hearted, filled after: the state has to be readable without colour alone. */
		fill: none;
		stroke: currentColor;
		stroke-width: 1.7;
		stroke-linejoin: round;
		transition:
			fill var(--dur-fast) ease,
			transform var(--dur-fast) var(--ease-out);
	}
	.heart--on .heart__mark {
		fill: currentColor;
	}

	/*
	 * The pop is on the mark, not the button.
	 *
	 * Scaling the whole button would shift the count beside it, and a number that jumps while it is
	 * changing is exactly the thing a reader is trying to read. `--ease-spring` overshoots slightly,
	 * which is what makes a tap feel answered rather than merely registered.
	 */
	.heart--on .heart__mark {
		animation: heart-pop var(--dur-base) var(--ease-spring);
	}

	@keyframes heart-pop {
		0% {
			transform: scale(1);
		}
		45% {
			transform: scale(1.32);
		}
		100% {
			transform: scale(1);
		}
	}

	.heart:active .heart__mark {
		transform: scale(0.88);
	}

	.heart__n {
		/* Slides up as it lands, so an incrementing number reads as a change rather than a redraw. */
		animation: rise var(--dur-base) var(--ease-out) both;
	}
	.heart--large .heart__mark {
		inline-size: 1.5rem;
		block-size: 1.5rem;
	}
	.heart--large {
		font-size: var(--step-body);
	}
</style>
