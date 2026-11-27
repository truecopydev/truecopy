/*
 * What another reader said a document prints, checked against the document.
 *
 * A model reads a page well and says nothing of the times it does not: a figure
 * copied from the row above, a digit dropped, a sign lost. Its output looks the
 * same either way. This module does not read in its place. It takes the values
 * the other reader returned and answers, value by value, one of three things:
 *
 *   confirmed     the row its label names prints it;
 *   contradicted  the row its label names prints other figures, and every one
 *                 of them was read with confidence;
 *   not-found     neither: nothing here vouches for the value, and nothing
 *                 here says it is wrong.
 *
 * THE THIRD ANSWER IS THE POINT. A check that only knows yes and no has to
 * call a figure wrong whenever its own reading missed it, and a cut that glued
 * two columns misses plenty. So a contradiction is only ever pronounced from
 * cells this library would itself serve as sure (`CONFIDENT_ABOVE`, cell by
 * cell): a row read with any doubt contradicts nothing, it is `not-found`.
 *
 * A confirmation asks for less, and that is deliberate: two readers that never
 * saw each other printing the same figure is agreement, whatever either one
 * thought of its own reading.
 *
 * What it cannot see, and does not pretend to: the COLUMN. `Revenue: 1 100`
 * is confirmed by a row that prints 1 200 for this year and 1 100 for the last
 * one. The label ties a value to its row, nothing here ties it to its year.
 */

import type { Place } from './document.js';
import { carriesText } from './cite.js';
import { CONFIDENT_ABOVE } from './confidence.js';
import { placesOf } from './layout.js';
import { decimalMarkOf, findNumbers, readDecimal } from './notation.js';
import type { Brackets, DecimalMark } from './notation.js';
import { readTable } from './table.js';
import type { OpenOptions } from './open.js';
import type { Table } from './table.js';

/** What the document says of one claimed value. */
export type Standing = 'confirmed' | 'contradicted' | 'not-found';

/** One value another reader claims the document prints. */
export interface ClaimedValue {
	/**
	 * The value. A number is always a figure. A string is a figure when it
	 * holds a digit and no letter, and words otherwise.
	 */
	value: string | number;
	/**
	 * The words that name its row: `Total assets`. Only the rows that label
	 * names answer for the value. Without a label a figure can only be found
	 * somewhere or not found, never contradicted, and found somewhere is a
	 * much smaller claim.
	 */
	label?: string;
	/** The page it was read from, 1 for the first. Left out, every page answers. */
	page?: number;
}

/** The answer for one claimed value, in the order the claims were given. */
export interface CheckedValue {
	standing: Standing;
	/**
	 * Whether a row the label names answered. A `confirmed` with `false` was
	 * claimed with no label: the value is printed, and nothing says on which
	 * row it belongs. A `not-found` with `false` under a label means the
	 * document prints that label nowhere.
	 */
	labelled: boolean;
	/** The page the answering row is on. Absent on a `not-found` with no such row. */
	page?: number;
	/** That row, 1 for the first row of the reading: `Table.rows[row - 1]`. */
	row?: number;
	/** Where the confirming cell sits on its page. Only on a `confirmed`. */
	place?: Place;
	/**
	 * How far the confirming cell was trusted on its own, 0 to 1, or `null`
	 * where nothing was measured. Only on a `confirmed` figure, and only
	 * informative: the agreement of two readers is what confirmed it.
	 */
	confidence?: number | null;
	/** The figures the labelled row prints instead. Only on a `contradicted`. */
	printed?: string[];
}

export interface VerifyOptions {
	/**
	 * The decimal mark the CLAIMS are written with, when it is not the
	 * document's. A model asked for JSON writes `1234.5` for a page that prints
	 * `1 234,5`; read with the page's comma, that claim is another number.
	 * Left out, a claimed string is read the way the document writes.
	 */
	written?: DecimalMark;
	/** What brackets around a figure mean on this document. A sign unless said. */
	brackets?: Brackets;
}

/** One row of the reading, with everything a lookup needs to answer from it. */
interface Line {
	page: number;
	at: number;
	row: number;
	number: number;
	cells: string[];
}

interface Lookup {
	table: Table;
	mark: DecimalMark | null;
	brackets: Brackets | undefined;
	lines: Line[];
}

const HAS_DIGIT = /\d/;
const HAS_LETTER = /\p{L}/u;

const isFigure = (value: string | number): boolean =>
	typeof value === 'number' || (HAS_DIGIT.test(value) && !HAS_LETTER.test(value));

