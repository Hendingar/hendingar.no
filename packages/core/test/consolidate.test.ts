import { describe, expect, it } from 'vitest';
import {
	DUPLICATE_WINDOW_MS,
	comparePair,
	groupDuplicates,
	type Candidate
} from '../src/consolidate.ts';

const at = (iso: string) => new Date(iso);

const ev = (
	id: number,
	sourceId: number | null,
	title: string,
	startsAt: string,
	venueName: string | null = null,
	/*
	 * Left null unless the case is about what a particular calendar means by a venue name. Null is
	 * the conservative value: no room name is resolved, which is how a human submission is compared.
	 */
	sourceSlug: string | null = null
): Candidate => ({ id, sourceId, sourceSlug, title, startsAt: at(startsAt), venueName });

describe('comparePair', () => {
	it('matches the same show listed by two sources', () => {
		const a = ev(1, 10, 'Bård Tufte Johansen - Prøver å være positiv', '2026-09-04T17:00:00Z');
		const b = ev(
			2,
			20,
			'Bård Tufte Johansen - Prøver å være positiv (18 år)',
			'2026-09-04T17:00:00Z'
		);
		expect(comparePair(a, b).same).toBe(true);
	});

	it('never matches two rows from the same source, however identical', () => {
		/*
		 * The rule the whole design rests on. Public swimming runs four times a day under one title
		 * from one source; those rows score a perfect 1.0 against each other and are four different
		 * sessions. No title rule can separate them, so the only correct move is never to ask.
		 */
		const a = ev(1, 10, 'Offentleg symjing', '2026-09-03T09:00:00Z');
		const b = ev(2, 10, 'Offentleg symjing', '2026-09-03T09:00:00Z');
		const verdict = comparePair(a, b);
		expect(verdict.same).toBe(false);
		if (!verdict.same) expect(verdict.reason).toBe('same source');
	});

	it('refuses two identical titles at different places', () => {
		// Two churches in one parish, both "Gudstjeneste" at 11:00. Same title, different events.
		const a = ev(1, 10, 'Gudstjeneste', '2026-09-06T09:00:00Z', 'Bremnes kyrkje');
		const b = ev(2, 20, 'Gudstjeneste', '2026-09-06T09:00:00Z', 'Moster kyrkje');
		const verdict = comparePair(a, b);
		expect(verdict.same).toBe(false);
		if (!verdict.same) expect(verdict.reason).toBe('different venues');
	});

	it.each([
		['Nysæter kyrkje', 'Moster kyrkje'],
		['Stord Kyrkje', 'Moster kyrkje'],
		['Nysæter kyrkje', 'Bømlo kyrkje'],
		['Stord Kyrkje', 'Bremnes kyrkje'],
		['Huglo bedehuskapell', 'Lykling kyrkje'],
		['Nysæter kyrkje', 'Kanalen'],
		['Nysæter kyrkje', 'Salem Moster']
	])('keeps a service at %s apart from one at %s', (left, right) => {
		/*
		 * Every one of these is a real pair from the live database: two parishes, identical title,
		 * identical minute, genuinely different services. The first row is why this test is a table
		 * rather than one case — `Nysæter kyrkje` / `Moster kyrkje` scored 0.60 on edit distance,
		 * a hundredth over VENUE_MISMATCH_THRESHOLD, and merged three groups of Sunday and
		 * Christmas services into one row each. Seven real services were hidden from the site by
		 * it. See `venueSimilarity`.
		 */
		const a = ev(1, 10, 'Gudstjeneste', '2026-12-24T13:30:00Z', left, 'stord-kyrkja');
		const b = ev(2, 20, 'Gudstjeneste', '2026-12-24T13:30:00Z', right, 'bomlo-kyrkja');
		const verdict = comparePair(a, b);
		expect(verdict.same).toBe(false);
		if (!verdict.same) expect(verdict.reason).toBe('different venues');
	});

	it('matches a room against the building another source names', () => {
		/*
		 * The defect this rule was extended for, with the rows exactly as the live database held
		 * them. "Riksteatret: Apestjernen" is two words, so it is not distinctive enough to be
		 * believed on its own, and `Storsalen` shares not a letter with `Stord kulturhus`.
		 */
		const a = ev(
			150,
			10,
			'Riksteatret: Apestjernen',
			'2026-10-26T17:00:00Z',
			'Stord kulturhus',
			'detskjer-sunnhordland'
		);
		const b = ev(
			520,
			20,
			'Riksteatret: Apestjernen',
			'2026-10-26T17:00:00Z',
			'Storsalen',
			'stord-kulturhus'
		);
		expect(comparePair(a, b).same).toBe(true);
	});

	it('refuses the same room name when it is a different building', () => {
		/*
		 * The safety half of the same rule, and not hypothetical: Riksteatret tours one production
		 * around 79 halls, and both of these calendars list it. If `Storsalen` meant Stord kulturhus
		 * everywhere, the night the tour played both towns would lose one of the two performances.
		 */
		const a = ev(
			520,
			20,
			'Riksteatret: Apestjernen',
			'2026-10-26T17:00:00Z',
			'Storsalen',
			'stord-kulturhus'
		);
		const b = ev(
			699,
			30,
			'Riksteatret: Apestjernen',
			'2026-10-26T17:00:00Z',
			'Storsalen',
			'bomlo-aktivitetforalle'
		);
		const verdict = comparePair(a, b);
		expect(verdict.same).toBe(false);
		if (!verdict.same) expect(verdict.reason).toBe('different venues');
	});

	it('does not resolve a room name a person typed into the form', () => {
		// A submission carries no source slug, so "Storsalen" stays "Storsalen" and fails to
		// corroborate a generic title — which is the right way for an unanswerable question to fail.
		const submitted = ev(-1, null, 'Riksteatret: Apestjernen', '2026-10-26T17:00:00Z', 'Storsalen');
		const imported = ev(
			150,
			10,
			'Riksteatret: Apestjernen',
			'2026-10-26T17:00:00Z',
			'Stord kulturhus',
			'detskjer-sunnhordland'
		);
		expect(comparePair(submitted, imported).same).toBe(false);
	});

	it('still matches when the same place is written differently', () => {
		const a = ev(1, 10, 'Grand Kyiv Ballet: Swan Lake', '2026-11-20T18:00:00Z', 'Stord kulturhus');
		const b = ev(
			2,
			20,
			'Grand Kyiv Ballet - Svanesjøen',
			'2026-11-20T18:00:00Z',
			'Stord Kulturhus'
		);
		expect(comparePair(a, b).same).toBe(true);
	});

	it('matches across an hour, because sources disagree about doors versus curtain', () => {
		const a = ev(1, 10, 'Salmar på Osvald', '2026-09-11T17:00:00Z');
		const b = ev(2, 20, 'Salmar på Osvald', '2026-09-11T17:59:00Z');
		expect(comparePair(a, b).same).toBe(true);
	});

	it('refuses the next day’s showing of the same play', () => {
		// Different tickets, different evening — merging these would delete an event.
		const a = ev(1, 10, 'Teater Vestland: Den gamle mannen', '2026-11-20T18:00:00Z');
		const b = ev(2, 20, 'Teater Vestland: Den gamle mannen', '2026-11-21T18:00:00Z');
		const verdict = comparePair(a, b);
		expect(verdict.same).toBe(false);
		if (!verdict.same) expect(verdict.reason).toBe('too far apart in time');
	});

	it('keeps unrelated events that merely collide in time apart', () => {
		const a = ev(1, 10, 'Songkveld i Stord kyrkje', '2026-09-04T17:00:00Z');
		const b = ev(2, 20, 'Sjakk i biblioteket', '2026-09-04T17:00:00Z');
		expect(comparePair(a, b).same).toBe(false);
	});

	it('compares a submission, which has no source, against imported rows', () => {
		// sourceId null is a human submission. It must still be comparable, or a person re-adding
		// an event we already hold creates a second copy.
		const a = ev(1, null, 'Konsert med Bjørn Berge', '2026-09-04T19:00:00Z');
		const b = ev(2, 20, 'Konsert med Bjørn Berge', '2026-09-04T19:00:00Z');
		expect(comparePair(a, b).same).toBe(true);
	});
});

