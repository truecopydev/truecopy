/*
 * How a page becomes rows and columns.
 *
 * Pure geometry over plain data: no engine, no bytes, no clock. Every function
 * here takes what it is given and returns something new, which is why the whole
 * reading can be exercised without a PDF, without a browser, and without the
 * file the person actually dropped. A caller who wants cells never loads a PDF
 * engine to get them.
 */

import type { CoordinateUnit, Document, Place, PositionedItem, Row, TextPage } from './document.js';

/** Vertical distance under which two items are on the same row. */
const SAME_ROW_TOLERANCE = 3;
/** Horizontal gap, in PDF units, past which two x open two columns. */
const COLUMN_GAP = 18;

/**
 * The same gap, once per ruler.
 *
 * `characters` is two and not one: a column of amounts is usually flush right,
 * so its values start one or two characters apart and are still one column.
 * Three would start swallowing a two-space separator.
 *
 * `index` is zero: x is the column's index there, so any two different indices
 * are two columns and nothing lies between them.
 */
const GAP: Record<CoordinateUnit, number> = { points: COLUMN_GAP, characters: 2, index: 0 };

/** The gap a page is cut by. A page carrying no unit came from a PDF, and a PDF
 *  is measured in points. */
export const gapFor = (unit: CoordinateUnit = 'points'): number => GAP[unit];

/**
 * Column boundaries, read off the spread of x over the whole page.
 *
 * Page-wide, never row-wide, and that is the whole point. Deciding "column or
 * not" on the gap between two neighbouring items glues a cell to the next one
 * as soon as they happen to touch on that row; the spread of x sees that every
 * year on the page shares one x and every quarter count another.
 */
export function columnBoundaries(items: PositionedItem[], gap = COLUMN_GAP): number[] {
	const xs = items
		.filter((item) => item.text.trim() !== '')
		.map((item) => item.x)
		.sort((a, b) => a - b);
	const boundaries: number[] = [];
	for (let i = 1; i < xs.length; i++) {
		if (xs[i] - xs[i - 1] > gap) boundaries.push((xs[i - 1] + xs[i]) / 2);
	}
	return boundaries;
}

/**
 * Column boundaries from anchors the caller already trusts - the x of a header
 * label, a rule drawn on the page, a cut a person confirmed.
 *
 * The two ways of finding columns are not rivals: the spread of x works on any
 * page and knows nothing, an anchor knows exactly where a column starts and
 * only exists when the page said so. Each boundary falls halfway between two
 * anchors, which is the shape `columnAt` and `rowToCells` already read, so a
 * reader swaps one for the other and changes nothing else.
 */
export function boundariesFromAnchors(anchors: number[]): number[] {
	const sorted = [...anchors].sort((a, b) => a - b);
	const boundaries: number[] = [];
	for (let i = 1; i < sorted.length; i++) boundaries.push((sorted[i - 1] + sorted[i]) / 2);
	return boundaries;
}

/**
 * Column boundaries from the edges that come back, row after row.
 *
 * The spread of x over a whole page counts everything on it: the letterhead,
 * the address block, the summary boxes, the footer, and every word inside a
 * long description. Measured on a real bank statement, that proposes twelve
 * columns where the table has five - and a cut that wrong takes every judgement
 * downstream with it.
 *
 * What separates a column from furniture needs no knowledge of the document at
 * all: a real column's left edge recurs. Every date sits at the same x, row
 * after row; a word in the middle of a description does not, and neither does
 * an address.
 *
 * A weak band at either edge is kept. A column used on two rows out of forty -
 * a lone credit on a statement of debits - lives at the edge and is real; a
 * lone x in the middle is a label that drifted.
 *
 * THE RIGHT EDGE IS READ TOO, AND ONLY INSIDE A BAND. A column of figures is
 * set flush right: its left edge moves with the digit count, so it never
 * recurs, and two such columns fall in one band with nothing to tell them
 * apart. Their right edges do recur - measured on page 27 of a real property
 * schedule, 72 rows: the right edges of its five figure columns come back on 62
 * to 65 rows each while the left edges of the same columns scatter over seven
 * bands, none reaching 31. The cut missed a boundary near 395, so a surface and
 * a price landed in one cell on 126 of that document's 233 rows. That is the
 * `merged-column` doubt this library already raises, and this is its cause.
 *
 * INSIDE A BAND AND NOWHERE ELSE, because a right edge cannot be trusted to
 * shape the bands themselves. A text column of varying width ends at a
 * different x on every row, and those ends are dense enough to bridge every gap
 * on the page: measured over 125 annual reports, letting right edges form the
 * bands welded the page into two columns and cost 127 458 of 736 181 filled
 * cells. Reading them only where the left edges already agreed keeps that
 * failure impossible - the bands, and therefore every boundary between them,
 * are exactly what they were.
 */
