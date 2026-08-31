import { describe, expect, it } from 'vitest';
import { carriesNumber, carriesText, citedText, numberedRows } from './cite.js';

/*
 * The check that separates reading from guessing: every value a model returns
 * is looked up in the rows the model itself cited, and nowhere else. These
 * cases pin the two lookups exactly where each was measured to fail when
 * written more naively.
 */

describe('numberedRows', () => {
	it('numbers each row and separates its cells', () => {
		expect(
			numberedRows([
				['PARIS', '75018', '212 rue Marcadet'],
				['EVRY', '91000', 'rue Gaston']
			])
		).toBe('0 | PARIS | 75018 | 212 rue Marcadet\n1 | EVRY | 91000 | rue Gaston');
	});

	it('keeps a row number stable across overlapping windows', () => {
		// A long table is read in windows, and the same row must cite the same
		// number in every prompt it appears in - renumbering from zero would make
		// one row cite differently in two windows.
		expect(numberedRows([['a'], ['b']], 40)).toBe('40 | a\n41 | b');
	});

	it('says nothing on no rows', () => {
		expect(numberedRows([])).toBe('');
	});
});

describe('citedText', () => {
	it('joins the cited rows, in the order they were cited', () => {
		const rows = [['a', 'b'], ['c'], ['d', 'e']];
		expect(citedText(rows, [2, 0])).toBe('d e a b');
	});

	it('reads citations against the numbering the model saw', () => {
		expect(citedText([['a'], ['b']], [41], 40)).toBe('b');
	});

	it('lets an invented row number carry nothing rather than throw', () => {
		// Citing a row that does not exist is exactly the kind of claim this
		// module exists to catch, and it is caught by every lookup against the
		// missing text failing - not by an exception in the middle of a batch.
		expect(citedText([['a']], [7])).toBe('');
	});
});

describe('carriesText', () => {
	it('finds all the words, in order, across the whole row', () => {
		// A layout throws the tail of a name past the figure columns: the name is
		// printed word for word and in order, but never in one piece. A contiguous
		// search refused 104 of one real document's 111 records for that alone.
		const row = 'EVRY 91000 rue Gaston 410 CCV 11/01/1989 142 939 0 28 066 171 005 Cremieux';
		expect(carriesText(row, 'rue Gaston Cremieux')).toBe(true);
	});

	it('refuses words out of order', () => {
		expect(carriesText('rue Gaston Cremieux', 'Cremieux rue')).toBe(false);
	});

	it('refuses a word the rows never printed', () => {
		expect(carriesText('EVRY 91000 rue Gaston', 'rue Pasteur')).toBe(false);
	});

	it('cuts on hyphens from both sides', () => {
		// A hyphenated name breaks at the hyphen and its tail lands a whole row of
		// figures away. Cutting both sides keeps the comparison symmetric, and a
		// name printed in one piece walks the same path.
		expect(carriesText('RUEIL- 92500 29 avenue Paul 870 789 MALMAISON', 'RUEIL-MALMAISON')).toBe(
			true
		);
		expect(carriesText('SCEAUX 92330 rue Houdan', 'RUEIL-MALMAISON')).toBe(false);
	});

	it('tolerates case, runs of whitespace and curly apostrophes', () => {
		expect(carriesText('quai de l’Ourcq  75019', "QUAI DE L'OURCQ")).toBe(true);
	});

	it('does not fold accents, which would equate two neighbouring towns', () => {
		expect(carriesText('EPINAY 93800', 'Épinay')).toBe(false);
		expect(carriesText('ÉPINAY 93800', 'Épinay')).toBe(true);
	});

	it('refuses an empty value: nothing is not carried', () => {
		expect(carriesText('EVRY 91000', '')).toBe(false);
		expect(carriesText('EVRY 91000', ' - ')).toBe(false);
	});
});

describe('carriesNumber', () => {
	it('finds a figure whose thousands the page spaced out', () => {
		expect(carriesNumber('EVRY 1 655 CCV', '1655', ',')).toBe(true);
		expect(carriesNumber('EVRY 1 655 CCV', '1 655', ',')).toBe(true);
	});

	it('tells two welded figures apart, as the page wrote them', () => {
		// The welded cell of a missed cut: two figures in one cell. Each is
		// carried; their accidental concatenation is not.
		const cell = '167 2 076 683';
		expect(carriesNumber(cell, '167', ',')).toBe(true);
		expect(carriesNumber(cell, '2 076 683', ',')).toBe(true);
		expect(carriesNumber(cell, '1672', ',')).toBe(false);
	});

	it('refuses a rounded figure, which flattened digits would let in', () => {
		// Flattening the source into one digit soup finds almost any figure by
		// accident - measured: a surface of 410 found three times in a row that
		// carries no 410. Reading the page's own numbers keeps the guard real.
		expect(carriesNumber('2 415 065,40', '2 415 065', ',')).toBe(false);
		expect(carriesNumber('142 939 0 28 066 171 005', '410', ',')).toBe(false);
	});

	it('accepts the same value written twice, mark in hand', () => {
		// Reformatted but equal is not an invention: the check is against the
		// VALUE read with the document's own mark, on both sides.
		expect(carriesNumber('total 1,234.56', '1234.56', '.')).toBe(true);
		expect(carriesNumber('total 1.234,56', '1234,56', ',')).toBe(true);
		expect(carriesNumber('total 1.234,56', '1.234', ',')).toBe(false);
	});

	it('reads the accounting negative as the page does', () => {
		expect(carriesNumber('solde (123,45) au 31/12', '(123,45)', ',')).toBe(true);
	});

	/*
	 * THE CHECK THAT SENT A CONSUMER LOOKING FOR A FIGURE THE PAGE PRINTS.
	 *
	 * A per-share value beside its total, between brackets with its unit - the
	 * standard French layout. The bracket used to poison the reading, so this
	 * answered false and the consumer recorded *the document does not carry
	 * this*. Measured on 24 values across 14 quarterly reports.
	 */
	it('finds a figure that a phrase between brackets carries', () => {
		const ligne = 'VALEUR DE RECONSTITUTION 1 516 388 206 € (185,74 €/part)';
		expect(carriesNumber(ligne, '185,74', ',')).toBe(true);
		expect(carriesNumber(ligne, '1 516 388 206', ',')).toBe(true);
		// And the figure it does NOT carry stays refused.
		expect(carriesNumber(ligne, '185,75', ',')).toBe(false);
	});

	it('refuses a value that is not a figure at all', () => {
		expect(carriesNumber('142 939', 'CCV', ',')).toBe(false);
	});

	it('guesses without a mark, and a guess is what it is', () => {
		// Left out, each figure is read on its own: right far more often than not,
		// and still a guess - pass decimalMarkOf(document.text) instead.
		expect(carriesNumber('total 12,40', '12,40')).toBe(true);
	});
});
