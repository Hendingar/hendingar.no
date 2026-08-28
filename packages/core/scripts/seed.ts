/**
 * Seeds a local database with enough data to develop against.
 *   pnpm db:up && pnpm db:migrate && pnpm db:seed
 *
 * Idempotent: safe to run repeatedly. Dates are relative to now, because hardcoded 2026 dates
 * silently produce an empty homepage once they pass — `listEvents` only returns the future.
 */
import { eq } from 'drizzle-orm';
import { createDb } from '../src/db.ts';
import { events, ingestRuns, sources, venues } from '../src/schema.ts';

const url = process.env.DATABASE_URL;
if (!url) {
	console.error('DATABASE_URL is not set. Run `pnpm db:up` (it creates .env from .env.example).');
	process.exit(1);
}

const db = createDb(url);

function daysFromNow(days: number, hour: number, minutes = 0): Date {
	const d = new Date();
	d.setDate(d.getDate() + days);
	d.setHours(hour, minutes, 0, 0);
	return d;
}

const [source] = await db
	.insert(sources)
	.values({
		slug: 'detskjer-sunnhordland',
		name: 'Det skjer Sunnhordland',
		url: 'https://detskjer.sunnhordland.no/events',
		region: 'Sunnhordland',
		attribution: 'Det skjer Sunnhordland',
		// Registered here too, so /datasamling has a coherent source to describe on a machine that
		// has only ever run the seed — a developer's laptop, or CI.
		kind: 'json-api',
		endpoint: 'https://detskjer.sunnhordland.no/api/events',
		scheduleCron: '0 5 * * *',
		trusted: true,
		lastRunAt: new Date()
	})
	.onConflictDoUpdate({
		target: sources.slug,
		set: {
			name: 'Det skjer Sunnhordland',
			kind: 'json-api',
			endpoint: 'https://detskjer.sunnhordland.no/api/events',
			scheduleCron: '0 5 * * *',
			trusted: true
		}
	})
	.returning();

const [venue] = await db
	.insert(venues)
	.values({
		name: 'Den Blå Time',
		slug: 'den-bla-time',
		municipality: 'Stord',
		latitude: 59.7789,
		longitude: 5.4986,
		timezone: 'Europe/Oslo',
		geocodeStatus: 'resolved',
		geocodedAt: new Date()
	})
	.onConflictDoUpdate({ target: venues.slug, set: { municipality: 'Stord' } })
	.returning();

// A second venue outside CET, so the timezone handling is exercised by the seed rather than
// only in a test. Formatting in a hardcoded Oslo would show this an hour early.
const [helsinki] = await db
	.insert(venues)
	.values({
		name: 'Kulttuuritalo',
		slug: 'kulttuuritalo',
		municipality: 'Helsinki',
		latitude: 60.1908,
		longitude: 24.9412,
		timezone: 'Europe/Helsinki',
		geocodeStatus: 'resolved',
		geocodedAt: new Date()
	})
	.onConflictDoUpdate({ target: venues.slug, set: { municipality: 'Helsinki' } })
	.returning();

if (!source || !venue || !helsinki) throw new Error('seed failed: insert returned no row');

await db
	.insert(events)
	.values([
		{
			sourceId: source.id,
			externalId: 'seed-1',
			title: 'Konsert på Den Blå Time',
			category: 'musikk',
			startsAt: daysFromNow(3, 20),
			endsAt: daysFromNow(3, 23, 30),
			venueId: venue.id,
			status: 'published'
		},
		{
			sourceId: source.id,
			externalId: 'seed-2',
			title: 'Teater: Ein draum om hausten',
			category: 'teater',
			startsAt: daysFromNow(11, 19),
			endsAt: daysFromNow(11, 21),
			venueId: venue.id,
			status: 'published'
		},
		{
			sourceId: source.id,
			externalId: 'seed-3',
			title: 'Kvöldkonsertti Helsingissä',
			category: 'musikk',
			startsAt: daysFromNow(6, 20),
			endsAt: daysFromNow(6, 22),
			venueId: helsinki.id,
			status: 'published'
		},
		{
			// Started already, still running — must remain visible. Regression guard for the bug
			// where `gte(startsAt, now)` hid events for their whole duration.
			sourceId: source.id,
			externalId: 'seed-4',
			title: 'Utstilling: Havet og oss',
			category: 'utstilling',
			startsAt: daysFromNow(-2, 10),
			endsAt: daysFromNow(9, 18),
			venueId: venue.id,
			status: 'published'
		}
	])
	.onConflictDoNothing({ target: [events.sourceId, events.externalId] });

/*
 * A little run history, so the status board has something to render locally and in CI.
 *
 * `trigger: 'seed'` rather than 'schedule' — these did not happen, and the board must never let
 * fabricated history pass for the real thing.
 */
const seedRuns = [2, 1, 0].map((daysAgo) => ({
	sourceId: source.id,
	startedAt: daysFromNow(-daysAgo, 5),
	finishedAt: daysFromNow(-daysAgo, 5, 1),
	status: 'success' as const,
	trigger: 'seed',
	fetched: 126,
	created: daysAgo === 2 ? 105 : 0,
	updated: 0,
	unchanged: daysAgo === 2 ? 0 : 105,
	rejected: 0,
	durationMs: 3000 + daysAgo * 120,
	message: null
}));

const [existingRun] = await db
	.select({ id: ingestRuns.id })
	.from(ingestRuns)
	.where(eq(ingestRuns.sourceId, source.id))
	.limit(1);
if (!existingRun) await db.insert(ingestRuns).values(seedRuns);

const [{ count } = { count: 0 }] = await db
	.select({ count: events.id })
	.from(events)
	.where(eq(events.status, 'published'))
	.limit(1);

console.log(
	`seeded: 1 source, 2 venues, 4 events, ${existingRun ? 0 : seedRuns.length} runs (sample id ${count})`
);
process.exit(0);
