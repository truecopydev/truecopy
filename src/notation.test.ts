import { describe, expect, it } from 'vitest';
import {
	accentFree,
	decimalMarkOf,
	findNumbers,
	isOnlyNumber,
	numberToken,
	readDate,
	readLeadingDate,
	readNumber,
	wellGrouped,
	type Notation
} from './notation.js';

const FRENCH: Notation = {
	dateOrder: 'DMY',
	months: { janv: 0, fevr: 1, mars: 2, avr: 3, mai: 4, juin: 5 }
};
const AMERICAN: Notation = { dateOrder: 'MDY' };

describe('readNumber', () => {
	it('reads the two conventions', () => {
		expect(readNumber('1 234,56')).toBe(1234.56);
		expect(readNumber('1.234,56')).toBe(1234.56);
		expect(readNumber('1,234.56')).toBe(1234.56);
		expect(readNumber('12,00')).toBe(12);
	});

	it('does not take every dot for a thousands separator', () => {
		// Measured: every dot removed turned this into 2 780 050 - a hundred times
		// over, on a document where the figure is compared against a legal
		// threshold. Three digits behind is a group of thousands; one or two can
		// only be a decimal.
		expect(readNumber('27800.50')).toBe(27800.5);
		expect(readNumber('27.800')).toBe(27800);
		expect(readNumber('1.2')).toBe(1.2);
		expect(readNumber('1.234')).toBe(1234);
	});

	it('takes the decimal mark the document settled, instead of counting', () => {
		// `1,234` is one thousand two hundred and thirty-four in Luxembourg and one
		// point two three four in Paris. Five characters do not decide that; the
		// document does.
		expect(readNumber('1,234', ',')).toBe(1.234);
		expect(readNumber('1,234', '.')).toBe(1234);
		expect(readNumber('48,275,477.16', '.')).toBe(48275477.16);
		expect(readNumber('3 775 881 779,64', ',')).toBe(3775881779.64);
	});

	it('reads all three ways a document writes a minus', () => {
		expect(readNumber('-12,00')).toBe(-12);
		expect(readNumber('12,00-')).toBe(-12);
		// The accounting negative. Read as a positive, it moves money the wrong way.
		expect(readNumber('(123,45)')).toBe(-123.45);
		expect(readNumber('+12,00')).toBe(12);
	});

	it('reads through what a typesetter puts inside a number', () => {
		expect(readNumber('1 234,56')).toBe(1234.56);
		expect(readNumber('1 234,56')).toBe(1234.56);
		expect(readNumber("1'234.56")).toBe(1234.56);
		expect(readNumber('1 234,56 €')).toBe(1234.56);
	});

	it('says null rather than guess', () => {
		expect(readNumber('')).toBeNull();
		expect(readNumber('   ')).toBeNull();
		expect(readNumber('no figure here')).toBeNull();
		expect(readNumber('-')).toBeNull();
	});

	it('refuses a run of digits too long to be a number', () => {
		// A damaged extraction glues digits together until they stop being a
		// quantity. Infinity is not a reading, it is a failure with a value.
		expect(readNumber('1'.repeat(400))).toBeNull();
	});
});

describe('findNumbers', () => {
	it('never starts a match inside another number', () => {
		// A date glued to a figure on a flattened line: without the lookarounds
		// this reads "026 300,00" and returns 26300.
		const found = findNumbers('30/05/2026 300,00', 2);
		expect(found.map((one) => one.value)).toEqual([300]);
	});

	it('leaves a rate alone rather than reading a bogus figure out of it', () => {
		expect(findNumbers('0,000000 %', 2)).toEqual([]);
	});

	it('does not go quadratic on a wide gap after an opening bracket', () => {
		// Bounded, but generously: past a tight bound the match starts later and
		// drops the bracket, which flips the sign in silence.
		expect(readNumber('(    123,45)')).toBe(-123.45);
		expect(findNumbers('(  123,45)', 2)[0].value).toBe(-123.45);
	});

	it('reads every figure on a line, in order, with where it sits', () => {
		const found = findNumbers('2018 worked 4 quarters, 28 500,00 paid');
		expect(found.map((one) => one.value)).toEqual([2018, 4, 28500]);
		expect(found[0].index).toBe(0);
	});

	it('narrows to figures written with a fixed number of decimals', () => {
		expect(findNumbers('2018 worked 4 quarters, 28 500,00 paid', 2)).toHaveLength(1);
	});

	it('drops a token that matches the shape but holds no number', () => {
		expect(findNumbers('1'.repeat(400))).toEqual([]);
	});
});

