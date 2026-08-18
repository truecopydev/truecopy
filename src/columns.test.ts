import { describe, expect, it } from 'vitest';
import { cellAt, columnCount, dominantKind, profileColumns } from './columns.js';
import { assignRoles, type RoleRule } from './roles.js';

const IS_DATE = /^\d{2}\/\d{2}(?:\/\d{4})?$/;
const IS_AMOUNT = /^-?\d+(?:[ .]\d{3})*,\d{2}$/;

function kindOf(cell: string): string | null {
	if (IS_DATE.test(cell)) return 'date';
	if (IS_AMOUNT.test(cell)) return 'amount';
	return /\p{L}{3,}/u.test(cell) ? 'text' : null;
}

const OPERATIONS = [
	['15/01', 'PRLV ASSURANCE', '', '58,49'],
	['24/01', 'VIR PAULINE', '45,00', ''],
	['27/02', 'CB CARREFOUR', '', '115,00'],
	['03/03', 'LOYER MARS', '', '1 250,00'],
	['12/03', 'SALAIRE', '3 200,00', '']
];

describe('reading a row', () => {
	it('trims, and treats a missing cell as an empty one', () => {
		expect(cellAt(['  a  '], 0)).toBe('a');
		expect(cellAt(['a'], 3)).toBe('');
	});

	it('counts the widest row as the number of columns', () => {
		expect(columnCount([['a'], ['a', 'b', 'c']])).toBe(3);
		expect(columnCount([])).toBe(0);
	});
});

describe('profileColumns', () => {
	const profiles = profileColumns(OPERATIONS, { kindOf });

	it('gives the share of each kind, over ALL rows', () => {
		expect(profiles[0].shareOfKind.date).toBe(1);
		expect(profiles[1].shareOfKind.text).toBe(1);
		// Two amounts out of five rows, not out of the two filled cells: a column
		// half empty is not a column of amounts, it is a mess.
		expect(profiles[2].shareOfKind.amount).toBeCloseTo(0.4);
		expect(profiles[2].shareFilled).toBeCloseTo(0.4);
	});

	it('says nothing of a kind it never saw', () => {
		expect(profiles[0].shareOfKind.amount).toBeUndefined();
	});

	it('stops sampling where it is told to', () => {
		const many = Array.from({ length: 500 }, (_, i) => [i < 3 ? '15/01' : 'texte long']);
		expect(profileColumns(many, { kindOf, sampleLimit: 3 })[0].shareOfKind.date).toBe(1);
	});

	it('holds an empty table without dividing by nothing', () => {
		expect(profileColumns([], { kindOf })).toEqual([]);
	});

	it('holds a table of empty cells', () => {
		const profiles = profileColumns([[''], ['']], { kindOf });
		expect(profiles[0]).toEqual({ shareOfKind: {}, shareFilled: 0 });
	});

	it('keeps the strongest of two columns of the same kind', () => {
		const twoDates = profileColumns(
			[
				['PAULINE', '16/01'],
				['24/01', '25/01'],
				['27/02', '26/02']
			],
			{ kindOf }
		);
		expect(dominantKind(twoDates[1], { date: 0.5 })).toBe('date');
		expect(
			assignRoles(twoDates, [{ role: 'date', kind: 'date', minimum: 0.5, take: 'best' }])
		).toEqual([undefined, 'date']);
	});
});

describe('dominantKind', () => {
	const profiles = profileColumns(OPERATIONS, { kindOf });

	it('names the kind that clears its own threshold', () => {
		expect(dominantKind(profiles[0], { date: 0.5 })).toBe('date');
	});

	it('names none when the share falls short', () => {
		expect(dominantKind(profiles[2], { amount: 0.7 })).toBeNull();
	});

	it('ignores a kind no threshold speaks of', () => {
		expect(dominantKind(profiles[1], { date: 0.5 })).toBeNull();
	});

	it('keeps the strongest when two clear their thresholds, whichever comes first', () => {
		const weakestFirst = { shareOfKind: { date: 0.6, text: 0.9 }, shareFilled: 1 };
		expect(dominantKind(weakestFirst, { date: 0.5, text: 0.5 })).toBe('text');
		const strongestFirst = { shareOfKind: { text: 0.9, date: 0.6 }, shareFilled: 1 };
		expect(dominantKind(strongestFirst, { date: 0.5, text: 0.5 })).toBe('text');
	});
});

