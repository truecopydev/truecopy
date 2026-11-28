import { describe, expect, it } from 'vitest';
import type { PositionedItem, Row } from './document.js';
import { boundariesFromFigureEdges } from './figure-edges.js';
import { readTable } from './table.js';

const item = (text: string, x: number, width = text.length * 6): PositionedItem => ({
	text,
	x,
	y: 0,
	width
});

const row = (...items: PositionedItem[]): Row => ({ y: 0, items, text: '' });

/** "( 7,604 )" as a PDF prints it: three items, the brackets on their own. */
const bracketed = (digits: string, x: number): PositionedItem[] => [
	item('(', x, 4),
	item(digits, x + 4),
	item(')', x + 4 + digits.length * 6, 4)
];

describe('figure edges', () => {
	it('parts two columns of figures that detached brackets welded', () => {
		const rows = [
			row(item('Net profit', 42), ...bracketed('7,604', 299), item('3,372', 337)),
			row(item('Depreciation', 42), item('576', 299), item('355', 337)),
			row(item('Income tax', 42), ...bracketed('182', 299), item('481', 337)),
			row(item('Goodwill', 42), item('5,683', 299), item('-', 337, 4)),
			row(item('Prepayments', 42), item('828', 299), ...bracketed('1,373', 337))
		];
		const cuts = boundariesFromFigureEdges(rows, [200]);
		expect(cuts).toHaveLength(1);
		expect(cuts[0]).toBeGreaterThan(333);
		expect(cuts[0]).toBeLessThanOrEqual(337);
	});

	it('leaves a number printed in groups of three alone', () => {
		const rows = [
			row(item('Paris', 42), item('1', 300), item('358', 309), item('522', 330)),
			row(item('Lyon', 42), item('2', 300), item('104', 309), item('007', 330)),
			row(item('Lille', 42), item('12', 294), item('650', 309), item('300', 330))
		];
		expect(boundariesFromFigureEdges(rows, [200])).toEqual([]);
	});

	it('opens one column for a flush-right column, not one per width', () => {
		const rows = [
			row(item('Revenue', 42), item('18', 291), item('20,878', 312)),
			row(item('Finance income', 42), item('23', 291), item('1,412', 318)),
			row(item('Interest income', 42), item('23', 291), item('10', 336)),
			row(item('Gross profit', 42), item('20,742', 312)),
			row(item('Other income', 42), item('214', 330))
		];
		expect(boundariesFromFigureEdges(rows, [200])).toHaveLength(1);
	});

	it('counts the rows that open their cell past the cut, for a column of references', () => {
		const rows = [
			row(item('Warrants exercised', 42), item('0.2', 243), item('0.2', 308)),
			row(item('Share-based compensation', 42), item('6', 216), item('0.0', 243), item('0.4', 308)),
			row(item('Dividends', 42), item('7', 216), item('1.5', 243), item('1.5', 308)),
			row(item('Equity', 42), item('4.1', 243), item('108.8', 302)),
			row(item('Capital increase', 42), item('2.0', 243), item('2.0', 308)),
			row(item('Other', 42), item('0.1', 243), item('0.1', 308)),
			row(item('Total', 42), item('8.0', 243), item('113.0', 302))
		];
		const cuts = boundariesFromFigureEdges(rows, [200, 280]);
		expect(cuts).toHaveLength(1);
		expect(cuts[0]).toBeGreaterThanOrEqual(222);
		expect(cuts[0]).toBeLessThanOrEqual(243);
	});

	it('does not part a label from the figure that ends it', () => {
		const rows = [
			row(item('Balance at 1 January', 42, 100), item('2025', 145), item('4,928', 300)),
			row(item('Balance at 31 December', 42, 110), item('2025', 155), item('5,120', 300)),
			row(item('Profit for the year', 42), item('192', 312))
		];
		expect(boundariesFromFigureEdges(rows, [250])).toEqual([]);
	});

	it('does not cut where the rows print across', () => {
		const rows = [
			row(item('576', 299), item('355', 345)),
			row(item('5,683', 299), item('481', 345)),
			row(item('consolidated statement', 299, 120)),
			row(item('restated comparative', 299, 120))
		];
		expect(boundariesFromFigureEdges(rows, [])).toEqual([]);
	});

	it('keeps a detached sign with its figure', () => {
		const rows = [
			row(item('Dividends', 42), item('-', 300, 4), item('1,250', 305)),
			row(item('Buy-back', 42), item('-', 300, 4), item('2,300', 305)),
			row(item('Other', 42), item('-', 300, 4), item('1,100', 305))
		];
		expect(boundariesFromFigureEdges(rows, [200])).toEqual([]);
	});

	it('parts a reference from the label it follows, a wide gap away', () => {
		const rows = [
			row(item('Tangible assets', 42), item('8', 160)),
			row(item('Intangible assets', 42), item('12', 160)),
			row(item('Deferred tax', 42), item('9', 160))
		];
		expect(boundariesFromFigureEdges(rows, [])).toEqual([144]);
	});

	it('lets the other rows settle a seam one row leaves open', () => {
		const rows = [
			row(item('Revenue', 42), item('18', 291), item('20,878', 306)),
			row(item('Cost of sales', 42), item('19', 291), ...bracketed('18,136', 306)),
			row(item('Selling expenses', 42), item('21', 291), ...bracketed('1,102', 306)),
			row(item('Gross profit', 42), item('20,742', 306)),
			row(item('Other income', 42), item('214', 306))
		];
		expect(boundariesFromFigureEdges(rows, [200])).toEqual([303]);
	});

	it('asks for as many rows as a column needs', () => {
		const prose = Array.from({ length: 18 }, (_, i) => row(item(`Line ${i} of the notes`, 42)));
		const rows = [
			...prose,
			row(item('576', 299), item('355', 345)),
			row(item('5,683', 299), item('481', 345))
		];
		expect(boundariesFromFigureEdges(rows, [200])).toEqual([]);
	});

	it('refuses a void that most rows print inside a number', () => {
		const rows = [
			row(item('Paris', 42), item('1', 300), item('358', 309)),
			row(item('Lyon', 42), item('2', 300), item('104', 309)),
			row(item('Lille', 42), item('4', 300), item('650', 309)),
			row(item('Nice', 42), item('7', 300), ...bracketed('12', 309)),
			row(item('Brest', 42), item('9', 300), ...bracketed('31', 309))
		];
		expect(boundariesFromFigureEdges(rows, [200])).toEqual([]);
	});

	it('has nothing to say of an empty page', () => {
		expect(boundariesFromFigureEdges([], [])).toEqual([]);
	});
});

describe('readTable with figureEdges', () => {
	const paste = () =>
		new File(['Label   2024   2023\nRevenue   576   355\nCosts   (182)   481\n'], 'table.txt', {
			type: 'text/plain'
		});

	it('reads a page it has nothing to cut exactly as without it', async () => {
		const plain = await readTable(paste());
		const asked = await readTable(paste(), { figureEdges: true });
		expect(asked.pages).toEqual(plain.pages);
		expect(asked.boundaries).toEqual(plain.boundaries);
	});
});
