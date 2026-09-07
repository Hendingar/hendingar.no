import { z } from 'zod';
import { readWebpackModuleExports } from './js-literal.ts';

/**
 * Culture houses on the "cw" platform, read through Gatsby's own page data.
 *
 * The programme page is a Gatsby build, so the data it renders is also served as JSON at
 * `/page-data/<path>/page-data.json`. That is not a private API — it is how the site hydrates
 * itself — and it carries more than the HTML shows: every showing, its room, its ticket link and
 * the parent event's category and image.
 *
 * One request per venue. The site also has a detail page per event with the same ticket shape, but
 * fetching 55 of them to learn what the listing already said would be rude and slower for nothing.
 */
export type KulturhusInstance = {
	slug: string;
	name: string;
	/** Human page, for attribution. */
	url: string;
	/** The URL we fetch first. See `pageData` for what comes back. */
	endpoint: string;
	/**
	 * How this site serves the programme data.
	 *
	 * The two sites run different Gatsby majors and it shows here, not in the data: the event
	 * shape underneath is identical, byte for byte in structure.
	 *
	 *  - `json`   — a newer build, `/page-data/<path>/page-data.json`. `endpoint` is that URL.
	 *  - `chunk`  — an older build with no page-data route at all. The programme lives in a
	 *               `path---<page>-<hash>.js` webpack chunk whose name carries a build hash, so
	 *               it cannot be configured; `endpoint` is the HTML page, which preloads the
	 *               chunk and is therefore where its current name is found.
	 *
	 * Declared rather than sniffed from the response. A site that changes Gatsby major should show
	 * up as a failing run and one line of config, not as a silent switch to a different parser.
	 */
	pageData: 'json' | 'chunk';
	/** Prefix for the relative `link` on each event. */
	origin: string;
	region: string;
	attribution: string;
	timezone: string;
	venueFallback: string;
	iconUrl: string | null;
	scheduleCron: string;
	trusted: boolean;
	posterRightsCleared: boolean;
};

export const INSTANCES: readonly KulturhusInstance[] = [
	{
		slug: 'stord-kulturhus',
		name: 'Stord kulturhus',
		url: 'https://stord.kulturhus.no/kulturprogram',
		endpoint: 'https://stord.kulturhus.no/page-data/kulturprogram/page-data.json',
		pageData: 'json',
		origin: 'https://stord.kulturhus.no',
		region: 'Sunnhordland',
		attribution: 'Stord kulturhus',
		timezone: 'Europe/Oslo',
		venueFallback: 'Stord kulturhus',
		/*
		 * Read from the page's own <link rel="icon">, not guessed.
		 *
		 * I first wrote `/favicon-32x32.png` by pattern and it 404s — the site serves its icon from
		 * the platform's image CDN. The same mistake Moster Amfi's declared apple-touch-icon
		 * invites, and the reason every icon in this repo is now checked against a real request.
		 */
		iconUrl: 'https://dx-cw-static-files.imgix.net/169/stord-kulturhus-favicon.png',
		scheduleCron: '0 5 * * *',
		trusted: true,
		posterRightsCleared: true
	},
	{
		/*
		 * The payoff of a platform importer, and it took some digging to see it.
		 *
		 * Bømlo kulturhus looks nothing like Stord from outside — its own domain, its own theme,
		 * no `/page-data/` route at all, and a programme page whose HTML carries no events
		 * whatsoever. What it is, is the same platform on an older Gatsby: the events live in a
		 * webpack chunk instead of a JSON file, and the shape inside is identical down to the
		 * naive `YYYY-MM-DD HH:MM:SS` clocks and the `e-<partner><id>` showing keys. So this is
		 * fifteen lines of config and a reader, not a fourteenth importer.
		 *
		 * `robots.txt` carries Cloudflare's content-signal preamble and, below it, no rules and no
		 * signal at all — nothing disallowed, and no reservation against building a search index,
		 * which is what we do and what we link back from.
		 */
		slug: 'bomlo-kulturhus',
		name: 'Bømlo kulturhus',
		url: 'https://bomlokulturhus.no/kulturprogram/',
		endpoint: 'https://bomlokulturhus.no/kulturprogram/',
		pageData: 'chunk',
		origin: 'https://bomlokulturhus.no',
		region: 'Sunnhordland',
		attribution: 'Bømlo kulturhus',
		timezone: 'Europe/Oslo',
		venueFallback: 'Bømlo kulturhus',
		/*
		 * Read from the page's own `<link rel="icon">`, and fetched to check it resolves — the
		 * house rule after a guessed `/favicon-32x32.png` 404'd on Stord. It is on the platform's
		 * image CDN under this venue's partner number, 121.
		 */
		iconUrl: 'https://dx-cw-static-files.imgix.net/121/favicon.png',
		scheduleCron: '0 5 * * *',
		trusted: true,
		posterRightsCleared: true
	}
];

