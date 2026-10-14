import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createMcpHandler } from '@modelcontextprotocol/server';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
	publicEventDetailSchema,
	publicEventSchema,
	showEventsResultSchema,
	viewResultSchema
} from '@hendingar/core/public-event';
import { buildMcpServer } from './server.ts';
import {
	DETAIL_HINT,
	LIST_HINT,
	resolveEventRef,
	VIEW_LIST_HINT,
	VIEW_URI,
	type Catalogue
} from './tools.ts';

/**
 * The MCP server's public contract (ADR 0024, and the condition ADR 0001 set for any public API):
 * the names an assistant calls, the promise that every one of them is a read, and the shape of
 * what comes back. A rename, a new tool, or a tool that writes fails here before it ships.
 *
 * Driven through the real HTTP handler with a stub catalogue — no database, no network.
 */

const ORIGIN = 'https://hendingar.no';

const row = {
	id: 42,
	title: 'Jazzkveld på Leirvik',
	category: 'musikk' as const,
	startsAt: new Date('2026-10-16T18:00:00Z'),
	endsAt: null,
	venueName: 'Stord kulturhus',
	venueTimeZone: 'Europe/Oslo',
	municipality: 'Stord',
	posterUrl: null,
	sourceMarks: [{ slug: 'stord-kulturhus', name: 'Stord kulturhus' }]
};

function stubCatalogue(calls: string[] = []): Catalogue {
	const seen =
		<T>(name: string, value: T) =>
		async () => {
			calls.push(name);
			return value;
		};
	return {
		listEvents: seen('listEvents', [row]),
		getEvent: async (id) => {
			calls.push('getEvent');
			if (id !== row.id) return null;
			return {
				...row,
				description: 'Trio.',
				ctaUrl: 'https://billett.example/42',
				sourceUrl: 'https://kulturhus.example/42',
				submissionMethod: 'import',
				venueAddress: 'Borggata 2',
				venuePostalCode: '5417',
				venueMunicipality: 'Stord',
				venueLatitude: 59.78,
				venueLongitude: 5.5,
				organizerName: null,
				weeklyHours: null,
				ageFrom: null,
				ageTo: null,
				duplicateOfId: null,
				duplicateOfTitle: null,
				removedUpstreamAt: null,
				reportedBy: [
					{
						slug: 'stord-kulturhus',
						name: 'Stord kulturhus',
						siteUrl: 'https://kulturhus.example',
						eventUrl: 'https://kulturhus.example/42'
					}
				]
			};
		},
		filmScreenings: seen('filmScreenings', { film: false, screenings: [] }),
		listEventsOnDate: seen('listEventsOnDate', [row]),
		weekendEvents: seen('weekendEvents', [row]),
		weekEvents: seen('weekEvents', { dates: ['2026-10-12'], timed: [row], spanning: [] }),
		calendarRange: seen('calendarRange', { current: '2026-10', last: '2026-12' }),
		dayCounts: seen('dayCounts', [{ date: '2026-10-16', total: 1 }]),
		placeCounts: seen('placeCounts', [{ municipality: 'Stord', total: 1 }]),
		listUpcoming: seen('listUpcoming', [row]),
		standingOffers: seen('standingOffers', []),
		weeklyActivities: seen('weeklyActivities', { today: '2026-10-14', activities: [] }),
		weekendPicks: seen('weekendPicks', []),
		// What the real query returns: the row plus its counts, which must not survive the mapping.
		listPopular: seen('listPopular', [{ ...row, hearts: 5, views: 9 }]),
		searchSuggestions: seen('searchSuggestions', {
			venues: [],
			categories: [],
			sources: [],
			events: [],
			total: 0
		}),
		listCategoryCounts: seen('listCategoryCounts', [{ slug: 'musikk', total: 1 }]),
		listSources: seen('listSources', []),
		posterOrigins: seen('posterOrigins', ['https://cdn.example']),
		siteStatus: seen('siteStatus', {
			upcomingCount: 1,
			standingCount: 0,
			sourceCount: 1,
			lastCollectedAt: null
		})
	};
}

const rpcResponse = z.object({
	result: z.record(z.string(), z.unknown()).optional(),
	error: z.object({ code: z.number(), message: z.string() }).optional()
});

async function rpc(
	method: string,
	params: Record<string, unknown> = {},
	catalogue = stubCatalogue()
) {
	const handler = createMcpHandler(() => buildMcpServer(catalogue, ORIGIN), {
		responseMode: 'json'
	});
	const response = await handler.fetch(
		new Request(`${ORIGIN}/mcp`, {
			method: 'POST',
			headers: {
				'content-type': 'application/json',
				accept: 'application/json, text/event-stream',
				'mcp-protocol-version': '2025-06-18'
			},
			body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params })
		})
	);
	const raw = await response.text();
	// The 2025 leg answers as one SSE frame; the body is the JSON after `data: `.
	const data = raw
		.split('\n')
		.find((line) => line.startsWith('data: '))
		?.slice('data: '.length);
	const parsed = rpcResponse.parse(JSON.parse(data ?? raw));
	if (parsed.error) throw new Error(parsed.error.message);
	return parsed.result ?? {};
}

