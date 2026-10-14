import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { build, type Plugin } from 'vite';

/**
 * Builds the MCP App view (`src/lib/mcp-view/`) into one self-contained HTML page and offers it to
 * the server as `virtual:hendingar-mcp-view` — a string, ready to serve as the
 * `ui://hendingar/events.html` resource (ADR 0024).
 *
 * Self-contained because of where it runs. A host draws the page in a sandboxed frame with a
 * Content Security Policy built from what the resource declares, and the simplest page to declare
 * is one that loads no script from anywhere. Every byte of script and style is inline; the only
 * network requests are poster images, whose origins the resource lists.
 *
 * A nested Vite build rather than a second toolchain: the same bundler and the same Svelte plugin
 * the site uses, with `configFile: false` so nothing of SvelteKit's config — its CSP, its adapter,
 * its routes — leaks into a page that is not part of the site.
 */

export const VIEW_MODULE_ID = 'virtual:hendingar-mcp-view';
const RESOLVED_ID = `\0${VIEW_MODULE_ID}`;

export function mcpView({ root, viewDir }: { root: string; viewDir: string }): Plugin {
	return {
		name: 'hendingar-mcp-view',
		resolveId(id) {
			return id === VIEW_MODULE_ID ? RESOLVED_ID : undefined;
		},
		async load(id) {
			if (id !== RESOLVED_ID) return undefined;
			// Rebuild when the view changes under `vite dev`.
			for (const file of readdirSync(viewDir)) this.addWatchFile(join(viewDir, file));
			const { js, css } = await bundle(root, join(viewDir, 'main.ts'));
			return `export default ${JSON.stringify(page(js, css))};`;
		}
	};
}

async function bundle(root: string, entry: string): Promise<{ js: string; css: string }> {
	const result = await build({
		configFile: false,
		root,
		logLevel: 'warn',
		// Always a production build, even inside `vite dev`: Svelte's dev runtime made the page
		// 446 KB instead of 337. Most of what remains is the ext-apps SDK and its MCP client and
		// Zod, measured on 2026-10-14 — the cost of speaking the protocol, paid once per chat.
		mode: 'production',
		define: { 'process.env.NODE_ENV': '"production"' },
		plugins: [svelte({ compilerOptions: { css: 'injected', runes: true, dev: false } })],
		build: {
			write: false,
			minify: true,
			cssCodeSplit: false,
			lib: { entry, formats: ['iife'], name: 'hendingarView', fileName: 'view' }
		}
	});
	const outputs = Array.isArray(result) ? result : [result];
	let js = '';
	let css = '';
	for (const out of outputs) {
		if (!('output' in out)) continue;
		for (const file of out.output) {
			if (file.type === 'chunk') js += file.code;
			else if (file.fileName.endsWith('.css')) css += String(file.source);
		}
	}
	if (!js) throw new Error('mcp-view: the bundle produced no script');
	return { js, css };
}

/** `</script>` or `</style>` inside the inlined code would end the element early. */
function inline(code: string, tag: 'script' | 'style'): string {
	return code.replace(new RegExp(`</${tag}`, 'gi'), `<\\/${tag}`);
}

function page(js: string, css: string): string {
	return [
		'<!doctype html>',
		'<html lang="nn">',
		'<head>',
		'<meta charset="utf-8">',
		'<meta name="viewport" content="width=device-width, initial-scale=1">',
		'<title>hendingar.no</title>',
		`<style>${inline(css, 'style')}</style>`,
		'</head>',
		'<body>',
		'<div id="app"></div>',
		`<script>${inline(js, 'script')}</script>`,
		'</body>',
		'</html>'
	].join('\n');
}
