import { z } from 'zod';
import { listingUrl } from './site.ts';

/**
 * Reading Bømlo Næringsråd's listing.
 *
 * The page is a Next.js build and carries its own data in `__NEXT_DATA__` — the JSON the framework
 * embeds so the browser can hydrate without a second request. Parsing that rather than the rendered
 * markup is the whole reason this importer is short: it is the site's own structured data, and a
 * redesign that keeps the data keeps this working.
 *
 * Everything is validated. The blob is an implementation detail of somebody else's build, and the
 * day it changes shape must be a loud failure rather than an empty import.
 */

const logoSchema = z.object({ url: z.string().nullish() }).nullish();

const hostSchema = z
	.object({
		name: z.string().nullish(),
		generalInformation: z.object({ logo: logoSchema }).nullish()
	})
	.nullish();

const eventSchema = z.object({
	/** The CMS's own id. Stable across builds, and what `external_id` is keyed on. */
	id: z.string(),
	/** The path segment of the event's own page. */
	slug: z.string(),
	name: z.string(),
	/**
	 * An ISO instant, and genuinely one.
	 *
	 * Checked rather than assumed, because a stated offset is a claim — see the MEC importer for
	 * what it costs when the claim is wrong. All 100 events carry `+00:00`, and the wall clocks
	 * that implies match what the descriptions tell a human on both sides of the daylight-saving
	 * change: a June event at `06:00+00:00` says "08.00" in its own text (CEST, +2), and a December
	 * one at `17:30+00:00` says doors at "18.30" (CET, +1). So these are real UTC instants, not wall
	 * clocks wearing an offset.
	 */
	starttime: z.string(),
	endtime: z.string().nullish(),
	host: hostSchema,
	about: z.object({ markdown: z.string().nullish() }).nullish()
});

export type UpstreamEvent = z.infer<typeof eventSchema>;

const pageSchema = z.object({
	props: z.object({
		pageProps: z.object({
			events: z.array(z.unknown()).nullish()
		})
	})
});

export type Parsed = { rows: UpstreamEvent[]; rejected: string[] };

/**
 * The `__NEXT_DATA__` blob out of the page.
 *
 * Found by its id rather than by position: Next.js emits other inline scripts, and the blob is the
 * only one that carries this id. A page without it is a redesign, not an empty week, so it throws.
 */
export function parseListing(html: string): Parsed {
	const script = /<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/.exec(html);
	if (!script?.[1]) throw new Error('no __NEXT_DATA__ on the listing page');

	let json: unknown;
	try {
		json = JSON.parse(script[1]);
	} catch {
		throw new Error('__NEXT_DATA__ is not JSON');
	}

	const outer = pageSchema.safeParse(json);
	if (!outer.success) {
		throw new Error(`unexpected __NEXT_DATA__ shape: ${outer.error.issues[0]?.message}`);
	}

	const rows: UpstreamEvent[] = [];
	const rejected: string[] = [];
	for (const raw of outer.data.props.pageProps.events ?? []) {
		const parsed = eventSchema.safeParse(raw);
		if (parsed.success) rows.push(parsed.data);
		else
			rejected.push(parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join(', '));
	}
	return { rows, rejected };
}

const HEADERS = {
	// Identifying, with a contact URL, as docs/event-sources.md asks of every importer.
	'user-agent': 'hendingar.no importer (+https://hendingar.no)',
	accept: 'text/html'
};

export type Read = () => Promise<string>;

/** One request per run, for the one page a reader would open. */
export const read: Read = async () => {
	const response = await fetch(listingUrl(), {
		headers: HEADERS,
		signal: AbortSignal.timeout(30_000)
	});
	if (!response.ok) throw new Error(`${listingUrl()} responded ${response.status}`);
	return response.text();
};
