import { describe, expect, it } from 'vitest';
import { cellConfidence, CONFIDENT_ABOVE } from './confidence.js';
import type { CoordinateUnit, Document, PositionedItem } from './document.js';
import { readTable, type Finding } from './table.js';
import { pdfWithText } from './kit.js';

/*
 * The frozen model, pinned to the reference it was measured with.
 *
 * The weights were learned and judged outside this repository, by a bench that
 * computes the same traits from a reading. Every expected number below comes
 * from that reference, on the readings written here: a port that drifts from
 * it by one trait is a different model wearing the measured one's figures.
 */
interface Case {
	cut: number[];
	rows: PositionedItem[][];
	cells: string[][];
	findings: Finding[];
	expected: (number | null)[][];
}

const reading = (
	{ cut, rows, cells, findings }: Omit<Case, 'expected'>,
	unit?: CoordinateUnit
): { pages: string[][][]; boundaries: number[][]; findings: Finding[]; document: Document } => ({
	pages: [cells],
	boundaries: [cut],
	findings,
	document: {
		pages: [
			{
				pageNumber: 1,
				width: 595,
				height: 842,
				items: rows.flat(),
				rows: rows.map((items) => ({ y: 0, items, text: '' })),
				columnBoundaries: [],
				...(unit ? { unit } : {})
			}
		],
		text: '',
		origin: 'pdf',
		name: 'table.pdf'
	}
});

const ACCOUNTS: Case = {
	cut: [100, 200],
	rows: [
		[
			{ text: 'Revenue', x: 10, y: 0, width: 60, height: 10 },
			{ text: '1', x: 110, y: 0, width: 8, height: 10 },
			{ text: '234', x: 122, y: 0, width: 20, height: 10 },
			{ text: '(5 678)', x: 210, y: 0, width: 40, height: 10 }
		],
		[
			{ text: 'Costs', x: 10, y: 0, width: 40, height: 10 },
			{ text: '12,5 %', x: 110, y: 0, width: 30, height: 10 },
			{ text: '3 (1 200', x: 210, y: 0, width: 45, height: 8 }
		],
		[
			{ text: 'Total 2024', x: 10, y: 0, width: 70, height: 10 },
			{ text: '7) 8', x: 110, y: 0, width: 25, height: 10 },
			{ text: '45*', x: 215, y: 0, width: 20, height: 12 },
			{ text: 'x', x: 250, y: 0, width: 5, height: 10 }
		],
		[
			{ text: 'Net', x: 10, y: 0, width: 30, height: 10 },
			{ text: '(1 234) 5 EUR', x: 110, y: 0, width: 60, height: 10 },
			{ text: '\u2212 12 345 678', x: 205, y: 0, width: 70, height: 10 }
		]
	],
	cells: [
		['Revenue', '1 234', '(5 678)'],
		['Costs', '12,5 %', '3 (1 200'],
		['Total 2024', '7) 8', '45* x'],
		['Net', '(1 234) 5 EUR', '\u2212 12 345 678']
	],
	findings: [
		{ code: 'thin-column', page: 1, column: 1, shareFilled: 0.1, message: 'thin' },
		{ code: 'pages-disagree', message: 'disagree' },
		{ code: 'thin-column', page: 2, column: 2, shareFilled: 0.1, message: 'elsewhere' }
	],
	expected: [
		[null, 0.938988306651195, 0.9911421572696402],
		[null, 0.945996696280974, 1.8448710812468683e-5],
		[1.2776589575214103e-7, 1.1641421103769645e-6, 8.602741550234327e-7],
		[null, 8.124864554481803e-7, 0.9913804010826561]
	]
};

