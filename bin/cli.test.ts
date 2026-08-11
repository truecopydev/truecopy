import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { pdfWithText } from '../src/kit.js';

/*
 * The command has to run, and only running it says whether it does.
 *
 * It is the first thing anyone tries - no install, no project, no line of code
 * - so it is the first thing that can be broken without anyone noticing. It
 * runs here as a subprocess against the built package, exactly as `npx` would.
 */
const CLI = 'bin/truecopy.mjs';

function run(...args: string[]): { out: string; code: number } {
	try {
		return { out: execFileSync(process.execPath, [CLI, ...args], { encoding: 'utf8' }), code: 0 };
	} catch (error) {
		const failure = error as { stdout?: string; stderr?: string; status?: number };
		return { out: (failure.stdout ?? '') + (failure.stderr ?? ''), code: failure.status ?? 1 };
	}
}

/** A file on disk, because a command reads paths and not buffers. */
function onDisk(name: string, contents: string): string {
	const path = join(mkdtempSync(join(tmpdir(), 'truecopy-')), name);
	writeFileSync(path, contents);
	return path;
}

const STATEMENT = onDisk(
	'statement.pdf',
	pdfWithText(
		[
			['02/05/2026', 'CARTE AMAZON', '12,40'],
			['03/05/2026', 'VIR LOYER', '750,00'],
			['05/05/2026', 'CARTE SNCF', '68,00'],
			['09/05/2026', 'PRLV EDF', '91,32'],
			['12/05/2026', 'CARTE BOULANGER', '7,90']
		].flatMap((cells, row) =>
			cells.map((word, column) => ({ word, x: [50, 150, 430][column], y: 700 - row * 20 }))
		)
	)
);

describe('npx truecopy', () => {
	it('shows the cut and the columns of a document', () => {
		const { out, code } = run(STATEMENT);
		expect(code).toBe(0);
		expect(out).toContain('truecopy - statement.pdf');
		expect(out).toContain('3 column(s), 5 row(s)');
	});

	it('takes the verb too, for whoever expects one', () => {
		expect(run('explain', STATEMENT).out).toContain('3 column(s)');
	});

	it('says that nothing looking wrong is not a promise', () => {
		// The one sentence that separates this from every other extractor.
		const { out } = run(STATEMENT);
		expect(out).toContain('nothing looked wrong from the shape of this page');
		expect(out).toContain('that is not the same as "this reading is right"');
	});

	it('lists what it cannot vouch for when there is something to say', () => {
		const prose = onDisk('prose.txt', 'one line of prose\nand another one');
		expect(run(prose).out).toContain('what this reading cannot vouch for:');
	});

	it('refuses a file it cannot read, in words and with a reason', () => {
		const broken = onDisk('broken.pdf', 'this is not a PDF at all');
		const { out, code } = run(broken);
		expect(code).toBe(1);
		expect(out).toMatch(/password.*\(not-opened\)/s);
	});

	it('says what it is for when given nothing', () => {
		const { out, code } = run();
		expect(out).toContain('npx truecopy <file>');
		expect(code).toBe(1);
	});

	it('answers --help with the same page, and a zero exit', () => {
		expect(run('--help').code).toBe(0);
	});

	it('hands the same reading to a program, as data', () => {
		// A program that has to branch on a doubt should not be matching English
		// prose to do it, and a message rewritten for clarity should not break it.
		const { out, code } = run('--json', STATEMENT);
		expect(code).toBe(0);
		const read = JSON.parse(out);
		expect(read.file).toBe('statement.pdf');
		expect(read.rows[0]).toEqual(['02/05/2026', 'CARTE AMAZON', '12,40']);
		expect(read.pages[0].number).toBe(1);
		expect(read.pages[0].rows).toEqual(read.rows);
		expect(read.pages[0].boundaries).toHaveLength(2);
		expect(read.findings).toEqual([]);
	});

	it('names each doubt in the data, and never only in a sentence', () => {
		const prose = onDisk('prose.txt', 'one line of prose\nand another one');
		const read = JSON.parse(run('--json', prose).out);
		expect(read.findings.map((finding) => finding.code)).toEqual(['no-column']);
		expect(read.findings[0].message).toContain('every row came back whole');
	});

	it('says which file it could not open', () => {
		const { out, code } = run('nowhere/at/all.pdf');
		expect(code).toBe(1);
		expect(out).toContain('could not read that file');
	});
});
