import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { CATEGORY_SLUGS } from '@hendingar/core/taxonomy';
import { INSTANCES, buildBody, instanceBySlug, responseSchema } from '../src/api.ts';
import {
	isFailure,
	mapCategory,
	mapEvent,
	posterFrom,
	posterUrlFor,
	slugifyVenue
} from '../src/map.ts';

/**
 * Against a committed real response. No network (CLAUDE.md rule 6).
 */
const fixture = JSON.parse(
	readFileSync(fileURLToPath(new URL('./fixtures/kulleseidkanalen.json', import.meta.url)), 'utf8')
);

const instance = instanceBySlug('kulleseidkanalen')!;
const parsed = responseSchema.parse(fixture);
const upstream = parsed.data.allEventRegistrations.data;

describe('responseSchema', () => {
	it('accepts the real response', () => {
		expect(upstream.length).toBeGreaterThan(0);
		expect(parsed.data.allEventRegistrations.records).toBe(upstream.length);
	});

	it('rejects a response whose shape changed, rather than reporting zero events', () => {
		// A GraphQL API answers 200 with a changed shape as happily as with the right one. Mapping
		// first would turn that into a quiet empty run instead of a loud failure.
		expect(
			responseSchema.safeParse({ data: { allEventRegistrations: { records: 1 } } }).success
		).toBe(false);
	});
});

describe('buildBody', () => {
	it('filters on registration still being open, not on start time', () => {
		// Filtering on EVENT_STARTS_AT would drop an event that has begun but is still running.
		const body = buildBody(instance, new Date('2026-09-03T08:00:00Z'));
		const condition = body.variables.reportFilters[0]!.conditions[0]!;
		expect(condition.field).toBe('EVENT_REGISTRATION_CLOSES_AT');
		expect(condition.operator).toBe('GREATER_THAN_OR_EQUAL');
		// Unix seconds, as the API expects — milliseconds silently match nothing.
		expect(condition.value).toBe('1788422400');
	});

	it('asks for the configured customer', () => {
		expect(buildBody(instance, new Date()).variables.customerId).toBe(instance.customerId);
	});
});

describe('mapEvent', () => {
	const mapped = upstream.map((e) => mapEvent(e, instance));

	it('maps every event in the fixture without failures', () => {
		expect(mapped.filter(isFailure)).toEqual([]);
	});

	it('keeps the instant the source published, offset and all', () => {
		const first = upstream[0]!;
		const m = mapped[0]!;
		if (isFailure(m)) throw new Error('should have mapped');
		expect(m.startsAt.toISOString()).toBe(new Date(first.startsAt).toISOString());
	});

	it('keeps an end time after midnight, because a concert really does end at 02:00', () => {
		const m = mapped[0]!;
		if (isFailure(m)) throw new Error('should have mapped');
		expect(m.endsAt).not.toBeNull();
		expect(m.endsAt!.getTime()).toBeGreaterThan(m.startsAt.getTime());
	});

	it('drops an end time that is not after the start', () => {
		const m = mapEvent({ ...upstream[0]!, endsAt: upstream[0]!.startsAt }, instance);
		if (isFailure(m)) throw new Error('should have mapped');
		expect(m.endsAt).toBeNull();
	});

	it('uses the short place name, not the postal geo string', () => {
		const m = mapped[0]!;
		if (isFailure(m)) throw new Error('should have mapped');
		// geoDescription is "…, Kanalvegen, Finnås, Norge" — an address, not a venue.
		expect(m.venueName).not.toMatch(/Norge/);
		expect(m.venueName).toMatch(/Kulleseidkanalen/i);
	});

	it('links every event to its ticket page', () => {
		for (const m of mapped) {
			if (isFailure(m)) continue;
			expect(m.sourceUrl).toMatch(/^https:\/\/checkin\.no\/event\/\d+$/);
			expect(m.ctaUrl).toBe(m.sourceUrl);
		}
	});

	it('records poster rights from the agreement, and both ways', () => {
		for (const m of mapped) {
			if (isFailure(m)) continue;
			expect(m.posterRightsVerified).toBe(instance.posterRightsCleared);
		}
		const without = mapEvent(upstream[0]!, { ...instance, posterRightsCleared: false });
		if (isFailure(without)) throw new Error('should have mapped');
		expect(without.posterRightsVerified).toBe(false);
	});

	it('rejects an unparseable start rather than storing a wrong one', () => {
		const m = mapEvent({ ...upstream[0]!, startsAt: 'til hausten ein gong' }, instance);
		expect(isFailure(m)).toBe(true);
	});

	it('rejects an empty name', () => {
		expect(isFailure(mapEvent({ ...upstream[0]!, name: '   ' }, instance))).toBe(true);
	});
});