const toolList = z.object({
	tools: z.array(
		z.object({
			name: z.string(),
			description: z.string(),
			annotations: z.object({
				readOnlyHint: z.boolean(),
				destructiveHint: z.boolean(),
				openWorldHint: z.boolean()
			}),
			outputSchema: z.record(z.string(), z.unknown())
		})
	)
});

const callResult = z.object({
	isError: z.boolean().optional(),
	structuredContent: z.record(z.string(), z.unknown()).optional(),
	content: z.array(
		z.union([
			z.object({ type: z.literal('text'), text: z.string() }),
			z.object({
				type: z.literal('resource_link'),
				uri: z.string(),
				name: z.string(),
				description: z.string().optional()
			})
		])
	)
});

function texts(result: z.infer<typeof callResult>): string[] {
	return result.content.flatMap((block) => (block.type === 'text' ? [block.text] : []));
}

async function callTool(name: string, args: Record<string, unknown> = {}, catalogue?: Catalogue) {
	return callResult.parse(await rpc('tools/call', { name, arguments: args }, catalogue));
}

describe('the MCP contract', () => {
	it('offers exactly these tools — renaming or adding one is a change to a public API', async () => {
		const { tools } = toolList.parse(await rpc('tools/list'));
		expect(tools.map((t) => t.name).sort()).toEqual(
			[
				'about',
				'always_open',
				'busy_days',
				'events_on_date',
				'get_event',
				'list_categories',
				'list_sources',
				'popular_events',
				'resolve_names',
				'search_events',
				'show_events',
				'upcoming_events',
				'week_events',
				'weekend_events',
				'weekend_picks',
				'weekly_activities'
			].sort()
		);
	});

	it('declares every tool read-only and closed-world', async () => {
		const { tools } = toolList.parse(await rpc('tools/list'));
		for (const tool of tools) {
			expect(tool.annotations, tool.name).toEqual(
				expect.objectContaining({
					readOnlyHint: true,
					destructiveHint: false,
					openWorldHint: false
				})
			);
		}
	});

	it('offers these resources and prompts', async () => {
		const resources = z
			.object({ resources: z.array(z.object({ uri: z.string() })) })
			.parse(await rpc('resources/list'));
		expect(resources.resources.map((r) => r.uri).sort()).toEqual([
			'hendingar://about',
			'hendingar://categories',
			'ui://hendingar/events.html'
		]);
		const templates = z
			.object({ resourceTemplates: z.array(z.object({ uriTemplate: z.string() })) })
			.parse(await rpc('resources/templates/list'));
		expect(templates.resourceTemplates.map((t) => t.uriTemplate)).toEqual([
			'hendingar://event/{id}'
		]);
		const prompts = z
			.object({ prompts: z.array(z.object({ name: z.string() })) })
			.parse(await rpc('prompts/list'));
		expect(prompts.prompts.map((p) => p.name).sort()).toEqual(['kva-skjer', 'planlegg-helga']);
	});

	it('returns events that link hendingar.no and name their source', async () => {
		const result = await callTool('search_events', { q: 'jazz' });
		const events = z.array(publicEventSchema).parse(result.structuredContent?.events);
		expect(events[0]?.url).toBe('https://hendingar.no/hending/42-jazzkveld-paa-leirvik');
		expect(events[0]?.sources).toEqual([{ slug: 'stord-kulturhus', name: 'Stord kulturhus' }]);
		expect(events[0]?.startsAt).toBe('2026-10-16T20:00:00+02:00');
		// The same answer as text, for the clients that read only that.
		expect(JSON.parse(texts(result)[0] ?? '')).toEqual(result.structuredContent);
	});

	it('tells the assistant how to show a list, beside the list', async () => {
		const result = await callTool('search_events', { q: 'jazz' });
		expect(texts(result)).toContain(LIST_HINT);
		expect(LIST_HINT).toMatch(/`url`/);
		expect(LIST_HINT).toMatch(/`icsUrl`/);
	});

	it('links every listed event as a resource the client can open', async () => {
		const result = await callTool('search_events', { q: 'jazz' });
		const links = result.content.filter((block) => block.type === 'resource_link');
		expect(links).toEqual([
			expect.objectContaining({
				uri: 'hendingar://event/42',
				name: 'Jazzkveld på Leirvik',
				description: expect.stringContaining('Stord kulturhus')
			})
		]);
		// And the link resolves: the resource template answers it with the same event.
		const read = z
			.object({ contents: z.array(z.object({ text: z.string() })) })
			.parse(await rpc('resources/read', { uri: 'hendingar://event/42' }));
		expect(publicEventDetailSchema.parse(JSON.parse(read.contents[0]?.text ?? '')).id).toBe(42);
	});

	it('tells the assistant how to show one event', async () => {
		const result = await callTool('get_event', { event: 42 });
		expect(texts(result)).toContain(DETAIL_HINT);
	});

	it('draws the answer-shaped tools with the view, and never a search', async () => {
		const listed = z
			.object({
				tools: z.array(
					z.object({ name: z.string(), _meta: z.record(z.string(), z.unknown()).optional() })
				)
			})
			.parse(await rpc('tools/list'));
		const withView = listed.tools.filter((t) => t._meta?.ui !== undefined);
		expect(withView.map((t) => t.name).sort()).toEqual(
			['events_on_date', 'show_events', 'upcoming_events', 'week_events', 'weekend_events'].sort()
		);
		for (const tool of withView) expect(tool._meta?.ui).toEqual({ resourceUri: VIEW_URI });
	});

	it('hands a drawn list to the view in a shape the view accepts', async () => {
		const result = await callTool('weekend_events', { which: 'denne' });
		const drawn = viewResultSchema.parse(result.structuredContent);
		expect(drawn.events.map((e) => e.id)).toEqual([42]);
		expect(texts(result)).toContain(VIEW_LIST_HINT);
	});

	it('serves the view as one self-contained page, with posters allowed by origin', async () => {
		const read = z
			.object({
				contents: z.array(
					z.object({
						uri: z.string(),
						mimeType: z.string(),
						text: z.string(),
						_meta: z.object({
							ui: z.object({ csp: z.object({ resourceDomains: z.array(z.string()) }) })
						})
					})
				)
			})
			.parse(await rpc('resources/read', { uri: VIEW_URI }));
		const view = read.contents[0];
		expect(view?.mimeType).toBe('text/html;profile=mcp-app');
		expect(view?.text).toMatch(/^<!doctype html>/);
		expect(view?.text).toContain('<div id="app"></div>');
		// Nothing loaded from elsewhere: the script and the style are inline.
		expect(view?.text).not.toMatch(/<script[^>]+src=|<link[^>]+stylesheet/);
		expect(view?._meta.ui.csp.resourceDomains).toEqual(
			expect.arrayContaining([ORIGIN, 'https://cdn.example', 'https://upload.wikimedia.org'])
		);
	});

	it('shows the events asked for, and says which were not found', async () => {
		const result = await callTool('show_events', { ids: [42, 7, 42], heading: 'Fredag' });
		const shown = showEventsResultSchema.parse(result.structuredContent);
		expect(shown.events.map((e) => e.id)).toEqual([42]);
		expect(shown.missing).toEqual([7]);
		expect(shown.heading).toBe('Fredag');
	});

	it('resolves a pasted link to the event it names', async () => {
		const result = await callTool('get_event', {
			event: 'https://hendingar.no/hending/42-jazzkveld-paa-leirvik'
		});
		const detail = publicEventDetailSchema.parse(result.structuredContent);
		expect(detail.ticketUrl).toBe('https://billett.example/42');
		expect(detail.sources[0]?.eventUrl).toBe('https://kulturhus.example/42');
	});

	it('answers an unknown event as a tool error the assistant can read, not a crash', async () => {
		const result = await callTool('get_event', { event: 7 });
		expect(result.isError).toBe(true);
		expect(texts(result)[0]).toContain('7');
	});

	it('refuses input the site itself would refuse', async () => {
		const result = await callTool('week_events', { week: '2025-W53' });
		expect(result.isError).toBe(true);
	});

	it('reads the stored weekend picks and asks nothing else', async () => {
		const calls: string[] = [];
		await callTool('weekend_picks', {}, stubCatalogue(calls));
		expect(calls).toEqual(['weekendPicks']);
	});

	it('hands out no hearts or views, even from the tool ordered by them', async () => {
		const result = await callTool('popular_events', { by: 'hearts' });
		expect(texts(result).join('\n')).not.toMatch(/"hearts"|"views"/);
	});
});

