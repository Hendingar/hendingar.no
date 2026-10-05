import { describe, expect, it } from 'vitest';
import { hotlinkedShareImage } from './share-image.ts';

describe('hotlinkedShareImage', () => {
	const poster = 'https://billetto.imgix.net/xuiif9mj0kood4p1hgt3bdus5v8l?w=640&h=360';

	it('previews a hotlinked poster where it lives', () => {
		expect(hotlinkedShareImage({ posterUrl: poster, posterRightsVerified: false })).toBe(poster);
	});

	it('leaves a poster we may redraw to our own card', () => {
		expect(hotlinkedShareImage({ posterUrl: poster, posterRightsVerified: true })).toBeNull();
	});

	it('falls back to the card with no poster, or one a scraper would drop', () => {
		expect(hotlinkedShareImage({ posterUrl: null, posterRightsVerified: false })).toBeNull();
		for (const posterUrl of ['http://example.org/p.jpg', '/posters/seed.jpg', 'javascript:x']) {
			expect(hotlinkedShareImage({ posterUrl, posterRightsVerified: false }), posterUrl).toBeNull();
		}
	});
});
