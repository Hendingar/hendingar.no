import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { formatEventClock, instantToZonedWallClock } from '@hendingar/core/datetime';
import { CATEGORY_SLUGS } from '@hendingar/core/taxonomy';
import { parseListing, type Occurrence } from '../src/api.ts';
import { INSTANCES, instanceBySlug } from '../src/instances.ts';
import {
	DEFAULT_CATEGORY,
	isFailure,
	isSupersededOccurrenceId,
	mapEvent,
	occurrenceId,
	slugifyVenue
} from '../src/map.ts';

/**
 * Against committed real pages. No network, no clock (CLAUDE.md rule 6).
 */
const fixture = (name: string) =>
	readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)), 'utf8');

const bibliotek = parseListing(fixture('bomlobibliotek-kva-skjer.html'));
const moster = parseListing(fixture('mosteramfi-kva-skjer.html'));
const museum = parseListing(fixture('sunnhordland-aktivitetskalender.html'));

const bibliotekInstance = instanceBySlug('bomlobibliotek')!;
const mosterInstance = instanceBySlug('mosteramfi')!;
const museumInstance = instanceBySlug('sunnhordland-museum')!;

/** The three skins in use, so a change to one cannot be mistaken for a change to MEC. */
const ALL = [
	['bomlobibliotek', bibliotek, bibliotekInstance],
	['mosteramfi', moster, mosterInstance],
	['sunnhordland-museum', museum, museumInstance]
] as const;

const mapOne = (o: Occurrence, instance: (typeof ALL)[number][2]) =>
	mapEvent(o.event, o.postId, o.card, instance);

/** The occurrence for a named event, so an assertion can name what it is about. */
const find = (listing: typeof bibliotek, title: string, nth = 0) =>
	listing.occurrences.filter((o) => o.event.name.includes(title))[nth]!;

describe('parseListing', () => {
	it('finds the events on all three sites', () => {
		for (const [slug, listing] of ALL) {
			expect(listing.occurrences.length, slug).toBeGreaterThan(0);
			expect(listing.rejected, slug).toEqual([]);
		}
	});

	it('ignores the WebSite and Organization blocks on the same page', () => {
		// Every page carries non-Event ld+json. Picking those up would produce nameless events.
		for (const [slug, listing] of ALL) {
			for (const o of listing.occurrences) {
				expect(o.event['@type'], slug).toBe('Event');
				expect(o.event.name.trim(), slug).not.toBe('');
			}
		}
	});

	it('reads a post id for every occurrence on every site', () => {
		for (const [slug, listing] of ALL) {
			for (const o of listing.occurrences) expect(o.postId, slug).toMatch(/^\d+$/);
		}
	});

	/*
	 * The pairing is the load-bearing part of this parser, and the three skins break it in three
	 * different ways if it is done by position: the library prints twelve cards and then twelve
	 * ld+json blocks, the other two interleave them one for one.
	 */
	it('pairs every occurrence with the card that prints its clock', () => {
		for (const [slug, listing] of ALL) {
			for (const o of listing.occurrences)
				expect(o.card, `${slug}: ${o.event.name}`).not.toBeNull();
		}
	});

	it('gives each occurrence of a repeating post its own card', () => {
		// MEC repeats one post per occurrence — five posts produced the library's twelve cards. The
		// nth block of a post has to reach the nth card of that post, not the first one every time.
		const pokemon = bibliotek.occurrences.filter((o) => o.event.name.includes('Pokémontreff'));
		expect(pokemon.length).toBe(3);
		expect(new Set(pokemon.map((o) => o.postId)).size).toBe(1);
		expect(pokemon.map((o) => o.event.startDate)).toEqual([
			'2026-09-07T18:00:00+02:00',
			'2026-09-14T18:00:00+02:00',
			'2026-09-21T18:00:00+02:00'
		]);
		for (const o of pokemon) expect(o.card).toEqual({ start: '16:00', end: '17:00' });
	});

	it('reports no card clock where the page prints none', () => {
		// A permanent exhibition has no hours to print. Null, not a fabricated 00:00 — `mapEvent`
		// has to be able to tell "no time stated" from "midnight".
		const escape = find(museum, 'Escape');
		expect(escape.card).toEqual({ start: null, end: null });

		// And a stated start with no stated end is exactly that, not a start repeated.
		const skipsbyggjarar = find(museum, 'Skipsbyggjarar');
		expect(skipsbyggjarar.card).toEqual({ start: '17:30', end: null });
	});
});

