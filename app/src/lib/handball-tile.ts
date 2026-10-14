import type { HandballMatch } from '@hendingar/core/handball';
import { layoutClubName, type NameBlock } from './fixture-tile.ts';

/**
 * Setting the two names on the handball card.
 *
 * The football card puts its clubs in opposite corners of a diagonal. This one is a different
 * picture — the camera is behind the shooter, the goal is top right and the throwing hand bottom
 * right — so the names stack down the left as a scoreboard does: home, "MOT", away. The width is
 * the same 230 units the versus tile gives a name, so `layoutClubName` decides the size and the
 * line breaks, and only the vertical placement is new.
 */

/** Line pitch, in ems — the versus tile's. */
const LINE = 0.86;
/** How far a capital inks above its baseline, in ems. Archivo's cap height, rounded up. */
const CAP = 0.74;

/** The tag line ("HANDBALL · MENN") sits on this baseline; names start below it. */
export const TAG_Y = 30;
/** The column the names are centred in, below the tag and above the bottom frame. */
const TOP = 46;
const BOTTOM = 206;
/** From the last home baseline to the first away cap: room for "MOT" between rules. */
const GAP = 30;

export type PlacedName = NameBlock & {
	/** One baseline per line, in the tile's 400 × 225 units. */
	baselines: number[];
};

export type HandballTileLayout = {
	home: PlacedName;
	away: PlacedName;
	/** Baseline of the "MOT" between them. */
	motY: number;
	tag: string;
	/** What a screen reader is told, since every glyph in the tile is drawn. */
	label: string;
};

function inkHeight(block: NameBlock): number {
	return block.fontSize * CAP + (block.lines.length - 1) * block.fontSize * LINE;
}

export function handballTile(match: HandballMatch): HandballTileLayout {
	const home = layoutClubName(match.home.club);
	const away = layoutClubName(match.away.club);

	const total = inkHeight(home) + GAP + inkHeight(away);
	// Centred in the column, and never above it — a block that does not fit hangs from the top
	// rather than climbing into the tag.
	const top = TOP + Math.max(0, (BOTTOM - TOP - total) / 2);

	const homeFirst = top + home.fontSize * CAP;
	const homeBaselines = home.lines.map((_, i) => homeFirst + i * home.fontSize * LINE);
	const homeLast = homeBaselines[homeBaselines.length - 1] ?? homeFirst;

	const awayFirst = homeLast + GAP + away.fontSize * CAP;
	const awayBaselines = away.lines.map((_, i) => awayFirst + i * away.fontSize * LINE);

	return {
		home: { ...home, baselines: homeBaselines.map(round) },
		away: { ...away, baselines: awayBaselines.map(round) },
		motY: round(homeLast + GAP / 2 + 4),
		tag: `HANDBALL · ${match.team.toUpperCase()}`,
		label: `Handballkamp: ${match.home.club} mot ${match.away.club}, ${match.team}`
	};
}

function round(n: number): number {
	return Math.round(n * 10) / 10;
}