export function boundariesFromRecurrence(
	rows: Row[],
	minimumSupport = 0.15,
	gap = COLUMN_GAP
): number[] {
	const perRow = rows.map((row) => row.items).filter((items) => items.length > 0);
	if (perRow.length === 0) return [];

	const bands = bandsOf(
		perRow.flatMap((items) => items.map((item) => item.x)).sort((a, b) => a - b),
		gap
	);
	const needed = Math.max(2, Math.round(perRow.length * minimumSupport));
	const strong = bands.map((band) => rowsReaching(perRow, band, (item) => item.x) >= needed);
	const kept = bands.filter((_, index) => strong[index] || atAnEdge(strong, index));

	const boundaries: number[] = [];
	for (const [index, band] of kept.entries()) {
		if (index > 0) boundaries.push((kept[index - 1].to + band.from) / 2);
		boundaries.push(...cutsInside(band, perRow, needed, gap));
	}
	return boundaries;
}

/** How many rows put one of their edges inside a band. */
function rowsReaching(
	perRow: PositionedItem[][],
	band: Band,
	edge: (item: PositionedItem) => number
): number {
	return perRow.filter((items) => items.some((item) => within(edge(item), band))).length;
}

const within = (at: number, band: Band): boolean => at >= band.from && at <= band.to;

/**
 * Where a recurring right edge splits one band into two columns.
 *
 * FOUR CONDITIONS, AND EACH ONE KEEPS A REAL FAILURE OUT. The right edge has to
 * recur on as many rows as a band does, or one long cell would open a column.
 * Nothing may be printed ACROSS the cut. Nothing may START just after it
 * either, and that is what separates a column from a run of words: columns are
 * set a gap apart, words follow each other closely. And a real column has to
 * begin at or after the cut, or it bounds nothing - a lone value to the right
 * of a table is not a column.
 *
 * The gap is asked of the ROWS and not of the next left edge, because one wide
 * value reaching back into the gap is exactly what welds two columns into one
 * band in the first place. A single row starting there proves nothing; most of
 * them starting there is prose.
 *
 * Nothing asks for a column on the LEFT of the cut, because the band already
 * guarantees one: its first left edge is below the cluster by construction.
 *
 * The cut sits exactly where the left column's text ENDS, and that position is
 * the whole reason this is safe: an item of the left column starts before its
 * own right edge, so it stays left, and an item of the right column starts
 * after the left column stopped, so it goes right. `columnAt` reads a left edge
 * and nothing else, so no cell is ever divided.
 */
function cutsInside(band: Band, perRow: PositionedItem[][], needed: number, gap: number): number[] {
	const rights = perRow
		.flatMap((items) => items.map((item) => item.x + item.width))
		.filter((at) => at > band.from && at < band.to)
		.sort((a, b) => a - b);
	if (rights.length === 0) return [];

	const cuts: number[] = [];
	for (const cluster of bandsOf(rights, gap)) {
		if (rowsReaching(perRow, cluster, (item) => item.x + item.width) < needed) continue;
		const cut = cluster.to;
		if (rowsAcross(perRow, cut) >= needed) continue;
		if (rowsReaching(perRow, { from: cut + 1, to: cut + gap }, (item) => item.x) >= needed)
			continue;
		if (rowsReaching(perRow, { from: cut, to: band.to }, (item) => item.x) < needed) continue;
		cuts.push(cut);
	}
	return cuts;
}

