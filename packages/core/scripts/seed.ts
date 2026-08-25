/**
 * Seeds a local database with enough data to develop against.
 *   pnpm db:up && pnpm db:migrate && pnpm db:seed
 */
import { createDb } from '../src/db.ts';
import { events, sources, venues } from '../src/schema.ts';

const url = process.env.DATABASE_URL;
if (!url) {
	console.error('DATABASE_URL is not set. Copy .env.example to .env.');
	process.exit(1);
}

const db = createDb(url);

const [source] = await db
	.insert(sources)
	.values({
		slug: 'detskjer-sunnhordland',
		name: 'Det skjer Sunnhordland',
		url: 'https://detskjer.sunnhordland.no/events',
		region: 'Sunnhordland',
		attribution: 'Det skjer Sunnhordland'
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
		geocodeStatus: 'resolved',
		geocodedAt: new Date()
	})
	.returning();

if (!source || !venue) throw new Error('seed failed: insert returned no row');

await db.insert(events).values([
	{
		sourceId: source.id,
		externalId: 'seed-1',
		title: 'Konsert på Den Blå Time',
		category: 'musikk',
		startsAt: new Date('2026-09-12T20:00:00+02:00'),
		endsAt: new Date('2026-09-12T23:30:00+02:00'),
		venueId: venue.id,
		status: 'published'
	},
	{
		sourceId: source.id,
		externalId: 'seed-2',
		title: 'Teater: Ein draum om hausten',
		category: 'teater',
		startsAt: new Date('2026-09-20T19:00:00+02:00'),
		venueId: venue.id,
		status: 'published'
	}
]);

console.log('seeded 1 source, 1 venue, 2 events');
process.exit(0);
