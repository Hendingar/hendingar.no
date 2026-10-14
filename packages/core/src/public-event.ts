import { z } from 'zod';
import { formatEventTime, schemaDateTime, DEFAULT_TIME_ZONE } from './datetime.ts';
import { eventPath } from './slug.ts';
import { categoryLabel, CATEGORY_SLUGS, type CategorySlug } from './taxonomy.ts';
import { plainText } from './text.ts';
import { describeWeeklyHours, type WeeklyHours } from './weekly-hours.ts';

/**
 * An event as it leaves the site for somebody else's software — today, the MCP server at `/mcp`.
 *
 * One shape for every tool, so an assistant that has learnt to read one answer can read them all,
 * and one mapper, so the listing and the detail cannot disagree about what a time or a link is.
 * The rules it enforces are the site's own, written down once more where a machine reads them:
 *
 * - **Every event carries its address on hendingar.no and the sources that reported it.** We are an
 *   index, not a replacement (docs/event-sources.md). An answer that quotes an event without its
 *   origin quietly claims it as ours — or as the assistant's.
 * - **Times are written with the venue's offset**, from `schemaDateTime`, and once more as the
 *   wall clock a person reads, from `formatEventTime`. An assistant handed `18:00Z` for a 20:00
 *   concert converts it, or doesn't; handed both, it has nothing to get wrong.
 * - **No hearts, no views, no rank.** The same rule as the kurator's payload (ADR 0018): a count of
 *   what readers opened is not evidence about an evening, and a model given one will use it as one.
 *   `popular_events` says what it is in its own name and description instead.
 */

/** What `sourceMarksFor` gives a listing row: whose calendars said so. */
type SourceMarkInput = { slug: string; name: string };

/** The columns every listing query in the app selects, as the minimum this needs. */
export type ListingRowInput = {
	id: number;
	title: string;
	category: CategorySlug;
	startsAt: Date;
	endsAt: Date | null;
	venueName: string | null;
	/** Absent on the standing-offer query, which has no clock to render. */
	venueTimeZone?: string | null;
	municipality?: string | null;
	posterUrl?: string | null;
	sourceMarks?: SourceMarkInput[] | null;
};

/** What `getEvent` returns, as the minimum this needs. */
export type DetailRowInput = ListingRowInput & {
	description: string | null;
	ctaUrl: string | null;
	sourceUrl: string | null;
	submissionMethod: string | null;
	venueAddress: string | null;
	venuePostalCode: string | null;
	venueMunicipality: string | null;
	venueLatitude: number | null;
	venueLongitude: number | null;
	organizerName: string | null;
	weeklyHours: WeeklyHours | null;
	ageFrom: number | null;
	ageTo: number | null;
	duplicateOfId: number | null;
	duplicateOfTitle: string | null;
	removedUpstreamAt: Date | null;
	reportedBy: Array<{
		slug: string;
		name: string;
		siteUrl: string | null;
		eventUrl: string | null;
	}>;
};

const sourceSchema = z.object({
	slug: z.string(),
	name: z.string(),
	/** The event on the source's own site, when we have it. Detail only. */
	eventUrl: z.string().nullable().optional(),
	/** The source's front page. Detail only. */
	siteUrl: z.string().nullable().optional()
});

export const publicEventSchema = z.object({
	id: z.number().int(),
	title: z.string(),
	category: z.enum(CATEGORY_SLUGS),
	categoryLabel: z.string(),
	/** ISO 8601 with the venue's own offset: `2026-09-12T20:00:00+02:00`. */
	startsAt: z.string(),
	endsAt: z.string().nullable(),
	/** The start as a person reads it, at the venue: "lør. 12. sep. 2026, 20:00". */
	when: z.string(),
	timeZone: z.string(),
	venue: z.string().nullable(),
	municipality: z.string().nullable(),
	/** The event's page on hendingar.no. Link this. */
	url: z.string(),
	/** The same event as an `.ics` file, for a calendar app. */
	icsUrl: z.string(),
	/** Hot-linked from where the source keeps it, as the site does — never re-hosted. */
	posterUrl: z.string().nullable(),
	/** Every calendar that reported this event. Empty when a reader sent it in. */
	sources: z.array(sourceSchema)
});

export type PublicEvent = z.infer<typeof publicEventSchema>;

