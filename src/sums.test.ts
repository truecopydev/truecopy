import { describe, expect, it } from 'vitest';
import { provenCells, provenSums } from './sums.js';
import { readTable } from './table.js';

/*
 * A sum that holds proves its cells, and what a sum cannot see it does not
 * prove. Each refusal below was met on a real annual report before it was
 * written here.
 */
const page = (...columns: string[][]): string[][][] => [
	columns[0].map((_, row) => columns.map((column) => column[row]))
];
const down = (...cells: string[]): string[][][] => page(cells);
const places = (pages: string[][][]) =>
	provenSums(pages).map((sum) => [sum.along, sum.line, sum.terms, sum.total, sum.signs]);

describe('provenSums', () => {
	it('finds the total printed under its terms, and the grand total over its subtotals', () => {
		expect(places(down('100', '250', '350', '40', '60', '100', '450'))).toEqual([
			['column', 0, [0, 1], 2, 'printed'],
			['column', 0, [3, 4], 5, 'printed'],
			['column', 0, [2, 5], 6, 'printed']
		]);
	});

	it('reads brackets, signs, units and footnote stars as the page prints them', () => {
		expect(places(down('1 000 \u20ac', '(600)', '400*'))).toHaveLength(1);
		expect(places(down('$ 500', '+ 250', '750'))).toHaveLength(1);
		expect(places(down('900', '200-', '700'))).toHaveLength(1);
		expect(places(down('-900', '\u2212200', '(1 100)'))).toHaveLength(1);
		expect(places(down('050', '0', '100', '150'))).toHaveLength(1);
		expect(places(down('(12,5)', '(30,0)', '(42,5)'))).toHaveLength(1);
	});

	it('steps over a blank and a dash, and never crosses a cell that is not one number', () => {
		expect(places(down('100', '', '-', '250', '350'))).toEqual([
			['column', 0, [0, 3], 4, 'printed']
		]);
		expect(places(down('100', '27,11 84,59', '250', '350'))).toEqual([]);
		expect(places(down('100', '31 Dec 2025', '250', '350'))).toEqual([]);
		expect(places(down('100', '12,5 %', '250', '350'))).toEqual([]);
		expect(places(down('100', '99999999999999999999', '250', '350'))).toEqual([]);
	});

	it('proves nothing on a misread cell, a zero total, a lone term or mixed decimals', () => {
		expect(places(down('100', '250', '360'))).toEqual([]);
		expect(places(down('100', '(100)', '0'))).toEqual([]);
		expect(places(down('100', '0', '100'))).toEqual([]);
		expect(places(down('1,5', '2,5', '400'))).toEqual([]);
		expect(places(down('100', '250'))).toEqual([]);
	});

	it('does not believe a total under three digits', () => {
		expect(places(down('2', '3', '5'))).toEqual([]);
	});

	it('believes a charge printed without its sign only when a second column agrees', () => {
		expect(places(down('1 000', '600', '400'))).toEqual([]);
		expect(places(page(['1 000', '600', '400'], ['900', '500', '400']))).toEqual([
			['column', 0, [0, 1], 2, 'free'],
			['column', 1, [0, 1], 2, 'free']
		]);
		expect(provenSums(page(['1 000', '600', '400'], ['900', '500', '400']))[0].agreeing).toBe(2);
	});

	it('proves nothing when two patterns of signs fit, when a term is zero or past six terms', () => {
		const twice = ['300', '100', '100', '300'];
		expect(places(page(twice, twice))).toEqual([]);
		const withZero = ['500', '0', '200', '300'];
		expect(places(page(withZero, withZero))).toEqual([]);
		const long = ['1 000', '1', '2', '4', '8', '16', '32', '937'];
		expect(places(page(long, long))).toEqual([]);
	});

	it('proves nothing when the sum also holds without the same leading group', () => {
		// Note 13 glued to both figures: the sum adds up with it and without it.
		expect(places(down('13 439 232', '66 607', '13 505 839'))).toEqual([]);
		const free = ['13 500 000', '200 000', '13 300 000'];
		expect(places(page(free, free))).toEqual([]);
		// Only one reading adds up: another leading group, or a sum the group is needed for.
		expect(places(down('1 900', '700', '2 600'))).toHaveLength(1);
		expect(places(down('1 100', '1 200', '(900)', '1 400'))).toHaveLength(1);
		const held = ['2 500', '1 200', '1 300'];
		expect(places(page(held, held))).toHaveLength(2);
	});

	it('does not answer for the sign of a detached dash', () => {
		// Every cell owes its sign to a detached dash: the sum holds with all of them flipped.
		expect(places(down('- 4,913', '- 4,443', '- 9,356'))).toEqual([]);
		// Free signs read no sign at all.
		const free = ['- 3,095', '447', '3,542'];
		expect(places(page(free, free))).toEqual([]);
		// A bracket or a positive cell pins the signs down.
		expect(places(down('5,000', '- 2,000', '3,000'))).toHaveLength(1);
		expect(places(down('(100)', '200 -', '(300)'))).toHaveLength(1);
	});

	it('finds the total printed right of its terms, on rows of any length', () => {
		const pages = [[['Equity', '700', '550', '1 250'], ['Note'], []]];
		expect(places(pages)).toEqual([['row', 0, [1, 2], 3, 'printed']]);
		expect(provenSums([[]])).toEqual([]);
	});
});

describe('provenCells', () => {
	it('marks the terms and the total, down a column and along a row', () => {
		const pages = [
			[
				['Revenue', '700', '300', '1 000'],
				['Costs', '(400)', '(100)', '(500)'],
				['Result', '300', '200', '500']
			]
		];
		expect(provenCells(pages, provenSums(pages))).toEqual([
			[
				[false, true, true, true],
				[false, true, true, true],
				[false, true, true, true]
			]
		]);
	});
});

describe('readTable with sums', () => {
	const file = () =>
		new File(['Revenue;1 000\nCosts;(600)\nResult;400\nStaff;12\n'], 'accounts.csv', {
			type: 'text/csv'
		});

	it('says nothing of sums unless asked', async () => {
		const table = await readTable(file());
		expect(table.sums).toBeUndefined();
		expect(table.proven).toBeUndefined();
	});

	it('lays the proven cells out like the pages, and moves no cell', async () => {
		const plain = await readTable(file());
		const checked = await readTable(file(), { sums: true });
		expect(checked.pages).toEqual(plain.pages);
		expect(checked.sums).toHaveLength(1);
		expect(checked.proven).toEqual([
			[
				[false, true],
				[false, true],
				[false, true],
				[false, false]
			]
		]);
	});
});
