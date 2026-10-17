import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseEvents } from '../src/api.ts';
import { organisersOfHandEnteredEvents, parseOrganizerRows } from '../src/organisers.ts';

/** Against committed real responses (Bømlo's portal). No network. */
const fixture = (name: string): unknown =>
	JSON.parse(readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)), 'utf8'));

const events = parseEvents(fixture('events.json')).rows;
const organizers = parseOrganizerRows(fixture('organizers.json'));

describe('organisersOfHandEnteredEvents', () => {
	const rows = organisersOfHandEnteredEvents(events, organizers);

	it('counts only the public rows nobody mirrored in', () => {
		// 128 public rows in the fixture; 56 are eBillett's, copied from the culture house's ticket
		// account. The other 72 were typed in by somebody local.
		expect(rows.reduce((sum, r) => sum + r.total, 0)).toBe(72);
		expect(rows).toHaveLength(22);
	});

	it('names each organiser as the portal shows it, most rows first', () => {
		expect(rows.slice(0, 3).map((r) => [r.name, r.total])).toEqual([
			['Bømlo kommune', 23],
			['Bømlo Kyrkjelege Fellesråd', 15],
			['Bremnes Idrettslag', 8]
		]);
	});

	it('reads the provider from the payload rather than assuming it', () => {
		expect(events.some((e) => e.event_external_provider === 'eBillett')).toBe(true);
		expect(events.some((e) => e.event_external_provider === null)).toBe(true);
	});

	it('does not print the name of an organiser the portal keeps private', () => {
		const hidden = organizers.map((o) =>
			String(o.organizer_id) === '2' ? { ...o, organizer_public: false } : o
		);
		const top = organisersOfHandEnteredEvents(events, hidden)[0];
		expect(top?.organizerId).toBe('2');
		expect(top?.name).not.toContain('Bømlo kommune');
	});
});