describe('mapCategory', () => {
	it('prefers the specific topic over the generic one', () => {
		// Every Kulleseidkanalen concert carries BOTH — taking the first would file them all as
		// generic, which is the bug this ordering exists to avoid.
		expect(mapCategory(['Kulturarrangement', 'konsert'])).toBe('musikk');
	});

	it('falls back to anna when only a generic topic is present', () => {
		expect(mapCategory(['Kulturarrangement'])).toBe('anna');
	});

	it('falls back to anna for no topics at all', () => {
		expect(mapCategory([])).toBe('anna');
		expect(mapCategory([null, undefined, '  '])).toBe('anna');
	});

	it('only ever returns a slug that exists in the taxonomy', () => {
		for (const topics of [['konsert'], ['teater'], ['ukjent emne'], []]) {
			expect(CATEGORY_SLUGS).toContain(mapCategory(topics));
		}
	});

	it('maps the fixture to something better than all-anna', () => {
		const cats = upstream.map((e) => mapCategory((e.topicEvent ?? []).map((t) => t?.topic?.name)));
		expect(cats.every((c) => c === 'musikk')).toBe(true);
	});
});

describe('posterUrlFor', () => {
	it('absolutises the site-relative path Checkin returns', () => {
		expect(posterUrlFor('/static/12205/event_1/image700.jpg')).toBe(
			'https://checkin.no/static/12205/event_1/image700.jpg'
		);
	});

	it('leaves an absolute URL alone', () => {
		expect(posterUrlFor('https://example.com/a.jpg')).toBe('https://example.com/a.jpg');
	});

	it('is null for nothing', () => {
		expect(posterUrlFor(null)).toBeNull();
		expect(posterUrlFor('  ')).toBeNull();
	});
});

describe('posterFrom', () => {
	it('asks for the widths a card and an event page actually paint', () => {
		// The payload's own `image700` is short of a 434px card on a 2× screen; the resizer answers
		// any width from 500 up, and 400s below it.
		expect(posterFrom('/static/12205/event_1/image700.jpg')).toEqual({
			url: 'https://checkin.no/static/12205/event_1/image1000.jpg',
			srcset: [
				'https://checkin.no/static/12205/event_1/image500.jpg 500w',
				'https://checkin.no/static/12205/event_1/image700.jpg 700w',
				'https://checkin.no/static/12205/event_1/image1000.jpg 1000w'
			].join(', ')
		});
	});

	it('never asks below 500, which the resizer refuses', () => {
		const { srcset } = posterFrom('/static/12205/event_1/image700.jpg');
		for (const width of srcset!.split(', ').map((c) => Number(c.split(' ')[1]!.replace('w', '')))) {
			expect(width).toBeGreaterThanOrEqual(500);
		}
	});

	it('leaves a URL it cannot resize exactly as it found it', () => {
		// Another host, or a filename in a shape whose number is not a width — rewriting either one
		// invents a URL, and an invented URL is a broken poster on every card.
		expect(posterFrom('https://example.com/a.jpg')).toEqual({
			url: 'https://example.com/a.jpg',
			srcset: null
		});
		expect(posterFrom('/static/12205/event_1/poster.jpg')).toEqual({
			url: 'https://checkin.no/static/12205/event_1/poster.jpg',
			srcset: null
		});
	});

	it('is null for nothing', () => {
		expect(posterFrom(null)).toEqual({ url: null, srcset: null });
	});
});

describe('slugifyVenue', () => {
	it('folds Norwegian letters rather than dropping them', () => {
		expect(slugifyVenue('Kulleseidkanalen Gjestehamn')).toBe('kulleseidkanalen-gjestehamn');
		expect(slugifyVenue('Bømlo Åsen Ærlig')).toBe('boemlo-aasen-aerlig');
	});
});

describe('instances', () => {
	it('has unique slugs, because the slug is the source identity', () => {
		const slugs = INSTANCES.map((i) => i.slug);
		expect(new Set(slugs).size).toBe(slugs.length);
	});

	it('keeps the slug the directory already uses, so the source graduates rather than duplicating', () => {
		// packages/core/src/directory.ts lists this same slug as a linked source. If they diverge,
		// the importer creates a second row and /datasamling shows the venue twice.
		expect(instanceBySlug('kulleseidkanalen')).toBeTruthy();
	});
});
