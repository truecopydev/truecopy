import { describe, expect, it } from 'vitest';
import { CONFIDENT_ABOVE } from './confidence.js';
import type { CoordinateUnit, PositionedItem } from './document.js';
import type { Table } from './table.js';
import { verify, verifyValues } from './verify.js';

/*
 * Three answers, and the cases pin the line between them: what confirms, what
 * is allowed to contradict, and everything else, which is neither.
 */

const SURE = CONFIDENT_ABOVE + 0.001;
const UNSURE = 0.5;

/** A one-page reading written by hand: the cells, and how far each was trusted. */
function reading(
	cells: string[][],
	confidence?: (number | null)[][],
	unit?: CoordinateUnit,
	text = cells.flat().join(' ')
): Table {
	const rows = cells.map((row, r) => ({
		y: 800 - 20 * r,
		text: row.join('\t'),
		items: row.map((cell, c): PositionedItem => ({
			text: cell,
			x: 10 + 100 * c,
			y: 800 - 20 * r,
			width: 50
		}))
	}));
	return {
		rows: cells,
		pages: [cells],
		boundaries: [[100, 200]],
		warnings: [],
		findings: [],
		document: {
			pages: [
				{
					pageNumber: 1,
					width: 595,
					height: 842,
					items: rows.flatMap((row) => row.items),
					rows,
					columnBoundaries: [],
					...(unit ? { unit } : {})
				}
			],
			text,
			origin: 'pdf',
			name: 'accounts.pdf'
		},
		...(confidence ? { confidence: [confidence] } : {})
	};
}

const ACCOUNTS = [
	['Revenue', '1 200', '1 100'],
	['Costs', '(183)', '(170)'],
	['Total assets', '14 455,5', '12 384']
];
const ALL_SURE = [
	[null, SURE, SURE],
	[null, SURE, SURE],
	[null, SURE, SURE]
];

