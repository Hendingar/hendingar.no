import { expect, test } from '@playwright/test';

/**
 * Improving an event we already have, instead of being turned away for having it.
 *
 * The duplicate check used to be a dead end. A submission matching a published event was
 * `duplicate`; one that merely resembled it was `declined`, because `duplicate` blocks and
 * `uncertain` is not a pass. Either way the only routes forward were to edit the title until it
 * stopped matching — which publishes a second row and is a lie — or to let the submission expire
 * with the poster and the source link still in it. Meanwhile the row it matched was frequently an
 * imported one with no picture and a single citation, and the person had both.
 *
 * These specs hold the two halves of the replacement: the offer is made, and taking it changes the
 * existing event without creating a second listing.
 *
 * Order-independent on purpose (CLAUDE.md rule 6). Both find their target at runtime from the
 * listing rather than naming a seeded row — the seed's dates move with the clock — and neither
 * asserts anything that a previous run's contribution could have already made true. A gap that is
 * filled once stays filled, so "the source link landed" is exactly the kind of claim that passes
 * on a fresh database and fails on the second run.
 */

/**
 * A published, dated, still-upcoming event, taken from whatever the listing shows today.
 *
 * Both narrowings are load-bearing rather than tidiness, and both were found by deliberately
 * breaking the rule the last spec guards — publishing the contribution instead of storing it as
 * another report — and watching the spec stay green:
 *
 * - **`section.day`, not the whole page.** The page's first `/hending/` link was a *standing*
 *   offer, and the day list excludes those (`datedOnly`), so a published clone of one could never
 *   appear in it.
 * - **The last link, not the first.** The first day group holds events already under way, which
 *   the listing keeps by their end time. A clone of one inherits its start and has no end, so it
 *   sorts into the past and is filtered out — again invisible to the assertion. The furthest-ahead
 *   event has no such escape hatch.
 *
 * With both in place, publishing the contribution fails the spec, which is what makes it a guard.
 */
async function anUpcomingEvent(page: import('@playwright/test').Page): Promise<number> {
	await page.goto('/hendingar');
	/*
	 * `:not([href$=".ics"])`, because a tile links its own calendar file under the same prefix.
	 *
	 * Without it `.last()` sometimes resolved to `…/kalender.ics`, whose link text is not a title —
	 * so the title-narrowed search below found nothing and the spec failed on its own second run.
	 */
	const link = page.locator('section.day a[href^="/hending/"]:not([href$=".ics"])').last();
	await expect(link).toBeVisible();
	const href = await link.getAttribute('href');
	const id = Number(href!.slice('/hending/'.length).split('-')[0]);
	expect(Number.isSafeInteger(id) && id > 0).toBe(true);
	return id;
}

/**
 * The event's title, exactly as the database holds it.
 *
 * Read out of the contribution form's own prefill rather than off a link, because that value comes
 * straight from `contributionTarget` — so a title-narrowed search built from it cannot miss the
 * row it is about. Scraping the tile's text was close enough to work once and not twice.
 */
async function openContributionForm(
	page: import('@playwright/test').Page,
	id: number
): Promise<string> {
	await page.goto(`/send-inn?bidra=${id}`);
	await expect(page.locator('#title')).not.toHaveValue('');
	return page.locator('#title').inputValue();
}

test('the form opens as a contribution, with the event’s own identity fixed', async ({ page }) => {
	const id = await anUpcomingEvent(page);
	await openContributionForm(page, id);

	/*
	 * The heading changes, because the request changes.
	 *
	 * "Send inn ei hending" asks somebody to add one. This asks them to improve one that is here,
	 * and it names it — an invitation to "help make this better" with no event named is not
	 * something anybody can act on.
	 */
	await expect(page.getByRole('heading', { name: 'Gjer denne betre' })).toBeVisible();
	await expect(page.locator('.form__read')).toContainText('Du bidreg til');

	/*
	 * Title, date, time and place belong to the event, not to the contributor.
	 *
	 * These are what `comparePair` compares and what a reader followed a link to find, so a
	 * contribution authorised by a browser-local id must not be able to move them — otherwise
	 * "improve this event" is a way to repoint somebody else's URL. Read-only rather than disabled:
	 * a disabled input posts nothing, and the value is still stored as the sender's own account.
	 */
	const title = page.locator('#title');
	await expect(title).not.toHaveValue('');
	for (const field of ['#title', '#date', '#startTime', '#venueName']) {
		await expect(page.locator(field)).toHaveAttribute('readonly', '');
	}

	// A contribution improves one row and creates none, so there is nothing for a repetition to
	// expand into — the schema refuses the combination, so the question is not asked.
	await expect(page.locator('.repeat')).toBeHidden();
});

