import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { findContractingStatements, splitStatements } from '../src/migration-safety.ts';

/**
 * The expand/contract rule, enforced.
 *
 * `deploy.yml` applies migrations before the new revision is healthy, so the old code runs against
 * the new schema for a window. A subtractive migration breaks every query the running app makes,
 * and with no down-migration and no revision revert there is nothing to roll back to. This test is
 * why that cannot reach main by accident.
 */
const migrationsDir = fileURLToPath(new URL('../migrations', import.meta.url));

type Acknowledgements = { acknowledged: Record<string, string> };

const acknowledged: Acknowledgements = JSON.parse(
	readFileSync(`${migrationsDir}/contracting.json`, 'utf-8')
);

const migrationFiles = readdirSync(migrationsDir)
	.filter((f) => f.endsWith('.sql'))
	.sort();

describe('findContractingStatements', () => {
	it('passes an additive migration', () => {
		expect(findContractingStatements(`ALTER TABLE "events" ADD COLUMN "note" text;`)).toEqual([]);
		expect(findContractingStatements(`ALTER TYPE "source_kind" ADD VALUE 'link';`)).toEqual([]);
		expect(
			findContractingStatements(`CREATE TABLE "x" ("id" serial PRIMARY KEY NOT NULL);`)
		).toEqual([]);
	});

	it('catches a dropped column, which is the failure that motivated this', () => {
		const found = findContractingStatements(`ALTER TABLE "events" DROP COLUMN "poster_url";`);
		expect(found.map((f) => f.rule)).toContain('drop-column');
	});

	it('catches a rename, because a rename is a drop and an add at once', () => {
		expect(
			findContractingStatements(`ALTER TABLE "events" RENAME COLUMN "a" TO "b";`).map((f) => f.rule)
		).toContain('rename');
	});

	it('catches NOT NULL added without a default', () => {
		// The old revision inserts rows without the column and has no value to supply.
		expect(
			findContractingStatements(`ALTER TABLE "events" ADD COLUMN "x" text NOT NULL;`).map(
				(f) => f.rule
			)
		).toContain('add-column-not-null-without-default');
	});

	it('allows NOT NULL WITH a default, which the old revision survives', () => {
		expect(
			findContractingStatements(
				`ALTER TABLE "events" ADD COLUMN "x" boolean DEFAULT false NOT NULL;`
			)
		).toEqual([]);
	});

	it('allows NOT NULL on a GENERATED column, which nobody writes at all', () => {
		/*
		 * The one shape where "the old revision has no value to supply" is not a problem: it is not
		 * supposed to supply one. Postgres computes a generated column on every insert and rejects
		 * an INSERT that tries to set it, so a deploy where the old code is still writing rows is
		 * exactly the case this is safe in.
		 */
		expect(
			findContractingStatements(
				`ALTER TABLE "events" ADD COLUMN "kind" text GENERATED ALWAYS AS (case when ends_at - starts_at >= interval '30 days' then 'standing' else 'dated' end) STORED NOT NULL;`
			)
		).toEqual([]);
	});

	it('still refuses a plain NOT NULL column with no default', () => {
		// The carve-out above must not have opened the door generally — the word GENERATED is what
		// makes it safe, and a column without it is the original hazard.
		expect(
			findContractingStatements(`ALTER TABLE "events" ADD COLUMN "kind" text NOT NULL;`).map(
				(s) => s.rule
			)
		).toContain('add-column-not-null-without-default');
	});

	it('allows a dropped index, because slow is not the same as wrong', () => {
		expect(findContractingStatements(`DROP INDEX "events_starts_at_idx";`)).toEqual([]);
	});

	it('does not report a rule name that only appears in a comment', () => {
		expect(findContractingStatements(`-- DROP COLUMN would be unsafe here\nSELECT 1;`)).toEqual([]);
	});

	it('splits on drizzle statement breakpoints as well as semicolons', () => {
		const sql = `CREATE TABLE "a" ("id" int);\n--> statement-breakpoint\nCREATE TABLE "b" ("id" int);`;
		expect(splitStatements(sql)).toHaveLength(2);
	});
});

describe('the migrations in this repo', () => {
	it('has migrations to check', () => {
		expect(migrationFiles.length).toBeGreaterThan(0);
	});

	it.each(migrationFiles)('%s is expand-only, or acknowledged as contracting', (file) => {
		const findings = findContractingStatements(readFileSync(`${migrationsDir}/${file}`, 'utf-8'));
		if (findings.length === 0) return;

		const note = acknowledged.acknowledged[file];
		expect(
			note,
			[
				`${file} removes or narrows something, which breaks the revision still running during`,
				`the rollout. Either split it expand-first, or — if no deployed code uses this any more —`,
				`add it to packages/core/migrations/contracting.json with the reason.`,
				'',
				...findings.map((f) => `  [${f.rule}] ${f.statement}\n    -> ${f.why}`)
			].join('\n')
		).toBeTruthy();
		expect(note!.length, `${file}: the acknowledgement must say why it is safe`).toBeGreaterThan(
			20
		);
	});
});
