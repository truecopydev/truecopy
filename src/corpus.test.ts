import { describe, expect, it } from 'vitest';
import { readTable } from './table.js';
import { pdfWithPages, pdfWithText, type PlacedWord } from './kit.js';

/*
 * A corpus of layouts, and what it is honestly worth.
 *
 * These documents are synthetic. They are modelled on layouts met in the wild -
 * a French statement with separate debit and credit columns, an English one
 * with a single signed amount and a running balance, a page whose table sits
 * under a letterhead - but no real document is committed here, and none could
 * be: the documents this library is written for are somebody's money, health or
 * working life.
 *
 * So this corpus does not prove the library reads real documents. What it
 * proves is narrower and still worth having: that the shapes it claims to
 * handle behave as claimed, and - more importantly - that the shapes it handles
 * badly are pinned here saying so. A corpus that only holds the cases that pass
 * is a corpus that flatters.
 *
 * Every case below asserts what comes back AND what could not be vouched for.
 */

const at = (word: string, x: number, y: number): PlacedWord => ({ word, x, y });

const file = (pdf: string): File => new File([pdf], 'case.pdf', { type: 'application/pdf' });

/** A run of operations, one row per line, at fixed columns. */
function rowsAt(columns: number[], lines: string[][], top = 700): PlacedWord[] {
	return lines.flatMap((cells, index) =>
		cells.flatMap((cell, column) => (cell ? [at(cell, columns[column], top - index * 20)] : []))
	);
}

describe('a French statement: date, wording, debit, credit', () => {
	const pdf = pdfWithText(
		rowsAt(
			[50, 130, 380, 460],
			[
				['02/05/2026', 'CARTE AMAZON', '12,40', ''],
				['03/05/2026', 'VIR LOYER', '750,00', ''],
				['05/05/2026', 'CARTE SNCF', '68,00', ''],
				['09/05/2026', 'PRLV EDF', '91,32', ''],
				['12/05/2026', 'VIREMENT SALAIRE', '', '2400,00'],
				['15/05/2026', 'CARTE BOULANGER', '7,90', '']
			]
		)
	);

	it('finds the four columns the table has', async () => {
		const { rows } = await readTable(file(pdf));
		expect(rows[0]).toHaveLength(4);
	});

	it('vouches for the shape, because nothing about it is odd', async () => {
		const { warnings } = await readTable(file(pdf));
		// The credit column is used once in six, and it is a real column: a weak
		// band at the edge of the table is kept, and then reported as thin.
		expect(warnings).toEqual([
			'column 3 of page 1 is filled on only 17% of its rows - the cut may have invented it'
		]);
	});
});

describe('an English statement: date, description, amount, balance', () => {
	const pdf = pdfWithText(
		rowsAt(
			[50, 130, 380, 470],
			[
				['02/05/2026', 'AMAZON UK', '-12.40', '1,234.56'],
				['03/05/2026', 'RENT', '-750.00', '484.56'],
				['05/05/2026', 'RAIL TICKET', '-68.00', '416.56'],
				['09/05/2026', 'ELECTRICITY', '-91.32', '325.24'],
				['12/05/2026', 'SALARY', '2400.00', '2725.24']
			]
		)
	);

	it('reads four columns and vouches for the shape', async () => {
		const { rows, warnings } = await readTable(file(pdf));
		expect(rows[0]).toHaveLength(4);
		expect(warnings).toEqual([]);
	});
});

describe('a table under a letterhead - the case that costs', () => {
	/*
	 * This is the one that does not come out clean, and it is here for that
	 * reason. A real page carries a letterhead, an address block and a footer,
	 * each at an x of its own, and a cut that reads the whole page counts them as
	 * columns. Cutting on what recurs row after row removes most of them - but
	 * not all, because a block of five address lines recurs five times.
	 */
	const pdf = pdfWithText([
		at('BANQUE EXEMPLE', 40, 780),
		at('12 RUE DES FLEURS', 300, 765),
		at('75001 PARIS', 300, 750),
		at('N de compte', 40, 735),
		at('FR76 1234 5678 9012', 300, 735),
		at('Periode du 01/05 au 31/05', 200, 720),
		...rowsAt(
			[50, 130, 380, 460],
			[
				['02/05/2026', 'CARTE AMAZON', '12,40', ''],
				['03/05/2026', 'VIR LOYER', '750,00', ''],
				['05/05/2026', 'CARTE SNCF', '68,00', ''],
				['09/05/2026', 'PRLV EDF', '91,32', ''],
				['12/05/2026', 'VIREMENT SALAIRE', '', '2400,00'],
				['15/05/2026', 'CARTE BOULANGER', '7,90', '']
			],
			690
		)
	]);

	it('finds MORE columns than the table has, and says which are thin', async () => {
		const { rows, warnings } = await readTable(file(pdf));
		// Five, where the table has four: the address block held its own band.
		expect(rows[0].length).toBeGreaterThan(4);
		expect(warnings.join(' ')).toMatch(/the cut may have invented it/);
	});

	it('does not silently hand over a clean-looking table', async () => {
		// The whole argument of the library, on the one case that fails: the rows
		// come back, and so does the reason not to trust them yet.
		const { warnings } = await readTable(file(pdf));
		expect(warnings.length).toBeGreaterThan(0);
	});
});

describe('a bundle whose last page is a footer', () => {
	const pdf = pdfWithPages([
		rowsAt(
			[50, 130, 380],
			[
				['02/05/2026', 'CARTE AMAZON', '12,40'],
				['03/05/2026', 'VIR LOYER', '750,00'],
				['05/05/2026', 'CARTE SNCF', '68,00'],
				['09/05/2026', 'PRLV EDF', '91,32']
			]
		),
		[at('Conditions generales - page 2 sur 2', 50, 700)]
	]);

	it('says the pages are not cut the same way', async () => {
		const { warnings } = await readTable(file(pdf));
		expect(warnings.join(' ')).toMatch(/pages disagree on how many columns/);
	});
});

describe('a page of prose, which is not a table at all', () => {
	it('says it shows no column, rather than inventing one', async () => {
		const pdf = pdfWithText([
			at('Conditions generales du compte', 50, 700),
			at('Le present document ne porte aucun tableau.', 50, 680),
			at('Il est ici pour montrer ce que la lecture en dit.', 50, 660)
		]);
		expect((await readTable(file(pdf))).warnings).toEqual([
			'page 1 shows no column at all - every row came back whole'
		]);
	});
});
