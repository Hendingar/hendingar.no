import { DUPLICATE_TITLE_THRESHOLD, normaliseTitle, titleSimilarity } from './similarity.ts';

/**
 * Deciding which events are the same event.
 *
 * Pure, so the rule can be tested against real pairs without a database — and so two runs over the
 * same rows always produce the same grouping, which matters because the canonical row is what a
 * reader gets a URL to.
 */

export type Candidate = {
	id: number;
	sourceId: number | null;
	title: string;
	startsAt: Date;
	venueName: string | null;
};

/**
 * How far apart two listings of the same event may start.
 *
 * The duplicates actually observed share an instant exactly, but sources disagree about whether a
 * concert starts when the doors open or when the music does. An hour absorbs that; a day would
 * merge the Tuesday and Wednesday showings of the same play, which are different events people buy
 * different tickets for.
 */
export const DUPLICATE_WINDOW_MS = 60 * 60 * 1000;

/**
 * How alike two venue names must be for a *generic* title to be believed.
 *
 * Measured, and it does not separate cleanly on its own:
 *
 *   Stord kulturhus / Stord Kulturhus     1.00   same place, different case
 *   Bremnes kyrkje  / Moster kyrkje       0.57   different churches
 *   Stord Kulturhus / Storsalen           0.33   SAME event — building versus room
 *
 * A building and one of its rooms score lower than two different churches, so no threshold both
 * refuses the churches and allows the room. Which is why the venue is not consulted for every
 * pair — see `TITLE_DISTINCTIVE_TOKENS`.
 */
export const VENUE_MISMATCH_THRESHOLD = 0.6;

/**
 * A title of at least this many words is treated as evidence in itself.
 *
 * "Grand Kyiv Ballet: Swan Lake" names one event in the world. "Gudstjeneste" names something two
 * churches in the same parish both hold at 11:00 on the same Sunday — identical titles, different
 * events, and no title rule can tell them apart. So a distinctive title is believed on its own,
 * and a generic one has to be corroborated by the venue.
 *
 * This is deliberately asymmetric about which mistake it makes. A false merge hides a real event
 * from someone looking for it; a missed merge shows the same concert twice. The second is a worse
 * page and the first is a worse product, so where the rule is unsure it declines to merge.
 */
export const TITLE_DISTINCTIVE_TOKENS = 4;

export type PairVerdict =
	{ same: true; score: number } | { same: false; reason: string; score: number };

export function comparePair(a: Candidate, b: Candidate): PairVerdict {
	/*
	 * A source never duplicates itself.
	 *
	 * This is the rule that makes the whole thing safe, and it is not an optimisation. Public
	 * swimming runs four times a day under one title from one source: those rows score a perfect
	 * 1.0 against each other and are four different sessions. No title-based rule can tell them
	 * apart, so the only correct move is never to ask.
	 */
	if (a.sourceId !== null && a.sourceId === b.sourceId) {
		return { same: false, reason: 'same source', score: 0 };
	}

	const apart = Math.abs(a.startsAt.getTime() - b.startsAt.getTime());
	if (apart > DUPLICATE_WINDOW_MS) {
		return { same: false, reason: 'too far apart in time', score: 0 };
	}

	const score = titleSimilarity(a.title, b.title);
	if (score < DUPLICATE_TITLE_THRESHOLD) {
		return { same: false, reason: 'titles too different', score };
	}

	const distinctive =
		normaliseTitle(a.title).split(' ').filter(Boolean).length >= TITLE_DISTINCTIVE_TOKENS;

	if (!distinctive && a.venueName && b.venueName) {
		const venueScore = titleSimilarity(a.venueName, b.venueName);
		if (venueScore < VENUE_MISMATCH_THRESHOLD) {
			return { same: false, reason: 'different venues', score };
		}
	}

	return { same: true, score };
}

export type Group = { canonicalId: number; duplicateIds: number[] };

/**
 * Group candidates into events, and pick each group's canonical row.
 *
 * Union-find over the pairs that matched, so A–B and B–C put all three together even when A and C
 * would not have matched each other directly — a tourism board's English title and a venue's
 * Norwegian one often only meet through the newspaper's version in between.
 *
 * The canonical is the lowest id in the group. Not "the most trusted source" or "the fullest row",
 * both of which sound better and change when a source is edited: an id never moves, so a reader's
 * bookmark keeps working and a rerun cannot quietly hand the URL to a different row.
 */
export function groupDuplicates(candidates: readonly Candidate[]): Group[] {
	const parent = new Map<number, number>();
	for (const c of candidates) parent.set(c.id, c.id);

	const find = (id: number): number => {
		let root = id;
		while (parent.get(root) !== root) root = parent.get(root)!;
		// Path compression, so a long chain does not make later lookups quadratic.
		let walk = id;
		while (parent.get(walk) !== root) {
			const next = parent.get(walk)!;
			parent.set(walk, root);
			walk = next;
		}
		return root;
	};

	const union = (x: number, y: number) => {
		const rx = find(x);
		const ry = find(y);
		if (rx === ry) return;
		// Always point the higher id at the lower, so the root is the group's lowest id by
		// construction rather than by a later scan.
		if (rx < ry) parent.set(ry, rx);
		else parent.set(rx, ry);
	};

	/*
	 * Sorted by start, so the inner loop can stop as soon as it passes the window instead of
	 * comparing every row against every other. With a few hundred events a day that is the
	 * difference between instant and noticeable.
	 */
	const sorted = [...candidates].sort(
		(x, y) => x.startsAt.getTime() - y.startsAt.getTime() || x.id - y.id
	);

	for (let i = 0; i < sorted.length; i += 1) {
		for (let j = i + 1; j < sorted.length; j += 1) {
			const a = sorted[i]!;
			const b = sorted[j]!;
			if (b.startsAt.getTime() - a.startsAt.getTime() > DUPLICATE_WINDOW_MS) break;
			if (comparePair(a, b).same) union(a.id, b.id);
		}
	}

	const groups = new Map<number, number[]>();
	for (const c of candidates) {
		const root = find(c.id);
		const members = groups.get(root) ?? [];
		members.push(c.id);
		groups.set(root, members);
	}

	return [...groups.entries()]
		.filter(([, members]) => members.length > 1)
		.map(([canonicalId, members]) => ({
			canonicalId,
			duplicateIds: members.filter((id) => id !== canonicalId).sort((x, y) => x - y)
		}))
		.sort((x, y) => x.canonicalId - y.canonicalId);
}
