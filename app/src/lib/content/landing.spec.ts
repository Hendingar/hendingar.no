import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { MANIFEST, PIPELINE } from './landing.ts';

/**
 * The landing copy restates the README's verification table. That duplication is deliberate for
 * now (see landing.ts) but it must not silently drift, so this test fails when the two stop
 * matching.
 *
 * The non-goals used to be mirrored here too, from README.md#what-it-does-not-do. That section of
 * the page is gone, so there is no second copy left to drift — the README is the only statement of
 * them now, which is where they were binding all along.
 */
const readme = readFileSync(
	fileURLToPath(new URL('../../../../README.md', import.meta.url)),
	'utf-8'
);

/**
 * Slice between two headings, failing loudly if either is missing. `indexOf` returns -1 for an
 * absent marker, and `slice(start, -1)` silently runs to the end of the file — which is how the
 * first version of this test counted the Status table as pipeline stages.
 */
function section(from: string, to: string): string {
	const start = readme.indexOf(from);
	const end = readme.indexOf(to);
	if (start < 0) throw new Error(`README no longer contains heading: ${from}`);
	if (end < 0) throw new Error(`README no longer contains heading: ${to}`);
	if (end <= start) throw new Error(`README headings out of order: ${from} / ${to}`);
	return readme.slice(start, end);
}

describe('landing content', () => {
	it('has a pipeline step for every stage the README documents', () => {
		// Count the rows of the verification table structurally. Matching stage names would be
		// brittle in both directions: prettier pads the cells, and the landing copy is Nynorsk
		// while the README is English, so only the count is comparable.
		const rows = section('## Agentic verification', '## Status')
			.split('\n')
			.filter((line) => line.trimStart().startsWith('|'))
			.filter((line) => !/^\|[\s|:-]+\|$/.test(line.trim())) // drop the --- separator
			.slice(1); // drop the header row
		expect(rows.length).toBeGreaterThan(0);
		expect(PIPELINE.length).toBe(rows.length);
	});

	it('has exactly three manifest claims, since the band is a fixed three-row layout', () => {
		expect(MANIFEST.length).toBe(3);
	});
});