describe('groupDuplicates', () => {
	it('puts three listings of one event in one group', () => {
		const rows = [
			ev(7, 10, 'Bård Tufte Johansen - Prøver å være positiv', '2026-09-04T17:00:00Z'),
			ev(3, 20, 'Bård Tufte Johansen - Prøver å være positiv (18 år)', '2026-09-04T17:00:00Z'),
			ev(9, 30, 'Ekstra! Bård Tufte Johansen - Prøver å være positiv', '2026-09-04T17:00:00Z')
		];
		const groups = groupDuplicates(rows);
		expect(groups).toHaveLength(1);
		expect(groups[0]!.canonicalId).toBe(3);
		expect(groups[0]!.duplicateIds).toEqual([7, 9]);
	});

	it('joins a group transitively', () => {
		/*
		 * A tourism board's English title and a venue's Norwegian one often only meet through the
		 * newspaper's wording in between. Comparing pairs alone would leave two groups.
		 */
		const rows = [
			ev(1, 10, 'Grand Kyiv Ballet: Swan Lake', '2026-11-20T18:00:00Z'),
			ev(2, 20, 'Grand Kyiv Ballet: Swan Lake / Svanesjøen', '2026-11-20T18:00:00Z'),
			ev(3, 30, 'Grand Kyiv Ballet - Svanesjøen', '2026-11-20T18:00:00Z')
		];
		const groups = groupDuplicates(rows);
		expect(groups).toHaveLength(1);
		expect(groups[0]!.duplicateIds).toEqual([2, 3]);
	});

	it('picks the lowest id as canonical, so a rerun never moves the URL', () => {
		const rows = [
			ev(99, 10, 'Konsert', '2026-10-01T18:00:00Z'),
			ev(12, 20, 'Konsert', '2026-10-01T18:00:00Z')
		];
		expect(groupDuplicates(rows)[0]!.canonicalId).toBe(12);
		// Same rows in the other order must give the same answer.
		expect(groupDuplicates([...rows].reverse())[0]!.canonicalId).toBe(12);
	});

	it('reports nothing when there is nothing to merge', () => {
		expect(
			groupDuplicates([
				ev(1, 10, 'Songkveld', '2026-09-04T17:00:00Z'),
				ev(2, 20, 'Sjakk i biblioteket', '2026-09-04T17:00:00Z')
			])
		).toEqual([]);
	});

	it('does not merge a whole day of same-titled sessions from one source', () => {
		const rows = [
			ev(1, 10, 'Offentleg symjing', '2026-09-03T09:00:00Z'),
			ev(2, 10, 'Offentleg symjing', '2026-09-03T10:00:00Z'),
			ev(3, 10, 'Offentleg symjing', '2026-09-03T15:00:00Z')
		];
		expect(groupDuplicates(rows)).toEqual([]);
	});

	it('puts a building and its room in one group across three sources', () => {
		// The live rows, ids and all: two calendars name the house, its own programme names the hall.
		const rows = [
			ev(
				164,
				10,
				'Riksteatret: Ubesvart anrop',
				'2026-11-20T12:00:00Z',
				'Stord kulturhus',
				'detskjer-sunnhordland'
			),
			ev(
				535,
				20,
				'Riksteatret: ubesvart anrop',
				'2026-11-20T12:00:00Z',
				'Storsalen',
				'stord-kulturhus'
			),
			ev(
				565,
				30,
				'Riksteatret: ubesvart anrop',
				'2026-11-20T12:00:00Z',
				'Stord kulturhus',
				'fjordnorway-sunnhordland'
			)
		];
		const groups = groupDuplicates(rows);
		expect(groups).toHaveLength(1);
		expect(groups[0]!.canonicalId).toBe(164);
		expect(groups[0]!.duplicateIds).toEqual([535, 565]);
	});

	it('never chains two parishes together through one look-alike church name', () => {
		/*
		 * This exact trio was one row on the site. 218 and 219 are two services from the same
		 * source and are never compared to each other, so the group existed only because 394 joined
		 * both — `Nysæter kyrkje` scoring 0.60 against `Moster kyrkje` on edit distance. Union-find
		 * then hid two more services behind the third. A false merge is not local.
		 */
		const rows = [
			ev(218, 10, 'Gudstjeneste', '2026-09-13T09:00:00Z', 'Nysæter kyrkje', 'stord-kyrkja'),
			ev(219, 10, 'Gudstjeneste', '2026-09-13T09:00:00Z', 'Stord Kyrkje', 'stord-kyrkja'),
			ev(394, 20, 'Gudstjeneste', '2026-09-13T09:00:00Z', 'Moster kyrkje', 'bomlo-kyrkja')
		];
		expect(groupDuplicates(rows)).toEqual([]);
	});

	it('is stable: the same rows always produce the same grouping', () => {
		const rows = [
			ev(5, 10, 'Konsert på Osvald', '2026-09-11T17:00:00Z'),
			ev(2, 20, 'Konsert på Osvald', '2026-09-11T17:30:00Z'),
			ev(8, 30, 'Konsert på Osvald', '2026-09-11T17:15:00Z')
		];
		const once = JSON.stringify(groupDuplicates(rows));
		const twice = JSON.stringify(groupDuplicates([...rows].reverse()));
		expect(once).toBe(twice);
	});

	it('uses a window that is an hour, not a day', () => {
		expect(DUPLICATE_WINDOW_MS).toBe(3_600_000);
	});
});
