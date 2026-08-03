/*
 * See what the reading decided, and why.
 *
 * A library that only returns records leaves whoever integrates it guessing
 * between "the document is odd", "the cut is wrong" and "my rule is wrong", and
 * those three call for three different fixes. So everything the reading computed
 * is printed at once, in the order it decided: the cut into columns, what each
 * column turned out to contain, the role it was given, and which rows fell
 * outside the table's own signature.
 *
 * Text, and not an image, deliberately. Text goes into a terminal, into a CI
 * log, into a bug report, into a test's expected value, and it needs no canvas,
 * no headless browser and no dependency. An image needs a screen.
 */

import { columnCount, profileColumns, dominantKind, type ColumnProfile } from './columns.js';
import type { CoordinateUnit, Document, Row, TextPage } from './document.js';
import { rowToCells } from './layout.js';
import { assignRoles, type RoleRule } from './roles.js';
import {
	findRowAnomalies,
	sharesByKind,
	type RowAnomaly,
	type SignatureOptions
} from './signature.js';

export interface ExplainOptions {
	/** Only this page. Every page, when left out. */
	page?: number;
	/** Rows printed per page. The rest are counted, never silently dropped. */
	maximumRows?: number;
	/** Width of a printed cell, past which it is cut and marked with `>`. */
	cellWidth?: number;
	/**
	 * How a row becomes cells. Left out, the page's own column boundaries are
	 * used - but a reader that builds its own cut wants to see that cut, since
	 * the one being debugged is its own and not the library's.
	 */
	cellsOf?: (row: Row, page: TextPage) => string[];
	/**
	 * The cut to read the page by, when it is not the page's own.
	 *
	 * A page carries a letterhead, an address and a footer, and the spread of x
	 * over all of it invents columns the table never had - so `readTable` cuts on
	 * what recurs instead, and hands the boundaries back. Passing them here is
	 * what makes the heading and the cells tell the same story.
	 */
	boundariesOf?: (page: TextPage) => number[];
	/**
	 * Naming the kind of a cell turns on everything the reading judged by: what
	 * each column contains, and which rows break the signature. Left out, the cut
	 * and the fill rates are still shown - they are what a wrong cut shows up in
	 * first.
	 */
	signature?: SignatureOptions;
	/** The role rules, to show what each column was taken to be. */
	roles?: RoleRule<string>[];
}

const DEFAULT_MAXIMUM_ROWS = 40;
const DEFAULT_CELL_WIDTH = 22;
const NOTHING = '-';

/** Pad to width, or cut and say so. A line that wraps is a table that stops
 *  being one. */
function fit(text: string, width: number): string {
	return text.length > width ? `${text.slice(0, width - 1)}>` : text.padEnd(width);
}

const percent = (share: number): string => `${Math.round(share * 100)}%`;

/** The anomaly, in the words of someone looking at the page. */
export function describeAnomaly(anomaly: RowAnomaly): string {
	if (anomaly.cause === 'wrong-kind') {
		return `column ${anomaly.column} is not ${anomaly.expected}`;
	}
	const where = anomaly.kind === undefined ? '' : ` (${anomaly.kind})`;
	return `column ${anomaly.column}${where} is empty`;
}

function columnLines(
	profiles: ColumnProfile[],
	kinds: (string | null)[],
	roles: (string | undefined)[]
): string[] {
	const lines = ['col  kind        filled  role'];
	profiles.forEach((profile, column) => {
		lines.push(
			[
				String(column).padStart(3),
				fit(kinds[column] ?? NOTHING, 10),
				percent(profile.shareFilled).padStart(6),
				roles[column] ?? NOTHING
			].join('  ')
		);
	});
	return lines;
}

/**
 * Each column as wide as it needs to be, and no wider.
 *
 * Read off the rows actually printed, never off the whole table: a column sized
 * by a row nobody can see is a column of blank space with no explanation.
 */
function columnWidths(rows: string[][], maximum: number): number[] {
	const widths: number[] = [];
	for (const row of rows) {
		row.forEach((cell, column) => {
			widths[column] = Math.min(maximum, Math.max(widths[column] ?? 0, cell.length));
		});
	}
	return widths;
}