/*
 * ---------------------------------------------------------------------------------------------
 * The clock. This is the regression these tests exist for.
 *
 * MEC's JSON-LD applies the site's offset twice, so the instant it spells is two hours after the
 * instant it means, and it looks entirely well-formed while doing it. It shipped: Bømlo's
 * Pokémontreff sat on the site as an 18:00 event, and readers who added it to their calendar got
 * an alert two hours after the doors had opened.
 * ---------------------------------------------------------------------------------------------
 */
describe('mapEvent: the time the venue actually means', () => {
	it('maps every occurrence on every site without failures', () => {
		for (const [slug, listing, instance] of ALL) {
			const failures = listing.occurrences.map((o) => mapOne(o, instance)).filter(isFailure);
			expect(failures, slug).toEqual([]);
		}
	});

	it('takes the clock the page prints, not the instant the JSON-LD spells', () => {
		const o = find(bibliotek, 'Pokémontreff');
		const mapped = mapOne(o, bibliotekInstance);
		if (isFailure(mapped)) throw new Error(mapped.problem);

		// The card says 16:00 and the description says "Kl. 16-17 kvar måndag". The JSON-LD says
		// 2026-09-07T18:00:00+02:00, which is 16:00 UTC — the wall clock with the offset stapled on
		// twice. 14:00Z is 16:00 in Oslo, which is the event.
		expect(o.event.startDate).toBe('2026-09-07T18:00:00+02:00');
		expect(mapped.startsAt.toISOString()).toBe('2026-09-07T14:00:00.000Z');
		expect(formatEventClock(mapped.startsAt, bibliotekInstance.timezone)).toBe('16:00');
		expect(formatEventClock(mapped.endsAt!, bibliotekInstance.timezone)).toBe('17:00');
	});

	it('agrees with the printed clock for every occurrence on every site', () => {
		// The property behind the case above, asserted across all seventeen occurrences. If MEC
		// ever stops double-counting the offset, or a venue's skin changes, this is what notices.
		for (const [slug, listing, instance] of ALL) {
			for (const o of listing.occurrences) {
				const mapped = mapOne(o, instance);
				if (isFailure(mapped)) throw new Error(mapped.problem);
				if (o.card?.start) {
					expect(
						formatEventClock(mapped.startsAt, instance.timezone),
						`${slug}: ${o.event.name}`
					).toBe(o.card.start);
				}
				if (o.card?.end) {
					expect(
						formatEventClock(mapped.endsAt!, instance.timezone),
						`${slug}: ${o.event.name}`
					).toBe(o.card.end);
				}
			}
		}
	});

	it('keeps the day the venue means, not the day UTC is on', () => {
		const o = find(bibliotek, 'Pokémontreff');
		const mapped = mapOne(o, bibliotekInstance);
		if (isFailure(mapped)) throw new Error(mapped.problem);
		expect(instantToZonedWallClock(mapped.startsAt, bibliotekInstance.timezone).date).toBe(
			'2026-09-07'
		);
	});

	it('reads a date-only page off its cards rather than parking it at midnight', () => {
		// Moster Amfi states every event date-only and prints the clock on the card alone. Read from
		// the JSON-LD, its concerts arrived at midnight UTC — 02:00 on a summer morning.
		const o = find(moster, 'Trekkspelklubben');
		expect(o.event.startDate).toBe('2026-09-28');
		const mapped = mapOne(o, mosterInstance);
		if (isFailure(mapped)) throw new Error(mapped.problem);
		expect(mapped.startsAt.toISOString()).toBe('2026-09-28T08:30:00.000Z');
		expect(formatEventClock(mapped.startsAt, mosterInstance.timezone)).toBe('10:30');
	});

	it('resolves the wall clock in the venue zone, so it survives the clocks changing', () => {
		/*
		 * The point of a zone rather than the offset in the string. The same printed 17:00 is
		 * 16:00Z in January and 15:00Z in July, and an importer that trusted `+02:00` would put
		 * every winter event an hour early — the bug that would replace this one.
		 */
		const winter = { ...find(moster, 'Trekkspelklubben').event, startDate: '2027-01-13' };
		const summer = { ...winter, startDate: '2027-07-13' };
		const card = { start: '17:00', end: null };

		const w = mapEvent(winter, '5338', card, mosterInstance);
		const s = mapEvent(summer, '5338', card, mosterInstance);
		if (isFailure(w) || isFailure(s)) throw new Error('should have mapped');
		expect(w.startsAt.toISOString()).toBe('2027-01-13T16:00:00.000Z');
		expect(s.startsAt.toISOString()).toBe('2027-07-13T15:00:00.000Z');
	});

	it('falls back to the corrected JSON-LD clock when the page prints none', () => {
		// No card at all — a skin we have not met, or a card we failed to pair. The JSON-LD's own
		// wall clock read in the venue zone is still the better of the two available readings, and
		// it is what the twelve library cards independently confirm.
		const o = find(bibliotek, 'Sjakk');
		const mapped = mapEvent(o.event, o.postId, null, bibliotekInstance);
		if (isFailure(mapped)) throw new Error(mapped.problem);
		expect(formatEventClock(mapped.startsAt, bibliotekInstance.timezone)).toBe(o.card!.start!);
	});

	it('ignores a printed clock it cannot read in full', () => {
		// An English-configured MEC prints "4:00 pm". Half-reading that as 04:00 would move an
		// evening event to the morning, so it is treated as no card clock at all.
		const html = fixture('mosteramfi-kva-skjer.html').replace(
			'class="mec-start-time">10:30<',
			'class="mec-start-time">10:30 am<'
		);
		const o = parseListing(html).occurrences.find((x) => x.event.name.includes('Trekkspel'))!;
		expect(o.card?.start).toBeNull();
	});
});

