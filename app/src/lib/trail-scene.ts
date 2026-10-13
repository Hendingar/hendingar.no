import type { Trail, TrailGrade } from '@hendingar/core/trail';

/**
 * The landscape a trail card draws, as numbers.
 *
 * Arithmetic rather than markup for the same reason `fixture-tile.ts` is: geometry that is wrong
 * fails silently — a trail that leaves its mountain, a summit cropped off a phone's square — and
 * a pure function can be tested under node where a component cannot.
 *
 * ## The grade decides the mountain
 *
 * That is the whole idea of the card. An Enkel trip is rolling hills and a short gentle path; a
 * Krevjande one is a jagged peak with snow on it and a path that switchbacks four times to get
 * there. The shape is a reading of DNT's grade, so a reader learns how hard the trip is from
 * across the room, before the chip under it says the word.
 *
 * Deterministic per event: a small seeded generator, never `Math.random`, so the server and the
 * browser draw the same mountain and the same trip is the same card forever.
 */

/** The card's coordinate system, the same 16:9 as every other thumbnail. */
export const VIEW = { width: 400, height: 225 };

/**
 * The band everything that matters stays inside.
 *
 * Below 34rem a thumbnail is a 5.5rem square cut from the middle of the 16:9 box
 * (`xMidYMid slice`), which keeps x from 87.5 to 312.5. The summit, the path and the chips are
 * all drawn in there; only scenery runs out to the edges.
 */
export const SAFE = { left: 96, right: 304 };

type Shape = {
	/** How high the summit stands, as a y in the card. Lower is taller. */
	summitY: number;
	/** How much the ridge wanders either side of the main mountain's flanks. */
	jitter: number;
	/** Turns in the path between the trailhead and the summit. */
	switchbacks: number;
	/** Rounded hills, or broken rock. */
	smooth: boolean;
	/** Snow on the tops. */
	snow: boolean;
};

const SHAPES: Record<TrailGrade, Shape> = {
	enkel: { summitY: 128, jitter: 6, switchbacks: 1, smooth: true, snow: false },
	middels: { summitY: 92, jitter: 12, switchbacks: 2, smooth: true, snow: false },
	krevende: { summitY: 58, jitter: 20, switchbacks: 3, smooth: false, snow: true },
	ekspert: { summitY: 40, jitter: 28, switchbacks: 4, smooth: false, snow: true }
};

/** A trip with audiences but no grade still gets a mountain — the middling one. */
const UNGRADED: Shape = SHAPES.middels;

export type Point = { x: number; y: number };

export type TrailScene = {
	/** Three ridges, back to front, each a closed path. */
	far: string;
	mid: string;
	near: string;
	/** Snow caps on the main ridge, one closed path each. Empty below Krevjande. */
	snow: string[];
	summit: Point;
	/** The walked line, trailhead to summit. */
	path: string;
	/**
	 * Where DNT's red T is painted: the corners of the path, in walking order, each with `at` —
	 * the share of the path walked when it is reached.
	 */
	marks: (Point & { at: number })[];
	sun: Point;
	cloud: Point;
};

