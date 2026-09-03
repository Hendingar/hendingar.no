import { z } from 'zod';

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
	/** The page-data JSON we actually read. */
	endpoint: string;
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
		origin: 'https://stord.kulturhus.no',
		region: 'Sunnhordland',
		attribution: 'Stord kulturhus',
		timezone: 'Europe/Oslo',
		venueFallback: 'Stord kulturhus',
		iconUrl: 'https://stord.kulturhus.no/favicon-32x32.png',
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
export const pageDataSchema = z.object({
	result: z.object({
		pageContext: z.object({
			blocks: z.array(
				z.object({
					component: z.string().nullish(),
					data: z.unknown()
				})
			)
		})
	})
});

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

	for (const block of page.data.result.pageContext.blocks) {
		// Matched on shape rather than on the component name, so a rename upstream does not silently
		// return zero events — the name is a label, the `events` array is the contract.
		const programme = programmeDataSchema.safeParse(block.data);
		if (programme.success) return programme.data.events;
	}

	throw new Error('no programme block with an events array in the page data');
}

export type FetchPageData = (instance: KulturhusInstance) => Promise<unknown>;

export const fetchPageData: FetchPageData = async (instance) => {
	const response = await fetch(instance.endpoint, {
		headers: {
			'user-agent': 'hendingar.no importer (+https://hendingar.no)',
			accept: 'application/json'
		},
		signal: AbortSignal.timeout(30_000)
	});
	if (!response.ok) throw new Error(`${instance.endpoint} responded ${response.status}`);
	return response.json();
};