export function instanceBySlug(slug: string): KulturhusInstance | undefined {
	return INSTANCES.find((i) => i.slug === slug);
}

/**
 * One showing. This is the row we actually import.
 *
 * A single `events[]` entry can hold many: public swimming runs four times a day, a reading circle
 * monthly. Fifty-five entries on Stord's page are 109 showings, each with its own date, room and
 * ticket — so importing the entry would collapse a month of sessions into one row that moves every
 * time the importer runs.
 */
const ticketSchema = z.object({
	id: z.string(),
	/** Local wall clock, "YYYY-MM-DD HH:MM:SS". No zone anywhere in the payload. */
	date: z.string(),
	/**
	 * When it ends, on the sites that say. Same naive local form as `date`.
	 *
	 * Stord's payload omits it entirely and Bømlo's states it on every showing, which is why this
	 * is nullish rather than required — and why `mapTicket` uses it only when it is there. A
	 * duration guessed for the sites that stay quiet would be invented data.
	 */
	end: z.string().nullish(),
	/** The room. `location` on the listing, `title` on the detail page. */
	location: z.string().nullish(),
	link: z.string().nullish()
});

const eventSchema = z.object({
	id: z.string(),
	title: z.string(),
	image: z.string().nullish(),
	description: z.string().nullish(),
	/** Relative path to the event's own page. */
	link: z.string().nullish(),
	category: z.string().nullish(),
	begin: z.string().nullish(),
	tickets: z.array(ticketSchema).nullish()
});

export type UpstreamEvent = z.infer<typeof eventSchema>;
export type UpstreamTicket = z.infer<typeof ticketSchema>;

/**
 * Only the path down to the programme block is validated.
 *
 * Gatsby page data carries the whole page — theme, menus, footer — and asserting a shape for all of
 * it would break on any unrelated redesign. This validates what we read and ignores the rest.
 */
const blocksSchema = z.array(
	z.object({
		component: z.string().nullish(),
		data: z.unknown()
	})
);

/**
 * The two wrappers the same blocks arrive in.
 *
 * A newer Gatsby nests them under `result.pageContext`; an older one exports `pathContext`
 * directly. Only the box differs — what is inside it is the same programme, which is the whole
 * reason Bømlo is a config entry here and not another importer.
 *
 * A union rather than two functions, so `extractEvents` stays one code path and neither site can
 * quietly grow its own mapping.
 */
export const pageDataSchema = z.union([
	z.object({ result: z.object({ pageContext: z.object({ blocks: blocksSchema }) }) }),
	z.object({ pathContext: z.object({ blocks: blocksSchema }) })
]);

const programmeDataSchema = z.object({ events: z.array(eventSchema) });

