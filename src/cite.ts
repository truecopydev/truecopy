/*
 * The rows a model cited, and whether they really carry each value.
 *
 * A model that turns cells into records fails two ways. The first is visible:
 * it misses a record. The second is not: it returns a PLAUSIBLE value the
 * document never printed - a town deduced from a postcode, a rounded figure, a
 * recomposed date - and that one reads exactly like a successful extraction.
 *
 * The check that separates reading from guessing needs no model and no domain.
 * Hand the model numbered rows, require every record to cite the rows it came
 * from, then look every value up IN THOSE ROWS and nowhere else. A model then
 * cannot produce a fact; it can only point at one the document already
 * carries, and the pipeline around it - the cut, the numbering, this check -
 * is deterministic end to end.
 *
 * Checking against the whole document instead is the trap this module closes:
 * on a two-hundred-page document almost any figure is printed SOMEWHERE, so a
 * document-wide lookup validates values the cited rows never carried.
 * `checkExtraction` stays the arithmetic check against what the document
 * declares about itself; this is the literal check beside it, and the two
 * answer different questions - does the total close, and was each value read
 * or invented.
 *
 * What stays the caller's: which fields are text and which are figures, and
 * what a failed lookup costs. Both were measured to be judgement, not
 * mechanics - a record whose anchoring field cannot be found is worthless,
 * while a record that cannot justify one side field is worth keeping without
 * it. This module says CARRIED or NOT, per value; the policy is yours.
 */

import { findNumbers, readNumber, type DecimalMark } from './notation.js';

/**
 * The rows as a model should receive them: one line per row, its number first,
 * then its cells, separated by ` | `.
 *
 * The number IS the protocol. A model asked for records without it describes
 * where it read them in prose, and prose does not look anything up; asked to
 * cite row numbers, its claim becomes checkable by `citedText` below. `first`
 * exists because a long table is read in overlapping windows, and a row must
 * keep one number across every window it appears in - renumbering from zero
 * would make the same row cite differently in two prompts.
 */
export function numberedRows(rows: readonly (readonly string[])[], first = 0): string {
	return rows.map((row, index) => `${first + index} | ${row.join(' | ')}`).join('\n');
}

/**
 * The text of the rows a record cited, joined once.
 *
 * This is the ONLY source a value may be verified against. A number cited out
 * of range contributes nothing rather than throwing: an invented row number is
 * exactly the kind of claim this module exists to catch, and it is caught by
 * every lookup against the missing text failing, counted by the caller like
 * any other refusal.
 */
export function citedText(
	rows: readonly (readonly string[])[],
	cited: readonly number[],
	first = 0
): string {
	return cited
		.map((number) => rows[number - first])
		.filter((row): row is readonly string[] => row !== undefined)
		.map((row) => row.join(' '))
		.join(' ');
}

/**
 * The shape two texts are compared in.
 *
 * Three tolerances, and not one more. Case, because a document alternates
 * PARIS and Paris from one column to the next. Runs of whitespace, because the
 * cut inserts and swallows spaces - and the non-breaking space is already
 * inside `\s`, which matters because it is the one documents put between
 * thousands. Curly apostrophes, because the same page writes a name both ways.
 *
 * What is NOT tolerated: accents and digits. Folding accents would equate two
 * neighbouring towns, and normalising digits would let in the rounded figure
 * this whole module exists to catch.
 */
const folded = (text: string): string =>
	text.toLowerCase().replace(/[‘’ʼ]/g, "'").replace(/\s+/g, ' ').trim();

/**
 * The words of a text, in order, cut on whitespace AND on hyphens.
 *
 * On hyphens from both sides, because a layout breaks a hyphenated name at the
 * hyphen and throws its tail past the figure columns - the two halves of one
 * town arrive a whole row of figures apart. Cutting both the document and the
 * sought value the same way keeps the comparison symmetric, and a name printed
 * in one piece walks the same path with no special case.
 */
const wordsOf = (text: string): string[] =>
	folded(text)
		.split(' ')
		.flatMap((word) => word.split('-'))
		.filter((word) => word !== '');

/**
 * Is a text value carried by this source?
 *
 * ALL ITS WORDS, IN ORDER - never one contiguous substring. A layout rejects
 * the tail of a name to the far end of its row, past every figure: the name is
 * printed there word for word and in order, but not in one piece. Measured on
 * a real property schedule, a contiguous search refused 104 of one document's
 * 111 records for that reason alone.
 *
 * The guard still holds, because every word must come from the cited rows: an
 * invented value has none of its words there. What it can no longer catch is a
 * RECOMBINATION of words all present and in order - a real but narrow risk,
 * the cited rows covering one record.
 */
export function carriesText(source: string, value: string): boolean {
	const sought = wordsOf(value);
	if (sought.length === 0) return false;
	const words = wordsOf(source);
	let from = 0;
	for (const word of sought) {
		const at = words.indexOf(word, from);
		if (at === -1) return false;
		from = at + 1;
	}
	return true;
}

/**
 * Is a figure carried by this source?
 *
 * ON THE NUMBERS THE PAGE WRITES, never on flattened digits. Flattening the
 * source into one digit soup lets almost any figure occur by accident -
 * measured: a surface of 410 was found three times in a row that carries no
 * 410 at all, so the guard looked strong exactly where it protected nothing.
 * `findNumbers` is the same reader every other check here uses: it knows a
 * thousands group from two numbers, and it never starts a match inside one.
 *
 * Values are compared as READ, with the document's decimal mark on both
 * sides: `1 655` cited as `1655` is the same figure written twice, and is
 * carried; `2 415 065,40` cited as `2 415 065` differs in value - that is the
 * rounding this exists to catch - and is not. Pass the mark from
 * `decimalMarkOf(document.text)`; left out, each figure is read on its own,
 * which is a guess and inherits a guess's failures.
 */
export function carriesNumber(
	source: string,
	value: string,
	decimal?: DecimalMark | null
): boolean {
	const sought = readNumber(value, decimal);
	if (sought === null) return false;
	return findNumbers(source).some((found) => readNumber(found.raw, decimal) === sought);
}
