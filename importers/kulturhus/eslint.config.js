import tseslint from 'typescript-eslint';

export default tseslint.config(
	/*
	 * Fixtures are committed *upstream* files, not our code.
	 *
	 * This is the first importer whose fixture is a `.js` file — Bømlo kulturhus serves its
	 * programme as a webpack chunk — and linting a third party's minified bundle reports their
	 * style choices as our errors. `t` unused in `function(e,t)` is webpack's module signature.
	 */
	{ ignores: ['migrations/**', 'node_modules/**', 'test/fixtures/**'] },
	...tseslint.configs.recommended,
	{
		rules: {
			// CLAUDE.md rule 4: no escape hatches.
			'@typescript-eslint/no-explicit-any': 'error',
			'@typescript-eslint/consistent-type-assertions': [
				'error',
				{ assertionStyle: 'as', objectLiteralTypeAssertions: 'never' }
			]
		}
	}
);
