<script lang="ts">
	import { page } from '$app/state';

	/**
	 * Site-wide navigation. The site had none: /datasamling and /hendingar were reachable only from
	 * the footer, and the wordmark only existed as the giant hero type on the front page.
	 */
	const links = [
		{ href: '/hendingar', label: 'Hendingar' },
		// "Datasamling" reads as data collection in the GDPR sense — the wrong question entirely.
		// "Kjelder" is what the page is actually about. The URL is unchanged so existing links hold.
		{ href: '/datasamling', label: 'Kjelder' },
		{ href: '/send-inn', label: 'Send inn' }
	];
</script>

<header class="mast">
	<div class="shell mast__inner">
		<a class="mast__mark display" href="/">hendingar<span class="mast__dot">.no</span></a>
		<nav aria-label="Hovudmeny">
			<ul>
				{#each links as link (link.href)}
					<li>
						<a href={link.href} aria-current={page.url.pathname === link.href ? 'page' : undefined}>
							{link.label}
						</a>
					</li>
				{/each}
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