export const publicEventDetailSchema = publicEventSchema.extend({
	description: z.string().nullable(),
	organizer: z.string().nullable(),
	address: z.string().nullable(),
	postalCode: z.string().nullable(),
	latitude: z.number().nullable(),
	longitude: z.number().nullable(),
	/** Where tickets or sign-up live. We never sell tickets; this is where somebody else does. */
	ticketUrl: z.string().nullable(),
	/** The page this event was read from — for a reader's submission, the page they pointed at. */
	sourceUrl: z.string().nullable(),
	/** True when a reader sent this in through /send-inn rather than a calendar reporting it. */
	submittedByReader: z.boolean(),
	/** A standing activity's timetable, in place of a start time it does not really have. */
	weeklyHours: z.object({ cadence: z.string().nullable(), lines: z.array(z.string()) }).nullable(),
	ageFrom: z.number().int().nullable(),
	ageTo: z.number().int().nullable(),
	/** Set when this row is a second report of an event listed under another id. */
	duplicateOf: z.object({ id: z.number().int(), url: z.string() }).nullable(),
	/** The source stopped listing it. The page still works; the event may well not happen. */
	removedUpstream: z.boolean()
});

export type PublicEventDetail = z.infer<typeof publicEventDetailSchema>;

function absolute(origin: string, path: string): string {
	return new URL(path, origin).href;
}

export function toPublicEvent(row: ListingRowInput, origin: string): PublicEvent {
	const zone = row.venueTimeZone || DEFAULT_TIME_ZONE;
	const url = absolute(origin, eventPath(row.id, row.title));
	return {
		id: row.id,
		title: plainText(row.title) ?? row.title,
		category: row.category,
		categoryLabel: categoryLabel(row.category),
		startsAt: schemaDateTime(row.startsAt, zone),
		endsAt: row.endsAt ? schemaDateTime(row.endsAt, zone) : null,
		when: formatEventTime(row.startsAt, zone, 'full'),
		timeZone: zone,
		venue: row.venueName,
		municipality: row.municipality ?? null,
		url,
		icsUrl: `${url}/kalender.ics`,
		// Absolute, because the reader is not on our page: a seed poster is `/seed-poster.svg`, which
		// means nothing to a model and resolves against the wrong origin inside an MCP App's frame.
		posterUrl: row.posterUrl ? absolute(origin, row.posterUrl) : null,
		sources: (row.sourceMarks ?? []).map((m) => ({ slug: m.slug, name: m.name }))
	};
}

export function toPublicEventDetail(row: DetailRowInput, origin: string): PublicEventDetail {
	const base = toPublicEvent(
		{ ...row, municipality: row.venueMunicipality ?? row.municipality ?? null },
		origin
	);
	return {
		...base,
		// `reportedBy` is the complete list — every row consolidated under this one — and carries
		// each source's own link to the event, which the listing's marks do not.
		sources: row.reportedBy.map((s) => ({
			slug: s.slug,
			name: s.name,
			eventUrl: s.eventUrl,
			siteUrl: s.siteUrl
		})),
		description: plainText(row.description),
		organizer: row.organizerName,
		address: row.venueAddress,
		postalCode: row.venuePostalCode,
		latitude: row.venueLatitude,
		longitude: row.venueLongitude,
		ticketUrl: row.ctaUrl,
		sourceUrl: row.sourceUrl,
		submittedByReader: row.submissionMethod !== null && row.submissionMethod !== 'import',
		weeklyHours: row.weeklyHours ? describeWeeklyHours(row.weeklyHours) : null,
		ageFrom: row.ageFrom,
		ageTo: row.ageTo,
		duplicateOf:
			row.duplicateOfId !== null
				? {
						id: row.duplicateOfId,
						url: absolute(origin, eventPath(row.duplicateOfId, row.duplicateOfTitle ?? ''))
					}
				: null,
		removedUpstream: row.removedUpstreamAt !== null
	};
}

/**
 * What `show_events` returns, and what the MCP App's view reads (ADR 0024).
 *
 * Here rather than beside the tool because it is a wire type with two ends: the server writes it
 * and a bundle running in somebody else's iframe parses it. One schema, so the two cannot drift.
 */
export const showEventsResultSchema = z.object({
	/** A short heading the assistant chose, or null for the view's own. */
	heading: z.string().nullable(),
	/** Today at the venues, `YYYY-MM-DD`, so the view can say "i dag" and "i morgon". */
	today: z.string(),
	timeZone: z.string(),
	events: z.array(publicEventDetailSchema),
	/** Ids that were asked for and are not published events, so the assistant can say so. */
	missing: z.array(z.number().int())
});

export type ShowEventsResult = z.infer<typeof showEventsResultSchema>;
