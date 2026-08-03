import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

/*
 * The example has to run, and this is the only way to know it does.
 *
 * An example that no longer works is worse than none: it is the first thing
 * anyone copies, and the first thing a language model copies. Reading it in a
 * review proves nothing, because what breaks it is a rename three files away.
 *
 * It runs as a subprocess, against the built package, resolved by its own name
 * exactly as a stranger would import it - which also checks that `exports`
 * still points where it claims.
 */
describe('the example', () => {
	const output = execFileSync(process.execPath, ['example/read-a-statement.mjs'], {
		encoding: 'utf8',
		stdio: ['ignore', 'pipe', 'ignore']
	});

	it('shows what the reading decided', () => {
		expect(output).toContain('3 column(s), 6 row(s)');
		expect(output).toContain('column 0 (date) is empty');
	});

	it('reads the five operations and leaves the total out', () => {
		expect(output).toContain('verdict   read');
		expect(output).toContain('records   5');
	});

	it('checks the reading against what the document declares', () => {
		expect(output).toContain('declared 929.62, read 929.62 -> 0 off');
	});

	it('offers every row for review, dropped ones included', () => {
		expect(output).toContain('dropped   | TOTAL DES DEBITS | 929,62');
	});

	it('refuses a document without substance, on a reader that wrote no refusal', () => {
		// Three methods, and the floor still holds. That is the whole point of the
		// default: the safe direction costs nothing to get right.
		expect(output).toContain('no substance -> refused');
	});
});
