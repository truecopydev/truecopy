import { describe, expect, it } from 'vitest';
import { classifyDocument, requirementHolds, type DocumentKind } from './classify.js';

/*
 * These kinds reproduce the precedence of a real filing of financial documents:
 * a bank statement quotes the word "facture" in a transaction label, and
 * without precedence it becomes an invoice.
 */
const IBAN = /\b[A-Z]{2}\d{2}(?:\s?[A-Z0-9]{4}){4,7}\b/;
const bankVocabulary = { all: [/\bdebit\b/i, /\bcredit\b/i, /\bsolde\b/i] };
const bankSignal = { anyOf: [{ all: [IBAN] }, bankVocabulary] };
const oneOf = (pattern: RegExp) => ({ anyOf: [{ all: [pattern] }] });

type Kind = 'loan' | 'card' | 'account' | 'tax' | 'invoice';

const KINDS: DocumentKind<Kind>[] = [
	{ name: 'loan', requires: [bankSignal, oneOf(/\bpret\b/i)] },
	{ name: 'card', requires: [bankSignal, oneOf(/\bcarte\b/i)] },
	{ name: 'account', requires: [bankSignal] },
	{ name: 'tax', requires: [oneOf(/avis d'imposition/i)] },
	{
		name: 'invoice',
		requires: [
			oneOf(/\bfacture\b/i),
			oneOf(/total ttc/i),
			// No IBAN: otherwise it is a statement that merely mentions an invoice.
			{ anyOf: [{ all: [IBAN] }], absent: true }
		]
	}
];

describe('classifyDocument', () => {
	it('reads an account from its vocabulary', () => {
		expect(classifyDocument('Debit Credit Solde du mois', KINDS)).toBe('account');
	});

	it('reads an account from its IBAN alone', () => {
		expect(classifyDocument('Titulaire FR76 3000 4000 0512 3456 7890 143', KINDS)).toBe('account');
	});

	it('refines to a loan before an account: the first kind wins', () => {
		expect(classifyDocument('Debit Credit Solde - tableau de PRET immobilier', KINDS)).toBe('loan');
	});

	it('does not take a statement quoting an invoice for an invoice', () => {
		// The trap precedence exists to avoid.
		const statement = 'Debit Credit Solde\n12/03 PRLV FACTURE EDF total ttc 89,10';
		expect(classifyDocument(statement, KINDS)).toBe('account');
	});

	it('reads an invoice when nothing says bank', () => {
		expect(classifyDocument('FACTURE 2024-0142\nTotal TTC 3 840,00', KINDS)).toBe('invoice');
	});

	it('reads the absence requirement as one', () => {
		const withIban = 'FACTURE 2024-0142 Total TTC 3 840,00 FR76 3000 4000 0512 3456 7890 143';
		// The invoice kind is ruled out by its absence requirement; the account
		// takes it on the IBAN alone, which is the right answer: an invoice filed
		// with a statement is still a bank document.
		expect(classifyDocument(withIban, KINDS)).toBe('account');
		expect(
			classifyDocument(
				withIban,
				KINDS.filter((kind) => kind.name === 'invoice')
			)
		).toBeNull();
	});

	it('returns null when no kind holds', () => {
		expect(classifyDocument('Compte rendu de reunion du 3 avril', KINDS)).toBeNull();
	});

	it('demands several occurrences when the kind asks for them', () => {
		const requirement = { anyOf: [{ all: [/\btrimestre\b/i], occurrences: 2 }] };
		expect(requirementHolds('one trimestre only', requirement)).toBe(false);
		expect(requirementHolds('a trimestre, then another trimestre', requirement)).toBe(true);
	});
});
