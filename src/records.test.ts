import { describe, expect, it } from 'vitest';
import { recordsFrom, spineWidthOf } from './records.js';

/*
 * The shape every case here is built from, and it is the real one: a property
 * schedule prints the street above the figures and the postcode below, both in
 * the column the figures leave empty.
 */
const record = (street: string, postcode: string): string[][] => [
	[street, '', '', '', ''],
	['', '07/12/1978', '677', 'Commerce', '791 706'],
	[postcode, '', '', '', '']
];

describe('spineWidthOf', () => {
	it('measures the widest row, less the one cell a record may leave empty', () => {
		// Exactly the maximum would reject half the real records: a schedule
		// prints a zero as a blank, so a complete row is one cell short.
		expect(spineWidthOf([['a', 'b', 'c', 'd'], ['a', 'b', 'c'], ['a']])).toBe(3);
	});

	it('never falls below one, whatever it is handed', () => {
		expect(spineWidthOf([])).toBe(1);
		expect(spineWidthOf([['only']])).toBe(1);
	});

	it('counts filled cells, not the length of the row', () => {
		// A row cut into eight columns that fills two is two cells wide. Counting
		// the array would make every row of a wide table look complete.
		expect(
			spineWidthOf([
				['a', '', '', 'b'],
				['a', '   ', '', '']
			])
		).toBe(1);
	});
});

