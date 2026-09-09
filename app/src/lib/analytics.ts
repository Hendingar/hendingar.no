/**
 * Page analytics, through d8a's server-side collector.
 *
 * A GA4-compatible tracker that reports to `global.t.d8a.tech` rather than to Google directly.
 * That is a smaller disclosure than gtag.js — no Google-owned script runs in the page, and the
 * collector is the only third party a visitor's browser talks to — but it is still a third party
 * receiving a page view and an IP, so the README no longer claims otherwise.
 *
 * ## Only on the real site
 *
 * Gated on the hostname, not on a build flag. Without that every `pnpm dev`, every preview server
 * and all ninety-odd end-to-end tests would report page views, which would make the numbers useless
 * for exactly the question they exist to answer. A build flag would work too and would be one more
 * thing to get wrong in an environment file; the hostname cannot be misconfigured.
 */

import { LIVE_HOSTS } from './origin.ts';

const MEASUREMENT_ID = '05801cfd-cf47-4892-9a2a-b301f6b2c429';
const COLLECTOR = `https://global.t.d8a.tech/${MEASUREMENT_ID}/d/c`;

/** Anything but the live site — localhost, a preview, CI — reports nothing. */
export function shouldTrack(hostname: string): boolean {
	return LIVE_HOSTS.has(hostname);
}

/**
 * The little a browser will admit about being driven rather than read.
 *
 * Structural, not `Navigator`: this needs two of its ninety properties, and taking the interface
 * would make it untestable without a browser. `webdriver` is a real `Navigator` field — Chrome
 * sets it under CDP automation — so the shape is honest.
 */
type BrowserIdentity = { webdriver?: boolean; userAgent?: string };

/**
 * Automation markers that appear in a user agent.
 *
 * Deliberately narrow. `bot`, `crawler` and `spider` are absent, and not by oversight: `/bot/i`
 * matches Cubot, a real phone brand, and a plain crawler does not run this script anyway. The
 * whole point is the headless browsers that DO run it.
 */
const AUTOMATION_MARKERS = /headless|puppeteer|playwright|phantomjs|selenium|webdriver/i;

/**
 * Is this a browser being driven by a program?
 *
 * One month of the dashboard, filtered to the United States: 46 "users", 50 sessions, 501 page
 * views. Every session exactly an hour long — which is a timeout, not a reader. The browser column
 * said `(not set)` at 11.5 views per session, with `Headless Chrome` named outright beside it. The
 * regions were California, Iowa, Texas, Oregon and New York, which is a list of cloud datacentres
 * rather than a list of places people live.
 *
 * They execute JavaScript — this file only runs on `hendingar.no` and it ran — so they are real
 * headless browsers walking the listing, not the polite crawlers that fetch HTML and leave. There
 * is nothing wrong with that, and there is something wrong with counting it: the numbers exist to
 * answer "is anybody reading this, and does it lead anywhere", and 500 page views from a
 * datacentre answers it with a lie.
 *
 * **A filter, not a block.** Nothing here refuses anybody a page — the site still serves every one
 * of these requests, and search engines must keep crawling it or an event index has failed at its
 * job. This only declines to report them.
 *
 * It catches stock Playwright, Puppeteer and Selenium. It does not catch a scraper that patches
 * `navigator.webdriver` and sends a plausible user agent, and nothing running in the page can:
 * that is an arms race the client side does not win, and pretending otherwise here would be worse
 * than the gap. The trade is asymmetric and cheap in our favour — a false positive costs one
 * uncounted page view, which is the same currency the whole problem is denominated in.
 */
export function isAutomatedBrowser(nav: BrowserIdentity): boolean {
	if (nav.webdriver === true) return true;
	// A real browser always sends one. Empty is the `(not set)` column in the dashboard.
	const ua = nav.userAgent?.trim() ?? '';
	if (!ua) return true;
	return AUTOMATION_MARKERS.test(ua);
}

let started = false;

