import { describe, expect, it } from 'vitest';
import { buildIcal, escapeText, foldLine, icalFilename, toIcalUtc } from '../src/ical.ts';

const NOW = new Date('2026-09-04T09:00:00Z');

const base = {
	id: 133,
	title: 'Pokémontreff i biblioteket',
	startsAt: new Date('2026-09-12T16:00:00Z'),
	url: 'https://hendingar.no/hending/133-pokemontreff-i-biblioteket'
};

describe('escapeText', () => {
	it('escapes the backslash first', () => {
		// Otherwise every escape this function adds is escaped again by the later rules.
		expect(escapeText('a\\b')).toBe('a\\\\b');
		expect(escapeText('a\\,b')).toBe('a\\\\\\,b');
	});

	it('escapes the separators that would otherwise end the value', () => {
		expect(escapeText('Bergen, Stord; Bømlo')).toBe('Bergen\\, Stord\; Bømlo');
	});

	it('turns a real newline into a literal one', () => {
		// A raw newline inside a value ends the property, and the rest of the description then
		// looks like a run of malformed fields.
		expect(escapeText('line one\nline two')).toBe('line one\\nline two');
		expect(escapeText('crlf\r\nhere')).toBe('crlf\\nhere');
	});
});

describe('foldLine', () => {
	it('leaves a short line alone', () => {
		expect(foldLine('SUMMARY:Kort')).toBe('SUMMARY:Kort');
	});

	it('folds at 75 octets, continuing with a space', () => {
		const line = `SUMMARY:${'a'.repeat(200)}`;
		const folded = foldLine(line);
		expect(folded).toContain('\r\n ');
		for (const segment of folded.split('\r\n')) {
			expect(new TextEncoder().encode(segment).length).toBeLessThanOrEqual(75);
		}
	});

	it('counts octets, not characters, and never splits one in half', () => {
		/*
		 * The bug this guards. ø and å are two bytes each in UTF-8, so a line of them overruns 75
		 * octets long before it reaches 75 characters — and cutting between the two bytes of one
		 * character produces a file some parsers reject and others render as mojibake.
		 */
		const line = `SUMMARY:${'ø'.repeat(120)}`;
		const folded = foldLine(line);
		for (const segment of folded.split('\r\n')) {
			expect(new TextEncoder().encode(segment).length).toBeLessThanOrEqual(75);
		}
		// Unfolding must give back exactly what went in, character for character.
		expect(folded.replace(/\r\n /g, '')).toBe(line);
	});

	it('round-trips any line through unfolding', () => {
		for (const line of ['DESCRIPTION:æøå '.repeat(30), 'X:' + '🎉'.repeat(40), 'A:b']) {
			expect(foldLine(line).replace(/\r\n /g, '')).toBe(line);
		}
	});
});

describe('toIcalUtc', () => {
	it('writes a UTC instant in the basic format', () => {
		expect(toIcalUtc(new Date('2026-09-12T16:00:00Z'))).toBe('20260912T160000Z');
	});

	it('converts an offset instant rather than keeping its wall clock', () => {
		// 18:00 in Oslo in September is 16:00Z. A calendar client re-localises from UTC, so this is
		// what makes the entry land at the right hour wherever the reader is.
		expect(toIcalUtc(new Date('2026-09-12T18:00:00+02:00'))).toBe('20260912T160000Z');
	});
});

describe('buildIcal', () => {
	it('produces a single well-formed VEVENT', () => {
		const ics = buildIcal(base, NOW);
		expect(ics.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true);
		expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true);
		expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(1);
		expect(ics).toContain('DTSTART:20260912T160000Z');
		expect(ics).toContain('SUMMARY:Pokémontreff i biblioteket');
		expect(ics).toContain('METHOD:PUBLISH');
	});

	it('uses CRLF throughout, which the spec requires', () => {
		const ics = buildIcal(base, NOW);
		// No bare LF anywhere: some parsers drop everything after the first one.
		expect(/[^\r]\n/.test(ics)).toBe(false);
	});

	it('keys the UID on our event id, so re-downloading updates rather than duplicates', () => {
		expect(buildIcal(base, NOW)).toContain('UID:hending-133@hendingar.no');
		expect(buildIcal(base, NOW)).toBe(buildIcal(base, NOW));
	});

	it('omits DTEND when the source never said when it ends', () => {
		/*
		 * An invented hour would be a guess sitting in someone's calendar, and they would plan
		 * around a time we made up.
		 */
		expect(buildIcal(base, NOW)).not.toContain('DTEND');
		const withEnd = buildIcal({ ...base, endsAt: new Date('2026-09-12T18:00:00Z') }, NOW);
		expect(withEnd).toContain('DTEND:20260912T180000Z');
	});

	it('ignores an end that is not after the start', () => {
		const same = buildIcal({ ...base, endsAt: base.startsAt }, NOW);
		expect(same).not.toContain('DTEND');
	});

	it('carries the source link in the description, so the entry can be checked', () => {
		const ics = buildIcal(
			{ ...base, description: 'Ta med korta dine.', sourceUrl: 'https://kjelda.no/x' },
			NOW
		);
		expect(ics.replace(/\r\n /g, '')).toContain('Ta med korta dine.\\n\\nhttps://kjelda.no/x');
	});

	it('escapes a description that would otherwise break the file', () => {
		const ics = buildIcal({ ...base, description: 'Gratis, open for alle; ta med sekk' }, NOW);
		const unfolded = ics.replace(/\r\n /g, '');
		expect(unfolded).toContain('DESCRIPTION:Gratis\\, open for alle\; ta med sekk');
		// One DESCRIPTION property, not three fragments.
		expect(unfolded.match(/^DESCRIPTION:/gm)).toHaveLength(1);
	});

	it('survives a long Norwegian title without producing an oversized line', () => {
		const ics = buildIcal(
			{ ...base, title: 'Førestilling på Bømlo kulturhus med ø og å '.repeat(4) },
			NOW
		);
		for (const line of ics.split('\r\n')) {
			expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
		}
	});
});

describe('icalFilename', () => {
	it('folds Norwegian letters and keeps the id', () => {
		expect(icalFilename(133, 'Pokémontreff i biblioteket')).toBe(
			'133-pokemontreff-i-biblioteket.ics'
		);
		expect(icalFilename(7, 'Bømlo Knøttekor')).toBe('7-boemlo-knoettekor.ics');
	});

	it('falls back to the id alone when a title has nothing usable', () => {
		expect(icalFilename(9, '!!!')).toBe('9.ics');
	});
});
