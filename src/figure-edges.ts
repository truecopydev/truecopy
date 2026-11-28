/*
 * Columns of figures the cut left in one cell.
 *
 * Geometry and the shape of a figure, nothing else: no engine, no bytes, no
 * knowledge of the document. It reads the rows and the boundaries the cut
 * already found, and returns the boundaries it would add.
 */

import type { PositionedItem, Row } from './document.js';
import { columnAt, rowsAcross } from './layout.js';

const CLOSING_ONLY = /^\)+$/;

/** A figure, or the start of one: digits with their sign, bracket and unit. */
const FIGURE_ITEM = /^[-+\u2212\u2013(]*\d[\d.,'\u2019]*[%)]*$/;
/** A bracket or a sign printed as an item of its own, ahead of its figure. */
const OPENER = /^[(+\u2212\u2013\u2014-]+$/;
const LONE_DASH = /^[-\u2212\u2013\u2014]$/;
const CLOSES_A_FIGURE = /[)%]$/;
const OPENS_SIGNED = /^[-+\u2212\u2013(]/;
const THOUSANDS = /^\d{3}(?:[.,]\d+)?[%)]*$/;
const ENDS_ON_DIGIT = /\d$/;
/** A gap this many digits wide is not the space inside a number. */
const WIDE_GAP = 1.5;

type Seam = 'apart' | 'within' | 'unknown';

/**
 * Whether a figure and the item before it on its row are two values.
 *
 * `apart` only when the row says so by itself: the item before closed its own
 * figure, this one opens on a bracket or a sign, or the gap between them is
 * wider than any space a number is printed with. `within` when the two could
 * be one number - a group of three digits a narrow space after a digit - and
 * that is what keeps a cut out of "1 358 522". A dash alone is a sign as often
 * as it is an empty cell, so only a wide gap parts it from either side.
 */
function seamOf(before: PositionedItem, figure: PositionedItem): Seam {
	const text = figure.text.trim();
	const previous = before.text.trim();
	const digit = figure.width / Math.max(1, text.length);
	const wide = figure.x - (before.x + before.width) > WIDE_GAP * digit;
	if (LONE_DASH.test(previous) || LONE_DASH.test(text)) return wide ? 'apart' : 'unknown';
	if (OPENER.test(previous)) return 'unknown';
	if (CLOSING_ONLY.test(previous)) return 'apart';
	if (!FIGURE_ITEM.test(previous)) return wide ? 'apart' : 'unknown';
	if (CLOSES_A_FIGURE.test(previous) || OPENS_SIGNED.test(text) || wide) return 'apart';
	return ENDS_ON_DIGIT.test(previous) && THOUSANDS.test(text) ? 'within' : 'unknown';
}

/** The void between a value and the figure after it, on one row. */
interface Void {
	from: number;
	to: number;
	column: number;
	seam: Seam;
}

const opensAFigure = (item: PositionedItem, next: PositionedItem | undefined): boolean => {
	const text = item.text.trim();
	if (FIGURE_ITEM.test(text) || LONE_DASH.test(text)) return true;
	return OPENER.test(text) && next !== undefined && FIGURE_ITEM.test(next.text.trim());
};

/** How close two left edges are to be the same edge, in the page's unit. */
const SAME_EDGE = 1;

/** The figures that open their cell, one list per column: where each starts. */
function cellStarts(perRow: PositionedItem[][], boundaries: number[]): Map<number, number[]> {
	const starts = new Map<number, number[]>();
	for (const items of perRow) {
		const sorted = [...items].sort((a, b) => a.x - b.x);
		sorted.forEach((item, i) => {
			const column = columnAt(item.x, boundaries);
			if (i > 0 && columnAt(sorted[i - 1].x, boundaries) === column) return;
			if (opensAFigure(item, sorted[i + 1]))
				starts.set(column, [...(starts.get(column) ?? []), item.x]);
		});
	}
	return starts;
}

/**
 * Every void ahead of a figure that shares its column with what precedes it.
 *
 * A seam the row leaves `unknown` is settled by the other rows: a figure that
 * starts where enough of them open their cell is at the head of a column, and
 * what precedes it on this row belongs to another.
 */
function voidsOf(
	perRow: PositionedItem[][],
	boundaries: number[],
	starts: Map<number, number[]>,
	needed: number
): Void[] {
	const voids: Void[] = [];
	for (const [before, figure] of perRow.flatMap(figuresAfterAValue)) {
		const column = columnAt(figure.x, boundaries);
		const from = before.x + before.width;
		if (columnAt(before.x, boundaries) !== column || from > figure.x) continue;
		const seam = seamOf(before, figure);
		const settled = seam === 'unknown' && opensACell(figure, before, starts.get(column), needed);
		voids.push({ from, to: figure.x, column, seam: settled ? 'apart' : seam });
	}
	return voids;
}

/** Each figure of a row with the item printed before it. */
function figuresAfterAValue(items: PositionedItem[]): [PositionedItem, PositionedItem][] {
	const sorted = [...items].sort((a, b) => a.x - b.x);
	const pairs: [PositionedItem, PositionedItem][] = [];
	for (let i = 1; i < sorted.length; i++) {
		if (opensAFigure(sorted[i], sorted[i + 1])) pairs.push([sorted[i - 1], sorted[i]]);
	}
	return pairs;
}

/** Whether enough rows open their cell where this figure starts. */
function opensACell(
	figure: PositionedItem,
	before: PositionedItem,
	starts: number[] = [],
	needed: number
): boolean {
	if (OPENER.test(before.text.trim())) return false;
	return starts.filter((x) => Math.abs(x - figure.x) <= SAME_EDGE).length >= needed;
}

const holds = (gap: Void, at: number): boolean => gap.from <= at && at <= gap.to;

/**
 * The position the most `apart` voids share, with how many do.
 *
 * Voids are intervals and a gutter is where they overlap: the left column ends
 * at a different x on every row, the right one starts at a different x too,
 * and the strip between the furthest end and the nearest start is in all of
 * them. The best position is always one of the ends, and the furthest of
 * the best ones: a bracket closing the left value is still left of it.
 */
function sharedVoid(voids: Void[]): { cut: number; apart: number; within: number } | undefined {
	const apart = voids.filter((gap) => gap.seam === 'apart');
	let best: { cut: number; apart: number; within: number } | undefined;
	for (const { from: cut } of apart) {
		const count = apart.filter((gap) => holds(gap, cut)).length;
		if (best !== undefined && (count < best.apart || (count === best.apart && cut <= best.cut)))
			continue;
		const within = voids.filter((gap) => gap.seam === 'within' && holds(gap, cut)).length;
		best = { cut, apart: count, within };
	}
	return best;
}

/**
 * Where a column of figures starts inside a column the cut left whole.
 *
 * Two columns of figures set a few points apart fall in one band as soon as a
 * bracket is printed as an item of its own: "(", "7,604", ")" and "3,372" put a
 * left edge every few points, nothing is a column gap apart any more, and
 * "( 7,604 ) 3,372" lands in one cell on every row. The right edges cannot
 * part them either, since the next figure starts well inside the gap that cut
 * asks for.
 *
 * What parts them is what the rows print: a void that comes back, ahead of a
 * figure, after a value that was already complete. Three conditions. The void
 * is shared by as many rows as a band has to be. On those rows the value
 * before it is `apart` - closed, signed, or a wide gap away - and the rows
 * where the figure could be the next three digits of one number are a small
 * minority, or the void is the inside of "1 358 522" and no gutter. And almost
 * nothing is printed across the cut.
 *
 * The cut sits where the value before the void ENDS, like a right-edge cut and
 * for the same reason: `columnAt` reads a left edge, so every figure of the
 * right column goes right, however wide.
 *
 * A column of references is filled on a few rows only, so the rows that open
 * their cell with a figure past the cut count with those that print a void
 * there: they agree with the cut too. Two voids are still asked for.
 *
 * One cut is taken at a time and the voids are read again, so the rows that
 * agreed on it stop asking: a gutter opens one column, not one per row.
 */
export function boundariesFromFigureEdges(
	rows: Row[],
	boundaries: number[],
	minimumSupport = 0.15
): number[] {
	const perRow = rows.map((row) => row.items).filter((items) => items.length > 0);
	const needed = Math.max(2, Math.round(perRow.length * minimumSupport));
	const cuts: number[] = [];
	for (;;) {
		const all = [...boundaries, ...cuts].sort((a, b) => a - b);
		const starts = cellStarts(perRow, all);
		const cut = columnsOfVoids(voidsOf(perRow, all, starts, needed))
			.map((voids) => gutterIn(voids, starts.get(voids[0].column) ?? [], perRow, needed))
			.find((found) => found !== undefined);
		if (cut === undefined) return cuts;
		cuts.push(cut);
	}
}

/** The cut one column's voids agree on, or nothing. */
function gutterIn(
	voids: Void[],
	starts: number[],
	perRow: PositionedItem[][],
	needed: number
): number | undefined {
	const shared = sharedVoid(voids);
	if (shared === undefined || shared.apart < 2 || shared.within * 4 > shared.apart)
		return undefined;
	const agreeing = shared.apart + starts.filter((x) => x >= shared.cut).length;
	if (agreeing < needed) return undefined;
	return rowsAcross(perRow, shared.cut) * 4 > agreeing ? undefined : shared.cut;
}

/** The voids, column by column: a gutter is looked for inside one column. */
function columnsOfVoids(voids: Void[]): Void[][] {
	const columns = new Map<number, Void[]>();
	for (const gap of voids) columns.set(gap.column, [...(columns.get(gap.column) ?? []), gap]);
	return [...columns.values()];
}
