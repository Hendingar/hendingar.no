import { describe, expect, it } from 'vitest';
import { eventFormSchema, eventSubmissionSchema, importedEventSchema } from '../src/validation.ts';

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

	/**
	 * `sourceUrl` and `ctaUrl` are filled in by strangers and rendered as anchors, so the scheme is
	 * a security boundary and not a formatting preference.
	 *
	 * `z.url()` on its own accepts every one of these: it asks only whether `new URL()` parses the
	 * string, and `javascript:alert(1)` parses fine. The moment a template writes `<a href={…}>`
	 * around one of these fields — which is exactly what the source link does — that is stored
	 * cross-site scripting, running on our origin, for every reader who clicks.
	 */
	it('rejects a URL whose scheme is not http or https', () => {
		for (const url of [
			'javascript:alert(1)',
			'JavaScript:alert(1)',
			'data:text/html,<script>alert(1)</script>',
			'vbscript:msgbox(1)',
			'file:///etc/passwd'
		]) {
			expect(eventSubmissionSchema.safeParse({ ...valid, sourceUrl: url }).success).toBe(false);
			expect(eventSubmissionSchema.safeParse({ ...valid, ctaUrl: url }).success).toBe(false);
		}
	});

	it('still accepts the ordinary links these fields exist to hold', () => {
		for (const url of [
			'https://kyrkjastord.no/Kalender',
			'http://gamal.example.no/side?id=4',
			'https://www.facebook.com/events/1234567890/'
		]) {
			expect(eventSubmissionSchema.safeParse({ ...valid, sourceUrl: url }).success).toBe(true);
		}
	});
});

describe('eventFormSchema', () => {
	const form = {
		title: 'Konsert på Den Blå Time',
		category: 'musikk',
		date: '2026-09-12',
		startTime: '20:00',
		venueName: 'Den Blå Time'
	};

	/**
	 * Regression, and the failure was a crash rather than a rejection.
	 *
	 * Zod 4 does not stop at the first failed check: a `.refine()` after `.url()` still runs when
	 * `.url()` failed. The scheme refinement called `new URL('')` and threw a TypeError straight
	 * out of `safeParse` — so every submission that left the source field empty, which is most of
	 * them, took down the whole form rather than validating.
	 */
	it('accepts an empty optional URL rather than throwing on it', () => {
		expect(() => eventFormSchema.safeParse({ ...form, sourceUrl: '', ctaUrl: '' })).not.toThrow();
		expect(eventFormSchema.safeParse({ ...form, sourceUrl: '', ctaUrl: '' }).success).toBe(true);
	});

	it('rejects rather than throws on a URL it cannot parse at all', () => {
		const r = eventFormSchema.safeParse({ ...form, sourceUrl: 'ikkje ei lenkje' });
		expect(r.success).toBe(false);
	});

	it('applies the scheme restriction here too', () => {
		expect(eventFormSchema.safeParse({ ...form, sourceUrl: 'javascript:alert(1)' }).success).toBe(
			false
		);
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

	it('holds the poster to the same schemes, since it is hotlinked into an img', () => {
		const base = { ...valid, externalId: '221479' };
		expect(importedEventSchema.safeParse({ ...base, posterUrl: 'data:text/html,x' }).success).toBe(
			false
		);
		expect(
			importedEventSchema.safeParse({ ...base, posterUrl: 'https://cdn.example.no/p.jpg' }).success
		).toBe(true);
	});
});
