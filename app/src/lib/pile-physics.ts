/**
 * The motion of the pile on `/haugen`: circles under gravity, and lift for the answers.
 *
 * Client only — matter-js is imported dynamically by the page once it has mounted, so the server
 * never loads it and a visitor who prefers reduced motion never downloads it. The page keeps the
 * DOM; this keeps bodies, and hands back where each one is.
 *
 * matter-js rather than a few lines of verlet: a hundred circles resting on each other is the case
 * a hand-rolled solver gets wrong — the pile jitters, sinks into itself, or never settles — and
 * a settled pile is most of what makes this feel like a heap of things rather than a screensaver.
 *
 * Deterministic from the ids: where a ball starts is a function of its id and nothing else, so two
 * visits drop the same pile the same way. No `Math.random` anywhere in this file.
 */

import type MatterNs from 'matter-js';

type Matter = typeof MatterNs;

export type BallSpec = { id: number; radius: number };
export type BallPose = { id: number; x: number; y: number; angle: number };

/** Thick enough that a fast ball cannot tunnel through a wall in one step. */
const WALL = 400;

/**
 * How far inside the box the walls stand.
 *
 * An answer is drawn with a ring and a shadow outside its circle, and the box clips at its edge —
 * so a ball pressed against the ceiling lost the top of its ring. The walls stand this far in,
 * which is the ring (5px) and its shadow with a little to spare.
 */
const INSET = 10;

/**
 * How much stronger than gravity a full-strength answer is pulled up.
 *
 * At 1.6 the best answers reach the top in about a second from the floor of a desktop pile —
 * quick enough to read as a response to what was typed, slow enough to be seen rising.
 */
const LIFT = 1.6;

/*
 * Collision layers. A lifted ball is a bubble: it passes through the heap of unlifted balls
 * instead of being trapped under it, and stacks only against the walls and other bubbles. Without
 * this an answer that happened to land at the bottom stayed buried under thirty balls nobody asked
 * for — seen on the first run, a 74% "Songkveld" pinned to the floor.
 */
const WALLS = 0x1;
const HEAP = 0x2;
const BUBBLES = 0x4;

/** A stable number in [0, 1) from an id and a salt — the same every visit, unlike `Math.random`. */
function spread(id: number, salt: number): number {
	const x = Math.sin(id * 12.9898 + salt * 78.233) * 43758.5453;
	return x - Math.floor(x);
}

export class PileWorld {
	readonly #m: Matter;
	readonly #engine: MatterNs.Engine;
	readonly #balls = new Map<number, { body: MatterNs.Body; radius: number }>();
	readonly #lift = new Map<number, number>();
	#walls: MatterNs.Body[] = [];
	#width: number;
	#height: number;
	#drag: { constraint: MatterNs.Constraint; id: number } | null = null;
	#stirring = false;
	#frame = 0;

