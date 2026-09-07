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

/**
 * The second customer, and the one that found the filter bug: a husflidslag course published
 * through husflid.no's proxy in front of this same API.
 */
const husflidFixture = JSON.parse(
	readFileSync(fileURLToPath(new URL('./fixtures/bomlo-husflidslag.json', import.meta.url)), 'utf8')
);
const husflid = instanceBySlug('husflid-bomlo')!;
const husflidUpstream = responseSchema.parse(husflidFixture).data.allEventRegistrations.data;

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
	it('filters on the event not being over, not on registration or start time', () => {
		/*
		 * EVENT_STARTS_AT would drop an event that has begun but is still running. So, it turns out,
		 * did EVENT_REGISTRATION_CLOSES_AT, which is what this used to assert: Checkin treats
		 * registration for a started event as closed, so on 7 September Bømlo Husflidslag's
		 * 9–23 September course came back under EVENT_ENDS_AT and not at all under the old field.
		 */
		const body = buildBody(instance, new Date('2026-09-03T08:00:00Z'));
		const condition = body.variables.reportFilters[0]!.conditions[0]!;
		expect(condition.field).toBe('EVENT_ENDS_AT');
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

describe('the husflidslag course', () => {
	const mapped = husflidUpstream.map((e) => mapEvent(e, husflid));

	it('maps without failures', () => {
		expect(mapped.filter(isFailure)).toEqual([]);
		expect(mapped.length).toBeGreaterThan(0);
	});

	it('takes the full description, which is the only one this customer writes', () => {
		/*
		 * The reason `description` is requested at all. `sellingDescription` is empty here, so
		 * mapping the teaser alone imported this course with nothing to read — and the field that
		 * does carry it is editor HTML, which has to be stripped rather than stored.
		 */
		const [first] = mapped;
		if (!first || isFailure(first)) throw new Error('should have mapped');
		expect(husflidUpstream[0]!.sellingDescription).toBe('');
		expect(first.description).toBeTruthy();
		expect(first.description).toContain('Bømlo Husflidslag arrangerer Bunadkurs');
		expect(first.description).not.toMatch(/<[a-z]/i);
	});

	it('prefers the full text over the teaser when both exist', () => {
		const m = mapEvent({ ...husflidUpstream[0]!, sellingDescription: 'Kort teaser' }, husflid);
		if (isFailure(m)) throw new Error('should have mapped');
		expect(m.description).toContain('Bunadkurs');
		expect(m.description).not.toBe('Kort teaser');
	});

	it('falls back to the teaser when there is no full text', () => {
		const m = mapEvent(
			{ ...husflidUpstream[0]!, description: null, sellingDescription: 'Kort teaser' },
			husflid
		);
		if (isFailure(m)) throw new Error('should have mapped');
		expect(m.description).toBe('Kort teaser');
	});

	it('keeps a course that spans weeks as the span the lag stated', () => {
		// Three Wednesday sessions, published as one registration running 9-23 September. The end is
		// two weeks after the start and is not upstream noise.
		const [first] = mapped;
		if (!first || isFailure(first)) throw new Error('should have mapped');
		expect(first.startsAt.toISOString()).toBe('2026-09-09T16:00:00.000Z');
		expect(first.endsAt?.toISOString()).toBe('2026-09-23T19:00:00.000Z');
	});

	it('claims no rights over the lag’s pictures', () => {
		// Kulleseidkanalen has agreed; a husflidslag has not been asked. Asserted per instance so the
		// two cannot drift into sharing one default.
		expect(husflid.posterRightsCleared).toBe(false);
		const [first] = mapped;
		if (!first || isFailure(first)) throw new Error('should have mapped');
		expect(first.posterRightsVerified).toBe(false);
	});

	it('files a course with no topic as anna rather than guessing from its title', () => {
		// "Bunadskurs" is obviously a kurs, and the payload says nothing, so `anna` is the honest
		// answer — reading the title would be exactly what ADR 0004 keeps out of the import path.
		expect(husflidUpstream[0]!.topicEvent).toEqual([]);
		const [first] = mapped;
		if (!first || isFailure(first)) throw new Error('should have mapped');
		expect(first.category).toBe('anna');
	});
});
