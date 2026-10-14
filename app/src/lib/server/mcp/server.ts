import { registerAppResource, RESOURCE_MIME_TYPE } from '@modelcontextprotocol/ext-apps/server';
import { McpServer, ResourceTemplate } from '@modelcontextprotocol/server';
import viewHtml from 'virtual:hendingar-mcp-view';
import { z } from 'zod';
import { COVERED_MUNICIPALITIES } from '@hendingar/core/coverage';
import { toPublicEventDetail } from '@hendingar/core/public-event';
import { CATEGORIES } from '@hendingar/core/taxonomy';
import { ABOUT_NOTES, registerTools, resolveEventRef, VIEW_URI, type Catalogue } from './tools.ts';

/** Where images in the view may come from besides the posters: the church paintings (church-art.ts). */
const VIEW_IMAGE_ORIGINS = ['https://upload.wikimedia.org'];

/**
 * The MCP server: what an assistant sees when somebody connects hendingar.no to it. ADR 0024.
 *
 * Built fresh for every request (`routes/mcp/+server.ts`), so it holds no state and any replica
 * can answer any call. `origin` is passed in rather than read from a constant so a local or dev
 * server hands out links to itself, exactly as the pages' canonical URLs do (`originFor`).
 */

/**
 * Read into the context of every client that connects, so short. What an assistant most needs to
 * be told and would otherwise get wrong: where this covers, what language the data is in, that
 * the link and the source are part of the answer, and what it must not make up.
 */
const INSTRUCTIONS = [
	`hendingar.no lists what is on in ${COVERED_MUNICIPALITIES.join(', ')} (Sunnhordland, Norway). It knows nothing about other places — say so rather than guess.`,
	"The data is in Norwegian, mostly Nynorsk. Answer in the user's language; keep names as written.",
	'Search is plain text matching. For a broad question, run several short searches (or `weekend_events` / `events_on_date`) and choose yourself.',
	"Always give each event's `url`, and name its source. hendingar.no is an index and the sources are the origin.",
	'`weekend_events`, `events_on_date`, `week_events`, `upcoming_events` and `show_events` draw their events as cards where the client can (MCP Apps); then keep your text short instead of listing every event again. Without cards, list events grouped by day, each title a Markdown link to its `url`, with the time from `when`, the venue, and an "add to calendar" link to `icsUrl`.',
	"Use `when` or `startsAt` exactly as given — they are already in the venue's time zone.",
	'Never invent prices, line-ups, age limits or availability. If it is not in the record, it is unknown; tickets are at `ticketUrl`.',
	'This server is read-only. To add or correct an event, send people to https://hendingar.no/send-inn.'
].join('\n');

export function buildMcpServer(catalogue: Catalogue, origin: string): McpServer {
	const server = new McpServer(
		{ name: 'hendingar', title: 'hendingar.no', version: '1.0.0', websiteUrl: origin },
		{ instructions: INSTRUCTIONS }
	);

	registerTools(server, catalogue, origin);

	server.registerResource(
		'event',
		new ResourceTemplate('hendingar://event/{id}', { list: undefined }),
		{
			title: 'An event',
			description: 'One event in full, as JSON — the same record `get_event` returns.',
			mimeType: 'application/json'
		},
		async (uri, { id }) => {
			const eventId = resolveEventRef(String(id));
			const row = eventId === null ? null : await catalogue.getEvent(eventId);
			if (!row) throw new Error(`Fann inga publisert hending med id ${String(id)}.`);
			return {
				contents: [
					{
						uri: uri.href,
						mimeType: 'application/json',
						text: JSON.stringify(toPublicEventDetail(row, origin))
					}
				]
			};
		}
	);

	registerAppResource(
		server,
		'events-view',
		VIEW_URI,
		{
			title: 'hendingar.no — hendingar som kort',
			description: 'The cards `show_events` is drawn with, in clients that support MCP Apps.',
			mimeType: RESOURCE_MIME_TYPE
		},
		async (uri) => {
			// Posters are hot-linked from each source's CDN, so the frame's image policy is built
			// from where the listed ones actually live — and our own origin, for the seed's.
			const resourceDomains = [
				...new Set([origin, ...VIEW_IMAGE_ORIGINS, ...(await catalogue.posterOrigins())])
			];
			return {
				contents: [
					{
						uri: uri.href,
						mimeType: RESOURCE_MIME_TYPE,
						text: viewHtml,
						_meta: { ui: { csp: { resourceDomains }, prefersBorder: false } }
					}
				]
			};
		}
	);

	server.registerResource(
		'categories',
		'hendingar://categories',
		{
			title: 'Categories',
			description: 'Every category slug and its Nynorsk label.',
			mimeType: 'application/json'
		},
		async (uri) => ({
			contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify(CATEGORIES) }]
		})
	);

	server.registerResource(
		'about',
		'hendingar://about',
		{
			title: 'About hendingar.no',
			description: 'What the site is, what it covers, and the rules for quoting it.',
			mimeType: 'text/markdown'
		},
		async (uri) => ({
			contents: [
				{
					uri: uri.href,
					mimeType: 'text/markdown',
					text: [
						'# hendingar.no',
						'',
						`Covers ${COVERED_MUNICIPALITIES.join(', ')}.`,
						'',
						...ABOUT_NOTES.map((note) => `- ${note}`)
					].join('\n')
				}
			]
		})
	);

	server.registerPrompt(
		'kva-skjer',
		{
			title: 'Kva skjer?',
			description: 'What is on, somewhere and sometime, with links.',
			argsSchema: z.object({
				stad: z
					.string()
					.max(100)
					.optional()
					.describe('Stord, Bømlo or Fitjar. Empty for all three.'),
				tid: z.string().max(100).optional().describe('"i kveld", "i helga", "neste veke", a date…')
			})
		},
		({ stad, tid }) => ({
			messages: [
				{
					role: 'user',
					content: {
						type: 'text',
						text: `Kva skjer ${tid ?? 'framover'}${stad ? ` i ${stad}` : ''}? Bruk hendingar.no, grupper svaret per dag, og ta med lenkja og kjelda til kvar hending.`
					}
				}
			]
		})
	);

	server.registerPrompt(
		'planlegg-helga',
		{
			title: 'Planlegg helga',
			description: 'A weekend plan from what is actually on, for a given group of people.',
			argsSchema: z.object({
				kven: z
					.string()
					.max(200)
					.optional()
					.describe('Who it is for: "to vaksne", "familie med born på 6 og 9"…'),
				stad: z
					.string()
					.max(100)
					.optional()
					.describe('Stord, Bømlo or Fitjar. Empty for all three.')
			})
		},
		({ kven, stad }) => ({
			messages: [
				{
					role: 'user',
					content: {
						type: 'text',
						text: `Lag ein plan for helga${kven ? ` for ${kven}` : ''}${stad ? ` i ${stad}` : ''}. Start med \`weekend_picks\`, sjå deretter gjennom \`weekend_events\`, og vel det som passar. Ta med tid, stad, lenkje og kjelde for kvart forslag, og sei frå om noko er usikkert.`
					}
				}
			]
		})
	);

	return server;
}
