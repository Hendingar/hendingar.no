import { z } from 'zod';

/**
 * Fjord Norway's regional event listings, read from the Next.js payload in the page.
 *
 * The markup renders client-side, but Next.js ships the data it renders as JSON in a
 * `__NEXT_DATA__` script tag. Same shape of decision as Gatsby's page-data for Stord kulturhus:
 * the structured version is right there, and parsing the DOM instead would be choosing the harder
 * copy of the same facts.
 *
 * This is a tourism board, so it AGGREGATES — most of what it lists we already have from the venue
 * itself. That is fine now that `pnpm consolidate` exists: a second source for an event is
 * corroboration to show, not a duplicate to hide. It would have been a bad source to add before.
 */
export type FjordInstance = {
	slug: string;
	name: string;
	url: string;
	/** The page carrying the region's events. */
	endpoint: string;
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

export const INSTANCES: readonly FjordInstance[] = [
	{
		slug: 'fjordnorway-sunnhordland',
		name: 'Fjord Norway — Sunnhordland',
		url: 'https://www.fjordnorway.com/no/arrangementer/sunnhordland',
		endpoint: 'https://www.fjordnorway.com/no/arrangementer/sunnhordland',
		origin: 'https://www.fjordnorway.com',
		region: 'Sunnhordland',
		attribution: 'Fjord Norway',
		timezone: 'Europe/Oslo',
		venueFallback: 'Sunnhordland',
		iconUrl: 'https://www.fjordnorway.com/favicon.ico',
		scheduleCron: '0 5 * * *',
		trusted: true,
		/*
		 * Images are the venues' and photographers', republished by the tourism board under terms we
		 * are not party to. We hotlink and never re-host, and the flag stays false because an
		 * agreement with Fjord Norway would not be an agreement with whoever took the photograph.
		 */
		posterRightsCleared: false
	}
];

export function instanceBySlug(slug: string): FjordInstance | undefined {
	return INSTANCES.find((i) => i.slug === slug);
}

/**
 * Every text field is a `{ no, en, de }` object, and the other languages are often empty strings
 * rather than absent — so "has an English title" and "has a non-empty English title" are different
 * questions, and only the second one is useful.
 */
const localeStringSchema = z.record(z.string(), z.unknown()).nullish();

export function localised(value: unknown, preferred = 'no'): string | null {
	if (typeof value === 'string') return value.trim() || null;
	if (typeof value !== 'object' || value === null) return null;
	const record = value as Record<string, unknown>;
	const first = record[preferred];
	if (typeof first === 'string' && first.trim()) return first.trim();
	// Fall back to any language that actually says something, rather than showing nothing.
	for (const [key, candidate] of Object.entries(record)) {
		if (key.startsWith('_')) continue;
		if (typeof candidate === 'string' && candidate.trim()) return candidate.trim();
	}
	return null;
}

/** `locSlug` nests a slug object per language: `{ no: { current: '…' } }`. */
export function localisedSlug(value: unknown, preferred = 'no'): string | null {
	if (typeof value !== 'object' || value === null) return null;
	const record = value as Record<string, unknown>;
	const pick = (key: string): string | null => {
		const entry = record[key];
		if (typeof entry !== 'object' || entry === null) return null;
		const current = (entry as { current?: unknown }).current;
		return typeof current === 'string' && current.trim() ? current.trim() : null;
	};
	return pick(preferred) ?? Object.keys(record).map(pick).find(Boolean) ?? null;
}

const showingSchema = z.object({
	_key: z.string().nullish(),
	/** ISO local time, no offset: "2026-09-04T19:00:00". */
	fromTime: z.string().nullish(),
	toTime: z.string().nullish(),
	venueName: z.string().nullish(),
	bookingUrl: z.string().nullish()
});

const eventSchema = z.object({
	_id: z.string(),
	locTitle: localeStringSchema,
	locSlug: z.unknown().nullish(),
	locShortDescription: localeStringSchema,
	subCategory: z.object({ locSlug: z.unknown().nullish() }).nullish(),
	place: z.object({ locTitle: localeStringSchema }).nullish(),
	cloudinaryImages: z
		.array(z.object({ image: z.object({ secure_url: z.string().nullish() }).nullish() }))
		.nullish(),
	eventInfo: z
		.object({ showings: z.array(showingSchema).nullish(), venueName: z.string().nullish() })
		.nullish()
});

export type UpstreamEvent = z.infer<typeof eventSchema>;
export type UpstreamShowing = z.infer<typeof showingSchema>;

/** Only the path we read is validated; the payload carries the entire site besides. */
const payloadSchema = z.object({
	props: z.object({
		pageProps: z.object({ eventsByRegion: z.array(eventSchema) })
	})
});

export function extractNextData(pageHtml: string): unknown {
	const match =
		/<script id="__NEXT_DATA__" type="application\/json"[^>]*>([\s\S]*?)<\/script>/.exec(pageHtml);
	if (!match?.[1]) throw new Error('no __NEXT_DATA__ script in the page');
	try {
		return JSON.parse(match[1]);
	} catch (error) {
		throw new Error(
			`__NEXT_DATA__ is not valid JSON: ${error instanceof Error ? error.message : String(error)}`
		);
	}
}

export function extractEvents(payload: unknown): UpstreamEvent[] {
	const parsed = payloadSchema.safeParse(payload);
	if (!parsed.success) {
		/*
		 * Throwing rather than returning nothing. A redesign that moves `eventsByRegion` would
		 * otherwise import zero events and report success, and a source going quiet must be an
		 * error — /datasamling cannot show "collected, nothing found" honestly.
		 */
		throw new Error(
			`unexpected __NEXT_DATA__ shape: ${parsed.error.issues
				.map((i) => `${i.path.join('.')}: ${i.message}`)
				.join('; ')
				.slice(0, 300)}`
		);
	}
	return parsed.data.props.pageProps.eventsByRegion;
}

export type FetchPage = (instance: FjordInstance) => Promise<string>;

export const fetchPage: FetchPage = async (instance) => {
	const response = await fetch(instance.endpoint, {
		headers: {
			'user-agent': 'hendingar.no importer (+https://hendingar.no)',
			accept: 'text/html'
		},
		signal: AbortSignal.timeout(30_000)
	});
	if (!response.ok) throw new Error(`${instance.endpoint} responded ${response.status}`);
	return response.text();
};
