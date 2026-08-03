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

export interface Table {
	/** Every row of every page, cut into cells. */
	rows: string[][];
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

function thinColumns(page: TextPage, rows: string[][]): string[] {
	// No kind is named, so nothing is judged on content: only on emptiness.
	const profiles = profileColumns(rows, { kindOf: () => null });
	return profiles.flatMap((profile, column) =>
		profile.shareFilled < MOSTLY_EMPTY_BELOW
			? [
					`column ${column} of page ${page.pageNumber} is filled on only ` +
						`${Math.round(profile.shareFilled * 100)}% of its rows - the cut may have invented it`
				]
			: []
	);
}

function complainAbout(page: TextPage, rows: string[][], cut: number[]): string[] {
	const where = `page ${page.pageNumber}`;
	if (page.rows.length === 0) {
		return [`${where} carries no text at all - a blank page, a scan, or an image`];
	}
	if (cut.length === 0) {
		// Everything landed in one column: either the page is prose, or the cut
		// failed and every row came back whole.
		return [`${where} shows no column at all - every row came back whole`];
	}
	return thinColumns(page, rows);
}

/** Pages that were cut differently from the others. One page out of step is
 *  usually a different table, and joining them makes a third one that is
 *  neither. */
function pagesOutOfStep(perPage: number[]): string[] {
	const counts = new Map<number, number>();
	for (const columns of perPage) counts.set(columns, (counts.get(columns) ?? 0) + 1);
	if (counts.size < 2) return [];
	const spread = [...counts.entries()]
		.sort((a, b) => b[1] - a[1])
		.map(([columns, pages]) => `${columns} on ${pages}`)
		.join(', ');
	return [`the pages disagree on how many columns there are (${spread})`];
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
	const rows: string[][] = [];
	const warnings: string[] = [];
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
		rows.push(...cells);
		warnings.push(...complainAbout(page, cells, cut));
		if (page.rows.length > 0) columnsPerPage.push(columnCount(cells));
	}

	warnings.push(...pagesOutOfStep(columnsPerPage));
	return { rows, warnings, boundaries, document };
}
