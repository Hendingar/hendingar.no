<script lang="ts">
	import { page } from '$app/state';
	import { canonicalUrl } from '../origin.ts';

	/**
	 * The head of one indexable page: title, description, canonical.
	 *
	 * Written once because these three travel together and were drifting apart when each route
	 * spelled them out. Before this, every route had a title and a description and exactly one had
	 * a canonical — which meant `www`, the apex and `dev` each told a crawler they were the
	 * original of the same page.
	 *
	 * `path` is explicit rather than read from `page.url`, because which query parameters belong in
	 * a canonical is a decision only the route can make: `/kalender?maanad=2026-10` is a page of its
	 * own, `/hendingar?kjelde=stord-kulturhus` is a filtered view of one.
	 *
	 * Pages that must not be indexed — `/hjarta`, `/kø`, the submission receipt — deliberately do
	 * not use this. They set their own title and `robots: noindex`, and a canonical on a page we are
	 * asking search engines to ignore would be contradictory noise.
	 */
	let { title, description, path }: { title: string; description: string; path: string } = $props();
</script>

<svelte:head>
	<title>{title}</title>
	<meta name="description" content={description} />
	<link rel="canonical" href={canonicalUrl(page.url, path)} />
</svelte:head>
