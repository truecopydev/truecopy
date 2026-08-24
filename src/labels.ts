/*
 * The value that goes with a label.
 *
 * `contract.ts` states the need in as many words and answers none of it:
 * `SelfCheck.declared` is a LIST because "a document may announce several
 * candidate values when its layout scattered a label from its number". Finding
 * those candidates was left to every caller, and three wrote it separately - a
 * pension record looking four lines under a heading, a fund report taking the
 * first amount to the right of one, a property schedule reading a column index
 * out of a header cell. Same question, three geometries, no domain word in any
 * of them.
 *
 * WHAT THIS ANSWERS. Given which cells are labels and which cells could be
 * values - both named by the caller, because this library has never heard of a
 * total - it says where the label is and which cells could be its value,
 * closest first.
 *
 * WHAT IT REFUSES TO DO. Pick. Handing back one value would mean deciding
 * between two readings of a layout, which is the plausible-but-wrong answer
 * argued against everywhere else here. The list goes to `SelfCheck.declared`,
 * and `readDocument` keeps the one that fits - so the document decides, not a
 * rule about how far a number usually sits from its heading.
 *
 * THE ONE RULE THAT COSTS A READING WHEN IT IS MISSING. A search stops at the
 * NEXT label. Two headings printed close together let the second one's figure
 * count for the first as well: a doubled total, so a false proof, so a refusal
 * on a reading that was right. That is the worst of both, and it was met on a
 * real pension record before it was written down.
 */

import { cellAt } from './columns.js';

/** Where a cell sits in a table of rows. */
export interface Cell {
	readonly row: number;
	readonly column: number;
}

/** A cell that could be the value of a label, and how far from it. */
export interface Candidate extends Cell {
	/** The cell exactly as the document prints it, never parsed. Reading it is
	 *  the caller's call: `readNumber(raw, decimalMarkOf(document.text))`. */
	readonly raw: string;
	/**
	 * How far it sits from the label: columns walked along the row, or rows
	 * walked down the column. One unit is one cell either way.
	 *
	 * Not points, and not a mixture of the two. A distance in points would say
	 * that a wide column is farther than a narrow one, which is a fact about the
	 * typesetting and not about which value belongs to which heading.
	 */
	readonly distance: number;
}

export interface Labelled {
	readonly label: Cell;
	/** Candidates, closest first. Empty when the document offers none, which is
	 *  an answer: a label with no value beside it is worth saying out loud. */
	readonly values: readonly Candidate[];
}

export type Look =
	/** Along the label's own row, to the right: `Total   1 234,56`. */
	| 'row'
	/** Down the label's own column: a header, and its figures under it. */
	| 'column'
	/** Both, merged and sorted by distance. */
	| 'both';

export interface LabelOptions {
	/**
	 * How many cells to walk. Four by default, measured rather than chosen: a
	 * pension record prints its presentation prose and a form reference between
	 * a heading and its figure, and four clears both without reaching the next
	 * section.
	 */
	reach?: number;
	/** Where to look. Both by default: a caller who knows its layout says so,
	 *  and one that does not gets every candidate with its distance. */
	look?: Look;
}

const DEFAULT_REACH = 4;

/**
 * Walk one direction from the label, and stop at the next label.
 *
 * Stopping and not skipping: a cell that is itself a label opens another
 * question, and reaching past it answers the wrong one. This is the rule whose
 * absence doubled a total on a real document.
 *
 * The one-cell read is `columns.cellAt`, reused rather than written again: the
 * same name doing the same thing twice in one barrel is confusing before it is
 * wasteful.
 */
function walk(
	rows: readonly (readonly string[])[],
	step: (distance: number) => Cell,
	reach: number,
	isLabel: (cell: string) => boolean,
	isValue: (cell: string) => boolean
): Candidate[] {
	const found: Candidate[] = [];
	for (let distance = 1; distance <= reach; distance += 1) {
		const at = step(distance);
		const row = rows[at.row];
		if (row === undefined) break;
		const raw = cellAt(row, at.column);
		if (raw === '') continue;
		if (isLabel(raw)) break;
		if (isValue(raw)) found.push({ ...at, raw, distance });
	}
	return found;
}

/**
 * Every label in a table, with the cells that could be its value.
 *
 * `isLabel` and `isValue` are the caller's, and that is the whole line this
 * library holds: it does not know a total from a heading from a footnote, and a
 * list of words that mean "total" would be a domain shipped in a parser.
 *
 * A label matching `isValue` too is not a contradiction and is not resolved
 * here: the cell is reported as a label, and a caller whose predicates overlap
 * is told nothing it did not already ask for.
 */
export function labelledValues(
	rows: readonly (readonly string[])[],
	isLabel: (cell: string) => boolean,
	isValue: (cell: string) => boolean,
	options: LabelOptions = {}
): Labelled[] {
	const reach = options.reach ?? DEFAULT_REACH;
	const look = options.look ?? 'both';
	const found: Labelled[] = [];

	rows.forEach((row, at) => {
		row.forEach((_, column) => {
			const text = cellAt(row, column);
			if (text === '' || !isLabel(text)) return;
			const label: Cell = { row: at, column };
			const values: Candidate[] = [];
			if (look !== 'column') {
				values.push(
					...walk(
						rows,
						(distance) => ({ row: at, column: column + distance }),
						reach,
						isLabel,
						isValue
					)
				);
			}
			if (look !== 'row') {
				values.push(
					...walk(rows, (distance) => ({ row: at + distance, column }), reach, isLabel, isValue)
				);
			}
			found.push({
				label,
				values: values.sort((left, right) => left.distance - right.distance)
			});
		});
	});

	return found;
}

