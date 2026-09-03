import { z } from 'zod';

/**
 * The upstream response, described exactly.
 *
 * This schema is the tripwire. `detskjer.sunnhordland.no` runs Innocode's "bestevent" platform,
 * white-labelled as *Det skjer* for Polaris Media titles — a third party who owes us nothing and
 * will change the payload without telling us. Validating every response means a shape change stops
 * the run with a precise error instead of writing plausible rubbish into the database.
 *
 * `.passthrough()` on the event: new upstream fields must not break us, missing ones must.
 */
export const upstreamEventSchema = z
	.object({
		id: z.number().int(),
		eventSlug: z.string(),
		title: z.string(),
		location: z.string().nullable(),
		status: z.string(),
		recurrent: z.boolean(),
		eventTime: z.string(),
		eventEndTime: z.string().nullable(),
		startDate: z.string(),
		endDate: z.string().nullable(),
		duration: z.number().int().nullable(),
		categoryId: z.number().int().nullable(),
		categoryName: z.string().nullable(),
		organizerName: z.string().nullable(),
		organizerSlug: z.string().nullable(),
		ctaUrl: z.string().nullable(),
		ctaType: z.string().nullable(),
		posterUrls: z.array(z.string()).default([]),
		imageRightsVerified: z.boolean().default(false),
		createdAt: z.string().nullable()
	})
	.loose();

export const upstreamPageSchema = z.object({
	interval: z.string().optional(),
	start: z.string().optional(),
	end: z.string().optional(),
	events: z.array(upstreamEventSchema),
	total: z.number().int().optional(),
	next_page: z.number().int().nullable().optional()
});

export type UpstreamEvent = z.infer<typeof upstreamEventSchema>;
export type UpstreamPage = z.infer<typeof upstreamPageSchema>;

export const SOURCE = {
	slug: 'detskjer-sunnhordland',
	name: 'Det skjer Sunnhordland',
	url: 'https://detskjer.sunnhordland.no/events',
	endpoint: 'https://detskjer.sunnhordland.no/api/events',
	region: 'Sunnhordland',
	attribution: 'Det skjer Sunnhordland',
	/** The whole region is CET/CEST. Recorded per venue so it survives expansion. */
	timezone: 'Europe/Oslo',
	/**
	 * Their own favicon, from the `<link rel="icon">` on their site.
	 *
	 * Owned by the importer rather than only by the seed, which never runs in production — so the
	 * icon arrived there by accident of whatever ran first. The 32px file, not the 196px one: it is
	 * rendered at about 16px, and the larger version is eight times the bytes for no visible gain.
	 */
	iconUrl:
		'https://superlocal-production.s3.eu-west-1.amazonaws.com/uploads/clients/header_style/1e6e4e2e-20e7-4390-a4cd-279f89e8b678/favicon/favicon-32.png',
	/**
	 * Innocode / Polaris Media have given us permission to use the event images.
	 *
	 * This has to be recorded here rather than read from the response, because the API's own
	 * `imageRightsVerified` is `false` on every single record — the publisher does not populate the
	 * field, so its value says nothing either way. Treating that as "rights denied" understated a
	 * permission we actually hold; treating it as "rights granted" would have invented one. Neither
	 * is readable from the data, so the agreement is the source of truth and it lives in the config
	 * beside the source it belongs to.
	 */
	posterRightsCleared: true
} as const;

const USER_AGENT =
	'hendingar.no-importer/0.1 (+https://github.com/Hendingar/hendingar.no; open-source event index)';

export type FetchPage = (page: number) => Promise<unknown>;

/** Real network fetch. Tests inject a fixture reader instead, so no test touches the network. */
export const fetchPage: FetchPage = async (page) => {
	const url = page <= 1 ? SOURCE.endpoint : `${SOURCE.endpoint}?page=${page}`;
	const res = await fetch(url, {
		headers: { accept: 'application/json', 'user-agent': USER_AGENT }
	});
	if (!res.ok) throw new Error(`${url} responded ${res.status} ${res.statusText}`);
	return res.json();
};

/**
 * Walk the paginator.
 *
 * Pagination here is by **week window**, not by offset: `?page=2` returns the following week and
 * `total` is the overall upcoming count, so `total` must never be used for loop control. We follow
 * `next_page`, stop on an empty window, and cap the horizon so a misbehaving upstream cannot make
 * this run forever.
 */
export async function collectPages(
	read: FetchPage = fetchPage,
	maxPages = 26 // ~6 months of weekly windows
): Promise<{ pages: UpstreamPage[]; rejected: { page: number; problem: string }[] }> {
	const pages: UpstreamPage[] = [];
	const rejected: { page: number; problem: string }[] = [];
	let page = 1;

	while (page <= maxPages) {
		const raw = await read(page);
		const parsed = upstreamPageSchema.safeParse(raw);
		if (!parsed.success) {
			rejected.push({ page, problem: parsed.error.issues[0]?.message ?? 'unparseable page' });
			break;
		}
		pages.push(parsed.data);

		// An empty window means we have run past the end of what the calendar holds.
		if (parsed.data.events.length === 0) break;
		const next = parsed.data.next_page;
		if (next == null || next <= page) break;
		page = next;
	}

	return { pages, rejected };
}
