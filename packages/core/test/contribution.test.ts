import { describe, expect, it } from 'vitest';
import {
	CONTRIBUTABLE_FIELDS,
	CONTRIBUTABLE_FIELD_LABELS,
	IDENTITY_FIELDS,
	describeFields,
	hasValue,
	isWorthContributing,
	planContribution
} from '../src/contribution.ts';

describe('hasValue', () => {
	it('treats an empty or blank string as nothing', () => {
		// A form posts '' for every box nobody touched. Counting that as a value would make an
		// untouched field look like a contribution, and an existing gap look filled.
		expect(hasValue('')).toBe(false);
		expect(hasValue('   ')).toBe(false);
		expect(hasValue('\n\t')).toBe(false);
	});

	it('treats null and undefined as nothing', () => {
		expect(hasValue(null)).toBe(false);
		expect(hasValue(undefined)).toBe(false);
	});

	it('treats an unparseable Date as nothing', () => {
		// `new Date('')` is a Date and holds nothing. A truthiness check would pass it.
		expect(hasValue(new Date(''))).toBe(false);
		expect(hasValue(new Date('2026-09-13T18:00:00Z'))).toBe(true);
	});

	it('accepts text with content', () => {
		expect(hasValue('https://example.org')).toBe(true);
		expect(hasValue(' x ')).toBe(true);
	});
});

describe('planContribution', () => {
	it('fills a gap and leaves an occupied field alone', () => {
		const plan = planContribution(
			{ posterUrl: null, sourceUrl: 'https://kulturhus.no/rolfsnes', description: 'Marknad.' },
			{
				posterUrl: 'https://store.example/769.jpg',
				sourceUrl: 'https://facebook.com/photo/1',
				description: 'Ein mykje betre skildring.'
			}
		);

		expect(plan.fill).toEqual(['posterUrl']);
		// The other two are offered and already held: not writes, but recorded as corroboration.
		expect(plan.redundant).toEqual(['sourceUrl', 'description']);
	});

	it('never reports a field as both a fill and redundant', () => {
		const plan = planContribution(
			{ posterUrl: null, ctaUrl: 'https://tikkio.com/x' },
			{ posterUrl: 'https://store.example/1.jpg', ctaUrl: 'https://ticketmaster.no/y' }
		);
		for (const field of plan.fill) expect(plan.redundant).not.toContain(field);
	});

	it('reports every gap on the canonical row, offered or not', () => {
		// What the invitation is built from: "denne manglar bilete og billettlenkje" is a specific
		// ask. It has to describe the row, not the submission that happened to arrive.
		const plan = planContribution(
			{ sourceUrl: 'https://kulturhus.no/x', description: 'Noko.', organizerName: 'Soga' },
			{ posterUrl: 'https://store.example/1.jpg' }
		);

		expect(plan.gaps).toEqual(['posterUrl', 'ctaUrl', 'endsAt']);
		expect(plan.fill).toEqual(['posterUrl']);
	});

	it('offers nothing when the submission adds nothing', () => {
		const plan = planContribution(
			{ posterUrl: null },
			{ posterUrl: '   ', sourceUrl: '', description: undefined }
		);
		expect(plan.fill).toEqual([]);
		expect(plan.redundant).toEqual([]);
		expect(isWorthContributing(plan)).toBe(false);
	});

	it('fills an end time only when the canonical has none', () => {
		const offered = { endsAt: new Date('2026-09-13T20:00:00Z') };
		expect(planContribution({ endsAt: null }, offered).fill).toEqual(['endsAt']);
		expect(planContribution({ endsAt: new Date('2026-09-13T21:00:00Z') }, offered).fill).toEqual(
			[]
		);
	});

	it('cannot be talked into touching an identity field', () => {
		/*
		 * The guard that matters. A contribution is authorised by a browser-local id, so the one
		 * thing it must never do is repoint an event a reader followed a link to. Passing identity
		 * fields in is not a type error — both sides are partial records keyed by field name — so
		 * this asserts the *behaviour*: they are not in the plan, whatever is offered.
		 */
		const plan = planContribution(
			{ posterUrl: null },
			// @ts-expect-error identity fields are not contributable, and that is the point
			{ title: 'Ei heilt anna hending', startsAt: new Date(), category: 'konsert' }
		);

		expect(plan.fill).toEqual([]);
		expect(plan.redundant).toEqual([]);
		for (const field of IDENTITY_FIELDS) {
			expect(plan.fill).not.toContain(field);
			expect(plan.gaps).not.toContain(field);
		}
	});

	it('is monotone: replaying a plan against the filled row writes nothing', () => {
		/*
		 * Two contributors, one gap. The second must find it closed rather than overwrite the
		 * first — which is the whole safety argument, so it is asserted rather than assumed.
		 */
		const first = planContribution({ posterUrl: null }, { posterUrl: 'https://a.example/1.jpg' });
		expect(first.fill).toEqual(['posterUrl']);

		const second = planContribution(
			{ posterUrl: 'https://a.example/1.jpg' },
			{ posterUrl: 'https://b.example/2.jpg' }
		);
		expect(second.fill).toEqual([]);
		expect(second.redundant).toEqual(['posterUrl']);
	});
});

describe('the two field lists', () => {
	it('do not overlap', () => {
		// A field is contributable or it is identity, never both. Adding one means choosing.
		for (const field of CONTRIBUTABLE_FIELDS) {
			expect(IDENTITY_FIELDS).not.toContain(field);
		}
	});

	it('label every contributable field', () => {
		// Exhaustive by construction in the type; asserted here so a stray key cannot pass either.
		expect(Object.keys(CONTRIBUTABLE_FIELD_LABELS).sort()).toEqual(
			[...CONTRIBUTABLE_FIELDS].sort()
		);
	});
});

describe('describeFields', () => {
	it('punctuates a Nynorsk list', () => {
		expect(describeFields([])).toBe('');
		expect(describeFields(['posterUrl'])).toBe('bilete');
		expect(describeFields(['posterUrl', 'ctaUrl'])).toBe('bilete og billettlenkje');
		expect(describeFields(['posterUrl', 'sourceUrl', 'description'])).toBe(
			'bilete, kjeldelenkje og skildring'
		);
	});
});
