/*
 * The shortest path, and it says what it cannot vouch for.
 *
 * Whoever types "extract tables from pdf" wants `readTable(file)` and rows.
 * Making them write a `kindOf`, choose thresholds and learn what a role is
 * before the first result is twenty minutes of reading, and most people leave
 * inside two.
 *
 * So this is two lines. But it does not return a bare array, and that is the
 * whole argument of this library: a plausible-looking table out of a document
 * that was misread is worse than nothing, because nobody checks a table that
 * looks right.
 *
 * What comes back instead is the rows and what could not be vouched for. Same
 * two lines for whoever only wants the cells:
 *
 *     const { rows } = await readTable(file);
 *
 * And a second field for whoever wonders whether to trust them. Every warning
 * here is computed without knowing anything about the document: they are
 * failures of shape, not of meaning.
 */

import type { Document, TextPage } from './document.js';
import { openDocument, type OpenOptions } from './open.js';
import { boundariesFromRecurrence, cellsOf, gapFor } from './layout.js';
import { columnCount, profileColumns } from './columns.js';

/**
 * What a reading could not vouch for, named rather than only worded.
 *
 * Same reason `Unreadable` is named: a sentence is for whoever reads it, a code
 * is for whatever acts on it. A program - or an agent - that has to branch on a
 * doubt should not be matching English prose to do it, and a message rewritten
 * for clarity should not break it.
 */
export type Doubt =
	/** The page carries no text at all: a blank page, a scan, an image. */
	| 'blank-page'
	/** No column was found: the page is prose, or the cut failed and every row
	 *  came back whole. */
	| 'no-column'
	/** A column filled on almost none of its rows: the cut may have invented it. */
	| 'thin-column'
	/** The pages were not cut the same way, so they are probably not one table. */
	| 'pages-disagree';

/** One doubt, in both forms: the code to act on, the sentence to show. */
export interface Finding {
	readonly code: Doubt;
	/** The same doubt in a sentence. This is exactly what `warnings` carries. */
	readonly message: string;
	/** The page it was found on. Absent when it is about the whole document. */
	readonly page?: number;
	/** The column it is about, for a `thin-column`. */
	readonly column?: number;
	/** How often that column is filled, 0 to 1, for a `thin-column`. */
	readonly shareFilled?: number;
}

export interface Table {
	/** Every row of every page, cut into cells. */
	rows: string[][];
	/**
	 * The same rows, kept in their pages, laid out exactly like `boundaries`.
	 *
	 * `rows` is the flat list because most readings want one table, and it is
	 * what `rows.flat()` of this would give. But flattening loses which page a
	 * row came from, and some documents cannot be read without it: a page that
	 * prints two tables side by side carries two runs of headings, and walking
	 * the rows in order alternates between them. `pages[i]` and `boundaries[i]`
	 * are the same page, so a reader can re-cut it.
	 */
	pages: string[][][];
	/**
	 * The cut used, one list per page.
	 *
	 * It is not the page's own `columnBoundaries`: that one is the spread of x
	 * over everything printed, letterhead included, and on a real page it proposes
	 * columns the table does not have. This is the cut that kept only the x that
	 * come back row after row, and it is here because a caller that wants to
	 * explain or re-cut the same page needs the same boundaries.
	 */
	boundaries: number[][];
	/**
	 * What could not be vouched for, in plain sentences.
	 *
	 * An empty list is not a promise. It means nothing looked wrong from here,
	 * which is a much smaller claim than "this reading is right" - and the
	 * difference between the two is what the rest of this library is for.
	 */
	warnings: string[];
	/**
	 * The same doubts, named and placed: `findings[i].message` is `warnings[i]`.
	 *
	 * Both are here on purpose. A person reads the sentence; a program branches
	 * on the code, and on the page and column it names.
	 */
	findings: Finding[];
	/** The document itself, for a reader that needs more than the cells. */
	document: Document;
}

