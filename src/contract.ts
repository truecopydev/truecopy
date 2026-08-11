/*
 * The contract a reading must honour.
 *
 * The skeleton belongs to this library, the meaning to the project. This file
 * knows of no transaction, no quarter, no invoice: it knows the shape of an
 * honest reading, and it makes that shape compulsory.
 *
 * A project plugs in one reader, or two that compete - a positional one when
 * there are coordinates, a line grammar when there are not, and an OCR page is
 * exactly where both apply and the richer read wins. That competition is the
 * project's business; what happens around it is not.
 *
 * The five laws, and where each is held:
 *
 *   1. The document checks itself                 `selfCheck`
 *   2. Refusing beats a plausible table           `refuse`
 *   3. Counting is not measuring                  `read` returns no score
 *   4. The reader proposes, the person confirms   `rowsToReview`
 *   5. Every quantifier is bounded                the project's lint, not here
 *
 * `kit.ts` numbers its own six rules: a law is what a reader is written to, a
 * rule is what a corpus checks it against from the outside.
 */

import type { Document, Place } from './document.js';
import { decimalMarkOf, findNumbers, readNumber } from './notation.js';

/**
 * What the document declares about itself, set against what was read.
 *
 * `declared` is a list: a document may announce several candidate values when
 * its layout scattered a label from its number. The gap kept is the smallest.
 *
 * `{ nothing }` asks the reader to say that the document declares nothing. That
 * costs more than a `null`, and that is the point: the oversight becomes a
 * sentence.
 */
export type SelfCheck = { declared: number[]; read: number; unit: string } | { nothing: string };

export interface Discrepancy {
	amount: number;
	unit: string;
	declared: number;
	read: number;
}

/** What is said when the reader gives up. A refusal with no way out is a dead
 *  end: `next` always carries the following move. */
export interface Refusal {
	title: string;
	explanation: string;
	next: string;
}

export interface ReviewableRow {
	raw: string;
	fields: Record<string, string | number | null>;
	/** Set when the reading dropped the row: the rule it broke. */
	droppedBecause?: string;
	/**
	 * Where this row is on the page, when the reading can say.
	 *
	 * The fourth law is that the reader proposes and the person confirms, and a
	 * person confirms what they can find again. Handed a list of figures they have
	 * to hunt through the document; handed a place they jump to it. Absent on a
	 * reading with no coordinates - a paste, a CSV - and that absence is itself
	 * the honest answer.
	 */
	where?: Place;
}

/**
 * A reading returns two things: the records, and what the document says about
 * itself without being a record - balances, a period, an announced total.
 * Without that second field the self-check has no raw material.
 */
export interface Reading<Entry, Header> {
	records: Entry[];
	header: Header;
}

/**
 * Three methods are required, two are not, and which is which is a judgement.
 *
 * Five methods before anything runs at all is a wall, and a wall in front of an
 * interface has one predictable outcome: whoever meets it writes `return null`
 * five times and ships. That is the very dodge `kit.ts` exists to catch, and the
 * likeliest author of it is now a language model writing from the types.
 *
 * So the two that have an honest default get one, and both defaults err the safe
 * way - toward refusing, never toward accepting:
 *
 *   repair   giving up. An honest gap beats a patch-up.
 *   refuse   refusing a reading that produced no record at all.
 *
 * The three that stay required are the three that carry the doctrine. `read` is
 * the work. `selfCheck` is the first law, and its `{ nothing }` case exists
 * precisely so that "this document declares nothing" costs a sentence instead of
 * a silent null. `rowsToReview` is the fourth law - the reader proposes and the
 * person confirms - and a default of "nothing to review" would quietly remove
 * the person from the loop.
 */
export interface Reader<Entry, Header = void> {
	read(document: Document): Reading<Entry, Header>;

	selfCheck(document: Document, reading: Reading<Entry, Header>): SelfCheck;

	/** Takes the document, not only the reading: a correction screen has to show
	 *  the rows that were dropped, which by definition are not in it. */
	rowsToReview(document: Document, reading: Reading<Entry, Header>): ReviewableRow[];

	/** The smallest repair that closes the gap, or none. Left out, none is
	 *  attempted: an honest gap beats a patch-up. */
	repair?(reading: Reading<Entry, Header>, discrepancy: Discrepancy): Reading<Entry, Header> | null;

	/**
	 * Why this document cannot be checked. Generic for preference: the absence of
	 * the substance, never the recognition of a layout.
	 *
	 * Left out, a reading that produced no record is refused and everything else
	 * is let through. That default is deliberately blunt and deliberately cautious
	 * - it is the floor, not a substitute for knowing what your document has to
	 * carry.
	 */
	refuse?(document: Document, reading: Reading<Entry, Header>): Refusal | null;
}

/** The refusal a reader gets when it writes none. Worded for a person, because
 *  a default that reads like a stack trace is a default nobody replaces. */
const NOTHING_READ: Refusal = {
	title: 'I could not read anything in this document',
	explanation: 'Nothing in it matched what this reader looks for.',
	next: 'Check it is the document expected, or enter the rows by hand.'
};

export type Verdict = 'refused' | 'needs-review' | 'read';

export interface ReadResult<Entry, Header> {
	verdict: Verdict;
	reading: Reading<Entry, Header>;
	selfCheck: SelfCheck;
	discrepancy: Discrepancy | null;
	repaired: boolean;
	refusal: Refusal | null;
	rowsToReview: ReviewableRow[];
}