describe('mapEvent: the end', () => {
	it('drops an end that is not after the start', () => {
		const o = find(bibliotek, 'Sjakk');
		const mapped = mapEvent(o.event, '123', { start: '17:00', end: '17:00' }, bibliotekInstance);
		if (isFailure(mapped)) throw new Error('should have mapped');
		expect(mapped.endsAt).toBeNull();
	});

	it('leaves an unstated end unstated rather than inventing one', () => {
		// Sunnhordland museum prints a start and no end for the boat-building talk. An invented
		// closing time would go into somebody's calendar as a fact.
		const mapped = mapOne(find(museum, 'Skipsbyggjarar'), museumInstance);
		if (isFailure(mapped)) throw new Error(mapped.problem);
		expect(mapped.endsAt).toBeNull();
	});

	it('keeps a multi-day span the source stated', () => {
		// The escape room is open from 2023 to 2027 and prints no hours. Local midnight to local
		// midnight is what the source said; the day is the part that decides whether you can go.
		const mapped = mapOne(find(museum, 'Escape'), museumInstance);
		if (isFailure(mapped)) throw new Error(mapped.problem);
		expect(instantToZonedWallClock(mapped.startsAt, museumInstance.timezone)).toEqual({
			date: '2023-01-01',
			time: '00:00'
		});
		expect(instantToZonedWallClock(mapped.endsAt!, museumInstance.timezone).date).toBe(
			'2027-12-31'
		);
	});

	it('rolls a card end past midnight onto the next day', () => {
		// A date-only page prints "22:00 - 01:00" with no hint that the 01:00 is tomorrow. Read
		// literally it ends twenty-one hours before it starts, and the end would simply vanish.
		const o = find(moster, 'Trekkspelklubben');
		const mapped = mapEvent(o.event, o.postId, { start: '22:00', end: '01:00' }, mosterInstance);
		if (isFailure(mapped)) throw new Error(mapped.problem);
		expect(instantToZonedWallClock(mapped.endsAt!, mosterInstance.timezone)).toEqual({
			date: '2026-09-29',
			time: '01:00'
		});
	});
});

