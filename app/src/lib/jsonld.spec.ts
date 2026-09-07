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
	venuePostalCode: null,
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

	it('writes a full postal address when the source gave us one', () => {
		/*
		 * The point of the whole address pass. `location.address` is required for Google's Event
		 * rich result and no event had one — `venues.address` was empty for every row in the
		 * database, because twelve importers received a street address and threw it away.
		 */
		expect(
			eventJsonLd(
				{ ...base, venueAddress: 'Kjøtteinsvegen 66', venuePostalCode: '5411' },
				CANONICAL
			)
		).toMatchObject({
			location: {
				address: {
					'@type': 'PostalAddress',
					streetAddress: 'Kjøtteinsvegen 66',
					postalCode: '5411',
					addressLocality: 'Stord',
					addressCountry: 'NO'
				}
			}
		});
	});

	it('emits an address for every event, down to the country we always know', () => {
		expect(eventJsonLd(base, CANONICAL)).toMatchObject({
			location: {
				'@type': 'Place',
				name: 'Den Blå Time',
				address: { '@type': 'PostalAddress', addressLocality: 'Stord', addressCountry: 'NO' }
			}
		});

		/*
		 * The case Search Console reported on 11 items: a venue nothing has geocoded, so there is no
		 * street, no postcode and no municipality. `location.address` is required for the Event rich
		 * result, and the country is a fact about every row here — every source is a Norwegian local
		 * calendar — so it is written rather than the whole field being dropped.
		 *
		 * This deliberately replaces the earlier rule that an absent address beats a thin one. That
		 * argument was about an *empty* PostalAddress asserting we know the address and that it is
		 * nothing; a country-only address asserts only what is true.
		 */
		expect(eventJsonLd({ ...base, venueMunicipality: null }, CANONICAL)).toMatchObject({
			location: {
				'@type': 'Place',
				name: 'Den Blå Time',
				address: { '@type': 'PostalAddress', addressCountry: 'NO' }
			}
		});
		// And no key claiming a value we do not have.
		const address = (
			eventJsonLd({ ...base, venueMunicipality: null }, CANONICAL).location as {
				address: Record<string, unknown>;
			}
		).address;
		expect(Object.keys(address)).toEqual(['@type', 'addressCountry']);
	});

	it('decodes an entity-encoded title rather than publishing the markup', () => {
		/*
		 * Live on the site: `importers/mec` did no entity decoding, so a Moster Amfi concert reached
		 * this field as `…Humor &laquo;Frå Vestlandet til Amerika i 200 år&raquo;`. The importer is
		 * fixed too; this is the net under it, for the rows written before that fix — the same
		 * argument `plainText` records for descriptions.
		 */
		const node = eventJsonLd(
			{ ...base, title: 'Viser, Historie og Humor &laquo;Frå Vestlandet til Amerika&raquo;' },
			CANONICAL
		);
		expect(node.name).toBe('Viser, Historie og Humor «Frå Vestlandet til Amerika»');
	});

	it('keeps a name rather than dropping the field when the title is only markup', () => {
		// `plainText` returns null for a string that reduces to nothing. An Event with an ugly name
		// beats an Event with no name at all.
		const node = eventJsonLd({ ...base, title: '<p></p>' }, CANONICAL);
		expect(node.name).toBe('<p></p>');
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
		 * The one genuinely dangerous thing about embedding JSON in a document: a value quoting
		 * "</script>" ends the element early and spills the rest of the JSON into the page.
		 *
		 * Asserted against the escaper directly, on a hand-built node. This used to go through
		 * `eventJsonLd`'s `name`, on the stated grounds that the title was the one field reaching
		 * the document exactly as a source wrote it — which is no longer true now that the name is
		 * passed through `plainText` too. Routing the check through a field that launders its input
		 * would leave `jsonLdScript` asserted by nothing.
		 */
		const out = jsonLdScript({ '@type': 'Event', name: 'Slutt </script> her' });
		expect(out).not.toContain('</script>');
		expect(out).toContain('<\\/script>');
		expect(JSON.parse(out.replace(/<\\\//g, '</')).name).toBe('Slutt </script> her');
	});

	it('has no raw markup left to escape by the time a title reaches it', () => {
		// Not a replacement for the guard above — belt to its braces. `plainText` strips the tag,
		// so the dangerous substring never reaches the document even before escaping.
		const node = eventJsonLd({ ...base, title: 'Slutt </script> her' }, CANONICAL);
		expect(node.name).toBe('Slutt her');
	});
});
