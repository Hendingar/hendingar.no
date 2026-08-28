import {
	boolean,
	doublePrecision,
	index,
	integer,
	pgEnum,
	pgTable,
	serial,
	text,
	timestamp,
	uniqueIndex
} from 'drizzle-orm/pg-core';
import { CATEGORY_SLUGS } from './taxonomy.ts';
import { VERIFICATION_CHECKS, VERIFICATION_VERDICTS } from './verification.ts';

/** Derived from taxonomy.ts — never write this list out by hand. */
export const categoryEnum = pgEnum('category', CATEGORY_SLUGS);

export const eventStatusEnum = pgEnum('event_status', [
	'pending', // submitted or imported, awaiting verification
	'published',
	'flagged', // verification was uncertain — human queue
	'rejected'
]);

/** How a source is collected. Shown on /datasamling so the method is public, not folklore. */
export const sourceKindEnum = pgEnum('source_kind', [
	'json-api', // an undocumented or public JSON endpoint — the cheapest and most stable
	'feed', // iCal or RSS
	'html', // parsed markup, brittle by nature
	'manual' // human submissions
]);

export const ingestRunStatusEnum = pgEnum('ingest_run_status', [
	'running',
	'success',
	'partial', // finished, but some records were rejected
	'failed'
]);

/** How an event entered the system. Shown on the event, so provenance is never a guess. */
export const submissionMethodEnum = pgEnum('submission_method', [
	'import', // a deterministic importer
	'form', // a human filled in the form
	'photo' // a human photographed a poster and confirmed the extraction
]);

/** The verification pipeline's stages — names and labels live in ./verification.ts (rule 1). */
export const verificationCheckEnum = pgEnum('verification_check', VERIFICATION_CHECKS);

/** `uncertain` is the one that matters: it routes to a human rather than guessing. */
export const verificationVerdictEnum = pgEnum('verification_verdict', VERIFICATION_VERDICTS);

export const geocodeStatusEnum = pgEnum('geocode_status', [
	'pending',
	'resolved',
	'ambiguous',
	'failed'
]);

/**
 * Where events come from. Importers upsert on (source_id, external_id) so a re-run updates rather
 * than duplicates — see docs/event-sources.md.
 */
export const sources = pgTable('sources', {
	id: serial('id').primaryKey(),
	slug: text('slug').notNull().unique(),
	name: text('name').notNull(),
	url: text('url').notNull(),
	region: text('region').notNull(),
	/** Attribution shown on every event from this source. */
	attribution: text('attribution').notNull(),
	/** How we collect it. Surfaced publicly — see /datasamling. */
	kind: sourceKindEnum('kind').notNull().default('json-api'),
	/** The exact endpoint we call, so the method is inspectable rather than implied. */
	endpoint: text('endpoint'),
	/**
	 * The source's own icon, hotlinked. Per-source data rather than a URL hardcoded in a component,
	 * because the next source will have a different one and /datasamling should not need a code
	 * change to show it. Null renders initials instead — the same fallback the event thumbnails use.
	 */
	iconUrl: text('icon_url'),
	/** Cron expression the scheduled job runs on. Null means "not scheduled yet". */
	scheduleCron: text('schedule_cron'),
	/**
	 * The upstream is editorially moderated, so its events publish on import rather than queueing.
	 *
	 * This is a deliberate, per-source decision and not a default. Untrusted sources — and every
	 * human submission — land as `pending` for the verification pipeline. Making it a column means
	 * the choice is auditable and visible on /datasamling, instead of being a constant buried in
	 * one importer.
	 */
	trusted: boolean('trusted').notNull().default(false),
	active: boolean('active').notNull().default(true),
	lastRunAt: timestamp('last_run_at', { withTimezone: true })
});

/**
 * One row per importer execution. This is the evidence behind /datasamling: without it the page
 * could only claim a source is being collected, never show that it actually was, when, or what
 * came back. Also the only way a silently-failing importer becomes visible.
 */
export const ingestRuns = pgTable(
	'ingest_runs',
	{
		id: serial('id').primaryKey(),
		sourceId: integer('source_id')
			.notNull()
			.references(() => sources.id),
		startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
		finishedAt: timestamp('finished_at', { withTimezone: true }),
		status: ingestRunStatusEnum('status').notNull().default('running'),
		/** 'schedule' | 'manual' — how the run was kicked off. */
		trigger: text('trigger').notNull().default('schedule'),

		/** Counts. `rejected` is the interesting one: it means the source changed shape. */
		fetched: integer('fetched').notNull().default(0),
		created: integer('created').notNull().default(0),
		updated: integer('updated').notNull().default(0),
		unchanged: integer('unchanged').notNull().default(0),
		rejected: integer('rejected').notNull().default(0),

		durationMs: integer('duration_ms'),
		/** Populated on failure or partial success. Shown verbatim on /datasamling. */
		message: text('message'),
		/** The commit that produced this run, so a behaviour change is traceable. */
		revision: text('revision')
	},
	(t) => [index('ingest_runs_source_started_idx').on(t.sourceId, t.startedAt)]
);