/**
 * The claimed figure as a decimal written out, or `null` when it is none.
 *
 * A JSON number never carries the document's notation, so it is read with a
 * dot whatever the page writes. One with an exponent is refused: a document
 * writes none, and `1e-7` read from its first digit would be carried by any
 * row printing 1.
 */
function soughtFigure(value: string | number, lookup: Lookup, written?: DecimalMark) {
	if (typeof value === 'number') {
		const plain = String(value);
		if (!Number.isFinite(value) || /e/i.test(plain)) return null;
		return readDecimal(plain, '.', lookup.brackets);
	}
	return readDecimal(value, written ?? lookup.mark, lookup.brackets);
}

function linesOf(table: Table): Line[] {
	let number = 0;
	return table.pages.flatMap((rows, at) =>
		rows.map((cells, row) => {
			number += 1;
			return { page: table.document.pages[at].pageNumber, at, row, number, cells };
		})
	);
}

const CLOSING = /^[ \t\u00a0\u2009\u202f]{0,12}\)/;

/**
 * The figures a cell prints, each with the bracket that closes it.
 *
 * A statement sets `( 14,600 )` with a space on each side, and the shared
 * token stops at the last digit: read alone, `( 14,600` is a bracket nobody
 * closed and the figure comes back positive. Measured on 80 tables of annual
 * reports, that one gap contradicted 261 negatives a model had read right.
 * The closing bracket is looked for here, in the cell, and the shared reading
 * is not touched.
 */
function figuresIn(cell: string): string[] {
	return findNumbers(cell).map(({ raw, index }) => {
		if (!raw.includes('(') || raw.includes(')')) return raw;
		const closing = CLOSING.exec(cell.slice(index + raw.length));
		return closing === null ? raw : raw + closing[0];
	});
}

/** The cell of a row that prints the figure, or -1. Never read across two cells. */
function cellPrinting(line: Line, sought: string, lookup: Lookup): number {
	return line.cells.findIndex((cell) =>
		figuresIn(cell).some((raw) => readDecimal(raw, lookup.mark, lookup.brackets) === sought)
	);
}

/**
 * Whether the reading of a cell is one this library would serve as sure.
 *
 * A delimited file is its own cut: the third field is the third column, and no
 * geometry was read to say so. Everywhere else the learned confidence decides,
 * and a cell it never scored was vouched for by nobody.
 */
function sure(line: Line, cell: number, table: Table): boolean {
	if (table.document.pages[line.at].unit === 'index') return true;
	const confidence = table.confidence?.[line.at][line.row][cell] ?? null;
	return confidence !== null && confidence >= CONFIDENT_ABOVE;
}

const count = (text: string, sign: string): number => text.split(sign).length - 1;

/** Digits a space apart, and a group of three behind a comma or a dot. */
const SPACED = /\d[ \t\u00a0\u2009\u202f]+\d/;
const MARKED_GROUP = /\d[.,]\d{3}(?!\d)/;

/** Three digits alone behind a zero: the tail of a figure, never a figure. */
const ORPHAN_GROUP = /^\s*0\d{2}\s*$/;

/**
 * Whether a cell was torn or glued by the cut, whatever score it was given.
 *
 * Three shapes, all met on real statements. A bracket open in one cell and
 * closed in the next is a negative torn in two: `( 1,384` beside `) ( 142 )`.
 * A figure grouped two ways at once is two things glued: `23 250,000` is
 * the note 23 and the figure 250,000, read as one number of eight digits.
 * And `075` alone in its cell is the last group of `6 427 075`, whose head
 * the cut left somewhere else on the row.
 */
const misread = (cell: string): boolean =>
	count(cell, '(') !== count(cell, ')') ||
	(SPACED.test(cell) && MARKED_GROUP.test(cell)) ||
	ORPHAN_GROUP.test(cell);

/** The figures a row prints, and whether every cell holding one was read surely. */
function figuresOf(line: Line, table: Table): { printed: string[]; allSure: boolean } {
	const printed: string[] = [];
	let allSure = true;
	line.cells.forEach((cell, at) => {
		const found = figuresIn(cell);
		if (found.length === 0) return;
		printed.push(...found.map((raw) => raw.trim()));
		if (misread(cell) || !sure(line, at, table)) allSure = false;
	});
	return { printed, allSure };
}

function confirmedBy(line: Line, cell: number, labelled: boolean, table: Table): CheckedValue {
	const place = placesOf(table.document.pages[line.at], table.boundaries[line.at])[line.row]?.[
		cell
	];
	return {
		standing: 'confirmed',
		labelled,
		page: line.page,
		row: line.number,
		...(place ? { place } : {}),
		confidence: table.confidence?.[line.at][line.row][cell] ?? null
	};
}

