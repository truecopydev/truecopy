import { describe, expect, it } from 'vitest';
import { readTable } from './table.js';
import { pdfWithPages, pdfWithText } from './kit.js';

/*
 * The shortest path, and its second field.
 *
 * `rows` alone would make this one more table extractor, and a worse one. What
 * sets it apart is what it refuses to vouch for, and these cases measure
 * exactly that: every warning is computed without knowing anything about the
 * document.
 */
const at = (word: string, x: number, y: number) => ({ word, x, y });

const pdf = (words: { word: string; x: number; y: number }[]): File =>
	new File([pdfWithText(words)], 'table.pdf', { type: 'application/pdf' });

const STATEMENT = pdf([
	at('02/05/2026', 50, 700),
	at('CARTE', 150, 700),
	at('12,40', 430, 700),
	at('03/05/2026', 50, 680),
	at('VIREMENT', 150, 680),
	at('750,00', 430, 680),
	at('05/05/2026', 50, 660),
	at('PRELEVEMENT', 150, 660),
	at('68,00', 430, 660)
]);

describe('readTable', () => {
	it('returns the cells with not one line of configuration', async () => {
		const { rows } = await readTable(STATEMENT);
		expect(rows).toEqual([
			['02/05/2026', 'CARTE', '12,40'],
			['03/05/2026', 'VIREMENT', '750,00'],
			['05/05/2026', 'PRELEVEMENT', '68,00']
		]);
	});

	it('complains about nothing on a clean table', async () => {
		expect((await readTable(STATEMENT)).warnings).toEqual([]);
	});

	it('returns the document too, for whoever needs more than the cells', async () => {
		const { document } = await readTable(STATEMENT);
		expect(document.origin).toBe('pdf');
		expect(document.pages).toHaveLength(1);
	});
});

describe('what readTable refuses to vouch for', () => {
	it('says when a page shows no column at all', async () => {
		// Everything landed in one column: either the page is prose, or the cut
		// failed and every row came back whole.
		const prose = pdf([at('one whole sentence with no column', 50, 700)]);
		expect((await readTable(prose)).warnings).toEqual([
			'page 1 shows no column at all - every row came back whole'
		]);
	});

	it('says when a column is almost always empty', async () => {
		// Counting cells would say nothing: a row is cut into as many cells as there
		// are boundaries, always. What varies is how often a column is filled, and a
		// column empty on nine rows out of ten was invented by the cut.
		const sparse = pdf([
			at('a', 50, 700),
			at('b', 200, 700),
			at('rare', 400, 700),
			at('c', 50, 680),
			at('d', 200, 680),
			at('e', 50, 660),
			at('f', 200, 660),
			at('g', 50, 640),
			at('h', 200, 640),
			at('i', 50, 620),
			at('j', 200, 620),
			at('k', 50, 600),
			at('l', 200, 600)
		]);
		expect((await readTable(sparse)).warnings).toEqual([
			'column 2 of page 1 is filled on only 17% of its rows - the cut may have invented it'
		]);
	});

	it('says when a page of the document is blank', async () => {
		// A blank page in the middle of a bundle is ordinary - a footer sheet, a
		// verso - and joining single-page files does not reproduce one.
		const bundle = new File(
			[pdfWithPages([[at('a', 50, 700), at('b', 200, 700)], []])],
			'lot.pdf',
			{
				type: 'application/pdf'
			}
		);
		expect((await readTable(bundle)).warnings.join(' ')).toMatch(/page 2 carries no text at all/);
	});

	it('says when the pages are not cut the same way', async () => {
		// A page out of step is usually a different table, and joining them makes a
		// third one that is neither.
		const bundle = new File(
			[
				pdfWithPages([
					[at('a', 50, 700), at('b', 200, 700), at('c', 400, 700)],
					[at('d', 50, 700), at('e', 200, 700)]
				])
			],
			'lot.pdf',
			{ type: 'application/pdf' }
		);
		expect((await readTable(bundle)).warnings.join(' ')).toMatch(
			/pages disagree on how many columns/
		);
	});

	it('a table with no warning is not a promise of correctness', async () => {
		// Three rows cut cleanly, and a fourth that is a total: the shape is
		// faultless, the meaning is not. That is exactly the limit of this short
		// path, and why the rest of the library exists.
		const withTotal = pdf([
			at('02/05/2026', 50, 700),
			at('CARTE', 150, 700),
			at('12,40', 430, 700),
			at('03/05/2026', 50, 680),
			at('VIREMENT', 150, 680),
			at('750,00', 430, 680),
			at('05/05/2026', 50, 660),
			at('PRELEVEMENT', 150, 660),
			at('68,00', 430, 660),
			at('TOTAL', 150, 640),
			at('830,40', 430, 640)
		]);
		const { rows, warnings } = await readTable(withTotal);
		expect(warnings).toEqual([]);
		expect(rows).toHaveLength(4);
	});
});
