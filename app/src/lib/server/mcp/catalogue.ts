import { isHttpError } from '@sveltejs/kit';
import type { z } from 'zod';
import type {
	calendarDateSchema,
	calendarSpanSchema,
	calendarWeekSchema,
	eventQuerySchema,
	weekendSchema
} from '@hendingar/core/validation';
import type { searchTermSchema } from '@hendingar/core/search';
import {
	calendarRange,
	dayCounts,
	filmScreenings,
	getEvent,
	listCategoryCounts,
	listEvents,
	listEventsOnDate,
	listPopular,
	listUpcoming,
	placeCounts,
	searchSuggestions,
	siteStatus,
	standingOffers,
	weekendEvents,
	weekEvents,
	weeklyActivities
} from '../../events.remote.ts';
import { listCollection } from '../../collection.remote.ts';
import { currentPicks } from '../kurator.ts';
import type { Catalogue } from './tools.ts';

/**
 * Everything the MCP server may read, and nothing it may not.
 *
 * Each entry is the site's own remote `query` — the function the page calls — so an assistant and
 * a reader asking the same question get the same rows, filtered by the same predicates
 * (`stillListed`, `datedOnly`, the duplicate rule). There is no second copy of any query to drift.
 *
 * What is absent is the point. No `command`, no `form`, nothing keyed on a `clientId`, nothing
 * that reaches the verifier or Jev: the server is read-only by construction, not by a flag, and
 * `contract.spec.ts` fails if a tool module ever imports one of those modules (ADR 0024).
 *
 * The tools take this as a parameter rather than importing it, so the contract test can hand them
 * a stub and run without a database. `Catalogue` in `tools.ts` is the shape they need.
 */
export const liveCatalogue = {
	listEvents: async (input: z.input<typeof eventQuerySchema>) => await listEvents(input),
	/** Null for an id that is not a published event, rather than the page's 404. */
	getEvent: async (id: number) => {
		try {
			return await getEvent(id);
		} catch (cause) {
			if (isHttpError(cause) && cause.status === 404) return null;
			throw cause;
		}
	},
	filmScreenings: async (id: number) => await filmScreenings(id),
	listEventsOnDate: async (date: z.input<typeof calendarDateSchema>) =>
		await listEventsOnDate(date),
	weekendEvents: async (which: z.input<typeof weekendSchema>) => await weekendEvents(which),
	weekEvents: async (weekKey: z.input<typeof calendarWeekSchema>) => await weekEvents(weekKey),
	calendarRange: async () => await calendarRange(),
	dayCounts: async (span: z.input<typeof calendarSpanSchema>) => await dayCounts(span),
	placeCounts: async (span: z.input<typeof calendarSpanSchema>) => await placeCounts(span),
	listUpcoming: async (limit: number) => await listUpcoming(limit),
	standingOffers: async () => await standingOffers(),
	weeklyActivities: async () => await weeklyActivities(),
	/** The stored picks. Never `curateToday` — reading them must not be able to make any. */
	weekendPicks: () => currentPicks(),
	listPopular: async (input: { by: 'hearts' | 'views'; limit: number }) => await listPopular(input),
	searchSuggestions: async (term: z.input<typeof searchTermSchema>) =>
		await searchSuggestions(term),
	listCategoryCounts: async () => await listCategoryCounts(),
	listSources: async () => (await listCollection()).sources,
	siteStatus: async () => await siteStatus()
} satisfies Catalogue;