describe('isOnlyNumber', () => {
	it('tells a cell of figures from prose quoting one', () => {
		expect(isOnlyNumber('1 234,56')).toBe(true);
		expect(isOnlyNumber('  12,00  ')).toBe(true);
		expect(isOnlyNumber('paid 12,00')).toBe(false);
		expect(isOnlyNumber('12,00 EUR')).toBe(false);
		expect(isOnlyNumber('')).toBe(false);
		expect(isOnlyNumber('TOTAL')).toBe(false);
	});

	it('holds the caller to the number of decimals it asked for', () => {
		expect(isOnlyNumber('12', 2)).toBe(false);
		expect(isOnlyNumber('12,00', 2)).toBe(true);
	});
});

describe('numberToken', () => {
	it('is a pattern the caller can compose with', () => {
		expect(numberToken(2).test('12,00')).toBe(true);
		expect(numberToken(2).test('12')).toBe(false);
	});
});

describe('readDate', () => {
	it('reads the order it was told, and never guesses one', () => {
		expect(readDate('01/02/2026', FRENCH)?.getMonth()).toBe(1);
		expect(readDate('01/02/2026', AMERICAN)?.getMonth()).toBe(0);
	});

	it('takes a two-digit year for this century', () => {
		expect(readDate('25/01/24', FRENCH)?.getFullYear()).toBe(2024);
	});

	it('refuses a day that rolls over into the next month', () => {
		// A 31st in a 30-day month is a misread, and JavaScript would happily
		// return the 1st of the month after.
		expect(readDate('31/04/2026', FRENCH)).toBeNull();
		expect(readDate('32/01/2026', FRENCH)).toBeNull();
		expect(readDate('01/13/2026', FRENCH)).toBeNull();
		expect(readDate('no date here', FRENCH)).toBeNull();
	});
});

describe('readLeadingDate', () => {
	it('reads an ISO date and says how much of the line it took', () => {
		expect(readLeadingDate('2026-01-25 GROCERIES', FRENCH)).toMatchObject({ length: 10 });
	});

	it('counts the spaces it skipped, so the caller strips the right slice', () => {
		const found = readLeadingDate('   25/01/2026 GROCERIES', FRENCH);
		expect(found?.length).toBe(13);
	});

	it('dates a row that carries no year against the one the document states', () => {
		const found = readLeadingDate('25/01 GROCERIES', FRENCH, 2026);
		expect(found?.date.getFullYear()).toBe(2026);
		expect(found?.date.getMonth()).toBe(0);
	});

	it('refuses a row with no year when nothing says which year it is', () => {
		expect(readLeadingDate('25/01 GROCERIES', FRENCH)).toBeNull();
	});

	it('refuses a yearless row whose day does not exist either', () => {
		expect(readLeadingDate('32/01 GROCERIES', FRENCH, 2026)).toBeNull();
	});

	it('does not hunt for a day and month in a line that starts with neither', () => {
		expect(readLeadingDate('GROCERIES 25/01', FRENCH, 2026)).toBeNull();
	});

	it('reads a month written out, accents and full stop included', () => {
		expect(readLeadingDate('25 janv. 2026 GROCERIES', FRENCH)?.date.getMonth()).toBe(0);
		expect(readLeadingDate('25 févr 2026', FRENCH)?.date.getMonth()).toBe(1);
	});

	it('refuses a month name the notation does not carry', () => {
		expect(readLeadingDate('25 smarch 2026', FRENCH)).toBeNull();
		expect(readLeadingDate('25 janv. 2026', AMERICAN)).toBeNull();
	});

	it('refuses a named month that is not a day of it', () => {
		expect(readLeadingDate('32 janv 2026', FRENCH)).toBeNull();
	});

	it('says nothing when the line does not start with a date', () => {
		expect(readLeadingDate('GROCERIES 25/01/2026', FRENCH)).toBeNull();
		expect(readLeadingDate('99-99-9999', FRENCH)).toBeNull();
		expect(readLeadingDate('2026-13-01', FRENCH)).toBeNull();
	});
});