/**
 * Start reporting, once.
 *
 * Idempotent because the layout effect it runs from can re-run, and a second `installD8a()` would
 * leave two trackers double-counting every page.
 *
 * Deliberately quiet on failure. Analytics is the least important thing on the page: a blocked
 * request, an extension that removes the script, or a collector that is down must cost the reader
 * nothing at all.
 *
 * Two gates, and `nav` is a parameter because of the second one. The hostname gate keeps
 * development quiet; `isAutomatedBrowser` keeps datacentres out of the numbers — and the browser
 * spec for this file runs under Playwright, which *is* an automated browser, so it has to be able
 * to hand in a reader's identity to test the reader's path at all. Defaulted rather than required,
 * because the one real call site should not have to know that.
 */
export async function startAnalytics(
	hostname: string,
	nav: BrowserIdentity = navigator
): Promise<void> {
	if (started || !shouldTrack(hostname) || isAutomatedBrowser(nav)) return;
	started = true;

	try {
		const { installD8a } = await import('@d8a-tech/wt');
		installD8a();

		const d8a = window.d8a;
		if (!d8a) return;

		d8a('js', new Date());

		/*
		 * Cookieless, and asked for before `config` because that is the only point at which it can
		 * still be obeyed.
		 *
		 * Left alone, the tracker writes two first-party cookies — `_d8a` and `_d8a_<property>` —
		 * which in Norway means a consent banner before a single page view is legal to collect.
		 * Denied, it keeps the client id in memory for the life of the page instead.
		 *
		 * The cost is real and worth naming: there is no cross-session dedup any more, so "users"
		 * is a meaningless number here and only counts of events mean anything. That is the right
		 * trade for this site. We are asking "is anybody reading this, and does it lead anywhere",
		 * not "who came back" — and the README's promise (README.md, "An ad platform") stays true
		 * without a fourth qualifying paragraph.
		 */
		d8a('consent', 'default', { analytics_storage: 'denied' });

		d8a('config', MEASUREMENT_ID, { server_container_url: COLLECTOR });
	} catch {
		// See above: never the reader's problem.
	}
}

/**
 * One named thing that happened, with facts about the *event being viewed* — never about the
 * reader.
 *
 * The list of names is short and deliberate, and it is written down in README.md. Nothing here
 * records a search term, a filter, a scroll position, a dwell time or anything joinable back to a
 * person: those are the "engagement metrics" the README rules out, and a non-goal is only worth
 * having if it holds when it is inconvenient.
 *
 * Same quiet contract as everything else in this file. It returns nothing, it throws nothing, and
 * on a development host it does not even reach the tracker — so `pnpm dev`, previews and the
 * end-to-end suite report nothing at all.
 */
export function track(name: TrackedEvent, params: Record<string, string | number>): void {
	if (!started) return;
	try {
		window.d8a?.('event', name, params);
	} catch {
		// See above.
	}
}

/**
 * Which listing a tile was clicked from, derived from the path rather than passed down.
 *
 * The alternative was a `list` prop threaded through EventGrid and EventsByDay from five call
 * sites, for one string that the URL already knows. A prop that has to be remembered at every call
 * site is a prop that will be forgotten at one of them, and then the numbers quietly say `framsida`
 * for a page that is not the front page.
 *
 * Coarse on purpose: `/kalender/2026-09-12` is `kalender`, not a date. Which day somebody browsed
 * is not a question we are asking.
 */
export function surfaceOf(pathname: string): string {
	if (pathname === '/') return 'framsida';
	const first = pathname.split('/')[1] ?? '';
	return ['hendingar', 'kalender', 'poppis', 'hjarta'].includes(first) ? first : 'anna';
}

/**
 * Every event we send, in one place, so the whole tracking plan is greppable and adding a seventh
 * is a decision rather than a call site.
 *
 * GA4's conventional names where one exists (`page_view`, `select_content`, `click`), because the
 * warehouse schema stays legible to anyone who has read a GA4 export before.
 */
export type TrackedEvent =
	/** Which pages get read. Sent on every navigation — see the note in +layout.svelte. */
	| 'page_view'
	/** An event page opened: which kind, from which source, how far ahead. */
	| 'view_event'
	/** An event opened from a listing, and which listing it was. */
	| 'select_content'
	/** A link off our site. The one that matters: an index that sends nobody onward has failed. */
	| 'click'
	/** The calendar file downloaded. Whether the export promise is used. */
	| 'add_to_calendar'
	/** A submission decided, and which of the checks decided it. */
	| 'submit_result';
