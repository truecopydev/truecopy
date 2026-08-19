import { describe, expect, it } from 'vitest';
import {
	boundariesFromAnchors,
	boundariesFromRecurrence,
	cellsOf,
	columnAt,
	columnBoundaries,
	documentFrom,
	documentFromText,
	pageFrom,
	placeOf,
	placesOf,
	rowToCells,
	rowsFrom
} from './layout.js';
import type { PositionedItem } from './document.js';

const item = (text: string, x: number, y: number, width = text.length * 5): PositionedItem => ({
	text,
	x,
	y,
	width
});

describe('columns', () => {
	it('finds no boundary on an empty page', () => {
		expect(columnBoundaries([])).toEqual([]);
		expect(columnBoundaries([item('   ', 10, 10)])).toEqual([]);
	});

	it('opens a column where the spread of x leaves a gap', () => {
		expect(columnBoundaries([item('a', 50, 700), item('b', 52, 680), item('c', 300, 700)])).toEqual(
			[176]
		);
	});

	it('cuts halfway between anchors the caller already trusts', () => {
		// A header row gives the x of each label; the cut goes between them.
		expect(boundariesFromAnchors([50, 150, 300])).toEqual([100, 225]);
		// Out of order, because a header row is read left to right on the page and
		// not always in the order the engine hands the items over.
		expect(boundariesFromAnchors([300, 50, 150])).toEqual([100, 225]);
	});

	it('cuts nowhere when there is nothing to cut between', () => {
		expect(boundariesFromAnchors([])).toEqual([]);
		expect(boundariesFromAnchors([120])).toEqual([]);
	});

	it('cuts a whole page into cells', () => {
		const page = pageFrom(1, 595, 842, [
			item('2018', 50, 700),
			item('worked', 150, 700),
			item('2019', 50, 680),
			item('worked', 150, 680)
		]);
		expect(cellsOf(page)).toEqual([
			['2018', 'worked'],
			['2019', 'worked']
		]);
	});

	it("cuts against the reader's own boundaries when it has some", () => {
		const page = pageFrom(1, 595, 842, [item('2018', 50, 700), item('worked', 150, 700)]);
		// One boundary opens two columns, and it sits past everything on the page:
		// the whole row lands in the first, and the second is empty rather than
		// absent - a cell a reader asked for exists, even when nothing fell in it.
		expect(cellsOf(page, [900])).toEqual([['2018 worked', '']]);
	});

	it('places an x in its column', () => {
		expect(columnAt(10, [100, 200])).toBe(0);
		expect(columnAt(150, [100, 200])).toBe(1);
		expect(columnAt(900, [100, 200])).toBe(2);
	});
});