/**
 * Under this share of filled cells, a column is mostly holes.
 *
 * Counting cells would say nothing: a row is cut into as many cells as there are
 * boundaries, always, so every row of a page has the same width by construction.
 * What does vary is how often a column is filled - and a column empty on nine
 * rows out of ten was invented by the cut, not found on the page.
 */
const MOSTLY_EMPTY_BELOW = 0.2;

function thinColumns(page: TextPage, rows: string[][]): Finding[] {
	// No kind is named, so nothing is judged on content: only on emptiness.
	const profiles = profileColumns(rows, { kindOf: () => null });
	return profiles.flatMap((profile, column) =>
		profile.shareFilled < MOSTLY_EMPTY_BELOW
			? [
					{
						code: 'thin-column' as const,
						page: page.pageNumber,
						column,
						shareFilled: profile.shareFilled,
						message:
							`column ${column} of page ${page.pageNumber} is filled on only ` +
							`${Math.round(profile.shareFilled * 100)}% of its rows - the cut may have invented it`
					}
				]
			: []
	);
}

function complainAbout(page: TextPage, rows: string[][], cut: number[]): Finding[] {
	const where = `page ${page.pageNumber}`;
	if (page.rows.length === 0) {
		return [
			{
				code: 'blank-page',
				page: page.pageNumber,
				message: `${where} carries no text at all - a blank page, a scan, or an image`
			}
		];
	}
	if (cut.length === 0) {
		// Everything landed in one column: either the page is prose, or the cut
		// failed and every row came back whole.
		return [
			{
				code: 'no-column',
				page: page.pageNumber,
				message: `${where} shows no column at all - every row came back whole`
			}
		];
	}
	return thinColumns(page, rows);
}

/** Pages that were cut differently from the others. One page out of step is
 *  usually a different table, and joining them makes a third one that is
 *  neither. */
function pagesOutOfStep(perPage: number[]): Finding[] {
	const counts = new Map<number, number>();
	for (const columns of perPage) counts.set(columns, (counts.get(columns) ?? 0) + 1);
	if (counts.size < 2) return [];
	const spread = [...counts.entries()]
		.sort((a, b) => b[1] - a[1])
		.map(([columns, pages]) => `${columns} on ${pages}`)
		.join(', ');
	return [
		{
			code: 'pages-disagree',
			message: `the pages disagree on how many columns there are (${spread})`
		}
	];
}

/**
 * Rows and cells out of a file, with no configuration at all.
 *
 * This is the shortest thing that works, and it is deliberately not the only
 * thing on offer: when the rows have to be trusted - when something downstream
 * acts on them - `findRowAnomalies`, `validate` and `readDocument` are what turn
 * a reading into one that checks itself.
 */
export async function readTable(file: File, options: OpenOptions = {}): Promise<Table> {
	const document = await openDocument(file, options);
	const pages: string[][][] = [];
	const findings: Finding[] = [];
	const boundaries: number[][] = [];
	const columnsPerPage: number[] = [];

	for (const page of document.pages) {
		/*
		 * The recurring cut, not the page's own: a page carries a letterhead, an
		 * address and a footer, and the spread of x over all of it invents columns
		 * the table never had. Measured by the page's own ruler - points on a page,
		 * characters in a paste, the field's index in a delimited file.
		 */
		const cut = boundariesFromRecurrence(page.rows, undefined, gapFor(page.unit));
		const cells = cellsOf(page, cut);
		boundaries.push(cut);
		pages.push(cells);
		findings.push(...complainAbout(page, cells, cut));
		if (page.rows.length > 0) columnsPerPage.push(columnCount(cells));
	}

	findings.push(...pagesOutOfStep(columnsPerPage));
	// One list, two shapes: the sentences are derived from the findings rather
	// than written twice, so a message can never say one thing and a code another.
	return {
		rows: pages.flat(),
		pages,
		warnings: findings.map((finding) => finding.message),
		findings,
		boundaries,
		document
	};
}
