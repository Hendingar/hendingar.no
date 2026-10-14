import { createMcpHandler } from '@modelcontextprotocol/server';
import { getRequestEvent } from '$app/server';
import { originFor } from '../../lib/origin.ts';
import { allow, TOO_MANY } from '../../lib/server/limits.ts';
import { liveCatalogue } from '../../lib/server/mcp/catalogue.ts';
import { buildMcpServer } from '../../lib/server/mcp/server.ts';
import type { RequestHandler } from './$types';

/**
 * hendingar.no as an MCP server — what somebody pastes into Claude, ChatGPT or Cursor so their
 * assistant can answer "kva skjer på Stord i helga" from the listing rather than from a guess.
 * ADR 0024 has the reasoning; the short version:
 *
 * - **Read-only.** Every tool reads what a GET on the site already shows (`catalogue.ts`). No
 *   submission, no hearts, no views, no model call, no Jev — so there is nothing to authenticate
 *   and nothing that costs money, and the endpoint can be as open as the pages are.
 * - **Stateless.** A fresh server per request, JSON responses, no session. Any replica answers any
 *   call, and a deploy cannot strand a client mid-conversation.
 * - **Nothing is logged.** Not the tool, not its arguments, not the search words — the README's
 *   "no search terms" holds for an assistant exactly as for a reader. And a model reading an event
 *   is not a reader opening it, so nothing here records a view.
 *
 * A `+server.ts` rather than a remote function because the caller is genuinely external (ADR
 * 0002). SvelteKit's CSRF check does not stand in the way: it only refuses cross-origin *form*
 * content types, and MCP is `application/json`.
 *
 * CORS is open (`*`) on purpose. There is no cookie and no credential to protect, and browser-based
 * clients — the MCP Inspector among them — cannot connect at all without it.
 */

/**
 * One handler for the process; its factory runs once per request. The origin is read from the
 * request in hand, so a dev or local server links to itself, as the pages' canonical URLs do.
 */
const handler = createMcpHandler(
	() => buildMcpServer(liveCatalogue, originFor(getRequestEvent().url)),
	{ responseMode: 'json' }
);

const CORS: Record<string, string> = {
	'access-control-allow-origin': '*',
	'access-control-allow-methods': 'GET, POST, DELETE, OPTIONS',
	'access-control-allow-headers':
		'content-type, accept, authorization, mcp-protocol-version, mcp-session-id, last-event-id',
	'access-control-expose-headers': 'mcp-protocol-version, mcp-session-id',
	'access-control-max-age': '86400'
};

function withCors(response: Response): Response {
	const headers = new Headers(response.headers);
	for (const [name, value] of Object.entries(CORS)) headers.set(name, value);
	headers.set('cache-control', 'no-store');
	return new Response(response.body, { status: response.status, headers });
}

const serve: RequestHandler = async (event) => {
	if (!allow('mcp', event)) {
		// A JSON-RPC error rather than an HTML 429, so the assistant can read why and say so.
		return withCors(
			new Response(
				JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32000, message: TOO_MANY } }),
				{ status: 429, headers: { 'content-type': 'application/json', 'retry-after': '60' } }
			)
		);
	}
	return withCors(await handler.fetch(event.request));
};

export const POST = serve;
export const GET = serve;
export const DELETE = serve;
export const OPTIONS: RequestHandler = () => withCors(new Response(null, { status: 204 }));
