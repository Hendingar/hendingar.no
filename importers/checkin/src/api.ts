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
	},
	/*
	 * Bømlo Husflidslag, whose courses are published through husflid.no.
	 *
	 * Norges Husflidslag's site renders its own course list from
	 * `husflid.no/wp-admin/admin-ajax.php?action=proxy_checkin_request` — a WordPress proxy in front
	 * of this very GraphQL API, passing the lag's `customerId`. We read the API directly rather than
	 * the proxy: the proxy adds nothing but a hop we do not control, and `api.checkin.no` answers
	 * this customer without any credential.
	 *
	 * **Finding the customerId is the awkward part, and it is not on the page.** Neither
	 * `husflid.no/lag/hordaland-husflidslag/bomlo-husflidslag/` nor Stord's equivalent contains its
	 * own id anywhere in the served HTML — grep the page for it and you get nothing — and the
	 * runtime endpoint the theme uses (`nhic_public_runtime`) returns only a nonce and a clock. The
	 * id comes out of the network tab: open the lag's course list, watch for
	 * `proxy_checkin_request`, and read `customerId` off the GraphQL body. Adding the next
	 * husflidslag is one entry here plus that one capture.
	 *
	 * `posterRightsCleared` is false: the lag has agreed nothing, and an unstated right is not a
	 * granted one (issue #3). Kulleseidkanalen above has agreed, which is why it differs.
	 */
	{
		slug: 'husflid-bomlo',
		name: 'Bømlo Husflidslag',
		url: 'https://husflid.no/lag/hordaland-husflidslag/bomlo-husflidslag/',
		customerId: 16148,
		region: 'Sunnhordland',
		attribution: 'Bømlo Husflidslag',
		timezone: 'Europe/Oslo',
		/*
		 * Only a fallback, and it has not been needed: the course states
		 * "Husflidsstovo på Sakseid- Skuleplass vegen 3", a hall name with its address glued on
		 * after a hyphen. That is taken as the venue name as-is rather than split on a guess about
		 * where a name ends — `packages/core/src/venue-aliases.ts` is where a tidier name belongs,
		 * once a second source names the same hall.
		 */
		venueFallback: 'Bømlo Husflidslag',
		iconUrl: null,
		scheduleCron: '0 5 * * *',
		trusted: true,
		posterRightsCleared: false
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
	/**
	 * The organiser's full text, as editor HTML — and the field that actually carries the event.
	 *
	 * `sellingDescription` is a short plain-text teaser and is not always written: it is 150 and 62
	 * characters on Kulleseidkanalen's two concerts and **empty** on Bømlo Husflidslag's course,
	 * where this field holds all 736 characters. Mapping only the teaser imported the husflidslag
	 * event with no description at all, and gave the concerts a tenth of what the venue wrote.
	 */
	description: z.string().nullish(),
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
    data { id name imageUrl sellingDescription description startsAt endsAt priceFrom priceTo currency topicEvent { topic { name } } geoLocation { geoDescription description } }
  }
}`;

/**
 * The filter the widget uses: registration still open.
 *
 * Not `EVENT_STARTS_AT >= now`: that is the filter you would reach for, and it drops an event that
 * has begun but is still running.
 *
 * It was `EVENT_REGISTRATION_CLOSES_AT >= now`, chosen for the same reason and **not achieving it**.
 * Bømlo Husflidslag's Bunadkurs runs 9–23 September, three Wednesday sessions; on 7 September, with
 * the course under way, that filter returned zero records for the customer and `EVENT_ENDS_AT`
 * returned the course. Checkin treats registration for an event that has started as closed, so the
 * filter picked to keep in-progress events was the one excluding them.
 *
 * Kulleseidkanalen is unaffected — verified live, both filters return the same two concerts — which
 * is exactly why this went unnoticed: it only shows on a customer that has something running today.
 *
 * `EVENT_ENDS_AT` also says what we mean without going through registration semantics at all: an
 * event is worth listing until it is over.
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
							field: 'EVENT_ENDS_AT',
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
