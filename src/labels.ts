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
 * and `discrepancyOf` keeps the one that fits - so the document decides, not a
 * rule about how far a number usually sits from its heading.
 *
 * THE ONE RULE THAT COSTS A READING WHEN IT IS MISSING. A search stops at the
 * NEXT label. Two headings printed close together let the second one's figure
 * count for the first as well: a doubled total, so a false proof, so a refusal
 * on a reading that was right. That is the worst of both, and it was met on a
 * real pension record before it was written down.
 */

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

const cellAt = (rows: readonly (readonly string[])[], row: number, column: number): string =>
	(rows[row]?.[column] ?? '').trim();

/**
 * Walk one direction from the label, and stop at the next label.
 *
 * Stopping and not skipping: a cell that is itself a label opens another
 * question, and reaching past it answers the wrong one. This is the rule whose
 * absence doubled a total on a real document.
 */
function walk(
	rows: readonly (readonly string[])[],
	from: Cell,
	step: (distance: number) => Cell,
	reach: number,
	isLabel: (cell: string) => boolean,
	isValue: (cell: string) => boolean
): Candidate[] {
	const found: Candidate[] = [];
	for (let distance = 1; distance <= reach; distance += 1) {
		const at = step(distance);
		if (rows[at.row] === undefined) break;
		const raw = cellAt(rows, at.row, at.column);
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
		row.forEach((cell, column) => {
			if (cell.trim() === '' || !isLabel(cell.trim())) return;
			const label: Cell = { row: at, column };
			const values: Candidate[] = [];
			if (look !== 'column') {
				values.push(
					...walk(
						rows,
						label,
						(distance) => ({ row: at, column: column + distance }),
						reach,
						isLabel,
						isValue
					)
				);
			}
			if (look !== 'row') {
				values.push(
					...walk(
						rows,
						label,
						(distance) => ({ row: at + distance, column }),
						reach,
						isLabel,
						isValue
					)
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
 */
export function columnOfHeader(
	rows: readonly (readonly string[])[],
	isHeader: (cell: string) => boolean
): number | null {
	const columns = new Set<number>();
	for (const row of rows) {
		row.forEach((cell, column) => {
			if (cell.trim() !== '' && isHeader(cell.trim())) columns.add(column);
		});
	}
	const [only] = columns;
	return columns.size === 1 && only !== undefined ? only : null;
}