/**
 * Venues are geocoded once and cached. Sources give us free-text venue names ("Den Blå Time"), and
 * the same venue recurs across hundreds of events — geocoding per event would be both slow and
 * rude to the geocoding provider.
 *
 * NOTE: latitude/longitude are plain columns for now. The PostGIS `geography(Point, 4326)` upgrade
 * is documented in docs/decisions/0005-postgis-geo.md and blocked on confirming the extension is
 * available on our host (issue #2). Proximity queries use a bounding box until then.
 */
export const venues = pgTable(
	'venues',
	{
		id: serial('id').primaryKey(),
		name: text('name').notNull(),
		slug: text('slug').notNull().unique(),
		address: text('address'),
		municipality: text('municipality'),
		latitude: doublePrecision('latitude'),
		longitude: doublePrecision('longitude'),
		/**
		 * IANA zone, e.g. `Europe/Oslo`. Required, not optional: `starts_at` is a timestamptz and
		 * therefore an *instant*, so the wall-clock time a visitor should see is only recoverable
		 * with a zone. Formatting in the server's or the browser's zone silently shifts concerts —
		 * a 20:00 Helsinki gig renders as 19:00 if you assume Oslo. See CLAUDE.md.
		 */
		timezone: text('timezone').notNull().default('Europe/Oslo'),
		geocodeStatus: geocodeStatusEnum('geocode_status').notNull().default('pending'),
		geocodedAt: timestamp('geocoded_at', { withTimezone: true })
	},
	(t) => [index('venues_lat_lon_idx').on(t.latitude, t.longitude)]
);

export const organizers = pgTable('organizers', {
	id: serial('id').primaryKey(),
	slug: text('slug').notNull().unique(),
	name: text('name').notNull(),
	avatarUrl: text('avatar_url')
});

export const events = pgTable(
	'events',
	{
		id: serial('id').primaryKey(),
		sourceId: integer('source_id').references(() => sources.id),
		/** The source's own stable id. Null for events submitted directly by a human. */
		externalId: text('external_id'),
		sourceUrl: text('source_url'),

		title: text('title').notNull(),
		description: text('description'),
		category: categoryEnum('category').notNull(),

		/**
		 * timestamptz. Importers MUST preserve the source's offset rather than normalising to UTC —
		 * Norwegian event times carry +01:00/+02:00 and users notice when that shifts.
		 */
		startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
		endsAt: timestamp('ends_at', { withTimezone: true }),

		venueId: integer('venue_id').references(() => venues.id),
		organizerId: integer('organizer_id').references(() => organizers.id),

		/** Outbound ticket link. We never sell tickets — see README non-goals. */
		ctaUrl: text('cta_url'),
		posterUrl: text('poster_url'),
		/** Do not re-host a poster whose rights are unverified (issue #3). */
		posterRightsVerified: boolean('poster_rights_verified').notNull().default(false),

		status: eventStatusEnum('status').notNull().default('pending'),
		/** Why the verification agent reached its conclusion — auditable, not a black box. */
		verificationNotes: text('verification_notes'),
		/** How this event arrived. */
		submissionMethod: submissionMethodEnum('submission_method').notNull().default('import'),

		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
	},
	(t) => [
		uniqueIndex('events_source_external_idx').on(t.sourceId, t.externalId),
		index('events_starts_at_idx').on(t.startsAt),
		index('events_status_starts_at_idx').on(t.status, t.startsAt)
	]
);

export type Event = typeof events.$inferSelect;
export type NewEvent = typeof events.$inferInsert;
export type Venue = typeof venues.$inferSelect;
export type NewVenue = typeof venues.$inferInsert;
export type Source = typeof sources.$inferSelect;
export type Organizer = typeof organizers.$inferSelect;
/**
 * One row per verification check per event.
 *
 * The README promises the agent's reasoning is "auditable rather than a black box". That promise
 * is only real if the reasoning is stored: a verdict with no record of why is exactly the black box
 * we said we would not build. Every check writes a row, including the ones that pass.
 */
export const verifications = pgTable(
	'verifications',
	{
		id: serial('id').primaryKey(),
		eventId: integer('event_id')
			.notNull()
			.references(() => events.id, { onDelete: 'cascade' }),
		check: verificationCheckEnum('check').notNull(),
		verdict: verificationVerdictEnum('verdict').notNull(),
		/** 0–100. Low confidence routes to a human even when the verdict is `pass`. */
		confidence: integer('confidence').notNull().default(0),
		/** The agent's stated reasoning, in the reader's language. Shown, not just logged. */
		reasoning: text('reasoning').notNull(),
		/** Which model produced this, so a behaviour change is traceable to a model change. */
		model: text('model'),
		/** Set when a check is decided by code rather than a model — e.g. duplicate matching. */
		deterministic: boolean('deterministic').notNull().default(false),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
	},
	(t) => [index('verifications_event_idx').on(t.eventId)]
);

export type IngestRun = typeof ingestRuns.$inferSelect;
export type Verification = typeof verifications.$inferSelect;
export type NewVerification = typeof verifications.$inferInsert;
export type NewIngestRun = typeof ingestRuns.$inferInsert;
