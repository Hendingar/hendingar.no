import { describe, expect, it } from 'vitest';
import type { NewEvent } from '@hendingar/core/schema';
import { isUnchanged, runIngest, runAll } from '../src/ingest.ts';
import { isFailure, type MapFailure, type MappedEventBase } from '../src/mapped.ts';
import type { EventRow, EventStore, RunClosing, SourceRow } from '../src/store.ts';
import type { Importer, SourceConfig } from '../src/contract.ts';

/**
 * The first tests this layer has ever had.
 *
 * All fifteen importers had exactly one test file, `test/map.test.ts`, and none of them tested
 * `ingest.ts` — the orchestration was 100% uncovered, which is where the `sourceUrl` change-detection
 * bug lived in nine of them for however long. It was uncoverable by construction: each `ingest.ts`
 * called `createDb` itself, so faking a database meant `as unknown as Db`.
 *
 * The store seam is what makes these possible, and the point of it: `recordingStore` below is a plain
 * object satisfying `EventStore`, with no cast anywhere (CLAUDE.md rules 4 and 6). No network, no
 * clock — `now` is injected and returns fixed instants.
 */

const CONFIG: SourceConfig = {
	slug: 'test-source',
	name: 'Test Source',
	url: 'https://example.no/program',
	region: 'Sunnhordland',
	attribution: 'Test Source',
	timezone: 'Europe/Oslo',
	scheduleCron: '0 5 * * *',
	iconUrl: null,
	trusted: true
};

/** Only the columns these tests read; the runner never inspects the rest. */
function sourceRow(overrides: Partial<SourceRow> = {}): SourceRow {
	const row = {
		id: 1,
		slug: CONFIG.slug,
		name: CONFIG.name,
		url: CONFIG.url,
		region: CONFIG.region,
		attribution: CONFIG.attribution,
		kind: 'json-api',
		endpoint: 'https://example.no/api',
		iconUrl: null,
		scheduleCron: CONFIG.scheduleCron,
		trusted: true,
		active: true,
		note: null,
		lastRunAt: null
	} satisfies SourceRow;
	return { ...row, ...overrides };
}

function eventRow(overrides: Partial<EventRow>): EventRow {
	const row = {
		id: 100,
		sourceId: 1,
		externalId: 'a',
		sourceUrl: 'https://example.no/e/a',
		title: 'Konsert',
		description: null,
		category: 'musikk',
		startsAt: new Date('2026-09-12T18:00:00Z'),
		endsAt: null,
		venueId: 7,
		organizerId: null,
		seriesId: null,
		ctaUrl: null,
		posterUrl: null,
		posterSrcset: null,
		posterRightsVerified: false,
		status: 'published',
		duplicateOfId: null,
		verificationNotes: null,
		submissionMethod: 'import',
		submissionOutcome: null,
		submitterClientId: null,
		appealText: null,
		appealedAt: null,
		appealVerdicts: null,
		reviewedAt: null,
		kind: 'dated',
		createdAt: new Date('2026-09-01T00:00:00Z'),
		updatedAt: new Date('2026-09-01T00:00:00Z')
	} satisfies EventRow;
	return { ...row, ...overrides };
}

type Recorded = {
	sourcesUpserted: number;
	runsOpened: number;
	closings: RunClosing[];
	touched: number;
	venues: number;
	inserted: NewEvent[];
	updated: { id: number; values: NewEvent; updatedAt: Date }[];
};

/** An `EventStore` that records instead of writing. No cast: a plain object satisfies the type. */
function recordingStore(existing: Map<string, EventRow> = new Map()) {
	const log: Recorded = {
		sourcesUpserted: 0,
		runsOpened: 0,
		closings: [],
		touched: 0,
		venues: 0,
		inserted: [],
		updated: []
	};
	const store: EventStore = {
		async upsertSource() {
			log.sourcesUpserted += 1;
			return sourceRow();
		},
		async openRun() {
			log.runsOpened += 1;
			return 42;
		},
		async closeRun(_runId, closing) {
			log.closings.push(closing);
		},
		async touchSource() {
			log.touched += 1;
		},
		async upsertVenue() {
			log.venues += 1;
			return 7;
		},
		async findEvent(_sourceId, externalId) {
			return existing.get(externalId) ?? null;
		},
		async insertEvent(values) {
			log.inserted.push(values);
		},
		async updateEvent(id, values, updatedAt) {
			log.updated.push({ id, values, updatedAt });
		}
	};
	return { store, log };
}

type Mapped = MappedEventBase & { description: string | null };