	constructor(matter: Matter, width: number, height: number) {
		this.#m = matter;
		this.#width = width;
		this.#height = height;
		this.#engine = matter.Engine.create({
			gravity: { x: 0, y: 1, scale: 0.001 },
			// Sleeping is what lets a settled pile cost nothing: bodies at rest stop being
			// integrated until something touches them.
			enableSleeping: true,
			positionIterations: 8,
			velocityIterations: 6
		});
		matter.Events.on(this.#engine, 'beforeUpdate', () => this.#applyLift());
		this.#buildWalls();
	}

	/**
	 * Make the world hold exactly these balls.
	 *
	 * A new ball is dropped in from a height chosen by its id. A ball that has gone is removed. A
	 * ball whose radius changed is scaled in place — an answer swelling where it stands, rather
	 * than vanishing and reappearing larger.
	 */
	sync(specs: readonly BallSpec[]): void {
		const { Bodies, Body, Composite, Sleeping } = this.#m;
		const wanted = new Set(specs.map((s) => s.id));

		for (const [id, ball] of this.#balls) {
			if (wanted.has(id)) continue;
			if (this.#drag?.id === id) this.release();
			Composite.remove(this.#engine.world, ball.body);
			this.#balls.delete(id);
		}

		for (const spec of specs) {
			const existing = this.#balls.get(spec.id);
			if (existing) {
				if (Math.abs(existing.radius - spec.radius) > 0.5) {
					Body.scale(existing.body, spec.radius / existing.radius, spec.radius / existing.radius);
					existing.radius = spec.radius;
					Sleeping.set(existing.body, false);
				}
				continue;
			}
			const edge = spec.radius + INSET;
			const x = edge + spread(spec.id, 1) * Math.max(1, this.#width - 2 * edge);
			const y = edge + spread(spec.id, 2) * Math.max(1, this.#height * 0.6);
			const body = Bodies.circle(x, y, spec.radius, {
				restitution: 0.15,
				friction: 0.08,
				frictionAir: 0.025,
				density: 0.001,
				angle: spread(spec.id, 3) * Math.PI * 2,
				collisionFilter: {
					category: this.#lift.has(spec.id) ? BUBBLES : HEAP,
					mask: WALLS | (this.#lift.has(spec.id) ? BUBBLES : HEAP)
				}
			});
			Composite.add(this.#engine.world, body);
			this.#balls.set(spec.id, { body, radius: spec.radius });
		}
	}

	/** How hard each ball is pushed up, 0 to 1. Ids absent from the map are not lifted. */
	setLift(lift: ReadonlyMap<number, number>): void {
		this.#lift.clear();
		for (const [id, value] of lift) if (value > 0) this.#lift.set(id, value);
		for (const [id, { body }] of this.#balls) {
			const bubble = this.#lift.has(id);
			body.collisionFilter.category = bubble ? BUBBLES : HEAP;
			body.collisionFilter.mask = WALLS | (bubble ? BUBBLES : HEAP);
		}
		this.wake();
	}

	/**
	 * Sift the heap while a question is out: every few frames a handful of balls are nudged up and
	 * sideways, and fall back. Something is being looked through, and the pile shows it.
	 *
	 * Which balls, and which way, come from the id and the frame — no `Math.random`, so the same
	 * wait looks the same twice.
	 */
	setStirring(on: boolean): void {
		if (on === this.#stirring) return;
		this.#stirring = on;
		if (on) this.wake();
	}

	resize(width: number, height: number): void {
		if (width === this.#width && height === this.#height) return;
		this.#width = width;
		this.#height = height;
		this.#buildWalls();
		// Anything now outside the box is put back inside it, rather than left to fall forever.
		for (const { body, radius } of this.#balls.values()) {
			const x = Math.min(Math.max(body.position.x, radius + INSET), width - radius - INSET);
			const y = Math.min(Math.max(body.position.y, radius + INSET), height - radius - INSET);
			this.#m.Body.setPosition(body, { x, y });
		}
		this.wake();
	}

	step(ms: number): void {
		// A long frame (a background tab coming back) is clamped: matter-js integrates badly over
		// large steps, and a pile that explodes on return is worse than one that pauses.
		this.#m.Engine.update(this.#engine, Math.min(ms, 1000 / 30));
	}

	/** True once every ball is asleep and nothing is held — the page can stop asking for frames. */
	get settled(): boolean {
		if (this.#drag || this.#stirring) return false;
		for (const { body } of this.#balls.values()) if (!body.isSleeping) return false;
		return true;
	}

	*poses(): Generator<BallPose> {
		for (const [id, { body }] of this.#balls) {
			yield { id, x: body.position.x, y: body.position.y, angle: body.angle };
		}
	}

	wake(): void {
		for (const { body } of this.#balls.values()) this.#m.Sleeping.set(body, false);
	}

	/** Pick a ball up at a point in its own box. */
	grab(id: number, x: number, y: number): void {
		const ball = this.#balls.get(id);
		if (!ball) return;
		this.release();
		const { Constraint, Composite, Sleeping } = this.#m;
		const constraint = Constraint.create({
			pointA: { x, y },
			bodyB: ball.body,
			pointB: { x: x - ball.body.position.x, y: y - ball.body.position.y },
			stiffness: 0.15,
			damping: 0.1,
			length: 0
		});
		Composite.add(this.#engine.world, constraint);
		Sleeping.set(ball.body, false);
		this.#drag = { constraint, id };
	}

	drag(x: number, y: number): void {
		if (!this.#drag) return;
		this.#drag.constraint.pointA = { x, y };
	}

	release(): void {
		if (!this.#drag) return;
		this.#m.Composite.remove(this.#engine.world, this.#drag.constraint);
		this.#drag = null;
		this.wake();
	}

	destroy(): void {
		this.#m.Events.off(this.#engine, 'beforeUpdate');
		this.#m.Composite.clear(this.#engine.world, false);
		this.#m.Engine.clear(this.#engine);
		this.#balls.clear();
	}

	#applyLift(): void {
		const g = this.#engine.gravity;
		this.#frame += 1;
		if (this.#stirring && this.#frame % 12 === 0) {
			const beat = this.#frame / 12;
			for (const [id, { body }] of this.#balls) {
				if (this.#lift.has(id) || spread(id, beat) < 0.82) continue;
				const kick = body.mass * g.y * g.scale;
				this.#m.Sleeping.set(body, false);
				this.#m.Body.applyForce(body, body.position, {
					x: kick * (spread(id, beat + 0.5) - 0.5) * 6,
					y: -kick * (8 + spread(id, beat + 0.25) * 8)
				});
			}
		}
		for (const [id, lift] of this.#lift) {
			const ball = this.#balls.get(id);
			if (!ball) continue;
			const { body } = ball;
			// Cancel the ball's weight, then pull up by a share of it: a lifted ball accelerates
			// upwards at LIFT × lift × g, and the strongest answers win the race to the top.
			const up = body.mass * g.y * g.scale * (1 + LIFT * lift);
			this.#m.Body.applyForce(body, body.position, { x: 0, y: -up });
		}
	}

	#buildWalls(): void {
		const { Bodies, Composite } = this.#m;
		if (this.#walls.length) Composite.remove(this.#engine.world, this.#walls);
		const w = this.#width;
		const h = this.#height;
		const opts = {
			isStatic: true,
			friction: 0.1,
			restitution: 0.1,
			collisionFilter: { category: WALLS, mask: HEAP | BUBBLES }
		};
		const i = INSET;
		this.#walls = [
			Bodies.rectangle(w / 2, h - i + WALL / 2, w + 2 * WALL, WALL, opts),
			Bodies.rectangle(w / 2, i - WALL / 2, w + 2 * WALL, WALL, opts),
			Bodies.rectangle(i - WALL / 2, h / 2, WALL, h + 2 * WALL, opts),
			Bodies.rectangle(w - i + WALL / 2, h / 2, WALL, h + 2 * WALL, opts)
		];
		Composite.add(this.#engine.world, this.#walls);
	}
}

/**
 * How big a ball is, and how many fit.
 *
 * The heap should fill the lower part of the box and leave sky above it for answers to rise into
 * — about 30% of the box covered — and no ball smaller than a thumbnail can be recognised at. So a narrow screen shows fewer, larger balls rather than all
 * of them as confetti: `capacity` is how many the box can hold at the smallest readable size, and
 * the page shows that many of the pile in its current order.
 */
export function ballSizing(width: number, height: number, count: number) {
	// A heap in the lower part of the stage, with open sky above it for answers to rise into.
	const FILL = 0.3;
	const minRadius = Math.min(30, Math.max(17, width / 45));
	const maxRadius = minRadius * 1.6;
	const area = FILL * width * height;
	const capacity = Math.max(1, Math.floor(area / (Math.PI * minRadius * minRadius)));
	const shown = Math.min(count, capacity);
	const radius = Math.min(maxRadius, Math.max(minRadius, Math.sqrt(area / (shown * Math.PI))));
	return { radius, capacity };
}

/**
 * Each ball a little different, by id — a heap of identical coins reads as a chart.
 * Between 85% and 115% of the base radius.
 */
export function ballVariance(id: number): number {
	return 0.85 + spread(id, 4) * 0.3;
}

/**
 * Which element is which ball, and how big it is — for the frame loop to move without Svelte.
 *
 * Sixty times a second the loop writes a transform straight onto each element. Routing that
 * through reactive state would re-render a hundred balls per frame to move them a pixel, so this
 * bookkeeping lives here, outside the component and outside reactivity, on purpose.
 */
export class BallStage {
	readonly #elements = new Map<number, HTMLElement>();
	readonly #radii = new Map<number, number>();

	/** An attachment: remembers the element while it is mounted. */
	register(id: number) {
		return (el: HTMLElement) => {
			this.#elements.set(id, el);
			return () => {
				if (this.#elements.get(id) === el) this.#elements.delete(id);
			};
		};
	}

	size(id: number, radius: number): void {
		this.#radii.set(id, radius);
	}

	place({ id, x, y, angle }: BallPose): void {
		const el = this.#elements.get(id);
		const r = this.#radii.get(id);
		if (!el || r === undefined) return;
		// Only the picture turns. The ball's box moves without rotating, so the score under it and
		// the card beside it stay level and readable while the heap tumbles.
		el.style.transform = `translate(${x - r}px, ${y - r}px)`;
		el.style.setProperty('--turn', `${angle}rad`);
	}
}
