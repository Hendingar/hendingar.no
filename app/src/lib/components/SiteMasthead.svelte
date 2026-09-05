<script lang="ts">
	import { page } from '$app/state';
	import { heartedCount, loadHearts } from '../hearts.svelte.ts';
	import { existingClientId } from '../client-id.ts';
	import { mySubmissions } from '../submit.remote';

	/**
	 * Site-wide navigation. The site had none: /datasamling and /hendingar were reachable only from
	 * the footer, and the wordmark only existed as the giant hero type on the front page.
	 */
	const links = [
		{ href: '/hendingar', label: 'Hendingar' },
		// The same events, asked the other way round: "what is on that Saturday" rather than "what
		// is next". Next to Hendingar because they are two views of one list, not two features.
		{ href: '/kalender', label: 'Kalender' },
		// "Datasamling" reads as data collection in the GDPR sense — the wrong question entirely.
		// "Kjelder" is what the page is actually about. The URL is unchanged so existing links hold.
		{ href: '/datasamling', label: 'Kjelder' },
		{ href: '/send-inn', label: 'Send inn' }
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
</script>

<header class="mast">
	<div class="shell mast__inner">
		<a class="mast__mark display" href="/">hendingar<span class="mast__dot">.no</span></a>
		<nav aria-label="Hovudmeny">
			<ul>
				{#each links as link (link.href)}
					<li>
						<a href={link.href} aria-current={isCurrent(link.href) ? 'page' : undefined}>
							{link.label}
						</a>
					</li>
				{/each}
				{#if waiting > 0}
					<li>
						<a href="/ko" aria-current={page.url.pathname === '/ko' ? 'page' : undefined}>
							Kø <span class="mast__count">{waiting}</span>
						</a>
					</li>
				{/if}
				{#if hearted > 0}
					<li>
						<a href="/hjarta" aria-current={page.url.pathname === '/hjarta' ? 'page' : undefined}>
							Hjarta <span class="mast__count">{hearted}</span>
						</a>
					</li>
				{/if}
			</ul>
		</nav>
	</div>
</header>

<style>
	.mast {
		border-block-end: var(--rule) solid var(--peach-line);
		padding-block: 0.85rem;
	}
	.mast__inner {
		display: flex;
		flex-wrap: wrap;
		gap: 0.75rem 1.5rem;
		align-items: baseline;
		justify-content: space-between;
	}
	.mast__mark {
		font-size: 1.25rem;
		text-decoration: none;
		letter-spacing: -0.01em;
	}
	.mast__dot {
		color: var(--peach-dim);
	}
	.mast__count {
		font-family: var(--font-mono);
		font-size: var(--step-micro);
		color: var(--peach-dim);
	}
	nav ul {
		display: flex;
		flex-wrap: wrap;
		gap: 1.25rem;
		list-style: none;
		margin: 0;
		padding: 0;
	}
	nav a {
		font-family: var(--font-mono);
		font-size: var(--step-micro);
		font-weight: 700;
		letter-spacing: 0.22em;
		text-transform: uppercase;
		text-decoration: none;
		color: var(--peach-dim);
	}
	nav a:hover {
		color: var(--peach);
	}
	nav a[aria-current='page'] {
		color: var(--peach);
		border-block-end: var(--rule-fat) solid var(--peach);
		padding-block-end: 0.2em;
	}
</style>
