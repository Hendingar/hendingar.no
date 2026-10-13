<script lang="ts">
	import SearchCombo from '../hendingar/SearchCombo.svelte';
	import { waysInCounts } from '../../events.remote';

	/**
	 * The listing's search field, on the front page where the category chips used to be.
	 *
	 * Sixteen chips with a count each were a row of facts to read before the first event, and on a
	 * desktop they ran off the edge of the shell. `/hendingar` replaced its forty chips with this
	 * same field for the same reason, and it covers what the chips did: focus opens the biggest
	 * categories and venues, and anything picked is a link to `/hendingar?…`. It is a GET form to
	 * `/hendingar` before it is a combobox, so it works from here with nothing but HTML.
	 *
	 * Same query as WaysIn, so the placeholder's number and "Alt framover" are one fetch and cannot
	 * disagree.
	 */
	const counts = await waysInCounts();
</script>

<div class="shell find">
	<SearchCombo filters={{}} tokens={[]} total={counts.upcomingCount} />
</div>

<style>
	.find {
		padding-block: clamp(1rem, 2.5vw, 1.5rem) 0;
	}
</style>