describe('rows', () => {
	it('groups by baseline, top of the page first', () => {
		const rows = rowsFrom([item('lower', 50, 600), item('upper', 50, 700)], []);
		expect(rows.map((row) => row.text)).toEqual(['upper', 'lower']);
	});

	it('tolerates the slight drift of one printed row', () => {
		expect(rowsFrom([item('A', 50, 700), item('B', 200, 701.4)], [])).toHaveLength(1);
	});

	it('drops the blank items a PDF sows between cells', () => {
		const page = pageFrom(1, 595, 842, [
			item('2019', 50, 700),
			item('  ', 120, 700),
			item('4', 400, 700)
		]);
		expect(page.rows[0].text).toBe('2019\t4');
	});

	it('separates two columns, and does not separate two halves of one cell', () => {
		// The two opposite traps, held together. "2013" and "0 trim." are two
		// columns whose items happen to touch on this row; "28" and "500" are one
		// amount cut in two.
		const page = pageFrom(1, 595, 842, [
			item('2013', 50, 700, 20),
			item('0 trim.', 70, 700, 30),
			item('28', 300, 700, 10),
			item('500', 311, 700, 15),
			item('2014', 50, 680, 20),
			item('4 trim.', 120, 680, 30),
			item('27', 300, 680, 10),
			item('800', 311, 680, 15)
		]);
		expect(page.rows.map((row) => row.text)).toEqual([
			'2013\t0 trim.\t28500',
			'2014\t4 trim.\t27800'
		]);
	});

	it('cuts a row against boundaries it is given', () => {
		const page = pageFrom(1, 595, 842, [item('2019', 50, 700), item('4', 400, 700)]);
		expect(rowToCells(page.rows[0], [200])).toEqual(['2019', '4']);
	});

	it('assembles a document from its pages', () => {
		const page = pageFrom(1, 595, 842, [item('one row', 50, 700)]);
		expect(documentFrom([page], 'pdf', 'x.pdf')).toMatchObject({
			text: 'one row',
			origin: 'pdf'
		});
	});

	it('makes a document of plain text: one page, one row per line', () => {
		const document = documentFromText('a\nb', 'paste.txt');
		// A paste was never paginated. One page per line would announce
		// "19 page(s)" of a nineteen-line file and make every per-page count
		// meaningless.
		expect(document.pages).toHaveLength(1);
		expect(document.pages[0].rows.map((row) => row.text)).toEqual(['a', 'b']);
	});

	it('does not make a row out of a blank line', () => {
		// Kept, they would count in every denominator and drag a column's fill
		// rate under the threshold that says a cut invented it.
		const document = documentFromText('a\n\n   \nb\n', 'paste.txt');
		expect(document.pages[0].rows.map((row) => row.text)).toEqual(['a', 'b']);
	});

	it('orders the rows of a paste the way a page orders its own', () => {
		const document = documentFromText('first\nsecond', 'paste.txt');
		const [first, second] = document.pages[0].rows;
		expect(first.y).toBeGreaterThan(second.y);
	});

	it('cuts a pasted table by the character its columns start at', () => {
		/*
		 * The same engine that reads a page. A pasted table lines its columns up
		 * with spaces, so the character a field starts at is a left edge exactly
		 * as a PDF's x is - and the cut votes on the left edges that come back,
		 * whichever ruler measured them.
		 */
		const document = documentFromText(
			['2018   4 trimestres   28 500,00', '2019   4 trimestres   29 100,00'].join('\n'),
			'colle.txt'
		);
		const page = document.pages[0];
		expect(page.rows[0].items.map((item) => [item.text, item.x])).toEqual([
			['2018', 0],
			['4 trimestres', 7],
			['28 500,00', 22]
		]);
		expect(rowToCells(page.rows[0], page.columnBoundaries)).toEqual([
			'2018',
			'4 trimestres',
			'28 500,00'
		]);
	});

	it('keeps a single space inside a field', () => {
		// `28 500,00` and `VIR SEPA LOYER` are one value each. Splitting on any
		// whitespace would turn one amount into two numbers.
		const [row] = documentFromText('VIR SEPA LOYER  750,00', 'x.txt').pages[0].rows;
		expect(row.items.map((item) => item.text)).toEqual(['VIR SEPA LOYER', '750,00']);
	});

	it('treats a tab as a separator too', () => {
		const [row] = documentFromText('a\tb\tc', 'x.txt').pages[0].rows;
		expect(row.items.map((item) => item.text)).toEqual(['a', 'b', 'c']);
	});

	it('finds no column in a line that lines nothing up', () => {
		// Prose is one field. The row comes back whole, and the reading says so
		// rather than inventing a column.
		const document = documentFromText('a sentence, with commas, and no columns', 'x.txt');
		expect(document.pages[0].columnBoundaries).toEqual([]);
		expect(document.pages[0].rows[0].items).toHaveLength(1);
	});

	it('ignores the indentation a line starts with', () => {
		const [row] = documentFromText('    2018   4', 'x.txt').pages[0].rows;
		expect(row.items.map((item) => [item.text, item.x])).toEqual([
			['2018', 4],
			['4', 11]
		]);
	});

	describe('a file written with a delimiter', () => {
		const cells = (text: string) => {
			const page = documentFromText(text, 'x.csv').pages[0];
			return page.rows.map((row) => rowToCells(row, page.columnBoundaries));
		};

		it('cuts a CSV on the grid its delimiter implies', () => {
			// x is the field's index: a CSV lines nothing up, so the character a
			// field starts at says nothing about which column it is in.
			expect(cells('date,libelle,montant\n02/05/2026,CARTE AMAZON,12.40')).toEqual([
				['date', 'libelle', 'montant'],
				['02/05/2026', 'CARTE AMAZON', '12.40']
			]);
		});

		it('reads a semicolon and a pipe as well', () => {
			expect(cells('a;b\nc;d')).toEqual([
				['a', 'b'],
				['c', 'd']
			]);
			expect(cells('a|b\nc|d')).toEqual([
				['a', 'b'],
				['c', 'd']
			]);
		});

		it('leaves an empty field empty without losing the column', () => {
			expect(cells('a,b,c\n,b,c')).toEqual([
				['a', 'b', 'c'],
				['', 'b', 'c']
			]);
		});

		it('does not call an aligned paste a CSV because its amounts hold commas', () => {
			/*
			 * The trap this rule exists for. Every French amount holds a comma, so
			 * counting commas finds exactly one on every line of this paste - and
			 * cutting on it would turn 12,40 into two columns.
			 */
			expect(
				cells('02/05/2026   CARTE AMAZON     12,40\n03/05/2026   VIR SEPA         750,00')
			).toEqual([
				['02/05/2026', 'CARTE AMAZON', '12,40'],
				['03/05/2026', 'VIR SEPA', '750,00']
			]);
		});

		it('lets a tab override alignment, because a tab is never punctuation', () => {
			// Two spaces inside a field would have opened a column had this been
			// read as aligned. The tab says otherwise, and wins.
			expect(cells('a  b\tc\nd  e\tf')).toEqual([
				['a b', 'c'],
				['d e', 'f']
			]);
		});

		it('refuses to split a file that quotes its fields', () => {
			/*
			 * A quoted field may hold the delimiter itself, and splitting anyway
			 * shifts every column after it. Half-parsing a quoted CSV is the
			 * plausible-but-wrong reading this library exists to prevent.
			 */
			expect(cells('nom,note\n"Durand, Jean",12')).toEqual([['nom,note'], ['"Durand, Jean",12']]);
		});

		it('does not take one line for a pattern', () => {
			expect(cells('a,b,c')).toEqual([['a,b,c']]);
		});

		it('does not take a delimiter whose count changes from line to line', () => {
			// What makes a delimiter real is what makes a column real: it recurs,
			// the same number of times, line after line.
			expect(cells('a,b\nc,d,e\nf\ng,h,i,j')).toEqual([['a,b'], ['c,d,e'], ['f'], ['g,h,i,j']]);
		});
	});

	it('gives back a row that has no geometry rather than an empty cell', () => {
		/*
		 * Cut by x, a row with no positioned items would come back as one empty
		 * cell per line: not uncut - empty. That is a table of the right shape
		 * holding nothing, the one outcome this library exists to prevent.
		 */
		const row = { y: 0, items: [], text: 'date,libelle,montant' };
		expect(rowToCells(row, [])).toEqual(['date,libelle,montant']);
		// And the width contract holds: as many cells as the cut asks for.
		expect(rowToCells(row, [100, 200])).toEqual(['date,libelle,montant', '', '']);
	});
});