/** How many rows print something ACROSS a position. Zero is a gutter, and a
 *  gutter is the only place a column may be cut. */
function rowsAcross(perRow: PositionedItem[][], at: number): number {
	return perRow.filter((items) => items.some((item) => item.x < at && item.x + item.width > at))
		.length;
}

interface Band {
	from: number;
	to: number;
}

/** Left edges closer than a column gap belong to the same band: they are the
 *  words of one cell, not two columns. */
function bandsOf(sorted: number[], gap: number): Band[] {
	const bands: Band[] = [{ from: sorted[0], to: sorted[0] }];
	for (const x of sorted) {
		const last = bands[bands.length - 1];
		if (x - last.to > gap) bands.push({ from: x, to: x });
		else last.to = x;
	}
	return bands;
}

const atAnEdge = (strong: boolean[], index: number): boolean =>
	!strong.slice(0, index).includes(true) || !strong.slice(index + 1).includes(true);

/** Which column an x falls into. */
export function columnAt(x: number, boundaries: number[]): number {
	let column = 0;
	while (column < boundaries.length && x >= boundaries[column]) column++;
	return column;
}

/**
 * Join a row: one tab between columns, nothing inside one.
 *
 * The "nothing" matters as much as the tab. The two halves of an amount are two
 * items of the same cell, and separating them would turn one number into two.
 */
function joinRow(items: PositionedItem[], boundaries: number[]): string {
	let text = items[0].text;
	for (let i = 1; i < items.length; i++) {
		const sameColumn = columnAt(items[i - 1].x, boundaries) === columnAt(items[i].x, boundaries);
		text += (sameColumn ? '' : '\t') + items[i].text;
	}
	return text.trim();
}

/**
 * Group items into rows by proximity of baseline.
 *
 * By proximity and not by rounding: rounding cuts space into fixed buckets, and
 * two items a tenth apart land in different buckets whenever they straddle a
 * bucket edge, splitting one row of the table in two at the mercy of where it
 * happened to sit on the page.
 */
export function rowsFrom(items: PositionedItem[], boundaries: number[]): Row[] {
	const placed = items
		.filter((item) => item.text.trim() !== '')
		.sort((a, b) => b.y - a.y || a.x - b.x);

	const grouped: PositionedItem[][] = [];
	for (const item of placed) {
		const current = grouped[grouped.length - 1];
		if (current && Math.abs(current[0].y - item.y) <= SAME_ROW_TOLERANCE) current.push(item);
		else grouped.push([item]);
	}

	return grouped.map((group) => {
		const ordered = [...group].sort((a, b) => a.x - b.x);
		return { y: ordered[0].y, items: ordered, text: joinRow(ordered, boundaries) };
	});
}

/** Cut a row against boundaries: the page's, or the ones a reader built from a
 *  header row of its own. */
export function rowToCells(row: Row, boundaries: number[]): string[] {
	const cells: string[][] = Array.from({ length: boundaries.length + 1 }, () => []);
	/*
	 * A row with no geometry still has its text. Rows built from plain text - a
	 * paste, a CSV, an OCR line handed over whole - carry no positioned items, and
	 * cutting them by x would hand back a table of the right shape holding
	 * nothing. Uncut is an answer, and the reading says so; empty is a lie.
	 */
	if (row.items.length === 0) cells[0].push(row.text);
	else for (const item of row.items) cells[columnAt(item.x, boundaries)].push(item.text);
	return cells.map((parts) => parts.join(' ').replace(/\s+/g, ' ').trim());
}

/**
 * A page as a table of cells: every row, cut into columns. This is the shape
 * `profileColumns`, `findRowAnomalies` and `explainRows` all take.
 *
 * `boundaries` overrides the page's own, for a reader that cut the page itself.
 */
