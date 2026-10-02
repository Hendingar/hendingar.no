import type { Fixture } from '@hendingar/core/fixture';
import { crestUrl } from './club-crests.ts';

/**
 * Setting a club name inside the versus tile.
 *
 * SVG text does not wrap and does not shrink, so both decisions have to be made before the markup
 * exists. They are made here rather than in the component because they are arithmetic, and
 * arithmetic that is wrong overflows a tile silently — the glyphs just leave the box.
 */

/** The tile's own coordinate system, shared with `EventThumb`'s generated tile. */
export const VIEW = { width: 400, height: 225 };

/**
 * How wide a capital advances, in ems.
 *
 * Taken from `brand.css`: "at 125% width a capital glyph advances ~0.92em". That is Archivo
 * Variable at the display weight, which is the widest thing that can render here — `system-ui` at
 * weight 900, the fallback on a machine without Archivo, advances nearer 0.75. Estimating with the
 * widest means the error is always "the name is a little smaller than it had to be", never "the
 * name runs off the tile".
 */
const ADVANCE = 0.92;

/**
 * The band a name is set in, in user units.
 *
 * The two names sit in opposite corners with the VS lockup between them, so neither gets the whole
 * width. 230 of 400 is what is left beside the mark.
 */
export const BAND = 230;

/** Big enough to read on a 310px card; small enough that two lines still clear the mark. */
const MAX_SIZE = 34;
/** Below this it is decoration rather than a name, and the title beside the tile does the work. */
const MIN_SIZE = 13;

export type NameBlock = {
	/** One or two lines, already uppercased. */
	lines: string[];
	/** The font size in user units, chosen so the longest line fits `BAND`. */
	fontSize: number;
};

function longest(lines: readonly string[]): number {
	return lines.reduce((most, line) => Math.max(most, line.length), 0);
}

/**
 * Split a name into the two lines whose longer half is as short as possible.
 *
 * Stacked, not strung out: "Stord Fotball" on one line has to be set at 19 units to fit the band,
 * and on two lines it fits at 34 — nearly twice the size, which on a thumbnail is the difference
 * between a wordmark and a smudge. Every break is at a space the club's own name already has.
 */
function balance(words: readonly string[]): string[] {
	if (words.length < 2) return [...words];
	let best: string[] = [words.join(' ')];
	for (let cut = 1; cut < words.length; cut += 1) {
		const candidate = [words.slice(0, cut).join(' '), words.slice(cut).join(' ')];
		if (longest(candidate) < longest(best)) best = candidate;
	}
	return best;
}

export function layoutClubName(club: string): NameBlock {
	const words = club.toUpperCase().split(/\s+/).filter(Boolean);
	const lines = balance(words);
	const fitted = BAND / (longest(lines) * ADVANCE);
	// Floored to a tenth, never rounded: rounding up is a tenth of a unit wider than the band, which
	// is how "Fløy-Flekkerøy" came to ink 230.55 units into a 230 unit space.
	const fontSize = Math.max(MIN_SIZE, Math.min(MAX_SIZE, Math.floor(fitted * 10) / 10));
	return { lines, fontSize };
}

export type FixtureSideTile = NameBlock & {
	/** The club's crest, where we have written its id down, and null otherwise. */
	crest: string | null;
};

export type FixtureTile = {
	home: FixtureSideTile;
	away: FixtureSideTile;
	grade: string | null;
	/** What a screen reader is told, since every glyph in the tile is drawn rather than written. */
	label: string;
};

export function fixtureTile(fixture: Fixture): FixtureTile {
	return {
		home: { ...layoutClubName(fixture.home.club), crest: crestUrl(fixture.home.club) },
		away: { ...layoutClubName(fixture.away.club), crest: crestUrl(fixture.away.club) },
		grade: fixture.grade,
		label: `${fixture.home.club} mot ${fixture.away.club}`
	};
}
