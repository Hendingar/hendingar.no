/**
 * Seeds a local database with enough data to develop against.
 *   pnpm db:up && pnpm db:migrate && pnpm db:seed
 *
 * Idempotent: safe to run repeatedly. Dates are relative to now, because hardcoded 2026 dates
 * silently produce an empty homepage once they pass — `listEvents` only returns the future.
 */
import { eq, sql } from 'drizzle-orm';
import { createDb } from '../src/db.ts';
import { events, ingestRuns, sources, venues } from '../src/schema.ts';
import type { CategorySlug } from '../src/taxonomy.ts';

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
		// Their own favicon, read from the <link rel="icon"> on their site.
		iconUrl:
			'https://superlocal-production.s3.eu-west-1.amazonaws.com/uploads/clients/header_style/1e6e4e2e-20e7-4390-a4cd-279f89e8b678/favicon/favicon-196.png',
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
			iconUrl:
				'https://superlocal-production.s3.eu-west-1.amazonaws.com/uploads/clients/header_style/1e6e4e2e-20e7-4390-a4cd-279f89e8b678/favicon/favicon-196.png',
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
 * Twelve more published events, so a seed-only database looks like the product instead of like a
 * near-empty one.
 *
 * This is not padding. `/hendingar` is a day-grouped grid with thumbnails, and neither property is
 * observable at four rows: nothing groups, and no tile has a poster. Two listing specs asserted
 * both against data that only `pnpm ingest` ever produced, so CI — which must not reach the
 * network (rule 6) and therefore never runs the importer — failed on data it could not create.
 * Fixing the seed keeps the assertions honest; lowering them would have hidden the real gap.
 *
 * Posters point at a local same-origin file rather than the source's CDN, for the same reason.
 */
const POSTER = '/seed-poster.svg';

const filler = (
	externalId: string,
	title: string,
	category: CategorySlug,
	day: number,
	hour: number,
	venueId: number,
	poster = false
) => ({
	sourceId: source.id,
	externalId,
	title,
	category,
	startsAt: daysFromNow(day, hour),
	endsAt: daysFromNow(day, hour + 2),
	venueId,
	status: 'published' as const,
	posterUrl: poster ? POSTER : null
});

const fillerEvents = [
	filler('seed-5', 'Songkveld i Stord kyrkje', 'kyrkjeliv', 1, 19, venue.id, true),
	filler('seed-6', 'Fjordcup: finaledag', 'sport', 1, 12, venue.id),
	filler('seed-7', 'Bokbad med Åsta Nordmark', 'litteratur', 2, 18, venue.id, true),
	filler('seed-8', 'Folkedans på kaien', 'dans', 2, 20, venue.id),
	filler('seed-9', 'Stand-up: Ope mikrofon', 'stand-up', 4, 21, venue.id, true),
	filler('seed-10', 'Bondens marknad', 'marknad', 5, 10, venue.id),
	filler('seed-11', 'Smakskveld: lokal sider', 'mat-og-drikke', 7, 19, venue.id, true),
	filler('seed-12', 'Kurs i trykkjekunst', 'kurs', 8, 17, venue.id),
	filler('seed-13', 'Haustfestivalen opnar', 'festival', 9, 15, venue.id, true),
	filler('seed-14', 'Kammermusikk i Helsingfors', 'musikk', 12, 19, helsinki.id, true),
	filler('seed-15', 'Teater: Kvit natt', 'teater', 14, 19, venue.id),
	filler('seed-16', 'Konferanse om lokaljournalistikk', 'konferanse', 16, 9, venue.id)
];

await db
	.insert(events)
	.values(fillerEvents)
	.onConflictDoNothing({ target: [events.sourceId, events.externalId] });

/*
 * A SECOND collected source, because one is not enough to exercise the source filter.
 *
 * /hendingar can filter by source, and that control only renders when there is more than one
 * source to choose between — so on a one-source database the filter is invisible and every spec
 * covering it fails, or worse, passes locally against ingested data and fails only in CI. The same
 * trap as the listing counts: a seed that is not representative moves the failure to the one place
 * it is expensive to debug.
 *
 * The slug matches the real importer's, deliberately. When `pnpm ingest` runs it upserts this same
 * row rather than creating a duplicate, and `pnpm db:sources` leaves it alone because its kind is
 * no longer `link`.
 */
const [library] = await db
	.insert(sources)
	.values({
		slug: 'bomlobibliotek',
		name: 'Bømlo folkebibliotek',
		url: 'https://www.bomlobibliotek.no/kva-skjer/',
		region: 'Sunnhordland',
		attribution: 'Bømlo folkebibliotek',
		kind: 'html',
		endpoint: 'https://www.bomlobibliotek.no/kva-skjer/',
		iconUrl: 'https://www.bomlobibliotek.no/wp-content/uploads/2022/06/webloft-favicon.png',
		scheduleCron: '0 5 * * *',
		trusted: true,
		lastRunAt: new Date()
	})
	.onConflictDoUpdate({
		target: sources.slug,
		set: { name: 'Bømlo folkebibliotek', kind: 'html', trusted: true }
	})
	.returning();