describe('recordsFrom', () => {
	it('joins the rows printed around a spine into one record', () => {
		const rows = [...record('18 Rue Lecourbe -', '75015 PARIS')];
		const { records, loose, findings } = recordsFrom(rows);
		expect(records).toEqual([{ spine: 1, rows: [0, 1, 2] }]);
		expect(loose).toEqual([]);
		expect(findings).toEqual([]);
	});

	it('keeps consecutive records apart', () => {
		const rows = [
			...record('18 Rue Lecourbe -', '75015 PARIS'),
			...record('25 rue Chateaubriand -', '75008 PARIS')
		];
		const { records, loose } = recordsFrom(rows);
		expect(records.map((one) => one.rows)).toEqual([
			[0, 1, 2],
			[3, 4, 5]
		]);
		expect(loose).toEqual([]);
	});

	it('refuses a fragment that fills a column the spine already fills', () => {
		/*
		 * The whole point, and a count cannot see it. A page header sits one row
		 * from a spine, so any rule built on proximity takes it; it fills the
		 * label column that the spine fills too, so compatibility refuses it.
		 * Measured on a real amortisation schedule: twenty-three furniture rows
		 * swallowed into records by proximity, none by this.
		 */
		const rows = [
			['Page 2 of 5', '', '', 'PRINTED 01/01', ''],
			['', '07/12/1978', '677', 'Commerce', '791 706'],
			['75015 PARIS', '', '', '', '']
		];
		const { records, loose } = recordsFrom(rows);
		expect(records).toEqual([{ spine: 1, rows: [1, 2] }]);
		expect(loose).toEqual([0]);
	});

	it('stops at the first row that does not fit, rather than reaching over it', () => {
		// Skipping a row would let a record reach over something belonging to its
		// neighbour, which is how an address ends up on the wrong building.
		const rows = [
			['75008 PARIS', '', '', '', ''],
			['', '', '', 'A NOTE', ''],
			['', '07/12/1978', '677', 'Commerce', '791 706']
		];
		const { records, loose } = recordsFrom(rows);
		expect(records).toEqual([{ spine: 2, rows: [2] }]);
		expect(loose).toEqual([0, 1]);
	});

	it('gives a fragment caught between two spines to the one above', () => {
		// A genuine tie: row 1 is one row from both spines and fits beside both.
		// The rule has to say which, or the answer depends on whichever loop ran
		// last. Above, because a record is printed under its own opening line
		// more often than over the next one.
		const rows = [
			['', '07/12/1978', '677', 'Commerce', '791 706'],
			['75015 PARIS', '', '', '', ''],
			['', '15/02/1979', '899', 'Bureau', '7 130 526']
		];
		const { records } = recordsFrom(rows);
		expect(records.map((one) => one.rows)).toEqual([[0, 1], [2]]);
	});

	it('gives a fragment to the nearer spine, not the earlier one', () => {
		/*
		 * The case that cost a whole record before it was measured. Row 3 fits
		 * beside both spines, and the one printed first is two rows away: a rule
		 * that walked down from a spine taking everything that fits reached
		 * straight into the next record, because the postcode of one building and
		 * the street of the next are both one cell in the same column.
		 */
		const rows = [
			['', '07/12/1978', '677', 'Commerce', '791 706'],
			['75015 PARIS', '', '', '', ''],
			['', '', '', '', ''],
			['25 rue Chateaubriand -', '', '', '', ''],
			['', '15/02/1979', '899', 'Bureau', '7 130 526']
		];
		const { records, loose } = recordsFrom(rows);
		expect(records.map((one) => one.rows)).toEqual([
			[0, 1],
			[3, 4]
		]);
		expect(loose).toEqual([2]);
	});

	it('honours a spine width the caller measured itself', () => {
		// The document may say what the library had to guess, and passing it is
		// honest where tuning a hidden default would not be.
		const rows = [
			['a', 'b', 'c', 'd'],
			['e', '', '', ''],
			['f', 'g', '', '']
		];
		expect(recordsFrom(rows, { spineWidth: 4 }).records.map((one) => one.spine)).toEqual([0]);
		expect(recordsFrom(rows, { spineWidth: 2 }).records.map((one) => one.spine)).toEqual([0, 2]);
	});

	it('honours a reach the caller narrows', () => {
		const rows = [...record('18 Rue Lecourbe -', '75015 PARIS')];
		const near = recordsFrom(rows, { reach: 1 });
		expect(near.records).toEqual([{ spine: 1, rows: [0, 1, 2] }]);
		const none = recordsFrom(rows, { reach: 0 });
		expect(none.records).toEqual([{ spine: 1, rows: [1] }]);
		expect(none.loose).toEqual([0, 2]);
	});

	it('returns every row on its own when nothing reaches the full width', () => {
		// An empty result would be a reading that lost the document. One record
		// per row is what a table of one column IS.
		const { records, loose, findings } = recordsFrom([[''], ['']]);
		expect(records).toEqual([
			{ spine: 0, rows: [0] },
			{ spine: 1, rows: [1] }
		]);
		expect(loose).toEqual([]);
		expect(findings.map((one) => one.code)).toEqual(['no-spine']);
		expect(findings[0]?.spineWidth).toBe(1);
	});

	it('says nothing at all about no rows, and loses nothing', () => {
		expect(recordsFrom([])).toEqual({ records: [], loose: [], findings: [] });
	});

	it('says when the spine is not sharp instead of picking a side', () => {
		/*
		 * The limit that the corpus measured and that no threshold removes: a
		 * record leaving one column empty is exactly as wide as a rich fragment.
		 * 61 records at one threshold, 71 at the next, and the judged answer is
		 * 65 - unreachable from either side. Saying so is the answer; tuning
		 * until one document lands would be per-issuer configuration.
		 */
		const full = ['a', 'b', 'c', 'd'];
		const nearMiss = ['a', 'b', 'c', ''];
		const rows = [full, nearMiss, nearMiss, full, nearMiss];
		const { findings } = recordsFrom(rows, { spineWidth: 4 });
		expect(findings.map((one) => one.code)).toEqual(['spine-not-sharp']);
		expect(findings[0]?.nearMisses).toBe(3);
		expect(findings[0]?.spineWidth).toBe(4);
		expect(findings[0]?.message).toMatch(/spineWidth/);
	});

	it('every row comes back, in a record or in loose', () => {
		// The invariant that matters more than any placement: a mechanism may be
		// wrong about where a fragment belongs, never silent about a row.
		const rows = [
			['cover text', '', '', '', ''],
			['more cover', '', '', '', ''],
			['', '07/12/1978', '677', 'Commerce', '791 706'],
			['75015 PARIS', '', '', '', ''],
			['a footer', '', '', '', '']
		];
		const { records, loose } = recordsFrom(rows);
		const seen = [...records.flatMap((one) => one.rows), ...loose].sort((a, b) => a - b);
		expect(seen).toEqual([0, 1, 2, 3, 4]);
	});
});
