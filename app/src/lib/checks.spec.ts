import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { PIPELINE } from './checks.ts';

/**
 * The rendered pipeline restates the README's verification table. That duplication is deliberate
 * for now, but it must not silently drift, so this test fails when the two stop matching.
 *
 * It used to live beside the landing copy, back when the pipeline was landing-page text. It is
 * now shared by `/` and `/send-inn`, so the test moved with the data.
 */
const readme = readFileSync(fileURLToPath(new URL('../../../README.md', import.meta.url)), 'utf-8');

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

describe('the five checks', () => {
	it('has a pipeline step for every stage the README documents', () => {
		// Count the rows of the verification table structurally. Matching stage names would be
		// brittle in both directions: prettier pads the cells, and the rendered copy is Nynorsk
		// while the README is English, so only the count is comparable.
		const rows = section('## Agentic verification', '## Status')
			.split('\n')
			.filter((line) => line.trimStart().startsWith('|'))
			.filter((line) => !/^\|[\s|:-]+\|$/.test(line.trim())) // drop the --- separator
			.slice(1); // drop the header row
		expect(rows.length).toBeGreaterThan(0);
		expect(PIPELINE.length).toBe(rows.length);
	});
});