describe('decimalMarkOf', () => {
	/*
	 * The same question as the column cut, asked of numbers: what recurs over the
	 * document decides, never what one token looks like. Met on a real French
	 * report that prints its figures the English way - the reader had no way to
	 * know, and read every amount a thousand times too small.
	 */
	it('reads a run that carries both marks: the rightmost is the decimal one', () => {
		expect(decimalMarkOf('TOTAL ACTIF NET 48,275,477.16')).toBe('.');
		expect(decimalMarkOf('TOTAL 2.418.919.276,24')).toBe(',');
	});

	it('reads a mark repeated over groups of three as a thousands mark', () => {
		expect(decimalMarkOf('1.234.567 titres')).toBe(',');
	});

	it('reads a mark followed by anything but three digits as the decimal one', () => {
		expect(decimalMarkOf('27800.50')).toBe('.');
		expect(decimalMarkOf('quantite 5,0')).toBe(',');
	});

	it('says nothing when nothing in the text settles it', () => {
		// A lone `1,234` is unreadable by construction, and so is a page of them.
		expect(decimalMarkOf('1,234 puis 5,678')).toBeNull();
		// Whole numbers carry no mark at all, so they answer nothing either.
		expect(decimalMarkOf('page 12 sur 2026')).toBeNull();
		expect(decimalMarkOf('aucun chiffre ici')).toBeNull();
		expect(decimalMarkOf('')).toBeNull();
	});

	it('does not take a date or a version for a number', () => {
		// Groups that are not three digits long: the run is not a thousands
		// notation, and it votes for nothing rather than for the wrong mark.
		expect(decimalMarkOf('arrete au 31.12.2025')).toBeNull();
		expect(decimalMarkOf('truecopy 1.0.1')).toBeNull();
	});

	it('lets the document settle what the token could not', () => {
		// The two compose with no word in between, and a document that settled
		// nothing must not force the caller to write it differently.
		const page = 'TOTAL ACTIF NET 48,275,477.16 dont 1,234 parts';
		expect(readNumber('1,234', decimalMarkOf(page))).toBe(1234);
		expect(readNumber('27800.50', decimalMarkOf('nothing here settles it'))).toBe(27800.5);
	});
});

describe('wellGrouped', () => {
	it('accepts what a typesetter would write, and one group alone whatever its length', () => {
		expect(wellGrouped('1 300 000', ',')).toBe(true);
		expect(wellGrouped('106 236 000,00', ',')).toBe(true);
		// A quantity is often printed with no separator at all.
		expect(wellGrouped('1300000', ',')).toBe(true);
		expect(wellGrouped('1,300,000.00', '.')).toBe(true);
	});

	it('refuses a group that no number starts with', () => {
		/*
		 * The reason this exists. `readNumber` throws separators away, so
		 * `000 106 236 000,00` reads as a perfectly good hundred and six million
		 * and a cut made there leaves 1 300 where the report prints 1 300 000.
		 * The value still closes its sector, so no arithmetic catches it: a
		 * quantity nothing cross-checks is where a wrong figure survives.
		 */
		expect(wellGrouped('000 106 236 000,00', ',')).toBe(false);
		expect(wellGrouped('0300 000', ',')).toBe(false);
		expect(wellGrouped('1 30 000', ',')).toBe(false);
		expect(wellGrouped('12345 678', ',')).toBe(false);
	});

	it('reads the thousands mark off the decimal one it is given', () => {
		// French groups with a space and decimals with a comma; English does both
		// with the other pair, and one answer settles both.
		expect(wellGrouped('1,300,000.00', ',')).toBe(false);
		expect(wellGrouped('1 300 000,00', '.')).toBe(false);
	});

	it('says no to nothing at all, and to what is not a number', () => {
		expect(wellGrouped('', ',')).toBe(false);
		expect(wellGrouped('   ', ',')).toBe(false);
		expect(wellGrouped(',50', ',')).toBe(false);
		expect(wellGrouped('-', ',')).toBe(false);
		// Two decimal marks is not a number, and calling its grouping good would
		// pass exactly the ambiguity this refuses.
		expect(wellGrouped('1,300,000.00', ',')).toBe(false);
		expect(wellGrouped('1 300,ab', ',')).toBe(false);
	});
});

describe('accentFree', () => {
	it('folds a label so two spellings of it compare equal', () => {
		// The case every consumer met: one PDF producer writes the accents, the
		// next one drops them, and the same prescribed heading has to be
		// recognised through both.
		expect(accentFree('Inventaire des actifs et passifs')).toBe(
			accentFree('INVENTAIRE DES ACTIFS ET PASSIFS')
		);
		expect(accentFree('Société')).toBe('societe');
		expect(accentFree('BALLAN-MIRÉ')).toBe('ballan-mire');
	});

	it('leaves everything that is not an accent alone', () => {
		// Punctuation, digits and spacing carry information a reader still needs,
		// and folding them here would decide something this library does not know.
		// The eszett is a letter, not an accented one: a caller who folds it to
		// `ss` knows something about German that this file does not.
		expect(accentFree('(en m2) 1 234,56')).toBe('(en m2) 1 234,56');
		expect(accentFree('Straße')).toBe('straße');
		expect(accentFree('')).toBe('');
	});
});