describe('mapEvent: identity and the rest of the shape', () => {
	const mappedBibliotek = bibliotek.occurrences.map((o) => mapOne(o, bibliotekInstance));

	it('gives each occurrence of a repeating event its own identity', () => {
		// The whole reason the post id is not enough: MEC repeats one post per occurrence.
		const ids = mappedBibliotek
			.filter((m) => !isFailure(m))
			.map((m) => !isFailure(m) && m.externalId);
		expect(new Set(ids).size).toBe(ids.length);
		expect(new Set(bibliotek.occurrences.map((o) => o.postId)).size).toBeLessThan(
			bibliotek.occurrences.length
		);
	});

	it('falls back to the venue name when the page leaves location empty', () => {
		// Moster Amfi is single-venue and prints no location; without the fallback these events
		// would arrive with no place at all.
		for (const o of moster.occurrences) {
			const mapped = mapOne(o, mosterInstance);
			if (isFailure(mapped)) continue;
			expect(mapped.venueName).toBe(mosterInstance.venueFallback);
		}
	});

	it('rejects an event whose URL has no post id rather than inventing one', () => {
		const o = bibliotek.occurrences[0]!;
		const mapped = mapEvent(o.event, null, o.card, bibliotekInstance);
		expect(isFailure(mapped)).toBe(true);
		if (isFailure(mapped)) expect(mapped.problem).toMatch(/no data-event-id/);
	});

	it('rejects an unparseable start date', () => {
		const o = bibliotek.occurrences[0]!;
		const mapped = mapEvent(
			{ ...o.event, startDate: 'ein gong til hausten' },
			'123',
			null,
			bibliotekInstance
		);
		expect(isFailure(mapped)).toBe(true);
	});

	it('rejects a date that matches the shape without being a day', () => {
		// `2026-02-31` parses as a perfectly good-looking date-only value and is not a date.
		const o = bibliotek.occurrences[0]!;
		const mapped = mapEvent(
			{ ...o.event, startDate: '2026-02-31' },
			'123',
			null,
			bibliotekInstance
		);
		expect(isFailure(mapped)).toBe(true);
	});

	it('takes poster rights from the recorded agreement, never from the page', () => {
		// MEC states nothing about image rights anywhere in its output, so this can only come from
		// the instance config — which records whether that named venue actually agreed. Asserted
		// both ways, because a flag that is only ever tested in its true state is not tested.
		for (const m of mappedBibliotek) {
			if (isFailure(m)) continue;
			expect(m.posterRightsVerified).toBe(bibliotekInstance.posterRightsCleared);
		}

		const withoutConsent = { ...bibliotekInstance, posterRightsCleared: false };
		const o = bibliotek.occurrences[0]!;
		const mapped = mapEvent(o.event, o.postId, o.card, withoutConsent);
		if (isFailure(mapped)) throw new Error('should have mapped');
		expect(mapped.posterRightsVerified).toBe(false);
		// The URL is still stored either way: we hotlink, and rights govern reuse, not linking.
		expect(mapped.posterUrl).toBe(o.event.image);
	});

	it('uses a category that exists in the taxonomy', () => {
		expect(CATEGORY_SLUGS).toContain(DEFAULT_CATEGORY);
	});
});