const BARE: Case = {
	cut: [100],
	rows: [
		[
			{ text: '12', x: 10, y: 0, width: 30 },
			{ text: '34', x: 35, y: 0, width: 20 },
			{ text: '5', x: 150, y: 0, width: 10 }
		],
		[{ text: '6', x: 10, y: 0, width: 10 }],
		[
			{ text: '45* %', x: 12, y: 0, width: 30 },
			{ text: '$ 3,5', x: 140, y: 0, width: 30 }
		],
		[
			{ text: '1.234,5-', x: 12, y: 0, width: 40 },
			{ text: '+ 7', x: 150, y: 0, width: 20 }
		]
	],
	cells: [
		['12 34', '5', '9', '12345'],
		['6', '8 k\u20ac'],
		['45* %', '$ 3,5'],
		['1.234,5-', '+ 7']
	],
	findings: [],
	expected: [
		[0.00018506366416493059, 0.997075879168917, 0.9948894490644077, 0.9948751398229564],
		[0.39593174811111964, 0.9903944676856404],
		[0.7745212503736191, 0.9986468938515619],
		[0.42880667982196174, 0.9992163152517444]
	]
};

/* Twelve decimals: far finer than any threshold, and deaf to the order of a sum. */
const rounded = (grid: (number | null)[][]): (number | null)[][] =>
	grid.map((row) => row.map((value) => (value === null ? null : Number(value.toFixed(12)))));

describe('cellConfidence', () => {
	it('gives the measured model its measured answers on an accounts table', () => {
		expect(rounded(cellConfidence(reading(ACCOUNTS))[0])).toEqual(rounded(ACCOUNTS.expected));
	});

	it('still answers where the geometry is thin: no height, no gap, no item, a cell past the cut', () => {
		expect(rounded(cellConfidence(reading(BARE))[0])).toEqual(rounded(BARE.expected));
	});

	it('serves a clean figure as sure and a merged pair as not', () => {
		const [rows] = cellConfidence(reading(ACCOUNTS));
		expect(rows[0][2]).toBeGreaterThanOrEqual(CONFIDENT_ABOVE);
		expect(rows[3][1]).toBeLessThan(0.01);
	});

	it('says nothing about a cell that carries no digit', () => {
		expect(cellConfidence(reading(ACCOUNTS))[0][0][0]).toBeNull();
	});

	it('says nothing on a page that is not measured in points', () => {
		const silent = cellConfidence(reading(ACCOUNTS, 'characters'));
		expect(silent[0].flat().every((value) => value === null)).toBe(true);
	});

	it('says nothing on a page the cut found no column on', () => {
		const silent = cellConfidence(
			reading({ ...BARE, cut: [], cells: [['12 34 5'], ['6'], ['4'], ['7']] })
		);
		expect(silent).toEqual([[[null], [null], [null], [null]]]);
	});

	it('says nothing about a column the cut merged, and still speaks for its neighbours', () => {
		const merged: Finding = { code: 'merged-column', page: 1, column: 2, message: 'merged' };
		const [rows] = cellConfidence(reading({ ...ACCOUNTS, findings: [merged] }));
		expect(rows.map((row) => row[2])).toEqual([null, null, null, null]);
		expect(rows[0][1]).toBeGreaterThan(0.9);
	});
});

describe('readTable with confidence', () => {
	const at = (word: string, x: number, y: number) => ({ word, x, y });
	const file = (): File =>
		new File(
			[
				pdfWithText([
					at('CARTE', 50, 700),
					at('12,40', 430, 700),
					at('VIREMENT', 50, 680),
					at('750,00', 430, 680),
					at('PRELEVEMENT', 50, 660),
					at('68,00', 430, 660)
				])
			],
			'table.pdf',
			{ type: 'application/pdf' }
		);

	it('leaves the field out unless asked', async () => {
		expect((await readTable(file())).confidence).toBeUndefined();
	});

	it('lays the confidence out like the pages, and moves no cell', async () => {
		const plain = await readTable(file());
		const scored = await readTable(file(), { confidence: true });
		expect(scored.pages).toEqual(plain.pages);
		expect(scored.findings).toEqual(plain.findings);
		expect(scored.confidence).toHaveLength(scored.pages.length);
		const [rows] = scored.confidence ?? [];
		expect(rows.map((row) => row.map((value) => typeof value))).toEqual([
			['object', 'number'],
			['object', 'number'],
			['object', 'number']
		]);
	});

	it('computes none with numberEdges, whose cells no longer follow the cut', async () => {
		const split = await readTable(file(), { confidence: true, numberEdges: true });
		expect(split.confidence).toBeUndefined();
	});
});
