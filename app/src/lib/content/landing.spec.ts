import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { DOES_NOT, MANIFEST, PIPELINE } from './landing.ts';

/**
 * The landing copy restates README.md#what-it-does-not-do and the README's verification table.
 * That duplication is deliberate for now (see landing.ts) but it must not silently drift, so this
 * test fails when the README's non-goals and the page's non-goals stop matching.
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

function readmeNonGoalTerms(): string[] {
	const body = section('## What it does not do', '## Agentic verification');
	return [...body.matchAll(/^- \*\*(?:A |An )?([^*]+?)\*\*/gim)].map((m) =>
		m[1].trim().toLowerCase()
	);
}

describe('landing content', () => {
	it('has a non-goal for every non-goal the README declares', () => {
		const inReadme = readmeNonGoalTerms();
		expect(inReadme.length).toBeGreaterThan(0);
		expect(DOES_NOT.length).toBe(inReadme.length);
	});

	it('has unique, non-empty claims', () => {
		const terms = DOES_NOT.map((c) => c.term);
		expect(new Set(terms).size).toBe(terms.length);
		for (const claim of DOES_NOT) {
			expect(claim.term.length).toBeGreaterThan(2);
			expect(claim.body.length).toBeGreaterThan(10);
		}
	});

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