const refusalWhenNothingRead = <Entry, Header>(reading: Reading<Entry, Header>): Refusal | null =>
	reading.records.length === 0 ? NOTHING_READ : null;

export function discrepancyOf(check: SelfCheck): Discrepancy | null {
	if ('nothing' in check) return null;
	if (check.declared.length === 0) return null;
	let closest = { amount: check.read - check.declared[0], declared: check.declared[0] };
	for (const declared of check.declared) {
		const amount = check.read - declared;
		if (Math.abs(amount) < Math.abs(closest.amount)) closest = { amount, declared };
	}
	return { amount: closest.amount, unit: check.unit, declared: closest.declared, read: check.read };
}

/**
 * Drive a reading, and this is where the doctrine is enforced.
 *
 * The rule imposed is deliberately weaker than "refuse as soon as the reading
 * contradicts the document": a bank statement that does not balance is still
 * usable row by row, while a document whose meaning is its total is not usable
 * at all. Imposing refusal would have excluded the first.
 *
 * So the skeleton imposes the one rule both hold: a reading that contradicts its
 * document never comes back as sound. The project chooses between refusing and
 * asking for review; it cannot choose to say nothing.
 */
export function readDocument<Entry, Header>(
	document: Document,
	reader: Reader<Entry, Header>
): ReadResult<Entry, Header> {
	let reading = reader.read(document);
	let check = reader.selfCheck(document, reading);
	let discrepancy = discrepancyOf(check);
	let repaired = false;

	if (discrepancy !== null && discrepancy.amount !== 0) {
		const mended = reader.repair?.(reading, discrepancy) ?? null;
		if (mended !== null) {
			reading = mended;
			check = reader.selfCheck(document, reading);
			discrepancy = discrepancyOf(check);
			repaired = true;
		}
	}

	const refusal = reader.refuse
		? reader.refuse(document, reading)
		: refusalWhenNothingRead(reading);
	const contradicts = discrepancy !== null && discrepancy.amount !== 0;
	let verdict: Verdict = 'read';
	if (refusal !== null) verdict = 'refused';
	else if (contradicts) verdict = 'needs-review';

	return {
		verdict,
		reading,
		selfCheck: check,
		discrepancy,
		repaired,
		refusal,
		rowsToReview: reader.rowsToReview(document, reading)
	};
}

/**
 * Rows that already exist, and the figure the document declares about them.
 *
 * The rows may come from anywhere: a reader written against this contract, a
 * spreadsheet, or a model that was handed the PDF and asked for a table. Nothing
 * in the pipeline asks where a reading came from, which is exactly why the check
 * applies to all three.
 */
export interface Extraction<Entry> {
	records: readonly Entry[];
	/** The figure each row carries: the one that has to add up. */
	amountOf(record: Entry): number;
	/**
	 * What the document declares about that same total, read from the document
	 * itself. Several when its layout scattered a label from its number - the
	 * closest is the one kept.
	 *
	 * An empty list is allowed and it is not a pass: the check then reports that
	 * this document declares nothing, in as many words.
	 */
	declared: number[];
	unit: string;
	/** How to show a row to a person. Left out, the figure alone. */
	describe?(record: Entry): string;
	/** How many decimals the document prints. Left out, two. */
	decimals?: number;
}

/** What a document prints amounts to, when the caller does not say. */
const CENTS = 2;

/**
 * Check rows against the document they came out of, in one call.
 *
 * The pipeline underneath is `readDocument`, and writing this by hand is the
 * twenty lines everybody writes the same way - which is the argument for it
 * being here rather than in a documentation page. It does the two things that
 * are easy to get wrong:
 *
 *   - it ROUNDS the sum to the document's precision. `discrepancy` compares a
 *     float subtraction against exactly zero, so a cent-sized residue turns a
 *     correct reading into `needs-review`;
 *   - it flags every row carrying a figure that appears NOWHERE in the document,
 *     read with the document's own decimal mark. That is what catches a value
 *     invented outright rather than misread.
 *
 * What it does not do, and cannot: compare the rows against the truth. It
 * compares them against what the document says about itself, which is the only
 * check that can call a reading wrong rather than odd. Two errors that cancel
 * out still pass.
 */
export function checkExtraction<Entry>(
	document: Document,
	extraction: Extraction<Entry>
): ReadResult<Entry, void> {
	const scale = 10 ** (extraction.decimals ?? CENTS);
	const round = (amount: number): number => Math.round(amount * scale) / scale;
	// The document's own notation, so a figure it prints the English way is not
	// counted as absent from a French page.
	const mark = decimalMarkOf(document.text);
	const written = new Set(
		findNumbers(document.text)
			.map((found) => readNumber(found.raw, mark))
			.filter((value) => value !== null)
	);
	const invented = (record: Entry): boolean => {
		const amount = round(extraction.amountOf(record));
		return !written.has(amount) && !written.has(-amount);
	};

	return readDocument<Entry, void>(document, {
		read: () => ({ records: [...extraction.records], header: undefined }),
		selfCheck: (_document, reading) =>
			extraction.declared.length === 0
				? { nothing: 'the caller named no figure this document declares about itself' }
				: {
						declared: extraction.declared,
						read: round(
							reading.records.reduce((sum, record) => sum + extraction.amountOf(record), 0)
						),
						unit: extraction.unit
					},
		rowsToReview: (_document, reading) =>
			reading.records.filter(invented).map((record) => ({
				raw: extraction.describe?.(record) ?? String(extraction.amountOf(record)),
				fields: { amount: extraction.amountOf(record) }
			}))
	});
}