/*
 * A column's role from its content. The roles are the caller's; the library has
 * never heard of a debit. What it provides is the pattern: order the rules, and
 * a column already named is out of the running for what comes next.
 */
describe('assignRoles', () => {
	const profiles = profileColumns(OPERATIONS, { kindOf });
	const RULES: RoleRule<'date' | 'money' | 'description'>[] = [
		{ role: 'date', kind: 'date', minimum: 0.5, take: 'best' },
		{ role: 'money', kind: 'amount', minimum: 0.3, take: 'each' },
		{ role: 'description', kind: 'text', minimum: 0.4, take: 'best' }
	];

	it('deduces every role from what the columns contain', () => {
		expect(assignRoles(profiles, RULES)).toEqual(['date', 'description', 'money', 'money']);
	});

	it('leaves a column undefined rather than inventing a role for it', () => {
		const rules: RoleRule<'date'>[] = [{ role: 'date', kind: 'date', minimum: 0.5, take: 'best' }];
		expect(assignRoles(profiles, rules)).toEqual(['date', undefined, undefined, undefined]);
	});

	it('takes a single best column and leaves its runner-up alone', () => {
		const twoDates = profileColumns(
			[
				['15/01', '16/01'],
				['24/01', '25/01'],
				['27/02', 'PAULINE']
			],
			{ kindOf }
		);
		const rules: RoleRule<'date'>[] = [{ role: 'date', kind: 'date', minimum: 0.5, take: 'best' }];
		expect(assignRoles(twoDates, rules)).toEqual(['date', undefined]);
	});

	it('passes over a rule no column earns', () => {
		const rules: RoleRule<'balance'>[] = [
			{ role: 'balance', kind: 'amount', minimum: 0.99, take: 'best' }
		];
		expect(assignRoles(profiles, rules)).toEqual([undefined, undefined, undefined, undefined]);
	});
});

describe('the share, taken out of the rows or out of the filled cells', () => {
	/*
	 * The two answers are not interchangeable, and the measurement says so: on a
	 * real bank statement the date column was filled on 26 rows out of 60, of which
	 * 16 were dates. That is 0.27 out of the rows and 0.62 out of the cells that
	 * exist. At a threshold of a half, the first answer loses the column.
	 *
	 * A statement leaves the date empty on every continuation line of a description
	 * that wrapped, and that column is still the date column.
	 */
	const rows = [
		['02/05/2026', 'CARTE AMAZON'],
		['', 'DESCRIPTION CONTINUED'],
		['03/05/2026', 'VIREMENT'],
		['', 'DESCRIPTION CONTINUED']
	];
	const kindOf = (cell: string) => (/^\d{2}\/\d{2}\/\d{4}$/.test(cell) ? 'date' : 'text');

	it('loses the column when the share is taken out of every row', () => {
		const profiles = profileColumns(rows, { kindOf });
		expect(
			assignRoles(profiles, [{ role: 'when', kind: 'date', minimum: 0.6, take: 'best' }])
		).toEqual([undefined, undefined]);
	});

	it('finds it again when the share is taken out of the cells that exist', () => {
		const profiles = profileColumns(rows, { kindOf });
		expect(
			assignRoles(profiles, [
				{ role: 'when', kind: 'date', minimum: 0.6, take: 'best', among: 'filled' }
			])
		).toEqual(['when', undefined]);
	});

	it('does not divide by a column that is entirely empty', () => {
		const withEmpty = rows.map((row) => [...row, '']);
		const profiles = profileColumns(withEmpty, { kindOf });
		expect(
			assignRoles(profiles, [
				{ role: 'when', kind: 'date', minimum: 0.6, take: 'best', among: 'filled' }
			])
		).toEqual(['when', undefined, undefined]);
	});
});