/** mulberry32: four lines of seeded randomness, good enough for scenery and identical everywhere. */
function seeded(seed: number): () => number {
	let a = seed >>> 0;
	return () => {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = a;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

const round = (n: number) => Math.round(n * 10) / 10;

/** A ridge as points across the full width, from a peak and a falloff, with seeded wander. */
function ridge(
	random: () => number,
	peak: Point,
	base: number,
	spread: number,
	jitter: number,
	steps = 16
): Point[] {
	const points: Point[] = [];
	for (let i = 0; i <= steps; i += 1) {
		const x = -20 + (i * (VIEW.width + 40)) / steps;
		const fall = Math.min(1, Math.abs(x - peak.x) / spread);
		const y = peak.y + (base - peak.y) * fall ** 1.35 + (random() - 0.5) * 2 * jitter * fall;
		points.push({ x: round(x), y: round(Math.min(base, y)) });
	}
	// The peak itself, exactly, so the summit flag stands on rock rather than beside it.
	points.push(peak);
	return points.sort((a, b) => a.x - b.x);
}

/** A ridge line as a filled shape down to the bottom edge. Rounded hills use midpoint curves. */
function closed(points: readonly Point[], smooth: boolean): string {
	const [first, ...rest] = points;
	if (!first) return '';
	let d = `M${-20} ${VIEW.height + 20} L${first.x} ${first.y}`;
	if (smooth) {
		for (let i = 0; i < rest.length; i += 1) {
			const p = rest[i]!;
			const next = rest[i + 1];
			const end = next ? { x: (p.x + next.x) / 2, y: (p.y + next.y) / 2 } : p;
			d += ` Q${p.x} ${p.y} ${round(end.x)} ${round(end.y)}`;
		}
	} else {
		for (const p of rest) d += ` L${p.x} ${p.y}`;
	}
	return `${d} L${VIEW.width + 20} ${VIEW.height + 20} Z`;
}

/** The ridge's height at x, by straight interpolation between its points. */
function heightAt(points: readonly Point[], x: number): number {
	for (let i = 0; i < points.length - 1; i += 1) {
		const a = points[i]!;
		const b = points[i + 1]!;
		if (x >= a.x && x <= b.x) return a.y + ((b.y - a.y) * (x - a.x)) / (b.x - a.x || 1);
	}
	return VIEW.height;
}

export function trailScene(id: number, trail: Trail): TrailScene {
	const random = seeded(id * 2654435761);
	const shape = trail.grade ? SHAPES[trail.grade] : UNGRADED;

	const summit = {
		x: round(SAFE.left + 110 + random() * (SAFE.right - SAFE.left - 130)),
		y: shape.summitY
	};

	const farPeak = { x: round(40 + random() * 120), y: round(shape.summitY + 30 + random() * 20) };
	const nearPeak = { x: round(300 + random() * 100), y: round(178 + random() * 14) };

	const farRidge = ridge(random, farPeak, 200, 220, shape.jitter * 0.6);
	// Broken rock needs more points than rolling hills, or a "jagged" ridge is four straight lines.
	const midRidge = ridge(random, summit, 214, 190, shape.jitter, shape.smooth ? 16 : 30);
	const nearRidge = ridge(random, nearPeak, 232, 260, 4);

	/*
	 * The path climbs the main mountain's face from a trailhead at the bottom of the safe band,
	 * turning `switchbacks` times. Every corner is kept a little below the ridge line at its x, so
	 * the walked line is always on the mountain and never in the sky beside it.
	 */
	const trailhead = { x: SAFE.left + 18, y: 216 };
	const corners: Point[] = [trailhead];
	for (let k = 1; k <= shape.switchbacks; k += 1) {
		const t = k / (shape.switchbacks + 1);
		const swing = (k % 2 === 1 ? 1 : -0.55) * (1 - t) * 70;
		const x = round(Math.max(SAFE.left + 8, Math.min(SAFE.right - 8, summit.x - 40 + swing)));
		const y = round(Math.max(216 - t * (216 - summit.y), heightAt(midRidge, x) + 10));
		corners.push({ x, y });
	}
	corners.push({ x: summit.x, y: summit.y + 3 });

	let path = `M${trailhead.x} ${trailhead.y}`;
	for (let i = 1; i < corners.length; i += 1) {
		const p = corners[i]!;
		if (shape.smooth) {
			const prev = corners[i - 1]!;
			path += ` Q${round((prev.x + p.x) / 2 + 14)} ${round((prev.y + p.y) / 2 + 6)} ${p.x} ${p.y}`;
		} else {
			path += ` L${p.x} ${p.y}`;
		}
	}

	/*
	 * Snow: a cap on the summit and whatever of the ridge beside it stands as high, with a ragged
	 * lower edge — alternating short and long tongues running down the rock, which is what reads
	 * as snow rather than as a roof. Each end tapers to the ridge itself.
	 */
	const snow: string[] = [];
	if (shape.snow) {
		const line = shape.summitY + 30;
		const tops = midRidge.filter((p) => p.y < line);
		if (tops.length > 1) {
			const upper = tops.map((p) => `${p.x} ${p.y}`).join(' L');
			const lower = tops
				.slice(1, -1)
				.reverse()
				.map((p, i) => `${p.x} ${round(Math.min(line + 6, p.y + (i % 2 ? 6 : 15)))}`);
			const d = [`M${upper}`, ...lower.map((point) => `L${point}`), 'Z'].join(' ');
			snow.push(d);
		}
	}

	/*
	 * When the drawn path reaches each corner, as a share of its whole length — so a T mark is
	 * painted as the path arrives at it, not before. Straight-line lengths: the curves on the
	 * gentle grades bow a little, and a mark a few milliseconds early is not visible.
	 */
	const legs = corners.slice(1).map((p, i) => Math.hypot(p.x - corners[i]!.x, p.y - corners[i]!.y));
	const total = legs.reduce((sum, leg) => sum + leg, 0) || 1;
	let walked = 0;
	const reached = legs.map((leg) => (walked += leg) / total);

	return {
		far: closed(farRidge, true),
		mid: closed(midRidge, shape.smooth),
		near: closed(nearRidge, true),
		snow,
		summit,
		path,
		marks: corners.slice(1, -1).map((p, i) => ({ ...p, at: round(reached[i] ?? 1) })),
		/*
		 * Right of centre: the top-left corner of every card carries the "om 2 t" badge, and a sun
		 * under it is a sun nobody sees. Behind the summit is fine — that is a sunset.
		 */
		sun: { x: round(SAFE.right - 30 - random() * 50), y: round(38 + random() * 18) },
		cloud: { x: round(160 + random() * 120), y: round(28 + random() * 22) }
	};
}
