import { describe, expect, it, vi } from 'vitest';
import { isAutomatedBrowser, shouldTrack, surfaceOf } from './analytics.ts';

const installD8a = vi.fn();
vi.mock('@d8a-tech/wt', () => ({ installD8a }));

describe('shouldTrack', () => {
	it('reports from the live site', () => {
		expect(shouldTrack('hendingar.no')).toBe(true);
		expect(shouldTrack('www.hendingar.no')).toBe(true);
	});

	it('reports nothing from a development or test host', () => {
		/*
		 * The reason this is a function rather than a build flag. Ninety-odd end-to-end tests, every
		 * `pnpm dev` and every preview server would otherwise report page views, and the numbers
		 * would answer a different question from the one they are for.
		 */
		for (const host of [
			'localhost',
			'127.0.0.1',
			'dev.hendingar.no',
			'hendingar.no.evil.example'
		]) {
			expect(shouldTrack(host), host).toBe(false);
		}
	});

	it('is an exact host match, not a suffix one', () => {
		// `endsWith('hendingar.no')` would happily report from an attacker's lookalike domain.
		expect(shouldTrack('nothendingar.no')).toBe(false);
	});
});

describe('isAutomatedBrowser', () => {
	/*
	 * The traffic this was written for. One month, filtered to the United States: 46 "users", 50
	 * sessions, 501 page views, every session exactly an hour, browser `(not set)` at 11.5 views a
	 * session with `Headless Chrome` named beside it, out of California, Iowa, Texas, Oregon and
	 * New York — cloud datacentres, not towns.
	 */
	const READER = {
		webdriver: false,
		userAgent:
			'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36'
	};

	it('believes a browser that admits it is being driven', () => {
		// The one honest signal there is: Chrome sets it under CDP automation.
		expect(isAutomatedBrowser({ ...READER, webdriver: true })).toBe(true);
	});

	it('catches the headless user agents that showed up in the dashboard', () => {
		for (const userAgent of [
			'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/140.0.0.0 Safari/537.36',
			'Mozilla/5.0 (Windows NT 10.0; Win64; x64) puppeteer/23.0.0',
			'python-requests/2.32 selenium/4.24',
			'PhantomJS/2.1.1'
		]) {
			expect(isAutomatedBrowser({ webdriver: false, userAgent }), userAgent).toBe(true);
		}
	});

	it('treats an absent user agent as automation', () => {
		// This is the `(not set)` column. A real browser always sends one.
		for (const userAgent of ['', '   ', undefined]) {
			expect(isAutomatedBrowser({ webdriver: false, userAgent })).toBe(true);
		}
	});

	it('leaves an ordinary reader alone', () => {
		expect(isAutomatedBrowser(READER)).toBe(false);
	});

	it('leaves readers on the browsers people actually use alone', () => {
		for (const userAgent of [
			// Safari on an iPhone, Firefox on Windows, Edge, and Samsung's browser.
			'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
			'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:130.0) Gecko/20100101 Firefox/130.0',
			'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 Edg/140.0.0.0',
			'Mozilla/5.0 (Linux; Android 14; SAMSUNG SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/26.0 Chrome/140.0.0.0 Mobile Safari/537.36'
		]) {
			expect(isAutomatedBrowser({ webdriver: false, userAgent }), userAgent).toBe(false);
		}
	});

	it('does not read "bot" out of the middle of a real device name', () => {
		/*
		 * Cubot is a phone brand, and `/bot/i` matches it. That is why the marker list names the
		 * automation tools instead of the word "bot" — and why `crawler` and `spider` are absent
		 * too: a crawler that does not run JavaScript never reaches this code, so excluding it
		 * buys nothing and risks a reader.
		 */
		expect(
			isAutomatedBrowser({
				webdriver: false,
				userAgent:
					'Mozilla/5.0 (Linux; Android 13; Cubot X30) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36'
			})
		).toBe(false);
	});
});

describe('surfaceOf', () => {
	it('names the listing a tile was clicked from', () => {
		expect(surfaceOf('/')).toBe('framsida');
		expect(surfaceOf('/hendingar')).toBe('hendingar');
		expect(surfaceOf('/poppis/vist')).toBe('poppis');
	});

	it('is coarse on purpose', () => {
		// Which day somebody browsed is not a question we are asking, so the date does not travel.
		expect(surfaceOf('/kalender/2026-09-12')).toBe('kalender');
		expect(surfaceOf('/kalender')).toBe('kalender');
	});

	it('never invents a name for a page that is not a listing', () => {
		expect(surfaceOf('/send-inn')).toBe('anna');
		expect(surfaceOf('/hending/12-konsert')).toBe('anna');
		expect(surfaceOf('')).toBe('anna');
	});
});

/**
 * That `startAnalytics` actually consults the gate — not merely that the gate is right.
 *
 * Written after deleting `isAutomatedBrowser(nav)` from the call and watching all 180 tests pass.
 * Every assertion about it was on the pure function, so the wiring was unguarded and a later edit
 * could have dropped it in silence. A correct predicate nobody calls is not a filter.
 *
 * A fresh copy of the module per test, because the install latch is module state and going through
 * one shared instance would make these pass or fail on which ran first (CLAUDE.md rule 6). The
 * browser spec cannot do this — it needs the one real `window` — which is why the wiring is
 * asserted here, under node, where the module registry is resettable.
 *
 * `installD8a` being called is the observable line: it is the last thing that happens before the
 * tracker touches `window`, which does not exist here, and the module swallows that quietly.
 */
describe('startAnalytics consults the automation gate', () => {
	const READER = {
		webdriver: false,
		userAgent:
			'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36'
	};

	async function freshStart(): Promise<typeof import('./analytics.ts').startAnalytics> {
		installD8a.mockClear();
		vi.resetModules();
		return (await import('./analytics.ts')).startAnalytics;
	}

	it('installs nothing for a driven browser, even on the live site', async () => {
		const startAnalytics = await freshStart();
		await startAnalytics('hendingar.no', { ...READER, webdriver: true });
		expect(installD8a).not.toHaveBeenCalled();
	});

	it('installs nothing for a headless user agent on the live site', async () => {
		const startAnalytics = await freshStart();
		await startAnalytics('hendingar.no', {
			webdriver: false,
			userAgent: 'Mozilla/5.0 (X11; Linux x86_64) HeadlessChrome/140.0.0.0 Safari/537.36'
		});
		expect(installD8a).not.toHaveBeenCalled();
	});

	it('still installs for a reader on the live site', async () => {
		// The other direction, and the one that matters more: the gate must not have closed the door.
		const startAnalytics = await freshStart();
		await startAnalytics('hendingar.no', READER);
		expect(installD8a).toHaveBeenCalledTimes(1);
	});
});
