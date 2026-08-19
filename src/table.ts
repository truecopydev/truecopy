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
import { decimalMarkOf, findNumbers, type DecimalMark } from './notation.js';

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
	/**
	 * A column whose cells hold TWO values where the table's others hold one:
	 * the cut missed a boundary and two neighbouring columns landed together.
	 *
	 * The opposite failure to `thin-column`, and the dangerous one. A column that
	 * was never separated cannot be seen by a fill rate - it is filled on every
	 * row, exactly like a good one - so a reading of it is wrong and silent about
	 * being wrong. Read as one figure, one such column produced 97 wrong values
	 * out of 162 on a real property schedule.
	 */
	| 'merged-column'
	/** The pages were not cut the same way, so they are probably not one table. */
	| 'pages-disagree';

/** One doubt, in both forms: the code to act on, the sentence to show. */
export interface Finding {
	readonly code: Doubt;
	/** The same doubt in a sentence. This is exactly what `warnings` carries. */
	readonly message: string;
	/** The page it was found on. Absent when it is about the whole document. */
	readonly page?: number;
	/** The column it is about, for a `thin-column` or a `merged-column`. */
	readonly column?: number;
	/** How often that column is filled, 0 to 1, for a `thin-column`. */
	readonly shareFilled?: number;
	/** How often that column holds two values, 0 to 1, for a `merged-column`. */
	readonly shareDoubled?: number;
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
	 *
	 * AND `pages[i][j]` IS `document.pages[i].rows[j]`, cut into cells. The two
	 * are the same row in two shapes, one in cells and one in placed fragments,
	 * and that is a GUARANTEE rather than an accident of the current code: the
	 * cut maps over `page.rows` and drops nothing - not an empty row, not a row
	 * whose cells all came back blank.
	 *
	 * It is written down because a reader needs it to reach a row's GEOMETRY,
	 * and some questions have no answer in the cells at all. Which of two
	 * records does a stray line of text belong to? Nothing in its own text says
	 * so: the answer is which baseline it sits closer to, and that is
	 * `document.pages[i].rows[j].y`. Measured on a property schedule that prints
	 * each address above and below its figures - 291 of its 556 published
	 * buildings had no street at all until their rows could be placed.
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

/**
 * Past this share of its filled cells holding two values, a column was never
 * separated.
 *
 * Measured rather than chosen, on the two real geometries of the corpus: the one
 * column known to be a merged pair holds two on 93 % of its cells, and every
 * other column of both documents holds two on none of them. Half is far from
 * both, which is what a threshold should be.
 */
const DOUBLED_ABOVE = 0.5;

/**
 * A cell that CERTAINLY holds two values, never one that might.
 *
 * Two conditions, and the second is the one that stops this crying wolf.
 *
 * The cell must hold nothing but numbers and separators, so an address carrying
 * a number and a street name is not a merged pair.
 *
 * And every number in it must carry a fraction IN THE DOCUMENT'S OWN MARK.
 * Without that, two integers separated by a space are indistinguishable from ONE
 * number, the space being exactly what French notation puts between thousands.
 * Measured: the loose rule fires on 48 % of a column that is perfectly well cut,
 * the strict one on none of it, and on 93 % of the column that really is two.
 *
 * The mark has to be the document's and not "any dot or comma", which is the
 * same trap one field over: under English notation `1,234` is a plain thousands
 * integer, so a mark-agnostic test would call an accidentally split
 * comma-grouped column merged - exactly the failure this condition exists to
 * rule out, moved to another notation.
 */
function holdsTwoValues(cell: string, mark: DecimalMark): boolean {
	const fraction = mark === ',' ? /,\d/ : /\.\d/;
	const found = findNumbers(cell);
	if (found.length < 2) return false;
	if (!found.every((number) => fraction.test(number.raw))) return false;
	let rest = cell;
	for (const number of found) rest = rest.replace(number.raw, ' ');
	return /^[\s.,;:/-]*$/.test(rest);
}

function mergedColumns(page: TextPage, rows: string[][], mark: DecimalMark): Finding[] {
	/*
	 * Through `profileColumns`, exactly like `thinColumns`, and not for symmetry:
	 * it caps the work at its sample, and this is the doubt that costs the most
	 * to compute - a regular expression over every cell. A table describes itself
	 * in its first rows, and scanning ten thousand to learn what two hundred
	 * already said is time somebody spends watching a spinner.
	 */
	const profiles = profileColumns(rows, {
		kindOf: (cell) => (holdsTwoValues(cell, mark) ? 'doubled' : null)
	});
	return profiles.flatMap((profile, column) => {
		const doubled = profile.shareOfKind.doubled ?? 0;
		/*
		 * `doubled > half of filled` rather than the ratio compared to a half: both
		 * shares are of the same rows, so the comparison is the same one without a
		 * division - and without the guard on an empty column that a division would
		 * need. A column filled on nothing has doubled nothing either, and `0 > 0`
		 * is already false.
		 */
		if (doubled <= DOUBLED_ABOVE * profile.shareFilled) return [];
		const share = doubled / profile.shareFilled;
		return [
			{
				code: 'merged-column' as const,
				page: page.pageNumber,
				column,
				shareDoubled: share,
				message:
					`column ${column} of page ${page.pageNumber} holds two values on ` +
					`${Math.round(share * 100)}% of its rows - the cut missed a boundary and two columns landed together`
			}
		];
	});
}

function complainAbout(
	page: TextPage,
	rows: string[][],
	cut: number[],
	mark: DecimalMark | null
): Finding[] {
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
	// Both, because they are opposite failures and a page can carry each on a
	// different column: one the cut invented, one it never separated.
	// A document that settles no decimal mark gets no merged-column doubt: without
	// it, a fraction cannot be told from a thousands group, so nothing here is
	// CERTAIN and a doubt this library cannot substantiate is one it does not raise.
	return [...thinColumns(page, rows), ...(mark === null ? [] : mergedColumns(page, rows, mark))];
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
 * How a table is read, on top of how the document is opened.
 *
 * `rightEdges` is the one knob the cut has, and it exists for compatibility
 * rather than tuning: reading right edges inside a band cuts a page finer, and
 * a reader that learned the WIDER cells - one that splits a shared cell itself,
 * on a page printing two tables side by side - loses the row it relied on when
 * a cut lands inside it. `false` restores the cut exactly as it was before
 * right edges were read at all, so such a reader upgrades without its readings
 * moving. It is not a per-document setting to hunt with: a reading that only
 * lands with it off is a reader built on the wider cells, not a better cut.
 */
export interface TableOptions extends OpenOptions {
	/** Read right edges inside a band, cutting flush-right figure columns
	 *  apart. On unless declined. */
	rightEdges?: boolean;
	/**
	 * Space the items of a cell as the page printed them, instead of one space
	 * apart. Off unless asked for.
	 *
	 * An engine breaks a cell into items wherever glyph spacing changes, and a
	 * single space between them turns "1 207 773 393" into "1 2 07 773 393" -
	 * a number no reader can parse and no check can catch, since every digit is
	 * there in the right order. On, the gap on the page decides, so items that
	 * touch stay joined and items a space apart stay apart.
	 *
	 * It moves cell text, so it arrives as a knob and not as a new default:
	 * a reader whose patterns learned the run-together form keeps it until its
	 * own bench says otherwise. Rows built without geometry are unaffected,
	 * having no gaps to measure, and `document.text` is not touched at all.
	 */
	measuredSpaces?: boolean;
}

/**
 * Rows and cells out of a file, with no configuration at all.
 *
 * This is the shortest thing that works, and it is deliberately not the only
 * thing on offer: when the rows have to be trusted - when something downstream
 * acts on them - `findRowAnomalies`, `validate` and `readDocument` are what turn
 * a reading into one that checks itself.
 */
export async function readTable(file: File, options: TableOptions = {}): Promise<Table> {
	const document = await openDocument(file, options);
	// Read once, off the whole document, because that is what settles it: five
	// characters do not say whether `1,234` is a thousand or a fraction, and a
	// page that never writes a decimal borrows the answer from the rest.
	const mark = decimalMarkOf(document.text);
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
		const cut = boundariesFromRecurrence(
			page.rows,
			undefined,
			gapFor(page.unit),
			options.rightEdges ?? true
		);
		const cells = cellsOf(page, cut, options.measuredSpaces ?? false);
		boundaries.push(cut);
		pages.push(cells);
		findings.push(...complainAbout(page, cells, cut, mark));
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