export const cellsOf = (page: TextPage, boundaries?: number[]): string[][] =>
	page.rows.map((row) => rowToCells(row, boundaries ?? page.columnBoundaries));

/**
 * Where a group of items sits, or `null` when the group is empty.
 *
 * One function for two jobs, because a row and a cell are the same question
 * asked of different items: a row is all of them, a cell is the ones that fell
 * into one column.
 *
 * The box is the outer edge of the items given and nothing more: it says
 * nothing about the gaps inside it, and it has no height, because a page holds
 * no line height - `y` is the baseline the items share. A caller drawing a
 * band picks its own. The unit is the page's, so a box from a PDF is in points
 * and a box from a paste is in characters; the two never mix in one `Place`.
 */
export function placeOf(items: PositionedItem[], page: number): Place | null {
	if (items.length === 0) return null;
	let left = items[0].x;
	let right = items[0].x + items[0].width;
	for (const item of items) {
		left = Math.min(left, item.x);
		right = Math.max(right, item.x + item.width);
	}
	return { page, x: left, y: items[0].y, width: right - left };
}

/**
 * A page as a table of places, laid out exactly like `cellsOf`.
 *
 * The two are read together: `cells[3][1]` is what the fourth row holds in its
 * second column, and `places[3][1]` is where to find it on the page. A cell
 * nothing fell into has no place - `null`, not a rectangle of nothing.
 */
export function placesOf(page: TextPage, boundaries?: number[]): (Place | null)[][] {
	const cuts = boundaries ?? page.columnBoundaries;
	return page.rows.map((row) => {
		const columns: PositionedItem[][] = Array.from({ length: cuts.length + 1 }, () => []);
		for (const item of row.items) columns[columnAt(item.x, cuts)].push(item);
		return columns.map((items) => placeOf(items, page.pageNumber));
	});
}

export function pageFrom(
	pageNumber: number,
	width: number,
	height: number,
	items: PositionedItem[]
): TextPage {
	const boundaries = columnBoundaries(items);
	return {
		pageNumber,
		width,
		height,
		items,
		rows: rowsFrom(items, boundaries),
		columnBoundaries: boundaries
	};
}

export function documentFrom(
	pages: TextPage[],
	origin: Document['origin'],
	name: string
): Document {
	return {
		pages,
		text: pages.flatMap((page) => page.rows.map((row) => row.text)).join('\n'),
		origin,
		name
	};
}

/** A run of two spaces or more, or a tab: what separates two columns of a table
 *  that was pasted rather than printed. */
const ALIGNED_SEPARATOR = / {2,}|\t+/g;

/**
 * The fields of an aligned line, each with the character it starts at.
 *
 * A single space stays inside a field, and that is the whole reason this is not
 * `split(/\s+/)`: `28 500,00` and `VIR SEPA LOYER` are one value each. Two
 * spaces is what a person types, or a converter emits, to say "new column".
 */
function alignedFields(line: string): PositionedItem[] {
	const fields: PositionedItem[] = [];
	let start = 0;
	const push = (end: number) => {
		const raw = line.slice(start, end);
		const text = raw.trim();
		if (text !== '') fields.push({ text, x: start + raw.indexOf(text), y: 0, width: text.length });
	};
	for (const separator of line.matchAll(ALIGNED_SEPARATOR)) {
		push(separator.index);
		start = separator.index + separator[0].length;
	}
	push(line.length);
	return fields;
}

/** Tried in this order. A tab is unambiguous; the rest are punctuation that a
 *  sentence uses too. */
const DELIMITERS = ['\t', ';', '|', ','];

/**
 * The delimiter a file is written with, or null.
 *
 * "Written with", not "contains": every French amount holds a comma, and a
 * paste of `02/05/2026   CARTE AMAZON   12,40` has exactly one on every line.
 * Counting commas would call that a CSV and cut `12,40` in half. So a file that
 * lines its columns up with spaces is read as aligned, and only a tab overrides
 * that - a tab is never punctuation.
 *
 * What makes a delimiter real is the same thing that makes a column real: it
 * recurs, the same number of times, line after line.
 */