const mapped = (overrides: Partial<Mapped> = {}): Mapped => ({
	externalId: 'a',
	title: 'Konsert',
	category: 'musikk',
	startsAt: new Date('2026-09-12T18:00:00Z'),
	endsAt: null,
	venueName: 'Den Blå Time',
	venueSlug: 'den-blaa-time',
	posterUrl: null,
	posterRightsVerified: false,
	sourceUrl: 'https://example.no/e/a',
	description: null,
	...overrides
});

/** A minimal importer. Each test overrides only the hook it is about. */
function importer(
	overrides: Partial<Importer<SourceConfig, Mapped>> = {}
): Importer<SourceConfig, Mapped> {
	return {
		facts: () => ({ kind: 'json-api', endpoint: 'https://example.no/api', note: 'Test.' }),
		collect: async () => [mapped()],
		values: ({ mapped: m, source, venueId }) => ({
			sourceId: source.id,
			externalId: m.externalId,
			sourceUrl: m.sourceUrl,
			title: m.title,
			description: m.description,
			category: m.category,
			startsAt: m.startsAt,
			endsAt: m.endsAt,
			venueId,
			posterUrl: m.posterUrl,
			posterRightsVerified: m.posterRightsVerified,
			status: source.trusted ? 'published' : 'pending'
		}),
		...overrides
	};
}

const clock = (...instants: string[]) => {
	const times = instants.map((i) => new Date(i));
	let n = 0;
	return () => times[Math.min(n++, times.length - 1)]!;
};

describe('isUnchanged', () => {
	/*
	 * The regression guard for the bug this whole runner exists to make impossible. Nine importers
	 * wrote `sourceUrl` and left it out of their hand-written comparison, so a source that moved an
	 * event's canonical URL was reported `unchanged` for ever.
	 */
	it('notices a change in every column the importer writes', () => {
		const stored = eventRow({});
		const base: Record<string, unknown> = {
			sourceId: stored.sourceId,
			externalId: stored.externalId,
			sourceUrl: stored.sourceUrl,
			title: stored.title,
			description: stored.description,
			category: stored.category,
			startsAt: stored.startsAt,
			endsAt: stored.endsAt,
			venueId: stored.venueId,
			ctaUrl: stored.ctaUrl,
			posterUrl: stored.posterUrl,
			posterSrcset: stored.posterSrcset,
			posterRightsVerified: stored.posterRightsVerified,
			status: stored.status
		};
		expect(isUnchanged(stored, base)).toBe(true);

		const changes: Record<string, unknown> = {
			sourceUrl: 'https://example.no/e/a-renamed',
			title: 'Konsert II',
			description: 'Noko nytt',
			category: 'teater',
			startsAt: new Date('2026-09-12T19:00:00Z'),
			endsAt: new Date('2026-09-12T21:00:00Z'),
			venueId: 8,
			ctaUrl: 'https://example.no/billett',
			posterUrl: 'https://example.no/p.jpg',
			posterSrcset: 'https://example.no/p.jpg 800w',
			posterRightsVerified: true,
			status: 'pending'
		};
		// Every single one, so no column can be quietly excluded from the comparison again.
		for (const [column, value] of Object.entries(changes)) {
			expect(isUnchanged(stored, { ...base, [column]: value }), column).toBe(false);
		}
	});

	it('compares dates as instants, not as objects', () => {
		const stored = eventRow({});
		// A different Date object for the same moment is `===`-unequal and must not read as a change.
		expect(isUnchanged(stored, { startsAt: new Date('2026-09-12T18:00:00Z') })).toBe(true);
		expect(isUnchanged(stored, { startsAt: new Date('2026-09-12T18:00:01Z') })).toBe(false);
	});

	it('treats null and undefined as the same absence', () => {
		const stored = eventRow({ description: null });
		expect(isUnchanged(stored, { description: undefined })).toBe(true);
		expect(isUnchanged(stored, { description: null })).toBe(true);
		expect(isUnchanged(stored, { description: '' })).toBe(false);
	});

	it('ignores the two columns that are the lookup itself', () => {
		// The row was found *by* sourceId and externalId, so they are equal by construction.
		const stored = eventRow({});
		expect(isUnchanged(stored, { sourceId: 999, externalId: 'something-else' })).toBe(true);
	});
});

