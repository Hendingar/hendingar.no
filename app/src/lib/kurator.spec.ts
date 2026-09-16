import { describe, expect, it } from 'vitest';
import { currentSelection } from './kurator.ts';

/**
 * The rule that decides whether the kurator's section is on the page.
 *
 * Written after it was wrong on the live site: the picks were read by today's date, and the job
 * that writes them lands around lunchtime, so the section was missing every morning. Every case
 * below takes "today" as an argument, so none of them depends on when they are run — which is also
 * what makes the morning case expressible at all.
 *
 * 2026-09-16 is a Wednesday, so `weekendAhead` for it is Fri 18th, Sat 19th, Sun 20th.
 */

const WEDNESDAY = '2026-09-16';

const pick = (forDate: string, localDate: string) => ({ forDate, localDate });

describe('currentSelection', () => {
	it('shows last night’s selection this morning', () => {
		// The bug, as a test. Nothing has run today yet and there is still an answer.
		const picks = [pick('2026-09-15', '2026-09-18'), pick('2026-09-15', '2026-09-19')];
		expect(currentSelection(picks, WEDNESDAY)).toHaveLength(2);
	});

	it('prefers today’s selection once it exists', () => {
		const picks = [pick('2026-09-15', '2026-09-18'), pick('2026-09-16', '2026-09-19')];
		const shown = currentSelection(picks, WEDNESDAY);
		expect(shown).toEqual([pick('2026-09-16', '2026-09-19')]);
	});

	it('never shows a selection made for a later day', () => {
		// Clock skew between the writer and the reader must not surface picks early.
		expect(currentSelection([pick('2026-09-17', '2026-09-18')], WEDNESDAY)).toEqual([]);
	});

	it('drops a pick whose day has already gone', () => {
		/*
		 * A Monday selection on a Saturday morning: Friday's pick has been and gone, Saturday's
		 * stands. The section shrinks rather than going stale.
		 */
		const saturday = '2026-09-19';
		const picks = [pick('2026-09-14', '2026-09-18'), pick('2026-09-14', '2026-09-19')];
		expect(currentSelection(picks, saturday)).toEqual([pick('2026-09-14', '2026-09-19')]);
	});

	it('retires itself when the weekend has passed, with nothing needing to run', () => {
		// The previous weekend's picks, read on the Wednesday after. The page empties on its own.
		const picks = [pick('2026-09-11', '2026-09-12'), pick('2026-09-11', '2026-09-13')];
		expect(currentSelection(picks, WEDNESDAY)).toEqual([]);
	});

	it('ignores an older selection entirely, even where its events still fit', () => {
		/*
		 * Only one selection is ever shown. Merging two would present picks made from two different
		 * candidate lists as one judgement, which is not a judgement anybody made.
		 */
		const picks = [pick('2026-08-20', '2026-09-20'), pick('2026-09-15', '2026-09-18')];
		expect(currentSelection(picks, WEDNESDAY)).toEqual([pick('2026-09-15', '2026-09-18')]);
	});

	it('is empty when nothing has ever been chosen', () => {
		expect(currentSelection([], WEDNESDAY)).toEqual([]);
	});
});
