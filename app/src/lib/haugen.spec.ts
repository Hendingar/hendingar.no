import { describe, expect, it } from 'vitest';
import { FLOAT, SINK, buoyancy, pileOrder, whenWords } from './haugen.ts';

describe('buoyancy', () => {
	it('lifts nothing that is not an answer, unsure ones included', () => {
		expect(buoyancy(0)).toBe(0);
		expect(buoyancy(SINK)).toBe(0);
		expect(buoyancy(FLOAT - 0.01)).toBe(0);
	});

	it('rises with the score and is full strength at 0.9', () => {
		expect(buoyancy(FLOAT)).toBeGreaterThan(0);
		expect(buoyancy(0.7)).toBeGreaterThan(buoyancy(FLOAT));
		expect(buoyancy(0.9)).toBe(1);
		expect(buoyancy(1)).toBe(1);
	});
});

describe('whenWords', () => {
	// 2026-10-03 is a Saturday.
	it('names the weekday in Nynorsk and the part of the day', () => {
		expect(whenWords('2026-10-03', 19)).toBe('laurdag kveld');
		expect(whenWords('2026-10-04', 11)).toBe('sundag formiddag');
		expect(whenWords('2026-10-05', 8)).toBe('måndag morgon');
		expect(whenWords('2026-10-06', 14)).toBe('tysdag ettermiddag');
	});

	it('draws the evening line at 17:00', () => {
		expect(whenWords('2026-10-03', 16)).toBe('laurdag ettermiddag');
		expect(whenWords('2026-10-03', 17)).toBe('laurdag kveld');
	});
});

describe('pileOrder', () => {
	const events = [1, 2, 3, 4, 5].map((id) => ({ id }));

	it('keeps date order when nothing has been asked', () => {
		expect(pileOrder(events, new Map()).map((e) => e.id)).toEqual([1, 2, 3, 4, 5]);
	});

	it('puts answers first, best first, and leaves the rest in date order', () => {
		const scores = new Map([
			[2, 0.6],
			[4, 0.9],
			[5, 0.2]
		]);
		expect(pileOrder(events, scores).map((e) => e.id)).toEqual([4, 2, 1, 3, 5]);
	});

	it('breaks a tie between equal answers by date', () => {
		const scores = new Map([
			[3, 0.8],
			[1, 0.8]
		]);
		expect(pileOrder(events, scores).map((e) => e.id)).toEqual([1, 3, 2, 4, 5]);
	});
});
