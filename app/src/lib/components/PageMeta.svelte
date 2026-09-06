<script lang="ts">
	import { page } from '$app/state';
	import { canonicalUrl } from '../origin.ts';

	/**
	 * The head of one indexable page: title, description, canonical, and what a shared link shows.
	 *
	 * Written once because these travel together and were drifting apart when each route spelled
	 * them out. Before this, every route had a title and a description, exactly one had a
	 * canonical, and none had a `twitter:card` — so a link pasted into a Facebook group or a
	 * Messenger thread arrived as a line of grey text. ADR 0011 already names that link as how
	 * almost everybody gets here.
	 *
	 * `path` is explicit rather than read from `page.url`, because which query parameters belong in
	 * a canonical is a decision only the route can make: `/kalender?maanad=2026-10` is a page of its
	 * own, `/hendingar?kjelde=stord-kulturhus` is a filtered view of one.
	 *
	 * Pages that must not be indexed — `/hjarta`, `/kø`, the submission receipt — deliberately do
	 * not use this. They set their own title and `robots: noindex`, and a canonical on a page we are
	 * asking search engines to ignore would be contradictory noise.
	 */
	let {
		title,
		description,
		path,
		/** An absolute URL. Defaults to the site card at `/og.png`, which every page can use. */
		image,
		imageAlt = 'hendingar.no — kva skjer i Sunnhordland',
		/** `article` for one event, `website` for a listing. Nothing else has a meaning here. */
		type = 'website'
	}: {
		title: string;
		description: string;
		path: string;
		image?: string;
		imageAlt?: string;
		type?: 'website' | 'article';
	} = $props();

	const url = $derived(canonicalUrl(page.url, path));
	const cardImage = $derived(image ?? canonicalUrl(page.url, '/og.png'));
</script>

<svelte:head>
	<title>{title}</title>
	<meta name="description" content={description} />
	<link rel="canonical" href={url} />

	<meta property="og:site_name" content="hendingar.no" />
	<meta property="og:locale" content="nn_NO" />
	<meta property="og:type" content={type} />
	<meta property="og:url" content={url} />
	<meta property="og:title" content={title} />
	<meta property="og:description" content={description} />
	<meta property="og:image" content={cardImage} />
	<!-- Facebook lays out the card before the image has loaded, and without these it guesses. -->
	<meta property="og:image:width" content="1200" />
	<meta property="og:image:height" content="630" />
	<meta property="og:image:alt" content={imageAlt} />

	<!--
		Not only for X. Several scrapers — Slack among them — read `twitter:card` to decide between
		a thumbnail and a full-width image, and fall back to the small one without it.
	-->
	<meta name="twitter:card" content="summary_large_image" />
	<meta name="twitter:title" content={title} />
	<meta name="twitter:description" content={description} />
	<meta name="twitter:image" content={cardImage} />
	<meta name="twitter:image:alt" content={imageAlt} />
</svelte:head>
