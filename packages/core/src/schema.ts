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

/** Derived from taxonomy.ts — never write this list out by hand. */
export const categoryEnum = pgEnum('category', CATEGORY_SLUGS);

export const eventStatusEnum = pgEnum('event_status', [
	'pending', // submitted or imported, awaiting verification
	'published',
	'flagged', // verification was uncertain — human queue
	'rejected'
]);

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
	active: boolean('active').notNull().default(true),
	lastRunAt: timestamp('last_run_at', { withTimezone: true })
});

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
