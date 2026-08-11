#!/usr/bin/env node
/*
 * npx truecopy a-document.pdf
 *
 * The shortest way to find out whether this library is any use on your own
 * documents: no install, no project, no line of code. It prints what the reading
 * decided - the cut into columns, what each column holds, how often it is
 * filled - and then what it could not vouch for.
 *
 * Deliberately no `kindOf`, no thresholds and no roles. Those need to know what
 * the documents mean, and the point of this command is to be useful before it
 * has been told anything. What it shows without them is the layer where a
 * reading goes wrong first: the cut.
 *
 * This is the only file in the package allowed to touch the filesystem. The
 * library runs in a browser, and a browser has no files.
 */

import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { explainDocument } from '../dist/explain.js';
import { readTable } from '../dist/table.js';
import { UnreadableDocument } from '../dist/open.js';

const HELP = `truecopy - see what a reading of your document decides

  npx truecopy <file>            the cut, the columns, and what is not vouched for
  npx truecopy explain <file>    the same
  npx truecopy --json <file>     the same reading as data, for a program

  Any file it can open: a PDF, a CSV, a paste saved to disk.
`;

/** The arguments, with the verb and the flags dropped. One verb, so it is
 *  optional; one flag, so it is a word and not a parser. */
function fileFrom(argv) {
	const args = argv.filter((arg) => arg !== 'explain' && arg !== '--json');
	return args.length === 1 ? args[0] : null;
}

/**
 * The same reading, as data.
 *
 * A person reads the sentences above; a program - or an agent - branches on the
 * code, the page and the column. Handing it the prose and asking it to match
 * English is how a reading gets acted on wrong, and this library exists to stop
 * exactly that. The document itself is not written out: it carries every
 * positioned item on every page, which is megabytes nobody asked for.
 */
function asJson(table) {
	const { document, rows, pages, boundaries, findings } = table;
	return JSON.stringify(
		{
			file: document.name,
			origin: document.origin,
			rows,
			pages: document.pages.map((page, index) => ({
				number: page.pageNumber,
				rows: pages[index],
				boundaries: boundaries[index]
			})),
			findings
		},
		null,
		'\t'
	);
}

async function run(argv) {
	const path = fileFrom(argv);
	if (path === null || path === '--help' || path === '-h') {
		process.stdout.write(HELP);
		return path === null ? 1 : 0;
	}

	const bytes = await readFile(path);
	const file = new File([bytes], basename(path), {
		type: path.toLowerCase().endsWith('.pdf') ? 'application/pdf' : 'text/plain'
	});

	const table = await readTable(file);
	if (argv.includes('--json')) {
		process.stdout.write(`${asJson(table)}\n`);
		return 0;
	}

	const { document, warnings, boundaries } = table;
	/*
	 * The cut readTable actually used, so the heading and the cells agree. Keyed
	 * on the page's position in the reading and NOT on its number: they are the
	 * same only when every page was opened, and `keepPage` is precisely the
	 * option that makes them differ.
	 */
	const cuts = new Map(document.pages.map((page, index) => [page.pageNumber, boundaries[index]]));
	const explained = explainDocument(document, {
		boundariesOf: (page) => cuts.get(page.pageNumber)
	});
	process.stdout.write(`${explained}\n`);

	/*
	 * The warnings come last and on their own, because they are the reason this
	 * library exists. An empty list is not a promise that the reading is right:
	 * it says nothing looked wrong from the shape of the page.
	 */
	if (warnings.length === 0) {
		process.stdout.write('\nnothing looked wrong from the shape of this page.\n');
		process.stdout.write('that is not the same as "this reading is right".\n');
	} else {
		process.stdout.write('\nwhat this reading cannot vouch for:\n');
		for (const warning of warnings) process.stdout.write(`  - ${warning}\n`);
	}
	return 0;
}

try {
	process.exitCode = await run(process.argv.slice(2));
} catch (error) {
	// A refusal is an answer, and it is worded for a person. Anything else is a
	// failure of this command, and it says which.
	const message =
		error instanceof UnreadableDocument
			? `${error.message} (${error.reason})`
			: `could not read that file: ${error.message}`;
	process.stderr.write(`${message}\n`);
	process.exitCode = 1;
}