describe('runIngest', () => {
	it('opens a run, closes it, and stamps the source', async () => {
		const { store, log } = recordingStore();
		const result = await runIngest('postgres://unused', CONFIG, importer(), {
			store,
			now: clock('2026-09-07T10:00:00Z', '2026-09-07T10:00:02Z')
		});

		expect(log.sourcesUpserted).toBe(1);
		expect(log.runsOpened).toBe(1);
		expect(log.touched).toBe(1);
		expect(log.closings).toHaveLength(1);
		expect(log.closings[0]).toMatchObject({ status: 'success', created: 1, durationMs: 2000 });
		expect(result).toMatchObject({ runId: 42, slug: 'test-source', status: 'success', created: 1 });
	});

	it('inserts an event it has never seen', async () => {
		const { store, log } = recordingStore();
		const result = await runIngest('postgres://unused', CONFIG, importer(), { store });
		expect(log.inserted).toHaveLength(1);
		expect(log.inserted[0]).toMatchObject({ externalId: 'a', title: 'Konsert' });
		expect(log.updated).toEqual([]);
		expect(result).toMatchObject({ created: 1, updated: 0, unchanged: 0 });
	});

	it('reports an identical event as unchanged and writes nothing', async () => {
		const { store, log } = recordingStore(new Map([['a', eventRow({})]]));
		const result = await runIngest('postgres://unused', CONFIG, importer(), { store });
		expect(log.inserted).toEqual([]);
		expect(log.updated).toEqual([]);
		expect(result).toMatchObject({ created: 0, updated: 0, unchanged: 1 });
	});

	it('updates when only the source URL moved', async () => {
		/*
		 * The bug, as an orchestration test. Before the runner, nine importers reported this as
		 * `unchanged` and left the stale URL in the database.
		 */
		const stored = eventRow({ sourceUrl: 'https://example.no/e/old-slug' });
		const { store, log } = recordingStore(new Map([['a', stored]]));
		const result = await runIngest('postgres://unused', CONFIG, importer(), {
			store,
			now: clock('2026-09-07T10:00:00Z')
		});
		expect(result).toMatchObject({ updated: 1, unchanged: 0 });
		expect(log.updated[0]?.values).toMatchObject({ sourceUrl: 'https://example.no/e/a' });
	});

	it('counts a mapping failure as rejected and turns the run partial', async () => {
		const failure: MapFailure = { externalId: 'b', title: 'Uleseleg', problem: 'no start time' };
		const { store, log } = recordingStore();
		const result = await runIngest(
			'postgres://unused',
			CONFIG,
			importer({ collect: async () => [mapped(), failure] }),
			{ store }
		);
		expect(result).toMatchObject({ fetched: 2, created: 1, rejected: 1, status: 'partial' });
		expect(result.message).toBe('Uleseleg: no start time');
		expect(log.closings[0]?.status).toBe('partial');
	});

	it('skips a repeated external id, because one event spans two windows', async () => {
		const { store, log } = recordingStore();
		const result = await runIngest(
			'postgres://unused',
			CONFIG,
			importer({ collect: async () => [mapped(), mapped()] }),
			{ store }
		);
		expect(result).toMatchObject({ fetched: 2, created: 1, rejected: 0, status: 'success' });
		expect(log.inserted).toHaveLength(1);
	});

	it('rejects a repeated external id when the importer says the key must be unique', async () => {
		// importers/tec: a repeat there means the external id is wrong, and must be visible.
		const { store } = recordingStore();
		const result = await runIngest(
			'postgres://unused',
			CONFIG,
			importer({ collect: async () => [mapped(), mapped()], onDuplicate: 'reject' }),
			{ store }
		);
		expect(result).toMatchObject({ rejected: 1, status: 'partial' });
		expect(result.message).toMatch(/not unique/);
	});

	it('marks the run failed and rethrows when the source goes quiet', async () => {
		/*
		 * ADR 0004: "the source went quiet" reported as a successful import of zero events is the one
		 * outcome /datasamling cannot show honestly. `collect` throwing must reach the run row.
		 */
		const { store, log } = recordingStore();
		const boom = importer({
			collect: async () => {
				throw new Error('no programme block on the page');
			}
		});
		await expect(
			runIngest('postgres://unused', CONFIG, boom, {
				store,
				now: clock('2026-09-07T10:00:00Z', '2026-09-07T10:00:01Z')
			})
		).rejects.toThrow('no programme block');

		expect(log.closings).toHaveLength(1);
		expect(log.closings[0]).toMatchObject({
			status: 'failed',
			message: 'no programme block on the page',
			durationMs: 1000
		});
		// A failed run must not stamp lastRunAt: the source did not report.
		expect(log.touched).toBe(0);
	});

	it('writes no run row on a dry run, and no events', async () => {
		const { store, log } = recordingStore();
		const result = await runIngest('postgres://unused', CONFIG, importer(), {
			store,
			dryRun: true
		});
		expect(log.runsOpened).toBe(0);
		expect(log.closings).toEqual([]);
		expect(log.inserted).toEqual([]);
		expect(log.venues).toBe(0);
		expect(result).toMatchObject({ runId: -1, created: 1 });
		// The sources row IS still written — a dry run has to register what it would collect.
		expect(log.sourcesUpserted).toBe(1);
	});

	it('rethrows without touching the run row on a dry run that fails', async () => {
		const { store, log } = recordingStore();
		const boom = importer({
			collect: async () => {
				throw new Error('parse failed');
			}
		});
		await expect(
			runIngest('postgres://unused', CONFIG, boom, { store, dryRun: true })
		).rejects.toThrow('parse failed');
		expect(log.closings).toEqual([]);
	});

	it('puts an importer’s own notes ahead of the per-event problems', async () => {
		const { store } = recordingStore();
		const result = await runIngest(
			'postgres://unused',
			CONFIG,
			importer({
				collect: async () => [
					mapped(),
					{ externalId: 'b', title: 'Uleseleg', problem: 'no start time' }
				],
				notes: (counts) => [
					counts.fetched === 0 ? 'the source lists nothing' : '2 away fixtures skipped'
				]
			}),
			{ store }
		);
		expect(result.message).toBe('2 away fixtures skipped; Uleseleg: no start time');
	});

	it('caps the problem list rather than filling the status board', async () => {
		const failures = Array.from({ length: 25 }, (_, n) => ({
			externalId: `x${n}`,
			title: `Rad ${n}`,
			problem: 'unparseable'
		}));
		const { store } = recordingStore();
		const result = await runIngest(
			'postgres://unused',
			CONFIG,
			importer({ collect: async () => failures }),
			{ store }
		);
		expect(result.rejected).toBe(25);
		expect(result.message?.split('; ')).toHaveLength(10);
	});

	it('leaves venueId null when the event names no venue', async () => {
		const { store, log } = recordingStore();
		await runIngest(
			'postgres://unused',
			CONFIG,
			importer({ collect: async () => [mapped({ venueName: null, venueSlug: null })] }),
			{ store }
		);
		expect(log.venues).toBe(0);
		expect(log.inserted[0]).toMatchObject({ venueId: null });
	});

	it('hands the stored row to values before it is built', async () => {
		// What importers/allevents needs for preferDescription: keep what we hold rather than take a
		// degraded copy from a detail page that failed.
		const stored = eventRow({ description: 'Den fulle omtalen' });
		const { store, log } = recordingStore(new Map([['a', stored]]));
		let sawExisting = false;
		await runIngest(
			'postgres://unused',
			CONFIG,
			importer({
				collect: async () => [mapped({ description: null })],
				values: ({ mapped: m, source, venueId, existing }) => {
					sawExisting = existing !== null;
					return {
						sourceId: source.id,
						externalId: m.externalId,
						sourceUrl: m.sourceUrl,
						title: m.title,
						description: m.description ?? existing?.description ?? null,
						category: m.category,
						startsAt: m.startsAt,
						endsAt: m.endsAt,
						venueId,
						status: 'published'
					};
				}
			}),
			{ store }
		);
		expect(sawExisting).toBe(true);
		// Unchanged, because values chose to keep the description it already had.
		expect(log.updated).toEqual([]);
	});
});

describe('runAll', () => {
	it('records a failing source against itself and carries on', async () => {
		/*
		 * The `--no-bail` argument, at the level below the shell: one rate-limited upstream must not
		 * cost the healthy sources in the same importer.
		 */
		const configs = [
			{ ...CONFIG, slug: 'first' },
			{ ...CONFIG, slug: 'second' },
			{ ...CONFIG, slug: 'third' }
		];
		const { store } = recordingStore();
		const results = await runAll(
			'postgres://unused',
			configs,
			importer({
				collect: async (config) => {
					if (config.slug === 'second') throw new Error('429 from upstream');
					return [mapped()];
				}
			}),
			{ store }
		);
		expect(results.map((r) => `${r.slug}:${r.status}`)).toEqual([
			'first:success',
			'second:failed',
			'third:success'
		]);
		expect(results[1]?.message).toBe('429 from upstream');
	});
});

describe('isFailure', () => {
	it('tells a rejection from an event', () => {
		expect(isFailure(mapped())).toBe(false);
		expect(isFailure({ externalId: 'a', title: 'T', problem: 'why' })).toBe(true);
	});
});
