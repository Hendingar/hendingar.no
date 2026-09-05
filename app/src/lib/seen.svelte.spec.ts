import { beforeEach, describe, expect, it } from 'vitest';
import { markSeen } from './seen.ts';

/**
 * The whole view counter rests on this, in a real browser with real storage.
 *
 * The server keeps only a total and is told nothing about who asked, so this list is the only
 * thing standing between "one view per browser" and "one view per reload". If it stops
 * remembering, the number silently becomes a page-load counter and nothing else fails.
 */
describe('markSeen', () => {
	beforeEach(() => localStorage.clear());

	it('is true the first time and false ever after', () => {
		expect(markSeen(41)).toBe(true);
		expect(markSeen(41)).toBe(false);
		expect(markSeen(41)).toBe(false);
	});

	it('tracks each event separately', () => {
		expect(markSeen(1)).toBe(true);
		expect(markSeen(2)).toBe(true);
		expect(markSeen(1)).toBe(false);
		expect(markSeen(2)).toBe(false);
		expect(markSeen(3)).toBe(true);
	});

	it('survives a reload, which is the case it exists for', () => {
		// Same storage, fresh read: this is what a second visit to the same page does.
		markSeen(7);
		expect(JSON.parse(localStorage.getItem('hendingar:seen') ?? '[]')).toContain(7);
		expect(markSeen(7)).toBe(false);
	});

	it('forgets the oldest rather than growing without bound', () => {
		for (let id = 1; id <= 520; id++) markSeen(id);
		const stored: number[] = JSON.parse(localStorage.getItem('hendingar:seen') ?? '[]');
		expect(stored).toHaveLength(500);
		// The first twenty fell off the front, so they would count once more. That is the harmless
		// direction: the alternative is a list that grows until storage refuses to take it.
		expect(stored).not.toContain(1);
		expect(stored).toContain(520);
		expect(markSeen(1)).toBe(true);
	});

	it('treats corrupt storage as empty instead of throwing', () => {
		// A page cannot fail to render because something else wrote nonsense under our key.
		localStorage.setItem('hendingar:seen', 'not json at all');
		expect(() => markSeen(5)).not.toThrow();
		expect(markSeen(5)).toBe(false);
	});

	it('ignores entries that are not event ids', () => {
		localStorage.setItem('hendingar:seen', JSON.stringify([1, 'two', null, 3.5, 4]));
		expect(markSeen(4)).toBe(false);
		expect(markSeen(1)).toBe(false);
		expect(markSeen(2)).toBe(true);
	});
});
