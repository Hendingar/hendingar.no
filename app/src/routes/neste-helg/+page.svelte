<script lang="ts">
	import WeekendListing from '../../lib/components/WeekendListing.svelte';

	/**
	 * The weekend after the one we are in — planning rather than tonight.
	 *
	 * This URL used to serve the NEAREST weekend, because it was the only weekend page and had to
	 * cover both meanings. Now that `/denne-helga` exists it can mean what it says. The address is
	 * kept rather than retired: it is a day old, it is in the sitemap, and "neste helg" is still
	 * the right name for this page — it is the sense of the words that has been narrowed, not the
	 * page that has moved.
	 *
	 * The body is shared with `/denne-helga` — see WeekendListing.
	 */
</script>

<WeekendListing which="neste" />