describe('verifyValues', () => {
	it('confirms a figure the labelled row prints, and says where', () => {
		const [checked] = verifyValues(reading(ACCOUNTS, ALL_SURE), [
			{ label: 'Total assets', value: '12 384' }
		]);
		expect(checked).toEqual({
			standing: 'confirmed',
			labelled: true,
			page: 1,
			row: 3,
			place: { page: 1, x: 210, y: 760, width: 50 },
			confidence: SURE
		});
	});

	it('contradicts a figure the labelled row prints otherwise, when every cell is sure', () => {
		const [checked] = verifyValues(reading(ACCOUNTS, ALL_SURE), [
			{ label: 'Revenue', value: 1250 }
		]);
		expect(checked).toEqual({
			standing: 'contradicted',
			labelled: true,
			page: 1,
			row: 1,
			printed: ['1 200', '1 100']
		});
	});

	it('contradicts a right figure claimed for the wrong row', () => {
		// The figure is printed, one row down: found anywhere, it would pass.
		const [checked] = verifyValues(reading(ACCOUNTS, ALL_SURE), [
			{ label: 'Revenue', value: '(183)' }
		]);
		expect(checked.standing).toBe('contradicted');
	});

	it('contradicts nothing from a row read with a doubt', () => {
		// A cut that glued two columns prints other figures than the page: the
		// reading is what is wrong, so it may not call the claim wrong.
		const doubted = [[null, SURE, UNSURE], ...ALL_SURE.slice(1)];
		const [checked] = verifyValues(reading(ACCOUNTS, doubted), [{ label: 'Revenue', value: 1250 }]);
		expect(checked).toEqual({ standing: 'not-found', labelled: true, page: 1, row: 1 });
	});

	it('contradicts nothing from a reading that scored no cell', () => {
		const [unscored] = verifyValues(reading(ACCOUNTS), [{ label: 'Revenue', value: 1250 }]);
		expect(unscored.standing).toBe('not-found');
		const nobody = ALL_SURE.map((row) => row.map(() => null));
		const [unvouched] = verifyValues(reading(ACCOUNTS, nobody), [
			{ label: 'Revenue', value: 1250 }
		]);
		expect(unvouched.standing).toBe('not-found');
	});

	it('still confirms from a doubted cell: two readers agreeing is the proof', () => {
		const doubted = [[null, UNSURE, UNSURE], ...ALL_SURE.slice(1)];
		const [checked] = verifyValues(reading(ACCOUNTS, doubted), [
			{ label: 'Revenue', value: '1 100' }
		]);
		expect(checked).toMatchObject({ standing: 'confirmed', confidence: UNSURE });
	});

	it('takes a delimited file as its own cut, with no score to wait for', () => {
		const [checked] = verifyValues(reading(ACCOUNTS, undefined, 'index'), [
			{ label: 'Costs', value: '(200)' }
		]);
		expect(checked).toMatchObject({ standing: 'contradicted', printed: ['(183)', '(170)'] });
	});

	it('contradicts nothing from a label printed alone on its line', () => {
		const wrapped = [['Revenue from contracts', '', ''], ...ACCOUNTS.slice(1)];
		const [checked] = verifyValues(reading(wrapped, ALL_SURE), [
			{ label: 'Revenue from contracts', value: 1250 }
		]);
		expect(checked).toEqual({ standing: 'not-found', labelled: true, page: 1, row: 1 });
	});

	it('confirms from any row carrying the label, and contradicts from all of them', () => {
		const twice = [...ACCOUNTS, ['Revenue', '300', '280']];
		const sure = [...ALL_SURE, [null, SURE, SURE]];
		const [second, neither] = verifyValues(reading(twice, sure), [
			{ label: 'Revenue', value: 280 },
			{ label: 'Revenue', value: 999 }
		]);
		expect(second).toMatchObject({ standing: 'confirmed', row: 4 });
		expect(neither).toMatchObject({
			standing: 'contradicted',
			printed: ['1 200', '1 100', '300', '280']
		});
	});

	it('without a label, only finds a figure somewhere or does not', () => {
		const [found, missing] = verifyValues(reading(ACCOUNTS, ALL_SURE), [
			{ value: '(170)' },
			{ value: 999 }
		]);
		expect(found).toMatchObject({ standing: 'confirmed', labelled: false, row: 2 });
		expect(missing).toEqual({ standing: 'not-found', labelled: false });
	});

	it('does not confirm under a label the document prints nowhere', () => {
		// The figure is printed, on the Revenue row. Found anywhere, a value
		// copied from the wrong row would be confirmed by the row it came from.
		const [renamed] = verifyValues(reading(ACCOUNTS, ALL_SURE), [
			{ label: 'Turnover', value: '1 200' }
		]);
		expect(renamed).toEqual({ standing: 'not-found', labelled: false });
	});

	it('reads a label letter by letter, as a text layer breaks its words', () => {
		const broken = [
			['Inventor ies', '21', '( 1,384 )'],
			['Deferred income fr', 'om contracts', '138,506'],
			['8 Total equity', '25.788', '15.076']
		];
		const sure = broken.map(() => [null, SURE, SURE]);
		const [spaced, split, noted] = verifyValues(reading(broken, sure), [
			{ label: 'Inventories', value: '(1,384)' },
			{ label: 'Deferred income from contracts', value: '138,506' },
			{ label: 'Total equity', value: '15.076' }
		]);
		expect(spaced).toMatchObject({ standing: 'confirmed', labelled: true, row: 1 });
		expect(split).toMatchObject({ standing: 'confirmed', labelled: true, row: 2 });
		expect(noted).toMatchObject({ standing: 'confirmed', labelled: true, row: 3 });
	});

	it('names a row by the label it opens on, not by a longer one', () => {
		const totals = [
			['Total', '500', '480'],
			['Total equity', '300', '280'],
			['Equity, total', '300', '280']
		];
		const sure = totals.map(() => [null, SURE, SURE]);
		const [own, longer, words] = verifyValues(reading(totals, sure), [
			{ label: 'Total', value: 300 },
			{ label: 'Total equity', value: 300 },
			{ label: 'equity total', value: 280 }
		]);
		// `Total` opens two rows and ends on one: the other does not answer.
		expect(own).toMatchObject({ standing: 'contradicted', printed: ['500', '480'] });
		expect(longer).toMatchObject({ standing: 'confirmed', row: 2 });
		expect(words).toMatchObject({ standing: 'confirmed', row: 3 });
	});

	it('takes a label of one or two characters for no label at all', () => {
		// The marks a statement numbers its rows with: a dozen rows open on each.
		const marked = [
			['F', '', '6 292'],
			['G', '', '703']
		];
		const sure = marked.map(() => [null, null, SURE]);
		const [checked] = verifyValues(reading(marked, sure), [{ label: 'F', value: '703' }]);
		expect(checked).toEqual({ standing: 'not-found', labelled: false });
	});

	it('contradicts nothing from a row that only carries the words of the label', () => {
		const flows = [['Net cash from investing activities', '(243)', '(1 751)']];
		const [checked] = verifyValues(reading(flows, [[null, SURE, SURE]]), [
			{ label: 'From investing activities', value: 200 }
		]);
		expect(checked).toEqual({ standing: 'not-found', labelled: true, page: 1, row: 1 });
	});

	it('contradicts nothing when a row without a label prints the figure', () => {
		// One printed row, two baselines: the cut made two rows of it, and the
		// figure sits on the one nobody can name.
		const split = [
			['', '498', ''],
			['Operating cash flow', '', '13 138'],
			['Investing cash flow', '119', '(9 594)']
		];
		const sure = split.map(() => [null, SURE, SURE]);
		const [unnamed, wrong] = verifyValues(reading(split, sure), [
			{ label: 'Operating cash flow', value: 498 },
			{ label: 'Operating cash flow', value: 119 }
		]);
		expect(unnamed).toEqual({ standing: 'not-found', labelled: true, page: 1, row: 2 });
		// 119 is printed too, on a row that has a name, and it is another one.
		expect(wrong).toMatchObject({ standing: 'contradicted', printed: ['13 138'] });
	});

	it('contradicts nothing from a figure grouped two ways at once', () => {
		// The note 23 glued to the figure 250,000: one number of eight digits.
		const glued = [['Called up share capital', '23 250,000', '250,000']];
		const [checked] = verifyValues(reading(glued, [[null, SURE, SURE]], undefined, '1,234.50'), [
			{ label: 'Called up share capital', value: 23 }
		]);
		expect(checked).toEqual({ standing: 'not-found', labelled: true, page: 1, row: 1 });
	});

	it('contradicts nothing a cell prints among the groups it glued', () => {
		// This year beside the last in one cell, and a note before its figure:
		// spaces group the thousands, and the same space parts two columns.
		const glued = [
			['Total equity', '253 238 258 024'],
			['Accruals', '23 704', '2 814']
		];
		const table = reading(
			glued,
			[
				[null, SURE],
				[null, SURE, SURE]
			],
			undefined,
			'1 234,50'
		);
		const standings = verifyValues(table, [
			{ label: 'Total equity', value: '258 024' },
			{ label: 'Total equity', value: '238 258' },
			{ label: 'Total equity', value: '258 025' },
			{ label: 'Accruals', value: '704' }
		]).map((checked) => checked.standing);
		expect(standings).toEqual(['not-found', 'not-found', 'contradicted', 'not-found']);
	});

	it('still contradicts a negative claimed without its brackets', () => {
		// 12 345 is a run of the groups of ( 12 345 ), and not a figure of it.
		const costs = [['Costs', '( 12 345 )', '( 170 )']];
		const table = reading(costs, [[null, SURE, SURE]], undefined, '1 234,50');
		const [checked] = verifyValues(table, [{ label: 'Costs', value: '12 345' }]);
		expect(checked.standing).toBe('contradicted');
	});

	it('contradicts nothing from a row holding the tail of a figure', () => {
		// 075 alone is the last group of 6 427 075: the cut lost its head.
		const torn = [['Profit for the year', '826 331', '075']];
		const table = reading(torn, [[null, SURE, SURE]], undefined, '1 234,50');
		const [checked] = verifyValues(table, [{ label: 'Profit for the year', value: '6 427 075' }]);
		expect(checked).toEqual({ standing: 'not-found', labelled: true, page: 1, row: 1 });
	});

	it('contradicts nothing from a negative the cut tore in two', () => {
		// The page prints ( 1,384 ) ( 142 ): the closing bracket fell in the
		// next cell, and the figure reads positive whatever its score says.
		const torn = [['Inventories', '( 1,384', ') ( 142 )']];
		const [checked] = verifyValues(reading(torn, [[null, SURE, SURE]]), [
			{ label: 'Inventories', value: '(1,384)' }
		]);
		expect(checked).toEqual({ standing: 'not-found', labelled: true, page: 1, row: 1 });
	});

	it('gives no place to a cell the cut has no zone for', () => {
		// With `numberEdges` a row is wider than its cut: the figure is there,
		// and no rectangle is invented for it.
		const wide = [['Revenue', '1 200', '1 100', '900']];
		const [checked] = verifyValues(reading(wide, [[null, SURE, SURE, SURE]]), [
			{ label: 'Revenue', value: 900 }
		]);
		expect(checked).toEqual({
			standing: 'confirmed',
			labelled: true,
			page: 1,
			row: 1,
			confidence: SURE
		});
	});

	it('looks a label of figures alone up as words', () => {
		const years = [
			['2024', '10', '20'],
			['2023', '30', '40']
		];
		const sure = years.map(() => [null, SURE, SURE]);
		const [checked] = verifyValues(reading(years, sure), [{ label: '2023', value: 40 }]);
		expect(checked).toMatchObject({ standing: 'confirmed', row: 2 });
	});

	it('looks words up on the page named and on no other', () => {
		const [here, elsewhere] = verifyValues(reading(ACCOUNTS, ALL_SURE), [
			{ value: 'Revenue', page: 1 },
			{ value: 'Revenue', page: 2 }
		]);
		expect(here.standing).toBe('confirmed');
		expect(elsewhere.standing).toBe('not-found');
	});

	it('reads the bracket that closes a negative set with spaces', () => {
		const spaced = [['Costs', '( 14,600 )', '178 ( 364 )']];
		const [negative, positive, second] = verifyValues(reading(spaced, [[null, SURE, SURE]]), [
			{ label: 'Costs', value: '(14,600)' },
			{ label: 'Costs', value: '14,600' },
			{ label: 'Costs', value: -364 }
		]);
		expect(negative.standing).toBe('confirmed');
		expect(positive).toMatchObject({
			standing: 'contradicted',
			printed: ['( 14,600 )', '178', '( 364 )']
		});
		expect(second.standing).toBe('confirmed');
	});

	it('looks on the page named and on no other', () => {
		const table = reading(ACCOUNTS, ALL_SURE);
		const [here, elsewhere] = verifyValues(table, [
			{ value: '1 200', page: 1 },
			{ value: '1 200', page: 2 }
		]);
		expect(here.standing).toBe('confirmed');
		expect(elsewhere).toEqual({ standing: 'not-found', labelled: false });
	});

	it('reads a JSON number with a dot whatever the page writes', () => {
		const [fraction, rounded] = verifyValues(reading(ACCOUNTS, ALL_SURE), [
			{ label: 'Total assets', value: 14455.5 },
			{ label: 'Total assets', value: 14455 }
		]);
		expect(fraction.standing).toBe('confirmed');
		// The rounding is the error this exists to catch.
		expect(rounded.standing).toBe('contradicted');
	});

	it('reads a claimed string in the mark it was written with, when told', () => {
		const table = reading(ACCOUNTS, ALL_SURE);
		const claim = [{ label: 'Total assets', value: '14455.5' }];
		expect(verifyValues(table, claim, { written: '.' })[0].standing).toBe('confirmed');
		expect(verifyValues(table, claim)[0].standing).not.toBe('confirmed');
	});

	it('reads brackets as a sign unless told they are punctuation', () => {
		const table = reading(ACCOUNTS, ALL_SURE);
		const [negative, positive] = verifyValues(table, [
			{ label: 'Costs', value: -183 },
			{ label: 'Costs', value: 183 }
		]);
		expect(negative.standing).toBe('confirmed');
		expect(positive.standing).toBe('contradicted');
		const [aside] = verifyValues(table, [{ label: 'Costs', value: 183 }], {
			brackets: 'punctuation'
		});
		expect(aside.standing).toBe('confirmed');
	});

	it('refuses a number no document writes', () => {
		const [exponent, endless] = verifyValues(reading([['Rate', '1', '2']], [[null, SURE, SURE]]), [
			{ value: 1e-7 },
			{ value: Number.POSITIVE_INFINITY }
		]);
		expect(exponent).toEqual({ standing: 'not-found', labelled: false });
		expect(endless).toEqual({ standing: 'not-found', labelled: false });
	});

	it('finds words on one row, in order, and never contradicts them', () => {
		const [named, labelled, absent, hollow] = verifyValues(reading(ACCOUNTS, ALL_SURE), [
			{ value: 'total assets' },
			{ label: 'Total', value: 'assets' },
			{ label: 'Total', value: 'liabilities' },
			{ value: '-' }
		]);
		expect(named).toEqual({ standing: 'confirmed', labelled: false, page: 1, row: 3 });
		expect(labelled).toEqual({ standing: 'confirmed', labelled: true, page: 1, row: 3 });
		expect(absent).toEqual({ standing: 'not-found', labelled: false });
		expect(hollow).toEqual({ standing: 'not-found', labelled: false });
	});
});

describe('verify', () => {
	it('reads the file itself, and a delimited file answers all three ways', async () => {
		const file = new File(['Label;2024;2023\nRevenue;1200;1100\nCosts;183;170\n'], 'accounts.csv', {
			type: 'text/csv'
		});
		const checked = await verify(file, [
			{ label: 'Revenue', value: 1100 },
			{ label: 'Costs', value: 190 },
			{ label: 'Margin', value: 12 }
		]);
		expect(checked.map((value) => value.standing)).toEqual([
			'confirmed',
			'contradicted',
			'not-found'
		]);
		expect(checked[1].printed).toEqual(['183', '170']);
	});
});