describe('resolveEventRef', () => {
	it.each([
		[42, 42],
		['42', 42],
		['42-jazzkveld', 42],
		['https://hendingar.no/hending/42-jazzkveld?x=1', 42],
		['http://localhost:5173/hending/42', 42],
		['jazzkveld', null]
	])('%s → %s', (ref, id) => {
		expect(resolveEventRef(ref)).toBe(id);
	});
});

/**
 * Read-only by construction, checked by reading the source.
 *
 * The annotations above are a claim; this is what makes it true. The catalogue is the only module
 * the tools reach the database through, and none of these may ever appear in it or beside it —
 * each is a write, a model call, or something keyed on a reader's `clientId`.
 */
describe('what the MCP modules must never import', () => {
	const FILES = ['./catalogue.ts', './tools.ts', './server.ts', '../../../routes/mcp/+server.ts'];
	const FORBIDDEN = [
		/submit\.remote/,
		/hearts\.remote/,
		/views\.remote/,
		/haugen/,
		/verifier/,
		/pile-answer/,
		/curateToday/,
		/\bcommand\b/,
		/\bform\b\s*\(/
	];

	it.each(FILES)('%s', (file) => {
		const source = readFileSync(fileURLToPath(new URL(file, import.meta.url)), 'utf8');
		const imports = source.split('\n').filter((line) => /^\s*(import|export .* from)/.test(line));
		const code = source.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
		for (const pattern of FORBIDDEN) {
			expect(imports.join('\n'), `${file} imports ${pattern}`).not.toMatch(pattern);
			expect(code, `${file} mentions ${pattern}`).not.toMatch(pattern);
		}
	});
});
