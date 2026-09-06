import { describe, expect, it } from 'vitest';
import {
	breadcrumbJsonLd,
	eventJsonLd,
	itemListJsonLd,
	jsonLdScript,
	siteJsonLd
} from './jsonld.ts';
import type { EventForJsonLd } from './jsonld.ts';

const CANONICAL = 'https://hendingar.no/hending/12-konsert';

const base: EventForJsonLd = {
	title: 'Konsert',
	description: null,
	startsAt: new Date('2026-09-12T18:00:00Z'),
	endsAt: null,
	posterUrl: null,
	ctaUrl: null,
	sourceUrl: null,
	organizerName: null,
	venueName: 'Den Blå Time',
	venueAddress: null,
	venueMunicipality: 'Stord',
	venueLatitude: null,
	venueLongitude: null,
	venueTimeZone: 'Europe/Oslo',
	reportedBy: []
};

describe('eventJsonLd', () => {
	it('names our own page as the event, not the source', () => {
		/*
		 * The bug this replaces. On the live site `url` was the source's page, on a document whose
		 * rel=canonical said hendingar.no — two contradictory answers to "where does this live", one
		 * of them handing the content to somebody else.
		 */
		const node = eventJsonLd(
			{ ...base, ctaUrl: 'https://kulturhus.no/billett', sourceUrl: 'https://kulturhus.no/event' },
			CANONICAL
		);
		expect(node.url).toBe(CANONICAL);
		expect(node['@id']).toBe(CANONICAL);
		expect(node.offers).toEqual({
			'@type': 'Offer',
			url: 'https://kulturhus.no/billett',
			availability: 'https://schema.org/InStock'
		});
		expect(node.sameAs).toEqual(['https://kulturhus.no/event']);
	});

	it('writes the venue’s offset rather than UTC', () => {
		expect(eventJsonLd(base, CANONICAL).startDate).toBe('2026-09-12T20:00:00+02:00');
	});

	it('lists every source that reported it, once, and never itself', () => {
		const node = eventJsonLd(
			{
				...base,
				sourceUrl: 'https://a.no/e',
				reportedBy: [
					{ eventUrl: 'https://a.no/e' },
					{ eventUrl: 'https://b.no/e' },
					{ eventUrl: null },
					{ eventUrl: CANONICAL }
				]
			},
			CANONICAL
		);
		expect(node.sameAs).toEqual(['https://a.no/e', 'https://b.no/e']);
	});

	it('strips markup out of the description', () => {
		const node = eventJsonLd(
			{ ...base, description: '<p>Ein <strong>fin</strong> kveld</p>' },
			CANONICAL
		);
		expect(node.description).toBe('Ein fin kveld');
	});

	it('omits what it does not know instead of inventing it', () => {
		const node = eventJsonLd(base, CANONICAL);
		// No price column exists. `0` would claim every event is free.
		expect(node.offers).toBeUndefined();
		expect(node.endDate).toBeUndefined();
		expect(node.image).toBeUndefined();
		expect(node.organizer).toBeUndefined();
		expect(node.sameAs).toBeUndefined();
	});

	it('refuses a non-http link rather than publishing it', () => {
		for (const url of ['javascript:alert(1)', 'mailto:a@b.no', 'not a url', '']) {
			expect(eventJsonLd({ ...base, ctaUrl: url }, CANONICAL).offers, url).toBeUndefined();
		}
	});

	it('emits an address only when there is one to emit', () => {
		expect(eventJsonLd(base, CANONICAL)).toMatchObject({
			location: {
				'@type': 'Place',
				name: 'Den Blå Time',
				address: { '@type': 'PostalAddress', addressLocality: 'Stord', addressCountry: 'NO' }
			}
		});

		/*
		 * Google requires `location.address`, and today essentially no venue has one — nothing
		 * geocodes them. An empty PostalAddress would be worse than none: it asserts we know the
		 * address and that it is nothing.
		 */
		expect(eventJsonLd({ ...base, venueMunicipality: null }, CANONICAL)).toMatchObject({
			location: { '@type': 'Place', name: 'Den Blå Time' }
		});
		expect(
			Object.keys(eventJsonLd({ ...base, venueMunicipality: null }, CANONICAL).location ?? {})
		).not.toContain('address');
	});
});

describe('breadcrumbJsonLd', () => {
	it('numbers the trail from one, contiguously', () => {
		const node = breadcrumbJsonLd([
			{ name: 'Framsida', url: 'https://hendingar.no/' },
			{ name: 'Konsert', url: CANONICAL }
		]);
		expect(node.itemListElement).toEqual([
			{ '@type': 'ListItem', position: 1, name: 'Framsida', item: 'https://hendingar.no/' },
			{ '@type': 'ListItem', position: 2, name: 'Konsert', item: CANONICAL }
		]);
	});
});

describe('siteJsonLd', () => {
	it('claims only the places we actually have events for', () => {
		// The README's ambition names Bergen and Haugalandet. Every imported row is Sunnhordland,
		// and areaServed is a claim, not a plan.
		expect(siteJsonLd('https://hendingar.no')).toMatchObject({
			'@graph': [
				{ '@type': 'WebSite' },
				{
					'@type': 'Organization',
					areaServed: ['Stord', 'Bømlo', 'Fitjar', 'Sunnhordland'].map((name) => ({
						'@type': 'AdministrativeArea',
						name
					}))
				}
			]
		});
	});

	it('gives the website a publisher it can actually resolve', () => {
		expect(siteJsonLd('https://hendingar.no')).toMatchObject({
			'@graph': [
				{ '@type': 'WebSite', publisher: { '@id': 'https://hendingar.no/#organization' } },
				{ '@type': 'Organization', '@id': 'https://hendingar.no/#organization' }
			]
		});
	});
});

describe('itemListJsonLd', () => {
	it('counts what it lists', () => {
		const node = itemListJsonLd('Musikk', ['https://hendingar.no/hending/1', CANONICAL]);
		expect(node).toMatchObject({
			numberOfItems: 2,
			itemListElement: [
				{ position: 1, url: 'https://hendingar.no/hending/1' },
				{ position: 2, url: CANONICAL }
			]
		});
	});
});

describe('jsonLdScript', () => {
	it('cannot close the script tag it sits in', () => {
		/*
		 * The one genuinely dangerous thing about embedding JSON in a document. A description
		 * quoting "</p>" would end the element early and spill the rest of the JSON into the page.
		 */
		// Asserted on the title, not the description: `plainText` already removes markup from the
		// latter, so the title is the field that reaches the document exactly as a source wrote it.
		const out = jsonLdScript(eventJsonLd({ ...base, title: 'Slutt </script> her' }, CANONICAL));
		expect(out).not.toContain('</script>');
		expect(out).toContain('<\\/script>');
		expect(JSON.parse(out.replace(/<\\\//g, '</')).name).toBe('Slutt </script> her');
	});
});
