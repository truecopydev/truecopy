/*
 * Which rows belong to the same record.
 *
 * Every other mechanism here works on the printed row, and in a great many real
 * documents the printed row is not the record. A property schedule prints the
 * street on one line, the figures on the next and the postcode on a third; a
 * fund report prints a name on two baselines with its own amounts between them;
 * a bank statement wraps a long wording. Read one row for one record and the
 * count comes out three to five times short, silently.
 *
 * Three applications wrote this separately before it was here, which is what
 * says it belongs here: none of them needed a domain word to do it.
 *
 * WHAT JOINS TWO ROWS, and it is one sentence. A table has a SPINE: the rows
 * that carry its full width. A row narrower than that is a fragment, and it
 * joins a neighbouring spine when every column it fills is a column that spine
 * leaves EMPTY.
 *
 * That second half is the whole difference between this and the rule everyone
 * writes first, and a count cannot see it. Attaching each fragment to its
 * nearest spine gets the same number of records on both measured documents and
 * swallows twenty-three page-furniture rows INTO records on one of them: a page
 * header sits one row from a spine, so proximity takes it. It cannot fill a
 * column the spine leaves empty, though - it fills the label column, which the
 * spine fills too - so compatibility refuses it. Measured in
 * `truecopydev/corpus`, `npm run banc-records`.
 *
 * WHAT THIS WILL NOT DO. It does not join the text of two rows. How to join
 * half a name to its other half is the caller's business and its answer differs
 * by document - a hyphen here, a space there, nothing at all when the halves
 * belong to two columns. This says WHICH rows, and stops.
 */

/** Why a grouping cannot be trusted, named rather than only worded. */
export type RecordDoubt =
	/**
	 * The spine is not sharp: too many rows sit just under the full width for
	 * "complete" and "fragment" to be told apart by width alone.
	 *
	 * It is a real property of some documents rather than a failure to tune. A
	 * record that leaves one column empty - a fee of zero, a tax that does not
	 * apply - is exactly as wide as a rich fragment, and no threshold separates
	 * them. Measured on a real property schedule: 61 records at one threshold, 71
	 * at the next, and the judged answer is 65 with neither reachable.
	 *
	 * A caller who knows one thing about its document closes that gap in a line.
	 * This library does not know that thing and will not guess it.
	 */
	| 'spine-not-sharp'
	/** No row reaches the full width: there is no spine to group around, and
	 *  every row is returned on its own. */
	| 'no-spine';

/** One doubt, in both forms: the code to act on, the sentence to show. */
export interface RecordFinding {
	readonly code: RecordDoubt;
	readonly message: string;
	/** The width a complete row was taken to have, for `spine-not-sharp`. */
	readonly spineWidth?: number;
	/** How many rows sit within one cell of that width, for `spine-not-sharp`. */
	readonly nearMisses?: number;
}

export interface RecordBlock {
	/** The row that carries the table's full width. */
	readonly spine: number;
	/** Every row of this record in printed order, the spine included. */
	readonly rows: readonly number[];
}

export interface RecordsOptions {
	/**
	 * How many filled cells a complete row carries. Left out, measured.
	 *
	 * An option because the measurement has a stated limit and the caller may
	 * know better: it is the one number a document can be wrong about, and
	 * passing it is honest where tuning a hidden default would not be.
	 */
	spineWidth?: number;
	/**
	 * How far above or below its spine a fragment may sit. Two by default,
	 * which is what a record split across three printed rows needs.
	 *
	 * Wider does not read more, it reads the neighbour: the row three above a
	 * spine is usually the row below the PREVIOUS spine.
	 */
	reach?: number;
}

export interface Records {
	readonly records: readonly RecordBlock[];
	/**
	 * Rows that belong to no record: a cover page, a letterhead, a page number.
	 *
	 * Returned rather than dropped. A row this mechanism could not place is
	 * exactly what a caller may need to look at, and a list that quietly loses
	 * a quarter of a document is the plausible-but-wrong reading argued against
	 * everywhere else here.
	 */
	readonly loose: readonly number[];
	readonly findings: readonly RecordFinding[];
}

const DEFAULT_REACH = 2;

/** How much narrower than the widest row a row may be and still be complete.
 *  One, because a record legitimately leaves a column empty. */
const SLACK = 1;

/**
 * Past this many near misses per spine, the two populations overlap and no
 * threshold separates them.
 *
 * Against the SPINE count and not the row count, which is the denominator that
 * means something: the question is how many rows sit just under the bar
 * compared to how many clear it, not how much of the document is fragments.
 *
 * Measured on the two real geometries in `truecopydev/corpus`: a property
 * schedule whose judged answer is unreachable from either side of the threshold
 * has 10 near misses for 61 spines, and an amortisation schedule that groups
 * exactly right has 1 for 185. Two documents is a thin basis and this number
 * will move; what will not is the denominator and the reason for the doubt.
 */
const NEAR_MISS_PER_SPINE = 0.1;

const filledColumns = (row: readonly string[]): Set<number> => {
	const columns = new Set<number>();
	row.forEach((cell, at) => {
		if (cell.trim() !== '') columns.add(at);
	});
	return columns;
};

