<script lang="ts">
	import WeekendListing from '../../lib/components/WeekendListing.svelte';

	/**
	 * What is on the weekend we are standing in, or walking into.
	 *
	 * The question a local events site is asked most often. It used to live at `/neste-helg`, which
	 * had to answer it under a name that is ambiguous on a Saturday — grammatically "neste helg" is
	 * the weekend after this one, and the page deliberately showed the one you were in so that
	 * somebody opening the site on Saturday afternoon still saw that evening's concerts.
	 *
	 * With both weekends addressable the compromise is gone: this page is "denne helga" and means
	 * it, `/neste-helg` is the one after and means that. Each is honestly named, and the pair says
	 * what is on now and what is coming.
	 *
	 * The body is shared with `/neste-helg` — see WeekendListing.
	 */
</script>

<WeekendListing which="denne" />
