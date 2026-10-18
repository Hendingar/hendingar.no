import { describe, expect, it } from 'vitest';
import {
	listSources,
	needsAttention,
	sourceListHref,
	sourceListParams,
	viewCounts,
	type ListableSource
} from './source-list.ts';

const now = new Date('2026-10-14T10:00:00Z');
const today = new Date('2026-10-14T05:00:00Z');
const lastWeek = new Date('2026-10-07T05:00:00Z');

function source(overrides: Partial<ListableSource> & { name: string }): ListableSource {
	return {
		slug: overrides.name.toLowerCase().replace(/\W+/g, '-'),
		kind: 'json-api',
		active: true,
		scheduleCron: '0 5 * * *',
		lastRunAt: today,
		eventsUpcoming: 0,
		activitiesWeekly: 0,
		runs: [{ status: 'success' }],
		...overrides
	};
}

const kulturhus = source({ name: 'Stord kulturhus', eventsUpcoming: 104 });
const bibliotek = source({ name: 'Bømlo folkebibliotek', eventsUpcoming: 12 });
const yoga = source({ name: 'Flow Yoga Bømlo', slug: 'allevents-flow-yoga', eventsUpcoming: 0 });
const teater = source({ name: 'Bømlo Teater', kind: 'link', lastRunAt: null, runs: [] });
const stopped = source({ name: 'Moster Amfi', lastRunAt: lastWeek, eventsUpcoming: 1 });
const failed = source({ name: 'Gruo Pub', runs: [{ status: 'failed' }], eventsUpcoming: 2 });
// Nothing dated, four weekly activities on /alltid-ope — the shape of a frivilligsentral.
const sentral = source({ name: 'Stord Frivilligsentral', activitiesWeekly: 4 });
const all = [bibliotek, teater, yoga, kulturhus, stopped, failed, sentral];

const names = (rows: ListableSource[]) => rows.map((r) => r.name);

describe('sourceListParams', () => {
	it('drops values it does not know rather than refusing them', () => {
		expect(sourceListParams(new URLSearchParams('vis=alt&sorter=tilfeldig&q=%20jazz%20'))).toEqual({
			q: 'jazz',
			vis: null,
			sorter: null
		});
	});

	it('round-trips through the href, leaving defaults out', () => {
		const params = { q: 'bømlo', vis: 'lenkje' as const, sorter: 'namn' as const };
		const href = sourceListHref(params);
		expect(sourceListParams(new URL(href, 'http://x').searchParams)).toEqual(params);
		expect(sourceListHref({ q: '', vis: null, sorter: null })).toBe('/datasamling');
	});
});

describe('listSources', () => {
	const plain = { q: '', vis: null, sorter: null };

	it('puts the sources that contribute most first, and linked ones last', () => {
		expect(names(listSources(all, plain, now))).toEqual([
			'Stord kulturhus',
			'Bømlo folkebibliotek',
			'Gruo Pub',
			'Moster Amfi',
			'Stord Frivilligsentral',
			'Flow Yoga Bømlo',
			'Bømlo Teater'
		]);
	});

	it('sorts by name on request, links included', () => {
		expect(names(listSources(all, { ...plain, sorter: 'namn' }, now))[0]).toBe(
			'Bømlo folkebibliotek'
		);
	});

	it('finds Bømlo without the ø, and a platform by its name', () => {
		expect(names(listSources(all, { ...plain, q: 'bomlo', sorter: 'namn' }, now))).toEqual([
			'Bømlo folkebibliotek',
			'Bømlo Teater',
			'Flow Yoga Bømlo'
		]);
		expect(names(listSources(all, { ...plain, q: 'AllEvents' }, now))).toEqual(['Flow Yoga Bømlo']);
	});

	it('filters to what needs attention, what is empty, and what is only linked', () => {
		expect(names(listSources(all, { ...plain, vis: 'tilsyn' }, now))).toEqual([
			'Gruo Pub',
			'Moster Amfi'
		]);
		expect(names(listSources(all, { ...plain, vis: 'tomme' }, now))).toEqual(['Flow Yoga Bømlo']);
		expect(names(listSources(all, { ...plain, vis: 'lenkje' }, now))).toEqual(['Bømlo Teater']);
		expect(viewCounts(all, now)).toEqual({ tilsyn: 2, tomme: 1, lenkje: 1 });
	});

	it('does not call a calendar of weekly activities empty', () => {
		/*
		 * Stord Frivilligsentral showed "0 framover" and sat under "Ingenting framover" while its
		 * four activities were live on /alltid-ope. Nothing dated is not the same as nothing.
		 */
		expect(names(listSources(all, { ...plain, vis: 'tomme' }, now))).not.toContain(
			'Stord Frivilligsentral'
		);
	});
});

describe('needsAttention', () => {
	it('never flags a source we chose not to collect', () => {
		expect(needsAttention(teater, now)).toBe(false);
	});
});
