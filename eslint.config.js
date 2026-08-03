import js from '@eslint/js';
import ts from 'typescript-eslint';
import sonarjs from 'eslint-plugin-sonarjs';
import regexp from 'eslint-plugin-regexp';
import prettier from 'eslint-config-prettier';

export default ts.config(
	js.configs.recommended,
	...ts.configs.recommended,
	sonarjs.configs.recommended,
	regexp.configs['flat/recommended'],
	prettier,
	{
		rules: {
			// The fifth law, held by a tool rather than by a comment. These patterns
			// run over a whole document, line by line, and an unbounded quantifier
			// there is not slow: it is a page that never comes back.
			'regexp/no-super-linear-backtracking': 'error',
			'regexp/no-super-linear-move': 'error'
		}
	},
	{
		// The example, the command and the gate's own scripts run in Node and print
		// to a terminal. Declared here rather than pulled from a globals package:
		// three names are not worth a dependency in a library that ships three.
		files: ['example/**/*.mjs', 'bin/**/*.mjs', 'scripts/**/*.mjs'],
		languageOptions: {
			globals: { console: 'readonly', File: 'readonly', process: 'readonly' }
		}
	},
	{
		files: ['**/*.test.ts'],
		rules: {
			/*
			 * A test that reads `1 234,56` and asserts 1234.56 is not doing float
			 * arithmetic: it pins a parser's output against a literal, and the
			 * literal is the same double. Approximate equality here would let the
			 * defect this file exists to catch - a figure off by a hundred - pass.
			 *
			 * Off for tests only. In the source the rule stands.
			 */
			'sonarjs/no-floating-point-equality': 'off'
		}
	},
	{ ignores: ['node_modules/', 'coverage/', 'dist/'] }
);
