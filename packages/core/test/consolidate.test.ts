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
	venueName: string | null = null
): Candidate => ({ id, sourceId, title, startsAt: at(startsAt), venueName });

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
