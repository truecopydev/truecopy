import { describe, expect, it } from 'vitest';
import { columnOfHeader, labelledValues } from './labels.js';

/*
 * The predicates a caller writes, and they are the caller's on purpose: this
 * library does not know a total from a heading. These two are the shape three
 * consumers wrote independently.
 */
const isTotal = (cell: string): boolean => /total/i.test(cell);
// A `\s` already covers the no-break space a French thousands separator uses, and
// writing one into the class as well puts a character nobody rereads into a
// regular expression. The linter catches it, which is why it is worth a line.
const isAmount = (cell: string): boolean => /^[\d\s]+(?:[.,]\d+)?$/.test(cell);

describe('labelledValues', () => {
	it('takes the value printed to the right of its label', () => {
		// A fund report closes its statement with the label and the figure on one
		// row, which is the geometry the fixture-less half of the world uses.
		const rows = [['Total portefeuille', '1 234,56', '99,80']];
		const [found] = labelledValues(rows, isTotal, isAmount);
		expect(found?.label).toEqual({ row: 0, column: 0 });
		expect(found?.values.map((one) => one.raw)).toEqual(['1 234,56', '99,80']);
		expect(found?.values.map((one) => one.distance)).toEqual([1, 2]);
	});

	it('takes the value printed under its label', () => {
		// A pension record prints the heading, then its presentation prose, then
		// the figure. Four cells of reach clears the prose.
		const rows = [['Total des points'], [''], ['prose'], ['4112,03']];
		const [found] = labelledValues(rows, isTotal, isAmount, { look: 'column' });
		expect(found?.values.map((one) => one.raw)).toEqual(['4112,03']);
		expect(found?.values[0]?.distance).toBe(3);
	});

	it('stops at the next label rather than reaching past it', () => {
		/*
		 * The rule whose absence is worst of both worlds, met on a real pension
		 * record: two schemes printed close together made the second one's figure
		 * count for the first as well, so the total doubled, so the proof failed,
		 * so a reading that was RIGHT came back refused.
		 */
		const rows = [['Total des points'], ['Total des points'], ['4112,03']];
		const [first, second] = labelledValues(rows, isTotal, isAmount, { look: 'column' });
		expect(first?.values).toEqual([]);
		expect(second?.values.map((one) => one.raw)).toEqual(['4112,03']);
	});

	it('says nothing rather than something when the document offers no value', () => {
		// An empty list is an answer: a label with nothing beside it is worth
		// saying out loud, and `SelfCheck` has a case for exactly that.
		const rows = [['Total des points'], ['DAICRISE01V03 87493545']];
		const [found] = labelledValues(rows, isTotal, isAmount, { look: 'column' });
		expect(found?.values).toEqual([]);
	});

	it('walks cells, never points, so a wide column is not farther', () => {
		const rows = [['Total', '', '1 234,56']];
		const [found] = labelledValues(rows, isTotal, isAmount);
		expect(found?.values[0]?.distance).toBe(2);
		expect(found?.values[0]).toMatchObject({ row: 0, column: 2 });
	});

	it('merges both directions and sorts by distance', () => {
		const rows = [
			['Total', '', '9 999'],
			['1 111', '', ''],
			['', '', '']
		];
		const [found] = labelledValues(rows, isTotal, isAmount);
		expect(found?.values.map((one) => one.raw)).toEqual(['1 111', '9 999']);
	});

	it('reports every label, including one with no value', () => {
		const rows = [['Total A', '10'], ['Total B'], ['x']];
		const found = labelledValues(rows, isTotal, isAmount, { look: 'row' });
		expect(found.map((one) => one.label.row)).toEqual([0, 1]);
		expect(found[1]?.values).toEqual([]);
	});

	it('honours a reach the caller narrows', () => {
		const rows = [['Total'], [''], [''], ['4112,03']];
		expect(labelledValues(rows, isTotal, isAmount, { look: 'column' })[0]?.values).toHaveLength(1);
		expect(
			labelledValues(rows, isTotal, isAmount, { look: 'column', reach: 2 })[0]?.values
		).toEqual([]);
	});

	it('stops at the end of the table rather than walking off it', () => {
		const rows = [['x'], ['Total']];
		expect(labelledValues(rows, isTotal, isAmount, { look: 'column' })[0]?.values).toEqual([]);
	});

	it('finds nothing in a table with no label, and does not throw', () => {
		expect(labelledValues([['1 234'], []], isTotal, isAmount)).toEqual([]);
		expect(labelledValues([], isTotal, isAmount)).toEqual([]);
	});
});

describe('columnOfHeader', () => {
	const declaresSurface = (cell: string): boolean => /\(\s*en\s*m2\s*\)/i.test(cell);

	it('reads the column a header announces, so bare numbers under it can be read', () => {
		// Requiring the unit inside each cell returned no value at all on a real
		// corpus of property schedules; reading it from the header returned them.
		const rows = [
			['Adresse', 'Date', '(en m2)', 'Type'],
			['18 Rue Lecourbe', '07/12/1978', '677', 'Commerce']
		];
		expect(columnOfHeader(rows, declaresSurface)).toBe(2);
	});

	it('refuses when several columns declare it', () => {
		// Either the predicate is too loose or the table carries two of that
		// column. Taking the first would answer a question nobody asked.
		const rows = [['(en m2)', 'Date', '(en m2)']];
		expect(columnOfHeader(rows, declaresSurface)).toBeNull();
	});

	it('refuses when none does', () => {
		expect(columnOfHeader([['Adresse', 'Date']], declaresSurface)).toBeNull();
		expect(columnOfHeader([], declaresSurface)).toBeNull();
	});

	it('accepts the same header repeated in its own column', () => {
		// A header reprinted at the top of every page is one column, not two.
		const rows = [
			['Adresse', '(en m2)'],
			['18 Rue Lecourbe', '677'],
			['Adresse', '(en m2)']
		];
		expect(columnOfHeader(rows, declaresSurface)).toBe(1);
	});
});