function rowLines(
	rows: string[][],
	anomalies: (RowAnomaly | undefined)[] | null,
	options: ExplainOptions
): string[] {
	const shown = Math.min(rows.length, options.maximumRows ?? DEFAULT_MAXIMUM_ROWS);
	const printed = rows.slice(0, shown);
	const widths = columnWidths(printed, options.cellWidth ?? DEFAULT_CELL_WIDTH);
	const lines: string[] = [];

	for (let index = 0; index < shown; index++) {
		const anomaly = anomalies?.[index];
		const cells = printed[index].map((cell, column) => fit(cell, widths[column])).join(' | ');
		const why = anomaly ? `   <- ${describeAnomaly(anomaly)}` : '';
		lines.push(`${String(index + 1).padStart(4)} ${anomaly ? '!' : ' '} ${cells.trimEnd()}${why}`);
	}
	// Said out loud, because a truncated listing that looks complete is how a
	// missing row gets read as a row that is not there.
	if (rows.length > shown) lines.push(`     ... ${rows.length - shown} more row(s)`);
	return lines;
}

/**
 * Explain a table of cells: the columns, what they hold, and the rows that
 * break the signature. What `explainDocument` prints per page, for a reader
 * holding rows that never came from a page - a paste, a CSV, an OCR line.
 */
export function explainRows(rows: string[][], options: ExplainOptions = {}): string {
	const signature = options.signature;
	const profiles = profileColumns(rows, signature ?? { kindOf: () => null });
	const shares = signature ? sharesByKind(signature) : {};
	const kinds = profiles.map((profile) => dominantKind(profile, shares));
	const roles = options.roles
		? assignRoles(profiles, options.roles)
		: profiles.map(() => undefined);
	const anomalies = signature ? findRowAnomalies(rows, signature) : null;

	return [
		`${columnCount(rows)} column(s), ${rows.length} row(s)`,
		'',
		...columnLines(profiles, kinds, roles),
		'',
		...rowLines(rows, anomalies, options)
	].join('\n');
}

/**
 * Where the page was cut, in the unit it was measured in.
 *
 * A cut is a list of numbers, and a list of numbers with no unit is a riddle:
 * `cut at 1, 2` on a CSV sends a reader looking for a defect that is not there.
 * Points stay unlabelled - they are what a page has always been measured in -
 * but the two rulers text brought say which one they are.
 *
 * On a delimited file the numbers themselves say nothing anybody needs: the
 * columns are the fields. So it names what happened instead.
 */
function describeCut(cut: number[], unit: CoordinateUnit = 'points'): string {
	if (cut.length === 0) return 'no boundary';
	if (unit === 'index') return 'cut on the delimiter';
	const at = cut.map((boundary) => Math.round(boundary)).join(', ');
	return unit === 'characters' ? `cut at characters ${at}` : `cut at ${at}`;
}

function pageLines(page: TextPage, options: ExplainOptions): string[] {
	const cut = options.boundariesOf?.(page) ?? page.columnBoundaries;
	const cellsOf = options.cellsOf ?? ((row: Row) => rowToCells(row, cut));
	const rows = page.rows.map((row) => cellsOf(row, page));
	return [
		'',
		`page ${page.pageNumber} - ${describeCut(cut, page.unit)}`,
		'',
		explainRows(rows, options)
	];
}

/**
 * What the reading saw, page by page, in the order it decided.
 *
 *     console.log(explainDocument(document, { signature, roles }));
 */
export function explainDocument(document: Document, options: ExplainOptions = {}): string {
	const pages =
		options.page === undefined
			? document.pages
			: document.pages.filter((page) => page.pageNumber === options.page);
	const rows = document.pages.reduce((total, page) => total + page.rows.length, 0);

	return [
		`truecopy - ${document.name}`,
		`${document.origin}, ${document.pages.length} page(s), ${rows} row(s)`,
		...pages.flatMap((page) => pageLines(page, options))
	].join('\n');
}
