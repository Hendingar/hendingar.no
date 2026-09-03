import { describe, expect, it } from 'vitest';
import { PROVENANCE_FIELDS, photoFilledFields } from './provenance.ts';
import type { ExtractedEvent } from '@hendingar/core/validation';

const draft = (over: Partial<ExtractedEvent> = {}): ExtractedEvent =>
	({
		title: null,
		description: null,
		category: null,
		date: null,
		startTime: null,
		endTime: null,
		recurrence: null,
		venueName: null,
		municipality: null,
		organizerName: null,
		ticketUrl: null,
		confidence: 80,
		unreadable: [],
		note: '',
		...over
	}) as ExtractedEvent;

describe('photoFilledFields', () => {
	it('marks only the fields the model actually read', () => {
		expect(photoFilledFields(draft({ title: 'Konsert', date: '2026-09-04' }))).toEqual([
			'title',
			'date'
		]);
	});

	it('treats null as "could not tell", not as a value', () => {
		// The model returning null for a field is its own admission, not an empty answer.
		expect(photoFilledFields(draft())).toEqual([]);
	});

	it('treats an empty string as unread too', () => {
		expect(photoFilledFields(draft({ title: '   ' }))).toEqual([]);
	});

	it('maps ticketUrl onto the ctaUrl field, which is the whole reason this is a function', () => {
		/*
		 * The extraction calls it `ticketUrl`; the form input is `ctaUrl`. Keying on the draft name
		 * would point the badge at an input that does not exist — and it would simply never render,
		 * with no error anywhere to notice.
		 */
		expect(photoFilledFields(draft({ ticketUrl: 'https://example.com' }))).toEqual(['ctaUrl']);
	});

	it('never reports a field name the form does not have', () => {
		const all = photoFilledFields(
			draft({
				title: 'a',
				description: 'b',
				category: 'musikk',
				date: '2026-09-04',
				startTime: '19:00',
				endTime: '21:00',
				venueName: 'Osvald',
				municipality: 'Stord',
				organizerName: 'Nokon',
				ticketUrl: 'https://example.com'
			})
		);
		for (const field of all) expect(PROVENANCE_FIELDS).toContain(field);
		expect(all).toHaveLength(PROVENANCE_FIELDS.length);
	});

	it('ignores keys that are not form fields', () => {
		// confidence, unreadable, note and recurrence are not inputs a person edits.
		const filled = photoFilledFields(draft({ confidence: 91, note: 'les greitt' }));
		expect(filled).toEqual([]);
	});
});