/**
 * Whether a row carrying no letter of its own prints the figure.
 *
 * A page that sets this year's column a hair above last year's comes back as
 * two rows: the label and one figure on the first, the other figure alone on
 * the second. A label that wraps does the same. The named row then prints
 * another figure, surely, and the claim is right: the figure sits on a row
 * nobody can name, which may be the one the claim meant. Such a row confirms
 * nothing either, because it belongs as easily to the row on its other side.
 */
function printedUnnamed(scope: Line[], sought: string, lookup: Lookup): boolean {
	return scope.some(
		(line) => !HAS_LETTER.test(line.cells.join('')) && cellPrinting(line, sought, lookup) !== -1
	);
}

const GAP = /[ \t\u00a0\u2009\u202f]+/;

/**
 * Whether a cell prints the figure among others it was glued to.
 *
 * Where thousands are set apart by a space, the space between two columns is
 * the same sign: `253 238 258 024` is one figure of twelve digits or this
 * year beside the last, and `23 704` is twenty-three thousand or the note 23
 * before 704. The text cannot tell and neither can a score. So a claim that
 * is a run of whole groups of such a cell is not contradicted by it. It is
 * not confirmed either: `238 258` is a run of the same cell and no figure of
 * the page.
 */
function gluedIn(rows: Line[], sought: string, lookup: Lookup): boolean {
	return rows.some((line) =>
		line.cells.some((cell) => {
			const groups = cell.trim().split(GAP);
			return groups.some((_, from) =>
				groups.some(
					(_, to) =>
						to >= from &&
						to - from < groups.length - 1 &&
						standsAlone(groups, from, to) &&
						readDecimal(groups.slice(from, to + 1).join(' '), lookup.mark, lookup.brackets) ===
							sought
				)
			);
		})
	);
}

