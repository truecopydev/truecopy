/*
 * What each column contains, counted.
 *
 * One pass, two uses: `roles` infers what a column is from its content, and
 * `signature` learns the type of the table to drop the rows that break it. Both
 * start by counting the same thing.
 *
 * The library knows neither dates nor amounts. The caller names the kind of a
 * cell; this file only counts, divides and compares.
 */

export interface ColumnProfile {
	/** Share of all rows whose cell in this column is of that kind. */
	shareOfKind: Record<string, number>;
	/** Share of all rows whose cell in this column is not empty. */
	shareFilled: number;
}

export interface ProfileOptions {
	/**
	 * The kind of a cell, or null when it is none of them.
	 *
	 * The caller names it in its own words - 'date', 'amount', 'text'. A plain
	 * string, deliberately: an enum here would mean this library had an opinion on
	 * what documents contain, and it has none.
	 */
	kindOf: (cell: string) => string | null;
	/**
	 * Stop after this many rows. A table describes itself in its first rows;
	 * reading ten thousand to learn what sixty already said is time the person
	 * spends watching a spinner.
	 */
	sampleLimit?: number;
}

const DEFAULT_SAMPLE_LIMIT = 200;

/** One cell, trimmed, and empty rather than undefined past the end of the row.
 *
 *  `readonly` on the row so the newer mechanisms can call it: they take
 *  `readonly (readonly string[])[]`, and a signature that only accepts a mutable
 *  array made each of them re-derive this one line. Strictly wider - it accepts
 *  what it accepted before and returns the same. */
export const cellAt = (row: readonly string[], column: number): string =>
	(row[column] ?? '').trim();

export const columnCount = (rows: string[][]): number =>
	rows.reduce((widest, row) => Math.max(widest, row.length), 0);

/** The share of each kind, and of filled cells, for every column. */
export function profileColumns(rows: string[][], options: ProfileOptions): ColumnProfile[] {
	const sampled = rows.slice(0, options.sampleLimit ?? DEFAULT_SAMPLE_LIMIT);
	const total = sampled.length;
	const profiles: ColumnProfile[] = [];

	for (let column = 0; column < columnCount(sampled); column++) {
		const seen = new Map<string, number>();
		let filled = 0;
		for (const row of sampled) {
			const cell = cellAt(row, column);
			if (cell === '') continue;
			filled++;
			const kind = options.kindOf(cell);
			if (kind !== null) seen.set(kind, (seen.get(kind) ?? 0) + 1);
		}
		const shareOfKind: Record<string, number> = {};
		/*
		 * Divided by all rows and not by the filled ones: a column of dates with a
		 * third of its cells empty is not a column of dates, it is a mess, and
		 * judging rows against it would condemn the honest ones.
		 *
		 * `total` is never zero here: a column only exists when a row does.
		 */
		for (const [kind, count] of seen) shareOfKind[kind] = count / total;
		profiles.push({ shareOfKind, shareFilled: filled / total });
	}

	return profiles;
}

/** The kind a column is made of, given a threshold per kind. Null when none
 *  reaches its own. */
export function dominantKind(
	profile: ColumnProfile,
	thresholds: Record<string, number>
): string | null {
	let dominant: string | null = null;
	let best = 0;
	for (const [kind, share] of Object.entries(profile.shareOfKind)) {
		const threshold = thresholds[kind];
		if (threshold === undefined || share < threshold) continue;
		if (share > best) {
			best = share;
			dominant = kind;
		}
	}
	return dominant;
}
