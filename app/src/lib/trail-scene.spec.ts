import { describe, expect, it } from 'vitest';
import { TRAIL_GRADES } from '@hendingar/core/trail';
import { SAFE, trailScene, VIEW } from './trail-scene.ts';

const IDS = Array.from({ length: 60 }, (_, i) => i * 37 + 1);

describe('trailScene', () => {
	it('is the same mountain every time for the same trip', () => {
		const trail = { grade: 'middels' as const, audiences: [] };
		expect(trailScene(568, trail)).toEqual(trailScene(568, trail));
		expect(trailScene(568, trail).mid).not.toBe(trailScene(569, trail).mid);
	});

	it('keeps the summit and every T mark inside what a phone’s square shows', () => {
		for (const grade of TRAIL_GRADES) {
			for (const id of IDS) {
				const scene = trailScene(id, { grade, audiences: [] });
				for (const point of [scene.summit, ...scene.marks]) {
					expect(point.x, `${grade} #${id}`).toBeGreaterThanOrEqual(SAFE.left);
					expect(point.x, `${grade} #${id}`).toBeLessThanOrEqual(SAFE.right);
					expect(point.y).toBeGreaterThan(0);
					expect(point.y).toBeLessThan(VIEW.height);
				}
			}
		}
	});

	it('draws a harder grade as a taller mountain with more turns to the top', () => {
		const scenes = TRAIL_GRADES.map((grade) => trailScene(7, { grade, audiences: [] }));
		const heights = scenes.map((s) => s.summit.y);
		expect([...heights].sort((a, b) => b - a)).toEqual(heights);
		expect(scenes.map((s) => s.marks.length)).toEqual([1, 2, 3, 4]);
	});

	it('only puts snow on the grades that would have it', () => {
		expect(trailScene(7, { grade: 'enkel', audiences: [] }).snow).toEqual([]);
		expect(trailScene(7, { grade: 'middels', audiences: [] }).snow).toEqual([]);
		expect(trailScene(7, { grade: 'krevende', audiences: [] }).snow.length).toBeGreaterThan(0);
	});

	it('still draws a mountain for a trip that names its audience but no grade', () => {
		const scene = trailScene(7, { grade: null, audiences: ['barn'] });
		expect(scene.marks.length).toBeGreaterThan(0);
	});
});