const ENDS_A_FIGURE = /[\d)]$/;
const OPENS_A_FIGURE = /^[\d(\-\u2212\u2013]/;

/**
 * Whether a run of groups carries its whole sign. `12 345` inside
 * `( 12 345 )` is not a figure of the cell: it is the negative without its
 * brackets, and a claim that lost the sign must still be contradicted.
 */
function standsAlone(groups: string[], from: number, to: number): boolean {
	const run = groups.slice(from, to + 1).join('');
	if (count(run, '(') !== count(run, ')')) return false;
	const before = groups[from - 1];
	const after = groups[to + 1];
	return (
		(before === undefined || ENDS_A_FIGURE.test(before)) &&
		(after === undefined || OPENS_A_FIGURE.test(after))
	);
}

/**
 * What the rows the label names say of a figure they do not print.
 *
 * Contradicted only when one of them prints figures and every such row was
 * read surely from end to end. A label printed alone on its line, its figures
 * on the next, contradicts nothing: that row prints no figure at all.
 */
function refusedBy(rows: Line[], scope: Line[], sought: string, lookup: Lookup): CheckedValue {
	const read = rows.map((line) => ({ line, ...figuresOf(line, lookup.table) }));
	const printing = read.filter((row) => row.printed.length > 0);
	const first = (printing[0] ?? read[0]).line;
	const where = { labelled: true, page: first.page, row: first.number };
	const unsure = printing.length === 0 || printing.some((row) => !row.allSure);
	if (unsure || gluedIn(rows, sought, lookup) || printedUnnamed(scope, sought, lookup)) {
		return { standing: 'not-found', ...where };
	}
	return { standing: 'contradicted', ...where, printed: printing.flatMap((row) => row.printed) };
}

const NOT_WRITTEN = /[^\p{L}\p{N}]+/gu;
const LEADING_NOTE = /^\p{N}+/u;
const OPENS_ON_A_LETTER = /^\p{L}/u;
const SHORTEST_LABEL = 3;

/**
 * A text as its letters and digits alone, without the note number it opens on.
 * A text of digits alone keeps them: `2023` is a label, not a note.
 */
const squashed = (text: string): string => {
	const written = text.toLowerCase().replace(NOT_WRITTEN, '');
	return written.replace(LEADING_NOTE, '') || written;
};

/**
 * The rows a label names.
 *
 * LETTER BY LETTER FIRST, because a text layer does not print words. It prints
 * `Inventor ies` and `Loss fo r the p erio d`, and the cut then breaks a label
 * across two cells: measured on 80 tables of annual reports, 38 % of the labels
 * a model had read off the image were carried, word for word, by no row at all.
 * Spaces and punctuation are therefore dropped on both sides, and a row
 * answers when it OPENS on the label and the label ends there: `Total` is not
 * named by `Total equity`.
 *
 * Only when no row opens on it are the words looked for in order, anywhere on
 * a row: a label printed after its figures, or behind a heading. Rows found
 * that way may confirm and never contradict: `From investing activities` is
 * carried, word for word, by `Net cash from investing activities`, which is
 * another row.
 *
 * A label of one or two characters names nothing. `F`, `a)` and `II.` are the
 * marks a statement numbers its rows with, a dozen rows open on each, and a
 * reader that hands one over as the label has not said which row it meant.
 */
function namedBy(scope: Line[], label: string): { rows: Line[]; opening: boolean } {
	const sought = squashed(label);
	if (sought.length < SHORTEST_LABEL) return { rows: [], opening: false };
	const opening = scope.filter((line) => {
		const row = squashed(line.cells.join(''));
		return row.startsWith(sought) && !OPENS_ON_A_LETTER.test(row.slice(sought.length));
	});
	if (opening.length > 0) return { rows: opening, opening: true };
	return {
		rows: scope.filter((line) => carriesText(line.cells.join(' '), label)),
		opening: false
	};
}

/** A figure nobody tied to a row: printed somewhere in the scope, or not. */
function seenAnywhere(scope: Line[], sought: string, lookup: Lookup): CheckedValue {
	for (const line of scope) {
		const cell = cellPrinting(line, sought, lookup);
		if (cell !== -1) return confirmedBy(line, cell, false, lookup.table);
	}
	return { standing: 'not-found', labelled: false };
}

/**
 * A figure claimed under a label answers from the rows that label names and
 * from no other. When the document prints the label nowhere, the figure is
 * `not-found` even if a row prints it: on a page of figures almost any number
 * is printed SOMEWHERE, and measured, that weaker lookup let through a third
 * of the wrong values it was shown.
 */
function checkFigure(claim: ClaimedValue, sought: string, lookup: Lookup): CheckedValue {
	const scope = lookup.lines.filter((line) => claim.page === undefined || line.page === claim.page);
	if (claim.label === undefined) return seenAnywhere(scope, sought, lookup);
	const named = namedBy(scope, claim.label);
	if (named.rows.length === 0) return { standing: 'not-found', labelled: false };
	for (const line of named.rows) {
		const cell = cellPrinting(line, sought, lookup);
		if (cell !== -1) return confirmedBy(line, cell, true, lookup.table);
	}
	if (named.opening) return refusedBy(named.rows, scope, sought, lookup);
	return {
		standing: 'not-found',
		labelled: true,
		page: named.rows[0].page,
		row: named.rows[0].number
	};
}

/**
 * Words are looked up as `carriesText` reads them: all of them, in order, on
 * one row. They are never contradicted - a row that prints other words than
 * the ones claimed is every other row of the document.
 */
function checkWords(claim: ClaimedValue, lookup: Lookup): CheckedValue {
	const scope = lookup.lines.filter((line) => claim.page === undefined || line.page === claim.page);
	const sought = `${claim.label ?? ''} ${String(claim.value)}`;
	const line = scope.find((candidate) => carriesText(candidate.cells.join(' '), sought));
	if (line === undefined) return { standing: 'not-found', labelled: false };
	return {
		standing: 'confirmed',
		labelled: (claim.label ?? '').trim() !== '',
		page: line.page,
		row: line.number
	};
}

/**
 * Check the values another reader returned against a reading of the document.
 *
 * The table should have been read with `confidence: true`: without the score
 * of each cell nothing is ever `contradicted`, except on a delimited file.
 * `verify` does that reading for you.
 */
export function verifyValues(
	table: Table,
	claims: readonly ClaimedValue[],
	options: VerifyOptions = {}
): CheckedValue[] {
	const lookup: Lookup = {
		table,
		mark: decimalMarkOf(table.document.text),
		brackets: options.brackets,
		lines: linesOf(table)
	};
	return claims.map((claim) => {
		if (!isFigure(claim.value)) return checkWords(claim, lookup);
		const sought = soughtFigure(claim.value, lookup, options.written);
		if (sought === null) return { standing: 'not-found', labelled: false };
		return checkFigure(claim, sought, lookup);
	});
}

/**
 * Read a file and check the values another reader returned from it.
 *
 * The reading is the default one with the confidence of each cell: the cut
 * options are refused here on purpose, because the confidence was measured on
 * the default cut and claims nothing past it.
 */
export async function verify(
	file: File,
	claims: readonly ClaimedValue[],
	options: VerifyOptions & OpenOptions = {}
): Promise<CheckedValue[]> {
	const { written, brackets, ...open } = options;
	const table = await readTable(file, { ...open, confidence: true });
	return verifyValues(table, claims, { written, brackets });
}