describe('where a reading came from', () => {
	/*
	 * A value that cannot be pointed at cannot be checked. Handed a list of
	 * figures, a person has to hunt through the document again; handed a place,
	 * they jump to it - and that difference is what makes a correction screen
	 * usable or abandoned.
	 */
	const page = pageFrom(1, 595, 842, [
		item('02/05/2026', 50, 700, 60),
		item('CARTE AMAZON', 150, 700, 90),
		item('12,40', 430, 700, 30),
		item('03/05/2026', 50, 680, 60),
		item('VIR LOYER', 150, 680, 70),
		item('750,00', 430, 680, 35)
	]);

	it('places a group of items from its leftmost edge to its rightmost', () => {
		expect(placeOf(page.rows[0].items, 1)).toEqual({ page: 1, x: 50, y: 700, width: 410 });
	});

	it('has no place for no items, rather than a rectangle of nothing', () => {
		expect(placeOf([], 1)).toBeNull();
	});

	it('lays places out exactly like the cells, so the two are read together', () => {
		const cells = cellsOf(page);
		const places = placesOf(page);
		expect(places).toHaveLength(cells.length);
		expect(places[0]).toHaveLength(cells[0].length);
		// cells[0][2] is the amount; places[0][2] is where to find it.
		expect(cells[0][2]).toBe('12,40');
		expect(places[0][2]).toEqual({ page: 1, x: 430, y: 700, width: 30 });
	});

	it('says null for a cell nothing fell into', () => {
		const sparse = pageFrom(1, 595, 842, [item('alone', 50, 700, 40), item('far', 430, 680, 20)]);
		const places = placesOf(sparse);
		// The second row has nothing in the first column, and no place for it.
		expect(places[1][0]).toBeNull();
		expect(places[1][1]).not.toBeNull();
	});

	it("cuts places against the reader's own boundaries, like the cells do", () => {
		expect(placesOf(page, [300])[0]).toHaveLength(2);
	});
});

