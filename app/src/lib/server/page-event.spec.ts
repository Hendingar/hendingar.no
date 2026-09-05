import { describe, expect, it } from 'vitest';
import { extractEventFromPage, pageText, readSchemaDateTime } from './page-event.ts';

/*
 * Both fixtures are verbatim from real pages, captured today:
 *  - JSON-LD: bomlobibliotek.no, WordPress with Modern Events Calendar
 *  - microdata: bakhagen.hageselskapet.no, Hageselskapet's CMS
 * They are the two shapes the Norwegian sites we already import actually publish.
 */
const JSON_LD_PAGE = `<!doctype html><html><head><title>Bok og strikk</title>
<script type="application/ld+json">{
 "@context": "http://schema.org",
 "@type": "Event",
 "startDate": "2026-09-07T18:00:00+02:00",
 "endDate": "2026-09-07T20:00:00+02:00",
 "location": { "@type": "Place", "name": "Hillestveit filial", "address": "" },
 "organizer": { "@type": "Person", "name": "", "url": "" },
 "offers": { "url": "https://www.bomlobibliotek.no/arrangement/bok-og-strikk-7/", "price": "0" },
 "description": "Bok og strikk held fram!",
 "name": "Bok og strikk på Hillestveit",
 "url": "https://www.bomlobibliotek.no/arrangement/bok-og-strikk-7/"
}</script></head><body><p>Bok og strikk</p></body></html>`;

const MICRODATA_PAGE = `<!doctype html><html><head><title>Aktiviteter</title></head><body>
<article class="activity" data-articleId="11596" itemscope itemtype="http://schema.org/Event">
<a href="https://bakhagen.hageselskapet.no/hordaland/bomlo/aktiviteter/fropakkekveld-5?instance=0">
<time class="starttime" datetime="2026-09-18T18:00+02:00" itemprop="startDate"><span class="day">18</span></time>
<time class="enddtime" datetime="2026-09-18T20:00+02:00" itemprop="endDate"></time>
<div class="local-branch">Hageselskapet Bømlo</div><h3 itemprop="name">Frøpakkekveld</h3>
<div class='location' itemprop="location" itemscope itemtype="http://schema.org/Place">
<span itemprop="name">Bømlo Folkebibliotek</span>
<span itemprop="address" itemscope itemtype="http://schema.org/PostalAddress"></span>
</div></a></article></body></html>`;

describe('readSchemaDateTime', () => {
	/**
	 * The three shapes are three different questions, and treating them alike moves events by an
	 * hour. An instant has to be converted; a bare wall clock must not be.
	 */
	it('converts an instant to the wall clock a local reader should see', () => {
		expect(readSchemaDateTime('2026-09-07T18:00:00+02:00')).toEqual({
			date: '2026-09-07',
			time: '18:00'
		});
		// The same moment written in UTC must give the same wall clock, not 16:00.
		expect(readSchemaDateTime('2026-09-07T16:00:00Z')).toEqual({
			date: '2026-09-07',
			time: '18:00'
		});
	});

	it('takes a datetime with no offset literally', () => {
		// Guessing an offset for a value that has none would shift the event for no reason.
		expect(readSchemaDateTime('2026-09-18T18:00')).toEqual({ date: '2026-09-18', time: '18:00' });
		expect(readSchemaDateTime('2026-09-18T18:00:00')).toEqual({
			date: '2026-09-18',
			time: '18:00'
		});
	});

	it('accepts a date with no time', () => {
		expect(readSchemaDateTime('2026-10-06')).toEqual({ date: '2026-10-06', time: null });
	});

	it('handles the seconds being optional, which one real source is inconsistent about', () => {
		// Hageselskapet writes 18:00+02:00 for a timed event and 23:59:59+02:00 for an all-day one.
		expect(readSchemaDateTime('2026-09-18T18:00+02:00')?.time).toBe('18:00');
		expect(readSchemaDateTime('2026-10-06T23:59:59+02:00')?.time).toBe('23:59');
	});

	it('returns null rather than an Invalid Date for rubbish', () => {
		for (const value of ['', null, undefined, 'i morgon', '2026-13-45T99:99:99Z', 42]) {
			expect(readSchemaDateTime(value)).toBeNull();
		}
	});
});