describe('occurrenceId', () => {
	it('is stable for the same post and day', () => {
		expect(occurrenceId('15252', '2026-09-03')).toBe('15252@2026-09-03');
	});

	/*
	 * Keyed on the day, not the instant — and this is why.
	 *
	 * The old key was `<post>@<ISO instant>`, so the moment a time was corrected the id changed,
	 * a second row was inserted, and the first was abandoned: still published, still wrong, and
	 * beyond the reach of every later run. That is how a two-hour offset became permanent, and it
	 * would happen again every time a venue moved its own start time.
	 */
	it('does not change when the clock on the day moves', () => {
		const chessNight = (time: string) =>
			mapEvent(
				find(bibliotek, 'Sjakk').event,
				'15252',
				{ start: time, end: null },
				bibliotekInstance
			);
		const at1700 = chessNight('17:00');
		const at1900 = chessNight('19:00');
		if (isFailure(at1700) || isFailure(at1900)) throw new Error('should have mapped');

		expect(at1700.externalId).toBe(at1900.externalId);
		expect(+at1700.startsAt).not.toBe(+at1900.startsAt);
	});
});

describe('isSupersededOccurrenceId', () => {
	/*
	 * This predicate decides what `ingest.ts` deletes, so both directions matter. Too narrow and
	 * the wrong-time rows stay published forever; too wide and it deletes live events, which no
	 * later run can put back — the page it would have to read them from is already gone.
	 */
	it('recognises the ids the instant-keyed version wrote', () => {
		for (const id of [
			'16190@2026-09-07T16:00:00.000Z',
			'5332@2026-09-08T00:00:00.000Z',
			'2145@2023-01-01T00:00:00.000Z'
		]) {
			expect(isSupersededOccurrenceId(id), id).toBe(true);
		}
	});

	it('leaves every id the day-keyed version writes alone', () => {
		const live = bibliotek.occurrences
			.map((o) => mapOne(o, bibliotekInstance))
			.filter((m) => !isFailure(m))
			.map((m) => (isFailure(m) ? '' : m.externalId));
		expect(live.length).toBeGreaterThan(0);
		for (const id of live) expect(isSupersededOccurrenceId(id), id).toBe(false);
	});

	it("leaves other importers' id shapes alone", () => {
		// It only ever runs scoped to one MEC source, but a predicate that matched `seed-1` or a
		// bare upstream id would be one config mistake away from deleting somebody else's events.
		for (const id of ['seed-1', '221479', 'hending-133', '16190@2026-09-07', '', '@']) {
			expect(isSupersededOccurrenceId(id), id).toBe(false);
		}
	});
});

describe('slugifyVenue', () => {
	it('folds Norwegian letters rather than dropping them', () => {
		expect(slugifyVenue('Bømlo folkebibliotek')).toBe('boemlo-folkebibliotek');
		expect(slugifyVenue('Måløy Kafé')).toBe('maaloey-kafe');
	});
});

describe('instances', () => {
	it('has unique slugs, because the slug is the source identity', () => {
		const slugs = INSTANCES.map((i) => i.slug);
		expect(new Set(slugs).size).toBe(slugs.length);
	});

	it('has an absolute https endpoint per instance', () => {
		for (const i of INSTANCES) {
			expect(i.endpoint).toMatch(/^https:\/\//);
			expect(i.url).toMatch(/^https:\/\//);
		}
	});

	it('either has a real icon URL or none at all, never a guessed path', () => {
		/*
		 * `iconUrl` must be read from the site, not inferred. A guessed `/favicon-32x32.png` 404s on
		 * Stord kulturhus and Moster Amfi advertises apple-touch icons it does not serve, so a
		 * plausible-looking path is not evidence. Null is the honest answer when a site declares
		 * nothing — SourceIcon then shows initials rather than a broken image.
		 */
		for (const i of INSTANCES) {
			if (i.iconUrl === null) continue;
			expect(i.iconUrl).toMatch(/^https:\/\//);
		}
	});

	it('names a timezone for every instance, because the clock is read against it', () => {
		// Not decoration. `mapEvent` resolves a printed wall clock against this, so a missing or
		// wrong zone moves every event on that site by an hour.
		for (const i of INSTANCES) expect(i.timezone).toMatch(/^[A-Za-z]+\/[A-Za-z_]+$/);
	});

	it('covers Sunnhordland museum without a new importer', () => {
		// The payoff of a platform importer: the museum runs the same WordPress plugin, so it is a
		// config entry rather than another package to maintain.
		expect(INSTANCES.map((i) => i.slug)).toContain('sunnhordland-museum');
	});
});