describe('the cut that keeps what comes back', () => {
	/*
	 * The spread of x over a whole page counts the letterhead, the address block
	 * and every word inside a description. Measured on a real statement, that
	 * proposes twelve columns where the table has five.
	 *
	 * What separates a column from furniture needs no knowledge of the document:
	 * a real column's left edge recurs.
	 */
	const table = (lines: [string, string, string][], top = 700) =>
		lines.flatMap(([a, b, c], i) => [
			item(a, 50, top - i * 20, 40),
			item(b, 150, top - i * 20, 60),
			item(c, 400, top - i * 20, 30)
		]);

	const LINES: [string, string, string][] = [
		['02/05', 'AMAZON', '12,40'],
		['03/05', 'LOYER', '750,00'],
		['05/05', 'SNCF', '68,00'],
		['09/05', 'EDF', '91,32'],
		['12/05', 'SALAIRE', '2400,00'],
		['15/05', 'BOULANGER', '7,90']
	];

	it('keeps the three columns of a clean table', () => {
		const page = pageFrom(1, 595, 842, table(LINES));
		expect(boundariesFromRecurrence(page.rows)).toHaveLength(2);
	});

	it('drops a band that appears once in the middle of the table', () => {
		// A label that drifted into the gap between two columns. The page-wide
		// spread would make a column of it; recurrence will not.
		const page = pageFrom(1, 595, 842, [...table(LINES), item('note', 250, 620, 30)]);
		const spread = page.columnBoundaries;
		const recurring = boundariesFromRecurrence(page.rows);
		expect(spread.length).toBeGreaterThan(recurring.length);
		expect(recurring).toHaveLength(2);
	});

	it('keeps a band that appears once at the edge, because a rare column is real', () => {
		// One credit on a statement of debits lives to the right of everything and
		// is a column; a lone x in the middle is a label.
		const page = pageFrom(1, 595, 842, [...table(LINES), item('2400,00', 520, 620, 30)]);
		expect(boundariesFromRecurrence(page.rows)).toHaveLength(3);
	});

	it('cuts nothing out of nothing', () => {
		expect(boundariesFromRecurrence([])).toEqual([]);
		expect(boundariesFromRecurrence(pageFrom(1, 595, 842, []).rows)).toEqual([]);
	});

	/*
	 * A COLUMN OF FIGURES IS SET FLUSH RIGHT, and its left edge never recurs: it
	 * moves with the digit count. Two such columns fall into ONE band as soon as
	 * the widest value of the second reaches back towards the first, and nothing
	 * in the left edges tells them apart afterwards. Measured on page 27 of a
	 * real property schedule, 72 rows: the right edges of its five figure columns
	 * come back on 62 to 65 rows each while the left edges of the same columns
	 * scatter over seven bands, none reaching 31. A surface and a price landed in
	 * one cell on 126 of that document's 233 rows.
	 */
	const FIGURES: [string, number, string, number][] = [
		['167', 20, '2 076 683', 78],
		['93', 15, '580 000', 60],
		['1157', 20, '1 520 000', 45],
		['12', 12, '2 160 000', 35],
		['82', 12, '1 222 929', 30]
	];

	const welded = FIGURES.flatMap(([surface, large, prix, largePrix], i) => [
		item('LABEL', 50, 700 - i * 20, 60),
		item(surface, 400 - large, 700 - i * 20, large),
		item(prix, 480 - largePrix, 700 - i * 20, largePrix)
	]);

	it('splits two flush-right columns that one wide value welded together', () => {
		const page = pageFrom(1, 595, 842, welded);
		const cut = boundariesFromRecurrence(page.rows);
		const cells = page.rows.map((row) => rowToCells(row, cut));
		expect(cells[0]).toEqual(['LABEL', '167', '2 076 683']);
		expect(cells.every((row) => row.length === 3)).toBe(true);
	});

	it('splits nothing when the ends of a column do not recur', () => {
		// A column of text ends at a different x on every row. There is no edge
		// that comes back, so there is nothing to cut on - which is the whole
		// reason the left edge was read alone for so long.
		const largeurs = [10, 30, 50, 70, 90];
		const page = pageFrom(
			1,
			595,
			842,
			largeurs.flatMap((large, i) => [
				item('TEXTE', 380, 700 - i * 20, large),
				item('1 000', 500 - (30 + i * 10), 700 - i * 20, 30 + i * 10)
			])
		);
		// The one boundary left is the left edges' own, between the two columns.
		expect(boundariesFromRecurrence(page.rows)).toEqual([405]);
	});

	it('cuts nothing where a row prints across the cut', () => {
		// Three section lines span both figure columns, exactly as a sub-total
		// does. A gutter that three rows out of eight walk through is not a
		// gutter.
		const page = pageFrom(1, 595, 842, [
			...welded,
			...[0, 1, 2].map((i) => item('Sous-total du secteur', 380, 600 - i * 20, 70))
		]);
		// Only the boundary the left edges already gave, in front of the figures.
		expect(boundariesFromRecurrence(page.rows)).toEqual([215]);
	});

	it('cuts nothing in front of a lone value', () => {
		// One row carries a figure to the right of the column; the others carry
		// nothing there. A value is not a column, so there is nothing to bound.
		const page = pageFrom(1, 595, 842, [
			...[10, 12, 14, 16, 18, 20, 12, 14].map((large, i) =>
				item('167', 400 - large, 700 - i * 20, large)
			),
			item('2 076 683', 405, 620, 40)
		]);
		expect(boundariesFromRecurrence(page.rows)).toEqual([]);
	});

	it('cuts nothing between two words of the same run', () => {
		// Short words, one gap apart, so the whole run is a single band and their
		// ends recur exactly as a column of figures would. What tells the two
		// apart is what comes next: a column starts a gap further on, a word does
		// not.
		const mots = ['ABC', 'DEF', 'GHI', 'JKL'];
		const page = pageFrom(
			1,
			595,
			842,
			[0, 1, 2, 3, 4].flatMap((ligne) =>
				mots.map((mot, rang) => item(mot, 50 + rang * 18, 700 - ligne * 20, 15))
			)
		);
		expect(boundariesFromRecurrence(page.rows)).toEqual([]);
	});

	it('keeps everything when nothing recurs enough to judge by', () => {
		// Asked for a support no band can reach, it says so by keeping them all
		// rather than by returning an empty cut: "I cannot tell" is not "no
		// columns".
		const page = pageFrom(1, 595, 842, table(LINES));
		expect(boundariesFromRecurrence(page.rows, 2).length).toBeGreaterThan(0);
	});
});
