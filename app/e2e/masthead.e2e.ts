import { expect, test } from '@playwright/test';

/**
 * The masthead is two ranks of links and one button on a row that has no slack: `.shell` stops
 * widening at 1280px of content, and the row wants 1360px of viewport to hold everything.
 *
 * That makes "it silently became two lines" the failure mode, and it is not one a screenshot of a
 * 1440px laptop would catch — during this change the bar was one clean line at 1440 and a wrapped
 * two at 1920, because `--step-micro` is a `vw` step that keeps growing after `.shell` has stopped.
 */

/** The four things the grid places, in DOM order. */
const PARTS = ['.mast__mark', '.mast__rank--views', '.mast__rank--meta', '.mast__cta'];

/**
 * Rank two at its widest, which is the only size worth testing the row against.
 *
 * "Hjarta" appears once this browser has hearted something, and that is per-context state in
 * localStorage — so writing it is hermetic in a way the heart *count* is not (see hearts.e2e.ts).
 * Without it rank two is two items and the row has slack it does not have in real use: the `vw`
 * bug this file exists for passed every assertion until this helper was added.
 */
async function seedPersonal(page: import('@playwright/test').Page): Promise<void> {
	await page.addInitScript(() => {
		try {
			localStorage.setItem('hendingar:hearts', JSON.stringify([1, 2, 3]));
		} catch {
			// A masthead must render without it; the test below says what it then proves.
		}
	});
}

/** Centre-line of each part, which is what "on the same row" actually means under `align-items`. */
async function centres(page: import('@playwright/test').Page): Promise<number[]> {
	return page.evaluate(
		(sel) =>
			sel.map((s) => {
				const box = document.querySelector(s)!.getBoundingClientRect();
				return Math.round(box.top + box.height / 2);
			}),
		PARTS
	);
}

/*
 * 2560 is the one that matters. Asserting only at 1440 is what let the `vw` step through: every
 * width below 1500 clamps `--step-micro` to its floor, so the bug was invisible until the monitor
 * got big enough for the type to grow while the container could not.
 */
for (const width of [1360, 1440, 1920, 2560]) {
	test(`the masthead is one row at ${width}px`, async ({ page }) => {
		await page.setViewportSize({ width, height: 900 });
		await seedPersonal(page);
		await page.goto('/');
		await expect(page.locator('nav a[href="/hjarta"]')).toBeVisible();

		const [mark, views, meta, cta] = await centres(page);
		expect(Math.abs(views - mark), 'rank one sits on the wordmark’s line').toBeLessThanOrEqual(1);
		expect(Math.abs(meta - mark), 'rank two sits on the wordmark’s line').toBeLessThanOrEqual(1);
		expect(Math.abs(cta - mark), '“Send inn” sits on the wordmark’s line').toBeLessThanOrEqual(1);

		// And rank one itself has not wrapped inside its own column, which is how the row first
		// failed at 1328px: every part on one centre-line, two lines of links inside it.
		const tops = await page.evaluate(() =>
			[...document.querySelectorAll('.mast__rank--views li')].map((li) =>
				Math.round(li.getBoundingClientRect().top)
			)
		);
		expect(tops.length).toBe(4);
		expect(new Set(tops).size, 'the four views are on one line').toBe(1);
	});
}

/*
 * The bug stated as an invariant, independent of any pixel count: a bigger monitor must never make
 * this bar taller. `.shell` stops widening at 1408px, so anything in the row still sized against
 * the viewport past that point is spending width the row has already run out of.
 */
test('a bigger monitor does not make the masthead taller', async ({ page }) => {
	await seedPersonal(page);
	const heightAt = async (width: number) => {
		await page.setViewportSize({ width, height: 900 });
		await page.goto('/');
		return page.evaluate(() =>
			Math.round(document.querySelector('.mast')!.getBoundingClientRect().height)
		);
	};

	const laptop = await heightAt(1440);
	for (const wide of [1600, 1920, 2560]) {
		expect(await heightAt(wide), `${wide}px must not be taller than 1440px`).toBeLessThanOrEqual(
			laptop
		);
	}

	// And the reason, pinned: rank two and the button are flat 12px, not the `vw`-based
	// `--step-micro`, which reaches 13px at 1625px and keeps the row shrinking as the screen grows.
	await page.setViewportSize({ width: 2560, height: 900 });
	await page.goto('/');
	await expect(page.locator('.mast__rank--meta a').first()).toHaveCSS('font-size', '12px');
	await expect(page.locator('.mast__cta')).toHaveCSS('font-size', '12px');
});

test('below the breakpoint the button keeps the top row rather than sinking under the ranks', async ({
	page
}) => {
	await page.setViewportSize({ width: 1024, height: 900 });
	await page.goto('/');

	const [mark, views, meta, cta] = await centres(page);
	// Stacked: the ranks drop, the button does not. It is the point of the change; it stays visible
	// on the wordmark's line at every width.
	expect(Math.abs(cta - mark), '“Send inn” stays beside the wordmark').toBeLessThanOrEqual(1);
	expect(views, 'rank one has dropped below the top row').toBeGreaterThan(mark);
	expect(meta, 'rank two has dropped below rank one').toBeGreaterThan(views);
});

test('the two ranks are told apart by more than their order', async ({ page }) => {
	await page.goto('/');
	const font = (sel: string) =>
		page.evaluate((s) => getComputedStyle(document.querySelector(s)!).fontFamily, sel);

	// Rank one carries the display face, rank two the mono label. Colour alone would not do it:
	// this is the whole reason the flat row of seven read as one undifferentiated list.
	expect(await font('.mast__rank--views a')).toMatch(/Archivo/i);
	expect(await font('.mast__rank--meta a')).toMatch(/Space Mono/i);
});

test('“Send inn” is the only filled thing in the bar, and its name is still just that', async ({
	page
}) => {
	await page.goto('/');
	const cta = page.locator('.mast__cta');

	// --peach on --navy-900: the inverted pairing brand.md measures at 8.29:1. The arrow is
	// decorative, so the accessible name must not have grown a glyph.
	await expect(cta).toHaveCSS('background-color', 'rgb(247, 169, 138)');
	await expect(cta).toHaveCSS('color', 'rgb(22, 34, 59)');
	await expect(cta).toHaveAccessibleName('Send inn');
});

test('the arrow goes before the row does, so the button can share the top line on a phone', async ({
	page
}) => {
	await page.setViewportSize({ width: 320, height: 800 });
	await page.goto('/');

	await expect(page.locator('.mast__cta svg')).toBeHidden();
	const [mark, , , cta] = await centres(page);
	expect(
		Math.abs(cta - mark),
		'“Send inn” shares the wordmark’s line at 320px'
	).toBeLessThanOrEqual(1);
	const overflow = await page.evaluate(
		() => document.documentElement.scrollWidth - document.documentElement.clientWidth
	);
	expect(overflow, 'the masthead must not scroll sideways at 320px').toBe(0);
});