const widthOf = (row: readonly string[]): number => filledColumns(row).size;

/**
 * How many filled cells a complete row carries, measured on the document.
 *
 * The widest row, less one. Requiring the exact maximum rejects half the real
 * records: a schedule prints a zero as a blank, so a perfectly complete row is
 * one cell short of the widest.
 */
export function spineWidthOf(rows: readonly (readonly string[])[]): number {
	const widest = rows.reduce((most, row) => Math.max(most, widthOf(row)), 0);
	return Math.max(1, widest - SLACK);
}

/** A row that fills only columns the spine leaves empty, and fills something. */
const fitsBeside = (fragment: readonly string[], empty: ReadonlySet<number>): boolean => {
	const columns = filledColumns(fragment);
	return columns.size > 0 && [...columns].every((column) => empty.has(column));
};

/** The columns a row leaves empty, across the width it was cut into. */
const emptyColumnsOf = (row: readonly string[]): Set<number> => {
	const here = filledColumns(row);
	return new Set(row.map((_, column) => column).filter((column) => !here.has(column)));
};

/** Whether every row strictly between `at` and its spine also fits beside it. */
function pathIsClear(
	rows: readonly (readonly string[])[],
	at: number,
	direction: number,
	step: number,
	empty: ReadonlySet<number>
): boolean {
	for (let between = 1; between < step; between += 1) {
		const row = rows[at + direction * between];
		if (row === undefined || !fitsBeside(row, empty)) return false;
	}
	return true;
}

/**
 * Which spine a fragment belongs to: the NEAREST one it fits beside, ties going
 * to the one above.
 *
 * Nearest and not first, and the difference is a whole record. Walking down from
 * a spine and taking every row that fits reaches straight past the fragment into
 * the NEXT record: the postcode of one building and the street of the next are
 * both a single cell in the same column, and nothing inside either tells them
 * apart. Their distance does.
 *
 * And the path is walked rather than jumped: every row between the fragment and
 * its spine must fit beside that spine too. Otherwise a record reaches over a
 * page header to collect something on the far side of it, which is how an
 * address ends up on the wrong building.
 */
function spineFor(
	rows: readonly (readonly string[])[],
	fragment: readonly string[],
	at: number,
	isSpine: readonly boolean[],
	reach: number
): number | null {
	for (let step = 1; step <= reach; step += 1) {
		for (const direction of [-1, 1]) {
			const spine = at + direction * step;
			const row = rows[spine];
			if (row === undefined || !isSpine[spine]) continue;
			const empty = emptyColumnsOf(row);
			if (!fitsBeside(fragment, empty)) continue;
			if (pathIsClear(rows, at, direction, step, empty)) return spine;
		}
	}
	return null;
}

/**
 * Group rows into records.
 *
 * Nothing is ever grouped away: every row comes back either in a record or in
 * `loose`, and a document with no spine at all comes back one record per row
 * rather than empty. The mechanism can be wrong about where a fragment belongs;
 * it is never allowed to be silent about a row.
 */
export function recordsFrom(
	rows: readonly (readonly string[])[],
	options: RecordsOptions = {}
): Records {
	const spineWidth = options.spineWidth ?? spineWidthOf(rows);
	const reach = options.reach ?? DEFAULT_REACH;
	const widths = rows.map(widthOf);
	const isSpine = widths.map((width) => width >= spineWidth);

	const findings: RecordFinding[] = [];
	// Nothing read is nothing to doubt: a document with no rows gets no finding,
	// because there is no document to say anything about.
	if (rows.length === 0) return { records: [], loose: [], findings: [] };
	if (!isSpine.includes(true)) {
		return {
			records: rows.map((_, at) => ({ spine: at, rows: [at] })),
			loose: [],
			findings: [
				{
					code: 'no-spine',
					message:
						'No row reaches the full width of this table, so there is nothing to group around: every row is returned on its own.',
					spineWidth
				}
			]
		};
	}

	const nearMisses = widths.filter((width) => width === spineWidth - 1).length;
	const spines = isSpine.filter(Boolean).length;
	if (nearMisses / spines > NEAR_MISS_PER_SPINE) {
		findings.push({
			code: 'spine-not-sharp',
			message:
				`${nearMisses} rows sit one cell under the full width of ${spineWidth}, so a complete row ` +
				'and a rich fragment cannot be told apart by width alone. Records at the edge may be split ' +
				'or merged; pass `spineWidth` if the document tells you which.',
			spineWidth,
			nearMisses
		});
	}

	const kept = new Map<number, number[]>();
	rows.forEach((_, at) => {
		if (isSpine[at]) kept.set(at, [at]);
	});
	const loose: number[] = [];
	rows.forEach((fragment, at) => {
		if (isSpine[at]) return;
		const spine = spineFor(rows, fragment, at, isSpine, reach);
		if (spine === null) loose.push(at);
		else kept.get(spine)?.push(at);
	});

	const records: RecordBlock[] = [...kept.entries()].map(([spine, its]) => ({
		spine,
		rows: its.sort((left, right) => left - right)
	}));
	return { records, loose, findings };
}