const [libraryVenue] = await db
	.insert(venues)
	.values({
		name: 'Bømlo folkebibliotek',
		slug: 'boemlo-folkebibliotek',
		municipality: 'Bømlo',
		timezone: 'Europe/Oslo',
		geocodeStatus: 'pending'
	})
	.onConflictDoUpdate({ target: venues.slug, set: { municipality: 'Bømlo' } })
	.returning();

if (!library || !libraryVenue) throw new Error('seed failed: library insert returned no row');

const libraryEvent = (
	externalId: string,
	title: string,
	category: CategorySlug,
	day: number,
	hour: number,
	poster: boolean
) => ({
	sourceId: library.id,
	externalId,
	title,
	category,
	startsAt: daysFromNow(day, hour),
	endsAt: daysFromNow(day, hour + 2),
	venueId: libraryVenue.id,
	status: 'published' as const,
	posterUrl: poster ? POSTER : null,
	// The venue has agreed we may use its images — the same fact the importer records.
	posterRightsVerified: poster
});

const libraryEvents = [
	libraryEvent('lib-1', 'Sjakk i biblioteket', 'anna', 1, 19, true),
	libraryEvent('lib-2', 'Språkkafé', 'anna', 3, 15, false),
	libraryEvent('lib-3', 'Lesestund for barnehageborn', 'litteratur', 5, 12, true),
	libraryEvent('lib-4', 'Bokbad i biblioteket', 'litteratur', 10, 18, false)
];

await db
	.insert(events)
	.values(libraryEvents)
	.onConflictDoNothing({ target: [events.sourceId, events.externalId] });

/*
 * Two human submissions, so /datasamling's submission log is not empty on a machine that has only
 * ever run the seed — the same reason the source metadata is registered here.
 *
 * One pending and one rejected, because those two rows exercise different behaviour: the rejected
 * one has its title withheld on the log, and a seed with only happy rows would never show that.
 * `sourceId` stays null — that is what makes an event a submission rather than an import.
 */
const submissionSeeds = [
	{
		title: 'Quiz på Kaikanten',
		category: 'anna' as const,
		startsAt: daysFromNow(4, 19),
		endsAt: daysFromNow(4, 21),
		venueId: venue.id,
		status: 'pending' as const,
		submissionMethod: 'photo' as const,
		verificationNotes:
			'Lese frå ein plakat. Kontrollen fann ikkje hendinga hos ei kjelde, så ho ventar på ein person.'
	},
	{
		title: 'KJØP BILLIGE KLOKKER NO!!!',
		category: 'anna' as const,
		startsAt: daysFromNow(2, 12),
		endsAt: null,
		venueId: null,
		status: 'rejected' as const,
		submissionMethod: 'form' as const,
		verificationNotes: 'Vurdert som reklame, ikkje ei hending. Lagra, ikkje sletta.'
	}
];

const [existingSubmission] = await db
	.select({ id: events.id })
	.from(events)
	.where(sql`${events.sourceId} is null`)
	.limit(1);
if (!existingSubmission) await db.insert(events).values(submissionSeeds);

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

/*
 * The second source needs runs too. A collected source with no run history is a state
 * /datasamling is built to make visible — "Ikkje køyrt" — so seeding one without runs quietly
 * puts the board in its warning state and hides the strip the page exists to show.
 */
const librarySeedRuns = [1, 0].map((daysAgo) => ({
	sourceId: library.id,
	startedAt: daysFromNow(-daysAgo, 5),
	finishedAt: daysFromNow(-daysAgo, 5, 1),
	status: 'success' as const,
	trigger: 'seed',
	fetched: 12,
	created: daysAgo === 1 ? 4 : 0,
	updated: 0,
	unchanged: daysAgo === 1 ? 0 : 4,
	rejected: 0,
	durationMs: 2100 + daysAgo * 90,
	message: null
}));

const [existingRun] = await db
	.select({ id: ingestRuns.id })
	.from(ingestRuns)
	.where(eq(ingestRuns.sourceId, source.id))
	.limit(1);
if (!existingRun) await db.insert(ingestRuns).values([...seedRuns, ...librarySeedRuns]);

const [{ count } = { count: 0 }] = await db
	.select({ count: events.id })
	.from(events)
	.where(eq(events.status, 'published'))
	.limit(1);

console.log(
	`seeded: 2 sources, 3 venues, ${4 + fillerEvents.length + libraryEvents.length} events, ${submissionSeeds.length} submissions, ${existingRun ? 0 : seedRuns.length + librarySeedRuns.length} runs (sample id ${count})`
);
process.exit(0);
