/**
 * Is a migration safe to apply while the previous revision is still serving?
 *
 * The deploy applies migrations before the new revision is healthy, so for a window the OLD code
 * runs against the NEW schema. That is fine for an additive change and fatal for a subtractive
 * one: a dropped or renamed column makes every query from the running app fail with
 * `42703 column does not exist`, and because there are no down-migrations and no revision revert,
 * a migration that succeeds before a failing deploy leaves the database permanently ahead of the
 * code with nothing to roll back to.
 *
 * The fix is expand/contract: every migration is additive, and removal happens in a LATER
 * migration once no deployed code reads the thing any more. This module is that rule made
 * mechanical, because a rule enforced by discipline is a rule that holds until the day someone is
 * in a hurry.
 *
 * Pure string analysis on purpose — no database, no drizzle internals — so it runs in `pnpm
 * verify` and cannot fail for want of a connection.
 */

export type MigrationFinding = {
	/** The offending SQL, trimmed to something readable in a test failure. */
	statement: string;
	rule: string;
	/** What breaks, stated as a consequence rather than a category. */
	why: string;
};

type Rule = {
	name: string;
	pattern: RegExp;
	why: string;
};

/**
 * Each rule describes a statement the OLD revision cannot survive.
 *
 * `DROP INDEX` is deliberately absent: losing an index makes queries slow, not wrong, and a
 * migration cannot be blocked for a performance change.
 */
const CONTRACTING_RULES: readonly Rule[] = [
	{
		name: 'drop-table',
		pattern: /\bDROP\s+TABLE\b/i,
		why: 'the running revision still queries this table'
	},
	{
		name: 'drop-column',
		pattern: /\bDROP\s+COLUMN\b/i,
		why: 'the running revision still selects this column, and Drizzle names every column explicitly'
	},
	{
		name: 'rename',
		pattern: /\bRENAME\s+(?:TO|COLUMN|CONSTRAINT)\b/i,
		why: 'a rename is a drop and an add at once — the old name disappears while code still uses it'
	},
	{
		name: 'set-not-null',
		pattern: /\bALTER\s+COLUMN\b[\s\S]*?\bSET\s+NOT\s+NULL\b/i,
		why: 'the running revision inserts rows without this column, and every such insert starts failing'
	},
	{
		name: 'change-type',
		pattern: /\bALTER\s+COLUMN\b[\s\S]*?\b(?:SET\s+DATA\s+)?TYPE\b/i,
		why: 'the running revision reads and writes the old type'
	},
	{
		name: 'drop-type',
		pattern: /\bDROP\s+TYPE\b/i,
		why: 'a column of this type is still being read by the running revision'
	},
	{
		name: 'drop-not-null-default',
		pattern: /\bALTER\s+COLUMN\b[\s\S]*?\bDROP\s+DEFAULT\b/i,
		why: 'the running revision relies on the default when it omits the column'
	},
	{
		name: 'add-column-not-null-without-default',
		// NOT NULL with no DEFAULT on the same statement: the old revision's inserts omit it.
		pattern: /\bADD\s+COLUMN\b(?:(?!\bDEFAULT\b)[\s\S])*?\bNOT\s+NULL\b(?![\s\S]*?\bDEFAULT\b)/i,
		why: 'the running revision inserts rows without this column and has no value to supply'
	},
	{
		name: 'add-unique-or-check',
		pattern: /\bADD\s+CONSTRAINT\b[\s\S]*?\b(?:UNIQUE|CHECK)\b/i,
		why: 'the running revision can still write rows that violate it, and the write fails rather than the deploy'
	}
];

/**
 * Split on semicolons at statement level.
 *
 * Crude, and adequate: drizzle-kit emits one statement per line separated by `--> statement-breakpoint`,
 * and nothing in these files contains a semicolon inside a string literal. A parser would be more
 * machinery than the input justifies.
 */
export function splitStatements(sql: string): string[] {
	return sql
		.split(/-->\s*statement-breakpoint|;/)
		.map((s) =>
			s
				// Strip line comments so a rule name mentioned in a comment is not a finding.
				.replace(/^\s*--.*$/gm, '')
				.trim()
		)
		.filter((s) => s.length > 0);
}

export function findContractingStatements(sql: string): MigrationFinding[] {
	const findings: MigrationFinding[] = [];
	for (const statement of splitStatements(sql)) {
		for (const rule of CONTRACTING_RULES) {
			if (rule.pattern.test(statement)) {
				findings.push({
					statement: statement.replace(/\s+/g, ' ').slice(0, 160),
					rule: rule.name,
					why: rule.why
				});
			}
		}
	}
	return findings;
}

export const CONTRACTING_RULE_NAMES: readonly string[] = CONTRACTING_RULES.map((r) => r.name);