function delimiterOf(lines: string[]): string | null {
	// One line is not a pattern: a single sentence with two commas would pass.
	if (lines.length < 2) return null;
	/*
	 * A quoted field may hold the delimiter itself, and splitting on it anyway
	 * shifts every column after it. Half-parsing a quoted CSV is precisely the
	 * plausible-but-wrong reading this library exists to prevent, so it refuses:
	 * the rows come back whole and the reading says as much.
	 */
	if (lines.some((line) => line.includes('"'))) return null;

	const aligned = lines.filter((line) => / {2,}/.test(line)).length >= lines.length / 2;
	for (const candidate of aligned ? ['\t'] : DELIMITERS) {
		const counts = lines.map((line) => line.split(candidate).length - 1);
		const usual = commonest(counts);
		if (usual >= 1 && counts.filter((count) => count === usual).length >= lines.length * 0.8) {
			return candidate;
		}
	}
	return null;
}

/** The count that comes up most often. */
function commonest(counts: number[]): number {
	const seen = new Map<number, number>();
	for (const count of counts) seen.set(count, (seen.get(count) ?? 0) + 1);
	return [...seen.entries()].sort((a, b) => b[1] - a[1])[0][0];
}

/**
 * The fields of a delimited line, placed on the grid the delimiter implies.
 *
 * x is the column's index, and that is the honest coordinate here: a CSV lines
 * nothing up, so the character a field starts at says nothing about which column
 * it is in - the third field is the third column whether it starts at character
 * 11 or at 24. On that grid every row agrees with every other, which is what the
 * cut is looking for.
 *
 * An empty field contributes no item. The column still exists, from the rows
 * that filled it, and how often it is filled is exactly what the reading
 * reports.
 */
function delimitedFields(line: string, delimiter: string): PositionedItem[] {
	return line
		.split(delimiter)
		.map((field, index) => ({ text: field.trim(), x: index, y: 0, width: 1 }))
		.filter((item) => item.text !== '');
}

/**
 * A document made of plain text: a paste, a CSV, an export.
 *
 * One page, and one row per line. A paste was never paginated, so the whole of
 * it is page 1 and every per-page count keeps its meaning. Blank lines are not
 * rows: kept, they would count in every denominator and drag a column's fill
 * rate under the threshold that says a cut invented it.
 *
 * The columns are found the same way they are on a page. The cut votes on which
 * left edges come back row after row, and that question does not care which
 * ruler measured them. So text only has to say where its fields start:
 *
 *   - a file written with a delimiter -> the field's index, because a CSV lines
 *     nothing up and the third field is the third column wherever it begins;
 *   - a table pasted with spaces -> the character it starts at, which is a left
 *     edge exactly as a PDF's x is;
 *   - anything else -> one field, the row whole.
 *
 * One engine, three rulers. The last case is not a failure: `readTable` says the
 * row came back whole rather than inventing a column.
 */
export function documentFromText(text: string, name: string): Document {
	const lines = text.split(/\r?\n/).filter((line) => line.trim() !== '');

	const delimiter = delimiterOf(lines);
	const unit: CoordinateUnit = delimiter === null ? 'characters' : 'index';
	const gap = gapFor(unit);

	// y descends, as it does down a page, so a reader that sorts rows by y - and
	// several do, because that is how a PDF gives them - gets reading order out of
	// a paste too.
	const rows: Row[] = lines.map((line, index) => {
		const fields = delimiter === null ? alignedFields(line) : delimitedFields(line, delimiter);
		return { y: -index, items: fields.map((item) => ({ ...item, y: -index })), text: line };
	});

	const items = rows.flatMap((row) => row.items);
	const page: TextPage = {
		pageNumber: 1,
		width: 0,
		height: 0,
		items,
		rows,
		columnBoundaries: columnBoundaries(items, gap),
		unit
	};
	return { pages: [page], text, origin: 'text', name };
}