/** Pure: page data → the programme's events. */
export function extractEvents(payload: unknown): UpstreamEvent[] {
	const page = pageDataSchema.safeParse(payload);
	if (!page.success) {
		throw new Error(
			`unexpected page-data shape: ${page.error.issues
				.map((i) => `${i.path.join('.')}: ${i.message}`)
				.join('; ')
				.slice(0, 300)}`
		);
	}

	const blocks =
		'pathContext' in page.data ? page.data.pathContext.blocks : page.data.result.pageContext.blocks;

	for (const block of blocks) {
		/*
		 * Matched on shape rather than on the component name, so a rename upstream does not
		 * silently return zero events — the name is a label, the `events` array is the contract.
		 *
		 * Shape matching earns its keep on the older build, where the same page also carries a
		 * *binding* block with an `events` key whose value is the template that produced this
		 * data — an object, not an array. It fails `z.array(eventSchema)` and is skipped, which a
		 * key-name match would not have done.
		 */
		const programme = programmeDataSchema.safeParse(block.data);
		if (programme.success) return programme.data.events;
	}

	throw new Error('no programme block with an events array in the page data');
}

export type FetchPageData = (instance: KulturhusInstance) => Promise<unknown>;

const UA = 'hendingar.no importer (+https://hendingar.no)';

/**
 * The chunk that holds a page's data, as the page's own `<link rel="preload">` addresses it.
 *
 * Pure, so the awkward half is testable against the committed HTML. The filename carries a build
 * hash (`path---kulturprogram-43a2179fbe39733d676a.js`), so it can never be configuration, and it
 * is read from the preload rather than from the route manifest further down the same file: the
 * manifest lists every page on the site keyed by an opaque number, while the preload is this
 * page's own.
 *
 * The captured value is the **href**, leading slash and all, because that is the one part a bare
 * filename gets wrong. Gatsby serves these from the site root while the programme lives at
 * `/kulturprogram/`, so resolving a bare name against the page URL asks for
 * `/kulturprogram/path---kulturprogram-….js` and gets a 404 — which is exactly what the first
 * live run did.
 */
export function chunkPathFor(html: string, page: string): string | null {
	const pattern = new RegExp(`(?:href|src)="([^"]*path---${page}-[0-9a-f]{8,}\\.js)"`);
	return pattern.exec(html)?.[1] ?? null;
}

/** The `kulturprogram` part of `https://…/kulturprogram/`, which is how the chunk is named. */
export function pageSlugFor(instance: KulturhusInstance): string {
	const path = new URL(instance.endpoint).pathname.replace(/^\/+|\/+$/g, '');
	return path === '' ? 'index' : path.replace(/\//g, '-');
}

async function get(url: string, accept: string): Promise<Response> {
	const response = await fetch(url, {
		headers: { 'user-agent': UA, accept },
		signal: AbortSignal.timeout(30_000)
	});
	if (!response.ok) throw new Error(`${url} responded ${response.status}`);
	return response;
}

/**
 * The programme data, however this site happens to serve it.
 *
 * `json` is one request. `chunk` is two — the page, then the chunk it preloads — and that is the
 * floor, not a shortcut: the hash in the chunk's name changes on every rebuild, so nothing can be
 * cached or configured past it. Two requests a day against a static host is cheaper than the
 * twenty-eight it would take to read the event pages one at a time.
 *
 * Neither path uses the platform API the site's bundle talks to. `basic_events` there is open and
 * returns every showing, but carries no title, description, image or category — and the endpoint
 * that does carry them wants basic-auth credentials that are sitting in the public bundle.
 * Scraped credentials are not ours to use, and the page's own data says everything we need.
 */
export const fetchPageData: FetchPageData = async (instance) => {
	if (instance.pageData === 'json') {
		return (await get(instance.endpoint, 'application/json')).json();
	}

	const html = await (await get(instance.endpoint, 'text/html')).text();
	const chunk = chunkPathFor(html, pageSlugFor(instance));
	if (!chunk) {
		throw new Error(
			`no path---${pageSlugFor(instance)}-<hash>.js preloaded by ${instance.endpoint}`
		);
	}
	const js =
		await // Against `origin`, so the href's leading slash resolves to the site root it names.
		(await get(new URL(chunk, instance.origin).toString(), 'text/javascript')).text();
	return readWebpackModuleExports(js);
};
