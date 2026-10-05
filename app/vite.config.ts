import { defineConfig } from 'vitest/config';
import { playwright } from '@vitest/browser-playwright';
import adapter from '@sveltejs/adapter-node';
import { sveltekit } from '@sveltejs/kit/vite';

export default defineConfig({
	// One .env for the whole workspace, at the repo root. `pnpm db:up` creates it.
	envDir: '..',
	plugins: [
		sveltekit({
			compilerOptions: {
				// Force runes mode for the project, except for libraries. Can be removed in svelte 6.
				runes: ({ filename }) =>
					filename.split(/[/\\]/).includes('node_modules') ? undefined : true,
				experimental: { async: true }
			},
			adapter: adapter(),
			experimental: { remoteFunctions: true },
			/*
			 * What a page may load, and who may frame it.
			 *
			 * The site renders text that strangers wrote — submissions, and fifteen importers'
			 * worth of other people's HTML descriptions — so the question is not whether an
			 * escaping bug will one day exist but what it can do when it does. With this, an
			 * injected <script> does not run: SvelteKit stamps a nonce on its own hydration script
			 * and nothing else has one. Every script the site needs is its own bundle, so `self` is
			 * the whole list.
			 *
			 * Images are the exception, and deliberately: importers hotlink posters from whatever
			 * CDN the source uses, and the submit form previews a photo as a `blob:`. Inline styles
			 * are allowed because Svelte writes `style=` attributes; a style cannot run code.
			 */
			csp: {
				mode: 'auto',
				directives: {
					'default-src': ['self'],
					'script-src': ['self'],
					'style-src': ['self', 'unsafe-inline'],
					'img-src': ['self', 'https:', 'data:', 'blob:'],
					'connect-src': ['self'],
					'font-src': ['self'],
					'object-src': ['none'],
					'base-uri': ['self'],
					'form-action': ['self'],
					'frame-ancestors': ['none']
				}
			}
		})
	],
	test: {
		expect: { requireAssertions: true },
		projects: [
			{
				extends: './vite.config.ts',
				test: {
					name: 'client',
					browser: {
						enabled: true,
						provider: playwright(),
						instances: [{ browser: 'chromium', headless: true }]
					},
					include: ['src/**/*.svelte.{test,spec}.{js,ts}'],
					exclude: ['src/lib/server/**']
				}
			},

			{
				extends: './vite.config.ts',
				test: {
					name: 'server',
					environment: 'node',
					include: ['src/**/*.{test,spec}.{js,ts}'],
					exclude: ['src/**/*.svelte.{test,spec}.{js,ts}']
				}
			}
		]
	}
});
