/*
 * A column's role, deduced from what it contains.
 *
 * This is what carries a reader through a table with no header row: the columns
 * still mean something. A column full of dates is the date one, one full of
 * amounts is money, the wordy one is the description. Recognising a header label
 * only works on issuers whose labels you have already seen; reading the content
 * works on the next one.
 *
 * What is generic is the pattern, not the roles. This library has never heard of
 * a debit or a value date. A caller declares, in order:
 *
 *     role      the name it wants back
 *     kind      the cell kind that betrays it
 *     minimum   the share below which the column is not that
 *     take      which of the qualifying columns to name
 *
 * Order matters, and it is the only precedence there is: a column already named
 * is out of the running for what comes after. That is how "the wordiest column
 * among those left is the description" is stated - a rule that reads backwards
 * if the description is looked for first.
 */

import { dominantKind, type ColumnProfile } from './columns.js';

export interface RoleRule<Role extends string> {
	role: Role;
	kind: string;
	minimum: number;
	/**
	 * `best`     the single strongest column, and only it.
	 * `each`     every column that qualifies, left to right. The caller decides
	 *            what several of them mean - one money column is an amount, two
	 *            are a debit and a credit, and that is domain knowledge.
	 */
	take: 'best' | 'each';
	/**
	 * What the share is taken out of, and the two answers are not interchangeable.
	 *
	 * `rows`    out of every row. A column of dates empty on a third of them is
	 *           not a column of dates, it is a mess, and judging rows against it
	 *           would condemn the honest ones. This is what `signature` wants.
	 *
	 * `filled`  out of the cells that are actually there. A statement leaves the
	 *           date empty on every continuation line of a wrapped description,
	 *           and that column is still the date column - the question here is
	 *           not "is this column reliable" but "what is in it".
	 *
	 * Defaults to `rows`, which is the cautious one. Measured: a real statement
	 * whose date column was filled on 26 rows out of 60, of which 16 were dates,
	 * scores 0.27 out of the rows and 0.62 out of the filled ones. Past a
	 * threshold of a half, the first answer loses the column entirely.
	 */
	among?: 'rows' | 'filled';
}

/** The share a rule is judged on. `shareOfKind` is always out of every row, so
 *  dividing it by the fill rate is what turns it into a share of the cells that
 *  exist. */
function shareFor(profile: ColumnProfile, rule: RoleRule<string>): number {
	const ofRows = profile.shareOfKind[rule.kind] ?? 0;
	if (rule.among !== 'filled') return ofRows;
	return profile.shareFilled === 0 ? 0 : ofRows / profile.shareFilled;
}

/**
 * A role per column, or `undefined` where none was earned.
 *
 * `undefined` and not a filler name: a column whose role is unknown must be
 * able to say so, because every rule downstream is entitled to refuse to judge
 * on it. Naming it 'unknown' invites code to treat that as a role.
 */
export function assignRoles<Role extends string>(
	profiles: ColumnProfile[],
	rules: RoleRule<Role>[]
): (Role | undefined)[] {
	const assigned: (Role | undefined)[] = profiles.map(() => undefined);

	for (const rule of rules) {
		const candidates = profiles
			.map((profile, column) => ({ column, share: shareFor(profile, rule) }))
			.filter(({ column, share }) => assigned[column] === undefined && share >= rule.minimum);
		if (candidates.length === 0) continue;

		if (rule.take === 'each') {
			for (const { column } of candidates) assigned[column] = rule.role;
			continue;
		}
		// `best` resolves a tie on the leftmost column: a table is read left to
		// right, and so is the tie.
		const best = candidates.reduce((chosen, one) => (one.share > chosen.share ? one : chosen));
		assigned[best.column] = rule.role;
	}

	return assigned;
}

/** The kind of every column at once, for a caller that wants the raw reading
 *  rather than roles of its own. */
export const dominantKinds = (
	profiles: ColumnProfile[],
	thresholds: Record<string, number>
): (string | null)[] => profiles.map((profile) => dominantKind(profile, thresholds));
