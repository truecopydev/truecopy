import { describe, expect, it } from 'vitest';
import { describeAnomaly, explainDocument, explainRows } from './explain.js';
import { documentFrom, documentFromText, pageFrom } from './layout.js';
import type { PositionedItem } from './document.js';
import type { RoleRule } from './roles.js';
import type { SignatureOptions } from './signature.js';

/*
 * A toy table with the two things worth seeing: a row missing a cell the column
 * always has (a total line), and a row holding the wrong kind of thing (a note).
 * Both are ordinary in a real document, and both are what a person needs shown.
 */
const at = (text: string, x: number, y: number): PositionedItem => ({ text, x, y, width: 40 });

const ITEMS: PositionedItem[] = [
	at('2018', 50, 700),
	at('worked', 150, 700),
	at('4', 300, 700),
	at('2019', 50, 680),
	at('worked', 150, 680),
	at('4', 300, 680),
	at('2020', 50, 660),
	at('worked', 150, 660),
	at('4', 300, 660),
	at('2021', 50, 640),
	at('worked', 150, 640),
	at('4', 300, 640),
	at('TOTAL', 150, 620),
	at('16', 300, 620),
	at('note', 50, 600),
	at('see below', 150, 600),
	at('0', 300, 600)
];

const kindOf = (cell: string): string => {
	if (/^\d{4}$/.test(cell)) return 'year';
	if (/^\d+$/.test(cell)) return 'count';
	return 'text';
};

const SIGNATURE: SignatureOptions = {
	kindOf,
	thresholds: {
		year: { share: 0.6, emptyIsAnomalyAbove: 0.7 },
		count: { share: 0.6 },
		text: { share: 0.6 }
	}
};

const ROLES: RoleRule<string>[] = [
	{ role: 'when', kind: 'year', minimum: 0.6, take: 'best' },
	{ role: 'howMany', kind: 'count', minimum: 0.6, take: 'each' }
];

const page = pageFrom(1, 595, 842, ITEMS);
const document = documentFrom([page], 'pdf', 'career.pdf');

describe('explainDocument', () => {
	const explained = explainDocument(document, { signature: SIGNATURE, roles: ROLES });

	it('names the document and where it came from', () => {
		expect(explained).toContain('truecopy - career.pdf');
		expect(explained).toContain('pdf, 1 page(s), 6 row(s)');
	});

	it('shows the cut, which is what a wrong reading shows up in first', () => {
		expect(explained).toContain('page 1 - cut at 100, 225');
		expect(explained).toContain('3 column(s), 6 row(s)');
	});

	it('shows what each column turned out to hold, and how often it is filled', () => {
		expect(explained).toMatch(/^ +0 +year +83% +when$/m);
		expect(explained).toMatch(/^ +2 +count +100% +howMany$/m);
	});

	it('leaves a column with no role named as nothing, never as a guess', () => {
		expect(explained).toMatch(/^ +1 +text +100% +-$/m);
	});

	it('marks the row that misses a cell its column always has', () => {
		expect(explained).toContain('!');
		expect(explained).toContain('column 0 (year) is empty');
	});

	it('marks the row holding the wrong kind of thing', () => {
		expect(explained).toContain('column 0 is not year');
	});

	it('leaves the sound rows unmarked', () => {
		const first = explained.split('\n').find((line) => line.startsWith('   1 '));
		expect(first).toContain('2018');
		expect(first).not.toContain('<-');
	});

	it('shows one page when asked for one', () => {
		const two = documentFrom([page, { ...page, pageNumber: 2 }], 'pdf', 'two.pdf');
		const one = explainDocument(two, { page: 2 });
		expect(one).toContain('page 2');
		expect(one).not.toContain('page 1 -');
	});

	it("uses the reader's own cut when it has one, since that is the cut being debugged", () => {
		const whole = explainDocument(document, { cellsOf: (row) => [row.text] });
		expect(whole).toContain('1 column(s)');
	});

	it('says so when a page carries no boundary at all', () => {
		expect(explainDocument(documentFromText('one line', 'paste.txt'))).toContain('no boundary');
	});

	describe('the cut names the ruler it was measured with', () => {
		/*
		 * A list of numbers with no unit is a riddle. `cut at 1, 2` on a CSV had
		 * somebody looking for a defect that was not there - the numbers were the
		 * indices of the fields, and perfectly right.
		 */
		it('leaves points unlabelled: it is what a page has always been measured in', () => {
			expect(explainDocument(document)).toContain('cut at 100, 225');
		});

		it('says characters for a table pasted with spaces', () => {
			const paste = documentFromText('2018   4 trimestres\n2019   4 trimestres', 'colle.txt');
			expect(explainDocument(paste)).toContain('cut at characters 4');
		});

		it('names what happened on a delimited file, where the numbers say nothing', () => {
			// The columns are the fields there, so their indices tell a reader
			// nothing they did not already know.
			const csv = documentFromText('a,b,c\nd,e,f', 'x.csv');
			expect(explainDocument(csv)).toContain('cut on the delimiter');
		});
	});
});

describe('explainRows, for rows that never came from a page', () => {
	const rows = [
		['2018', 'worked', '4'],
		['2019', 'worked', '4'],
		['2020', 'worked', '4']
	];

	it('shows the cut and the fill rates without being told any kind', () => {
		const explained = explainRows(rows);
		expect(explained).toContain('3 column(s), 3 row(s)');
		// No kind named, so none is claimed - and no row is judged.
		expect(explained).toMatch(/^ +0 +- +100% +-$/m);
		expect(explained).not.toContain('<-');
	});

	it('cuts a cell too wide to fit, and says it cut it', () => {
		expect(explainRows([['a long cell indeed']], { cellWidth: 6 })).toContain('a lon>');
	});

	it('counts the rows it did not print rather than leaving them unmentioned', () => {
		expect(explainRows(rows, { maximumRows: 1 })).toContain('... 2 more row(s)');
	});
});

describe('describeAnomaly', () => {
	it('says which column held the wrong kind', () => {
		expect(describeAnomaly({ cause: 'wrong-kind', column: 2, expected: 'amount' })).toBe(
			'column 2 is not amount'
		);
	});

	it('says which kind of column the hole was in, when the column had one', () => {
		expect(describeAnomaly({ cause: 'empty', column: 0, kind: 'date' })).toBe(
			'column 0 (date) is empty'
		);
	});

	it('says only that it is empty when the column has no kind of its own', () => {
		expect(describeAnomaly({ cause: 'empty', column: 3 })).toBe('column 3 is empty');
	});
});