/**
 * The column a header sits in, when exactly one header matches.
 *
 * A property schedule announces its unit once, in the header - `(en m2)` - and
 * prints bare numbers underneath. Requiring the unit inside each cell returned
 * no value at all on a real corpus; reading it from the header returned them.
 *
 * `null` when no header matches, and null again when SEVERAL do. Two matching
 * headers is exactly the document nobody should read on a hunch: either the
 * predicate is too loose or the table carries two of that column, and picking
 * the first would be a silent answer to a question nobody asked.
 *
 * WHERE IT DOES NOT APPLY, and it was measured. This reads ONE table: rows cut
 * against one set of boundaries. Handed the flattened rows of a whole document,
 * it answers `null` far more often than it is wrong to - a 43-page annual
 * report reprints its heading on pages the cut does not align, so the same
 * logical column lands at several indices and every one of them matches. On a
 * corpus of 125 such reports, 24 carried a heading a caller could find; this
 * refused 12 of them, and was right on at least some - the heading it refused
 * sat on a narrative page, above a column the schedule leaves empty. For a
 * document, cut it page by page with `Table.pages` and ask once per page.
 */
export function columnOfHeader(
	rows: readonly (readonly string[])[],
	isHeader: (cell: string) => boolean
): number | null {
	const columns = new Set<number>();
	for (const row of rows) {
		row.forEach((_, column) => {
			const text = cellAt(row, column);
			if (text !== '' && isHeader(text)) columns.add(column);
		});
	}
	const [only] = columns;
	return columns.size === 1 && only !== undefined ? only : null;
}

/* ------------------------------------------------------------------------- *
 * THE SAME QUESTION, ON A RUN OF TEXT.
 *
 * Everything above needs a grid: a caller who has cells knows which row and
 * which column a value sits in. A caller who has PROSE has neither, and the
 * question does not go away with the geometry - a heading and its figure are
 * still a heading and its figure when the layout has been flattened into one
 * string, which is what an API field, an OCR pass or a text-layer dump hands
 * over.
 *
 * So the rule that this file exists for - A SEARCH STOPS AT THE NEXT LABEL -
 * had to be written a fourth time by a fourth caller, and that caller got it
 * wrong. Its labels were the years of a French dividend table; between each
 * year and its amount the document prints the PAYMENT DATE, whose own year
 * then collected the amount. A whole published series came out shifted by one
 * year, and every value in it was well formed.
 *
 * The contract is the one above, minus a dimension. The caller says what a
 * label looks like and what a value looks like; this walks from each label and
 * stops at the next one; it hands back candidates and refuses to pick.
 * ------------------------------------------------------------------------- */

/** Where something sits in a run of text, and what it reads. */
export interface Span {
	/** Index of the first character, in the string that was searched. */
	readonly index: number;
	/** The text exactly as the document writes it, never parsed. */
	readonly raw: string;
}

/** A span that could be the value of a label, and how far from it. */
export interface TextCandidate extends Span {
	/** Characters between the end of the label and the start of this value.
	 *  Zero means they touch. */
	readonly distance: number;
}

/** A label found in the text, with the spans that could be its value. */
export interface Labelling {
	readonly label: Span;
	/** Candidates, closest first. Empty is an answer: a label the document
	 *  leaves without a value is worth saying out loud. */
	readonly values: readonly TextCandidate[];
}

export interface SpanOptions {
	/**
	 * How many characters to walk past a label before giving up.
	 *
	 * UNBOUNDED BY DEFAULT, and that is not laziness: in text the next label IS
	 * the boundary, and a character budget would be a number nobody measured.
	 * The one case it guards is the LAST label of a document, which otherwise
	 * reaches to the end - a caller who knows its own layout narrows it.
	 */
	reach?: number;
}

/** A fresh global copy, so a caller's regex keeps its own `lastIndex`. */
const scanning = (pattern: RegExp): RegExp =>
	new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`);

/** Every match of `pattern`, as spans. Zero-length matches are stepped over
 *  rather than looped on. */
function spansOf(text: string, pattern: RegExp): Span[] {
	const scan = scanning(pattern);
	const found: Span[] = [];
	let match: RegExpExecArray | null;
	while ((match = scan.exec(text)) !== null) {
		if (match[0].length === 0) {
			scan.lastIndex += 1;
			continue;
		}
		found.push({ index: match.index, raw: match[0] });
	}
	return found;
}

/**
 * Every label in a run of text, with the spans that could be its value.
 *
 * `labels` and `values` are the caller's patterns, and that is the whole line
 * this library holds here as above: it does not know a heading from a footnote,
 * and a list of words that mean "total" would be a domain shipped in a parser.
 *
 * A value that OVERLAPS its label is not a candidate. The year inside
 * "exercice clos le 31 decembre 2024" is part of the label, not the figure that
 * label announces, and returning it would answer a question nobody asked.
 */
export function labelledSpans(
	text: string,
	labels: RegExp,
	values: RegExp,
	options: SpanOptions = {}
): Labelling[] {
	const reach = options.reach ?? Number.POSITIVE_INFINITY;
	const found = spansOf(text, labels);
	const candidates = spansOf(text, values);

	return found.map((label, at) => {
		const from = label.index + label.raw.length;
		const nextLabel = found[at + 1]?.index ?? text.length;
		const until = Math.min(nextLabel, from + reach);
		const values_ = candidates
			.filter((one) => one.index >= from && one.index + one.raw.length <= until)
			.map((one) => ({ ...one, distance: one.index - from }));
		return { label, values: values_ };
	});
}
