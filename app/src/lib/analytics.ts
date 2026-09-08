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
 */
export async function startAnalytics(hostname: string): Promise<void> {
	if (started || !shouldTrack(hostname)) return;
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