test('a near-duplicate is offered as something to improve, not a wall', async ({ page }) => {
	/*
	 * The values come from the target itself, via the contribution form's own prefill.
	 *
	 * Typing a guess would make this spec depend on the seed's clock-relative dates lining up
	 * within the probe's one-hour window. Reading them back is exact, and it is the same data the
	 * probe will compare against.
	 */
	const id = await anUpcomingEvent(page);
	const target = {
		title: await openContributionForm(page, id),
		date: await page.locator('#date').inputValue(),
		startTime: await page.locator('#startTime').inputValue(),
		venueName: await page.locator('#venueName').inputValue()
	};

	// Now arrive as somebody who has no idea we already have it, and type the same event in.
	await page.goto('/send-inn');
	await page.locator('#title').fill(target.title);
	await page.locator('#date').fill(target.date);
	await page.locator('#startTime').fill(target.startTime);
	await page.locator('#venueName').fill(target.venueName);

	const banner = page.locator('.dupe-warn');
	await expect(banner).toBeVisible();
	/*
	 * The banner used to end at "treng du ikkje sende inn på nytt" — true, and a full stop. Both
	 * answers are now actions: yes leads somewhere, and no carries on as before.
	 */
	await expect(banner).toContainText('gjere henne betre');
	await expect(banner.getByRole('button', { name: /Nei, dette er ei anna hending/ })).toBeVisible();

	const offer = banner.getByRole('link', { name: /Ja/ });
	await expect(offer).toHaveAttribute('href', `/send-inn?bidra=${id}`);
	await offer.click();
	await expect(page.getByRole('heading', { name: 'Gjer denne betre' })).toBeVisible();
});

test('a contribution changes the event and adds no second listing', async ({ page }) => {
	const id = await anUpcomingEvent(page);
	const title = await openContributionForm(page, id);

	/*
	 * How many rows the listing shows for this exact title, before anything is sent.
	 *
	 * Searched rather than counted across the whole page: the unfiltered list is paginated, so an
	 * extra row at position 51 changes nothing visible and the assertion would pass on a bug.
	 * Narrowing to the title makes the count small, stable, and sensitive to precisely the failure
	 * this is here to catch.
	 */
	const search = `/hendingar?q=${encodeURIComponent(title)}`;
	await page.goto(search);
	const listed = page.locator('section.day a[href^="/hending/"]');
	const before = await listed.count();
	expect(before).toBeGreaterThan(0);

	await openContributionForm(page, id);

	/*
	 * A source link — the cheapest thing a contributor has that an imported row usually lacks.
	 *
	 * Whether it lands depends on whether the row already has one, and a second run of this spec
	 * against the same database will find the gap closed by the first. That is the correct
	 * behaviour (nothing is ever overwritten), so nothing below asserts the fill itself: the
	 * outcome is `contributed` either way, and the panel says honestly which of the two happened.
	 */
	await page.locator('#sourceUrl').fill('https://example.org/e2e-bidrag');
	await page.getByRole('button', { name: /Send inn hendinga/ }).click();

	const verdict = page.locator('.verdict');
	await expect(verdict).toBeVisible();
	/*
	 * Not "Ikkje publisert", which is what every other unpublished outcome says.
	 *
	 * No listing was created and that is the point rather than a shortfall. With no verifier
	 * reachable plausibility comes back `uncertain` — which does not block a contribution, because
	 * only a `fail` means the text should not go near a live event.
	 */
	await expect(verdict.locator('#verdict-h')).toHaveText('Takk — hendinga blei betre');
	await expect(verdict.locator('.verdict__head')).toHaveAttribute('data-outcome', 'contributed');

	// It names the event it improved, rather than reporting an unexplained non-publication.
	const cited = verdict.locator('.dupe');
	await expect(cited).toContainText('Hendinga du gjorde betre');
	await expect(cited.locator('.dupe__link')).toHaveAttribute(
		'href',
		new RegExp(`^/hending/${id}-`)
	);

	/*
	 * And no second row anywhere.
	 *
	 * A contribution is stored as another report of the same event — `rejected` with
	 * `duplicate_of_id` set, which is what an imported duplicate looks like — so every listing
	 * query keeps filtering it out. This is the assertion that would catch it being published.
	 */
	await page.goto(search);
	await expect(page.locator('section.day a[href^="/hending/"]')).toHaveCount(before);
});
