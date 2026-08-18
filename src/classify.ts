/*
 * The kind of a document: is it the one expected?
 *
 * The part that matters is precedence. A bank statement quotes the word
 * "facture" in a transaction label; read in the wrong order it is filed as an
 * invoice, and every operation it carries leaves the budget with it. An IBAN, or
 * the debit/credit/balance vocabulary, settles the question before the word
 * invoice is even looked at.
 *
 * Three notions and no more:
 *
 *     a pattern set   every one of its patterns must appear
 *     a requirement   any one of its sets must hold
 *     a kind          all of its requirements must hold, and the first kind wins
 *
 * `absent` inverts a requirement, so "an invoice only when there is no IBAN" is
 * stated rather than smuggled into an ordering that means something else.
 */

import { countMatches } from './pattern.js';

export interface PatternSet {
	all: RegExp[];
	/**
	 * Below this, the word is a coincidence: an article about retirement quotes
	 * "quarter" once and carries years and amounts besides.
	 */
	occurrences?: number;
}

export interface Requirement {
	anyOf: PatternSet[];
	/** Inverts: the requirement holds when no set does. */
	absent?: boolean;
}

export interface DocumentKind<Name extends string> {
	name: Name;
	requires: Requirement[];
}

const setHolds = (text: string, set: PatternSet): boolean =>
	set.all.every((pattern) => countMatches(text, pattern) >= (set.occurrences ?? 1));

function requirementHolds(text: string, requirement: Requirement): boolean {
	const holds = requirement.anyOf.some((set) => setHolds(text, set));
	return requirement.absent === true ? !holds : holds;
}

/**
 * The kind of the document, or `null` when none holds.
 *
 * The order of the list is the precedence, and that is deliberately the only way
 * to express it: a separate priority table always ends up contradicting the
 * order it is read in.
 */
export function classifyDocument<Name extends string>(
	text: string,
	kinds: DocumentKind<Name>[]
): Name | null {
	for (const kind of kinds) {
		if (kind.requires.every((requirement) => requirementHolds(text, requirement))) return kind.name;
	}
	return null;
}
