import { z } from 'zod';

/**
 * Checkin.no, a Norwegian ticketing platform, read through its GraphQL API.
 *
 * The venue's own page is not usable. `kulleseidkanalen.no/vare-arrangement/` renders the calendar
 * from a Checkin widget behind cookie consent, so the HTML contains no dates, no event markup and
 * no JSON-LD — and its OpenGraph tags describe the *page* ("Våre arrangement"), not the events.
 * An OpenGraph importer against that URL would yield exactly one useless row.
 *
 * The API underneath it, however, is structured and complete: ISO timestamps that keep their
 * offset, topics, geo description, price and a poster. Same shape of decision as reading Innocode's
 * JSON instead of parsing Det skjer's Next.js markup.
 *
 * Checkin hosts many Norwegian venues, each a `customerId`, so this is a platform importer and the
 * venues are data — the same reasoning as the MEC importer.
 */
export type CheckinInstance = {
	/** Our `sources.slug`. Must match the existing row so the source graduates rather than duplicating. */
	slug: string;
	name: string;
	/** The venue's own page, for attribution — not where the data comes from. */
	url: string;
	/** Checkin's customer id. This is the whole configuration. */
	customerId: number;
	region: string;
	attribution: string;
	timezone: string;
	/** `geoLocation.description` is a free-text place; this is the fallback when it is empty. */
	venueFallback: string;
	iconUrl: string | null;
	scheduleCron: string;
	trusted: boolean;
	/** The venue has agreed we may use its event images. Recorded, not assumed. */
	posterRightsCleared: boolean;
};

export const ENDPOINT = 'https://api.checkin.no/graphql';

/**
 * `imageUrl` comes back as a site-relative path (`/static/12205/event_228160/image700.jpg`).
 *
 * `checkin.no` serves it; `static.checkin.no` answers 403 and `www.checkin.no` 404, so the obvious
 * guesses are both wrong and worth recording.
 */
export const MEDIA_BASE = 'https://checkin.no';

/** `checkin.no/event/<id>` redirects to the real page, so we never need the slug. */
export const eventUrl = (id: number) => `${MEDIA_BASE}/event/${id}`;

export const INSTANCES: readonly CheckinInstance[] = [
	{
		slug: 'kulleseidkanalen',
		name: 'Kulleseidkanalen gjestehamn',
		url: 'https://kulleseidkanalen.no/vare-arrangement/',
		customerId: 12205,
		region: 'Sunnhordland',
		attribution: 'Kulleseidkanalen gjestehamn',
		timezone: 'Europe/Oslo',
		venueFallback: 'Kulleseidkanalen gjestehamn',
		iconUrl:
			'https://kulleseidkanalen.no/wp-content/uploads/2020/07/cropped-FAVICON-2_Kulleseidkanalen_Gjestehamn-1-192x192.png',
		scheduleCron: '0 5 * * *',
		trusted: true,
		posterRightsCleared: true
	}
];

export function instanceBySlug(slug: string): CheckinInstance | undefined {
	return INSTANCES.find((i) => i.slug === slug);
}

const topicSchema = z.object({
	topic: z.object({ name: z.string().nullish() }).nullish()
});

const eventSchema = z.object({
	id: z.number(),
	name: z.string(),
	imageUrl: z.string().nullish(),
	sellingDescription: z.string().nullish(),
	startsAt: z.string(),
	endsAt: z.string().nullish(),
	priceFrom: z.string().nullish(),
	priceTo: z.string().nullish(),
	currency: z.string().nullish(),
	topicEvent: z.array(topicSchema).nullish(),
	geoLocation: z
		.object({ geoDescription: z.string().nullish(), description: z.string().nullish() })
		.nullish()
});

export const responseSchema = z.object({
	data: z.object({
		allEventRegistrations: z.object({
			records: z.number(),
			data: z.array(eventSchema)
		})
	})
});

export type UpstreamEvent = z.infer<typeof eventSchema>;

/**
 * The query, verbatim from what the venue's own widget sends.
 *
 * Requesting only the fields we map: a query that asks for everything is a query that breaks when
 * any unrelated field is deprecated.
 */
const QUERY = `query allEventRegistrations($customerId: Int!, $offset: Int, $length: Int, $reportFilters: [EventRegistrationReportFilterInput!], $includeSubunitCustomers: Boolean, $customerIds: [Int!]) {
  allEventRegistrations(customerId: $customerId, offset: $offset, length: $length, reportFilters: $reportFilters, includeSubunitCustomers: $includeSubunitCustomers, customerIds: $customerIds) {
    records
    data { id name imageUrl sellingDescription startsAt endsAt priceFrom priceTo currency topicEvent { topic { name } } geoLocation { geoDescription description } }
  }
}`;

/**
 * The filter the widget uses: registration still open.
 *
 * Not `EVENT_STARTS_AT >= now`, deliberately — that is the filter you would reach for, and it drops
 * an event that has begun but is still running. This mirrors what the venue itself publishes.
 */
export function buildBody(instance: CheckinInstance, now: Date, length = 100) {
	return {
		query: QUERY,
		variables: {
			customerId: instance.customerId,
			includeSubunitCustomers: false,
			customerIds: null,
			offset: 0,
			length,
			reportFilters: [
				{
					rule: 'AND',
					conditions: [
						{
							rule: 'AND',
							field: 'EVENT_REGISTRATION_CLOSES_AT',
							operator: 'GREATER_THAN_OR_EQUAL',
							value: String(Math.floor(now.getTime() / 1000))
						}
					],
					orderBy: [{ field: 'EVENT_STARTS_AT', direction: 'ASC' }]
				}
			]
		},
		operationName: 'allEventRegistrations'
	};
}

export type FetchEvents = (instance: CheckinInstance, now: Date) => Promise<unknown>;

export const fetchEvents: FetchEvents = async (instance, now) => {
	const response = await fetch(ENDPOINT, {
		method: 'POST',
		headers: {
			'content-type': 'application/json',
			'user-agent': 'hendingar.no importer (+https://hendingar.no)'
		},
		body: JSON.stringify(buildBody(instance, now)),
		signal: AbortSignal.timeout(30_000)
	});
	if (!response.ok) throw new Error(`${ENDPOINT} responded ${response.status}`);
	const json: unknown = await response.json();
	/*
	 * GraphQL answers 200 with an `errors` array, so a status check is not enough — without this a
	 * schema change would surface as "zero events today" rather than as a failure.
	 */
	if (typeof json === 'object' && json !== null && 'errors' in json) {
		throw new Error(`GraphQL errors: ${JSON.stringify(json.errors).slice(0, 300)}`);
	}
	return json;
};
