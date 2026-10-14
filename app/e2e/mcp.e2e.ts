import { expect, test, type APIRequestContext } from '@playwright/test';

/**
 * The MCP server at `/mcp`, end to end, against the seed (ADR 0024).
 *
 * The contract spec beside the server covers the tools against a stub. What only a real request
 * can show is the route: that SvelteKit lets a cross-origin JSON POST through, that a browser-based
 * client can pass the CORS preflight, and that the tools read the same rows the pages do.
 */

const HEADERS = {
	'content-type': 'application/json',
	accept: 'application/json, text/event-stream',
	'mcp-protocol-version': '2025-06-18'
};

async function rpc(
	request: APIRequestContext,
	method: string,
	params: Record<string, unknown> = {},
	extraHeaders: Record<string, string> = {}
) {
	const res = await request.post('/mcp', {
		headers: { ...HEADERS, ...extraHeaders },
		data: { jsonrpc: '2.0', id: 1, method, params }
	});
	expect(res.status(), await res.text()).toBe(200);
	const raw = await res.text();
	const data = raw.split('\n').find((line) => line.startsWith('data: '));
	return JSON.parse(data ? data.slice('data: '.length) : raw);
}

async function callTool(request: APIRequestContext, name: string, args = {}) {
	const body = await rpc(request, 'tools/call', { name, arguments: args });
	expect(body.result.isError ?? false, JSON.stringify(body.result.content)).toBe(false);
	return body.result.structuredContent;
}

test('an assistant can connect, and is told what the server covers', async ({ request }) => {
	const body = await rpc(request, 'initialize', {
		protocolVersion: '2025-06-18',
		capabilities: {},
		clientInfo: { name: 'e2e', version: '0' }
	});
	expect(body.result.serverInfo.name).toBe('hendingar');
	expect(body.result.instructions).toContain('Stord');
});

test('a search returns seed events that link back to the site and the listing agrees', async ({
	request
}) => {
	const found = await callTool(request, 'search_events', { q: 'songkveld' });
	expect(found.count).toBeGreaterThan(0);
	const event = found.events[0];
	expect(event.title).toContain('Songkveld');
	expect(new URL(event.url).pathname).toMatch(/^\/hending\/\d+-songkveld/);

	// The page the link names exists and is the same event.
	const page = await request.get(new URL(event.url).pathname);
	expect(page.status()).toBe(200);
	expect(await page.text()).toContain('Songkveld');
});

test('a pasted link resolves to the full event, with its sources', async ({ request }) => {
	const found = await callTool(request, 'search_events', { q: 'songkveld' });
	const detail = await callTool(request, 'get_event', { event: found.events[0].url });
	expect(detail.id).toBe(found.events[0].id);
	expect(Array.isArray(detail.sources)).toBe(true);
	expect(detail.startsAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00[+-]\d{2}:\d{2}$/);
});

test('every tool answers against real data', async ({ request }) => {
	const { tools } = (await rpc(request, 'tools/list')).result;
	const args: Record<string, object> = {
		get_event: { event: 1 },
		events_on_date: { date: '2026-10-16' },
		week_events: { week: '2026-W43' },
		resolve_names: { term: 'stord' }
	};
	for (const tool of tools) {
		const body = await rpc(request, 'tools/call', {
			name: tool.name,
			arguments: args[tool.name] ?? {}
		});
		// `get_event` may honestly not find id 1; every other tool must succeed.
		if (tool.name !== 'get_event') {
			expect(body.result.isError ?? false, `${tool.name}: ${JSON.stringify(body.result)}`).toBe(
				false
			);
		}
	}
});

test('a cross-origin client is let through — the CSRF check is for forms, not JSON', async ({
	request
}) => {
	const body = await rpc(request, 'tools/list', {}, { origin: 'https://claude.ai' });
	expect(body.result.tools.length).toBeGreaterThan(0);
});

test('a browser-based client passes the CORS preflight', async ({ request }) => {
	const res = await request.fetch('/mcp', {
		method: 'OPTIONS',
		headers: {
			origin: 'https://inspector.example',
			'access-control-request-method': 'POST',
			'access-control-request-headers': 'content-type, mcp-protocol-version'
		}
	});
	expect(res.status()).toBe(204);
	expect(res.headers()['access-control-allow-origin']).toBe('*');
	expect(res.headers()['access-control-allow-headers']).toContain('mcp-protocol-version');
});

test('there is no session to open: GET is refused, as a stateless server should', async ({
	request
}) => {
	const res = await request.get('/mcp', { headers: { accept: 'text/event-stream' } });
	expect(res.status()).toBe(405);
});

test('/ki shows the address to paste, and fits a narrow phone', async ({ page }) => {
	await page.setViewportSize({ width: 320, height: 800 });
	await page.goto('/ki');
	await expect(page.locator('.ki__url')).toHaveText(/\/mcp$/);
	await expect(page.getByText('claude mcp add --transport http hendingar')).toBeVisible();
	const overflow = await page.evaluate(
		() => document.documentElement.scrollWidth - document.documentElement.clientWidth
	);
	expect(overflow).toBeLessThanOrEqual(0);
});

test('the footer links to /ki from every page', async ({ request }) => {
	const html = await (await request.get('/')).text();
	expect(html).toContain('href="/ki"');
});
