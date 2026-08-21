import tseslint from 'typescript-eslint';

export default tseslint.config(
	{ ignores: ['migrations/**', 'node_modules/**'] },
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