describe('extractEventFromPage', () => {
	it('prefers JSON-LD, and reads every field the page asserts', () => {
		const { source, event } = extractEventFromPage(JSON_LD_PAGE);
		expect(source).toBe('json-ld');
		expect(event.title).toBe('Bok og strikk på Hillestveit');
		expect(event.date).toBe('2026-09-07');
		expect(event.startTime).toBe('18:00');
		expect(event.endTime).toBe('20:00');
		expect(event.venueName).toBe('Hillestveit filial');
		expect(event.description).toBe('Bok og strikk held fram!');
		expect(event.ticketUrl).toBe('https://www.bomlobibliotek.no/arrangement/bok-og-strikk-7/');
	});

	it('treats an empty schema.org string as absent, not as an empty name', () => {
		// This page really does publish `"organizer": {"name": ""}`. Carrying that through would
		// put an empty organiser into the form and call it "read from the page".
		expect(extractEventFromPage(JSON_LD_PAGE).event.organizerName).toBeNull();
	});

	it('never guesses a category', () => {
		// schema.org's event types do not map onto our taxonomy. A wrong category chosen on
		// somebody's behalf is worse than a select they have to look at.
		expect(extractEventFromPage(JSON_LD_PAGE).event.category).toBeNull();
		expect(extractEventFromPage(MICRODATA_PAGE).event.category).toBeNull();
	});

	it('falls back to microdata, reading the machine value out of the attribute', () => {
		const { source, event } = extractEventFromPage(MICRODATA_PAGE);
		expect(source).toBe('microdata');
		expect(event.title).toBe('Frøpakkekveld');
		expect(event.date).toBe('2026-09-18');
		expect(event.startTime).toBe('18:00');
		expect(event.endTime).toBe('20:00');
	});

	it('reads the venue from the nested Place, not the event title', () => {
		// Both carry `itemprop="name"`, and the event's comes first in the document.
		expect(extractEventFromPage(MICRODATA_PAGE).event.venueName).toBe('Bømlo Folkebibliotek');
	});

	it('falls back to OpenGraph, and says plainly that is all it got', () => {
		const html = `<!doctype html><html><head>
			<meta property="og:title" content="Konsert i Kulturhuset" />
			<meta property="og:description" content="Ein fin kveld" />
			</head><body>x</body></html>`;
		const { source, event } = extractEventFromPage(html);
		expect(source).toBe('opengraph');
		expect(event.title).toBe('Konsert i Kulturhuset');
		expect(event.date).toBeNull();
		expect(event.unreadable).toContain('dato');
	});

	it('survives a malformed JSON-LD block and uses the valid one after it', () => {
		const html = `<html><head>
			<script type="application/ld+json">{ this is not json </script>
			<script type="application/ld+json">{"@type":"Event","name":"Etterpå","startDate":"2026-04-01"}</script>
			</head><body></body></html>`;
		const { source, event } = extractEventFromPage(html);
		expect(source).toBe('json-ld');
		expect(event.title).toBe('Etterpå');
	});

	it('finds an Event inside a @graph, which is how most CMSs emit it', () => {
		const html = `<html><head><script type="application/ld+json">
			{"@context":"https://schema.org","@graph":[
				{"@type":"WebSite","name":"Ein stad"},
				{"@type":"MusicEvent","name":"Konsert","startDate":"2026-04-01T20:00:00+02:00"}
			]}</script></head><body></body></html>`;
		const { source, event } = extractEventFromPage(html);
		expect(source).toBe('json-ld');
		expect(event.title).toBe('Konsert');
		expect(event.startTime).toBe('20:00');
	});

	it('reports "none" for a page with nothing on it, which is not an error', () => {
		// The signal to try the model. Most of the web has no structured data and no og:title.
		const { source, event } = extractEventFromPage('<html><body><p>hei</p></body></html>');
		expect(source).toBe('none');
		expect(event.title).toBeNull();
	});
});

describe('pageText', () => {
	it('drops the scripts and styles, which are most of a page by weight', () => {
		const html = `<html><head><style>.a{color:red}</style><script>var x = 1;</script></head>
			<body><h1>Konsert</h1><p>i kveld</p></body></html>`;
		const text = pageText(html);
		expect(text).toBe('Konsert i kveld');
		expect(text).not.toContain('var x');
		expect(text).not.toContain('color:red');
	});

	it('caps its own length, so one enormous page cannot become one enormous prompt', () => {
		expect(pageText(`<body>${'ord '.repeat(20_000)}</body>`, 500)).toHaveLength(500);
	});
});
