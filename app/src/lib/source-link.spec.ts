import { describe, expect, it } from 'vitest';
import { linkLabel, safeHttpUrl } from './source-link.ts';

describe('safeHttpUrl', () => {
	/**
	 * The rows this exists for are already written. `sourceUrl` was validated with a bare `z.url()`
	 * for the whole life of the submission form, and that accepts `javascript:` — so the database
	 * may hold one, and the source link is the first template to put these values in an `href`.
	 */
	it('refuses a scheme a browser would execute', () => {
		for (const url of [
			'javascript:alert(1)',
			'JAVASCRIPT:alert(1)',
			'data:text/html,<script>alert(1)</script>',
			'vbscript:msgbox(1)',
			'file:///etc/passwd'
		]) {
			expect(safeHttpUrl(url)).toBeNull();
		}
	});

	it('passes through the ordinary links', () => {
		expect(safeHttpUrl('https://kyrkjastord.no/Kalender')).toBe('https://kyrkjastord.no/Kalender');
		expect(safeHttpUrl('http://gamal.example.no/x')).toBe('http://gamal.example.no/x');
	});

	it('treats missing and unparseable as simply absent', () => {
		// A filter, not a validator: one bad row must not throw the listing that renders it.
		expect(safeHttpUrl(null)).toBeNull();
		expect(safeHttpUrl(undefined)).toBeNull();
		expect(safeHttpUrl('')).toBeNull();
		expect(safeHttpUrl('ikkje ei lenkje')).toBeNull();
	});
});

describe('linkLabel', () => {
	it('shows the host, which is the part that tells a reader anything', () => {
		expect(linkLabel('https://www.facebook.com/events/1234567890/?ref=newsfeed')).toBe(
			'facebook.com'
		);
		expect(linkLabel('https://kyrkjastord.no/Kalender')).toBe('kyrkjastord.no');
		expect(linkLabel('https://bomlo.aktivitetforalle.no/arrangement?type=81')).toBe(
			'bomlo.aktivitetforalle.no'
		);
	});

	it('falls back to the raw value rather than to an empty label', () => {
		expect(linkLabel('ikkje ei lenkje')).toBe('ikkje ei lenkje');
	});
});
