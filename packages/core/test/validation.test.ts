import { describe, expect, it } from 'vitest';
import { eventSubmissionSchema, importedEventSchema } from '../src/validation.ts';

const valid = {
	title: 'Konsert på Den Blå Time',
	category: 'musikk' as const,
	startsAt: '2026-09-12T20:00:00+02:00',
	venueName: 'Den Blå Time'
};

describe('eventSubmissionSchema', () => {
	it('accepts a minimal valid submission', () => {
		expect(eventSubmissionSchema.safeParse(valid).success).toBe(true);
	});

	it('rejects a timestamp without an offset', () => {
		const r = eventSubmissionSchema.safeParse({ ...valid, startsAt: '2026-09-12T20:00:00' });
		expect(r.success).toBe(false);
	});

	it('rejects an end before the start', () => {
		const r = eventSubmissionSchema.safeParse({
			...valid,
			endsAt: '2026-09-12T19:00:00+02:00'
		});
		expect(r.success).toBe(false);
	});

	it('rejects an unknown category', () => {
		const r = eventSubmissionSchema.safeParse({ ...valid, category: 'roller-disco' });
		expect(r.success).toBe(false);
	});
});

describe('importedEventSchema', () => {
	it('requires an externalId so importers can upsert idempotently', () => {
		expect(importedEventSchema.safeParse(valid).success).toBe(false);
		expect(importedEventSchema.safeParse({ ...valid, externalId: '221479' }).success).toBe(true);
	});

	it('defaults poster rights to unverified', () => {
		const r = importedEventSchema.parse({ ...valid, externalId: '221479' });
		expect(r.posterRightsVerified).toBe(false);
	});
});
