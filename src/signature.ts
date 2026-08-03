/*
 * The signature: the schema learned from the rows, instead of declared.
 *
 * A table describes itself. The date column holds a date on every row, the money
 * column an amount, and the columns that are always filled are filled. A row
 * that breaks that is not a row of the table - it is a total, a balance, a
 * footer.
 *
 * Its advantage over a list of forbidden words is decisive: it reads no label,
 * so it works on an issuer never seen. A word list only recognises what was put
 * in it, which means it recognises yesterday's documents.
 */

import {
	cellAt,
	columnCount,
	dominantKind,
	profileColumns,
	type ColumnProfile,
	type ProfileOptions
} from './columns.js';

export interface KindThreshold {
	/** Share of cells of that kind past which the column is of that kind. */
	share: number;
	/**
	 * Share of filled cells past which an empty cell is an anomaly, for a column
	 * of this kind. Absent: emptiness says nothing here.
	 *
	 * On a bank statement a date column that is nearly always filled, with one
	 * cell empty, is a balance line - it has no value date. On a money column,
	 * empty is ordinary.
	 */
	emptyIsAnomalyAbove?: number;
}

export interface SignatureOptions extends ProfileOptions {
	thresholds: Record<string, KindThreshold>;
	/** Share of filled cells past which a column counts as always filled,
	 *  whatever its kind. */
	filledThreshold?: number;
	/** Below this, there are too few rows to learn anything at all. */
	minimumRows?: number;
}

/** Why this row breaks the table's signature. */
export type RowAnomaly =
	| { cause: 'wrong-kind'; column: number; expected: string }
	/** `kind` tells which kind of column the hole was in, when it had one: a hole
	 *  in a date column does not read like a hole in any old column. */
	| { cause: 'empty'; column: number; kind?: string };

const DEFAULT_FILLED_THRESHOLD = 0.9;
const DEFAULT_MINIMUM_ROWS = 5;

/**
 * The same threshold for every kind a caller names.
 *
 * Written out, a signature repeats `{ share: 0.6 }` once per kind and the shape
 * drowns the one number that matters. Most callers want one share for everything
 * and a special case for at most one kind:
 *
 *     thresholdsFor(['date', 'amount', 'text'], 0.6)
 *     { ...thresholdsFor(['amount', 'text'], 0.6),
 *       date: { share: 0.6, emptyIsAnomalyAbove: 0.7 } }
 */
export const thresholdsFor = (kinds: string[], share: number): Record<string, KindThreshold> =>
	Object.fromEntries(kinds.map((kind) => [kind, { share }]));

/** The share of each kind on its own, which is what `dominantKind` reads. */
export const sharesByKind = (options: SignatureOptions): Record<string, number> =>
	Object.fromEntries(
		Object.entries(options.thresholds).map(([kind, threshold]) => [kind, threshold.share])
	);

function anomalyInCell(
	cell: string,
	profile: ColumnProfile,
	kind: string | null,
	column: number,
	options: SignatureOptions,
	filledThreshold: number
): RowAnomaly | undefined {
	if (kind !== null) {
		if (cell !== '' && options.kindOf(cell) !== kind) {
			return { cause: 'wrong-kind', column, expected: kind };
		}
		const emptyAbove = options.thresholds[kind].emptyIsAnomalyAbove;
		if (cell === '' && emptyAbove !== undefined && profile.shareFilled >= emptyAbove) {
			return { cause: 'empty', column, kind };
		}
	}
	if (cell === '' && profile.shareFilled >= filledThreshold) return { cause: 'empty', column };
	return undefined;
}

/**
 * How each row departs from the table's signature, or `undefined` where it
 * holds. Returns `null` when there are too few rows to learn: it is the
 * caller's call what to do with a table that short, and saying nothing beats
 * learning from a sample that teaches nothing.
 *
 * `judgedColumns` narrows the judgement to the columns whose role is known. A
 * column whose content is a mystery may not condemn anyone.
 */
export function findRowAnomalies(
	rows: string[][],
	options: SignatureOptions,
	judgedColumns?: (column: number) => boolean
): (RowAnomaly | undefined)[] | null {
	if (rows.length < (options.minimumRows ?? DEFAULT_MINIMUM_ROWS)) return null;

	const profiles = profileColumns(rows, options);
	const shares = sharesByKind(options);
	const kinds = profiles.map((profile) => dominantKind(profile, shares));
	const filledThreshold = options.filledThreshold ?? DEFAULT_FILLED_THRESHOLD;
	const columns = columnCount(rows);

	return rows.map((row) => {
		for (let column = 0; column < columns; column++) {
			if (judgedColumns && !judgedColumns(column)) continue;
			const anomaly = anomalyInCell(
				cellAt(row, column),
				profiles[column],
				kinds[column],
				column,
				options,
				filledThreshold
			);
			if (anomaly) return anomaly;
		}
		return undefined;
	});
}
