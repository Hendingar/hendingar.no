import { error } from '@sveltejs/kit';
import { command, query } from '$app/server';
import { askPileSchema, comparePileSchema } from '@hendingar/core/validation';
import { searchTermSchema } from '@hendingar/core/search';
import {
	askPile as answerFromServer,
	compareOnPile,
	pileEvents,
	textScores
} from './server/haugen.ts';
import { allow } from './server/limits.ts';

/**
 * The boundary for `/haugen` — the pile, and the two ways of asking it something.
 *
 * Read with ADR 0022. The split between `query` and `command` here is the security argument, not
 * a style choice: a `query` is a GET, and a GET is what a crawler follows, so nothing reachable by
 * GET may spend money. Text matching is free and answers `?q=` in the address bar; the ranker
 * costs a TypeSafe call and is only reachable as a `command`, which a person has to cause by
 * typing (the same reasoning ADR 0017 made for writing help).
 */

/**
 * The pile: the nearest upcoming events, in date order, as much of each as a ball needs.
 *
 * The full description and organiser are read on the server for the ranker and stay there; a ball
 * carries its picture, its title and two lines for the hover card. A hundred and fifty full
 * descriptions would be most of the page's weight.
 */
export const pile = query(async () => {
	const rows = await pileEvents();
	return rows.map((e) => ({
		id: e.id,
		title: e.title,
		category: e.category,
		startsAt: e.startsAt,
		venueName: e.venueName,
		venueTimeZone: e.venueTimeZone,
		posterUrl: e.posterUrl,
		posterSrcset: e.posterSrcset,
		sourceSlugs: (e.sourceMarks ?? []).map((m) => m.slug),
		sourceNames: (e.sourceMarks ?? []).map((m) => m.name),
		municipality: e.municipality,
		// The hover card's two lines, not the description: enough to tell a babysong from a
		// concert, and a fraction of the bytes.
		blurb: blurb(e.description)
	}));
});

const BLURB_CHARS = 140;

function blurb(text: string | null): string | null {
	if (!text) return null;
	const flat = text.replace(/\s+/g, ' ').trim();
	if (flat.length <= BLURB_CHARS) return flat;
	return `${flat.slice(0, BLURB_CHARS).replace(/\s+\S*$/, '')}…`;
}

export type PileBall = Awaited<ReturnType<typeof pile>>[number];

/**
 * Text matching over the pile, for a search that arrived in the address bar.
 *
 * What a visitor without JavaScript gets, and what a shared `/haugen?q=konsertar` renders before
 * hydration. Never the ranker: see the note at the top of this file.
 */
export const textAnswer = query(searchTermSchema, async (q) => {
	if (!q) return [];
	const rows = await pileEvents();
	return textScores(
		q,
		rows.map((e) => e.id)
	);
});

/**
 * Ask the pile something, live. Ranked by Jev when it can be, by text when it cannot.
 *
 * `mode` says which, so the page can be honest about a worse answer rather than presenting text
 * matching as if it understood the question.
 */
export const askPile = command(askPileSchema, async ({ q }) => {
	// The page never sends an empty question; anything that does is not the page.
	if (!q) error(400, 'empty question');
	const events = await pileEvents();
	// Over their own share, a visitor gets the text answer the whole site gets past its budget —
	// so one script typing cannot spend the ranker for everybody else.
	return answerFromServer(q, events, allow('ask'));
});

/**
 * The same three events, asked of Jev and of an ordinary chat model, side by side.
 *
 * A `command` for the same reason as `askPile`: it spends money, so a person has to press for it.
 */
export const comparePile = command(comparePileSchema, async ({ q, ids }) => {
	if (!q) error(400, 'empty question');
	if (!allow('ask')) return { status: 'budsjett' as const };
	return compareOnPile(q, ids);
});
