/*
 * A complete reader, in one file that runs.
 *
 *     node example/read-a-statement.mjs
 *
 * It builds a real PDF, opens it, shows what the reading decided, and drives
 * that reading through the contract. Nothing is stubbed: the same call sequence
 * works on a file somebody dropped.
 *
 * The document is invented - a five-line statement that announces its own
 * total - because an example that needs a file you do not have is an example you
 * cannot run.
 */

import {
	cellsOf,
	documentFromText,
	explainDocument,
	findRowAnomalies,
	describeAnomaly,
	isOnlyNumber,
	openDocument,
	readDate,
	readNumber,
	readDocument,
	thresholdsFor
} from 'truecopy';
import { pdfWithText } from 'truecopy/kit';

/* ------------------------------------------------------------------ *
 * 1. A real PDF. Five lines and a total, laid out in three columns.
 * ------------------------------------------------------------------ */

const at = (word, x, y) => ({ word, x, y });
const STATEMENT = pdfWithText([
	at('02/05/2026', 50, 700),
	at('CARTE AMAZON', 150, 700),
	at('12,40', 430, 700),
	at('03/05/2026', 50, 680),
	at('VIR LOYER', 150, 680),
	at('750,00', 430, 680),
	at('05/05/2026', 50, 660),
	at('CARTE SNCF', 150, 660),
	at('68,00', 430, 660),
	at('09/05/2026', 50, 640),
	at('PRLV EDF', 150, 640),
	at('91,32', 430, 640),
	at('12/05/2026', 50, 620),
	at('CARTE BOULANGER', 150, 620),
	at('7,90', 430, 620),
	at('TOTAL DES DEBITS', 150, 600),
	at('929,62', 430, 600)
]);

/* ------------------------------------------------------------------ *
 * 2. What a cell is, in your own words. The library never asks what they mean.
 * ------------------------------------------------------------------ */

const NOTATION = { dateOrder: 'DMY' };

const kindOf = (cell) => {
	if (readDate(cell, NOTATION)) return 'date';
	// Two decimals is what tells money from a reference number. That is domain
	// knowledge, and it stays here.
	if (isOnlyNumber(cell, 2)) return 'amount';
	return 'text';
};

const SIGNATURE = {
	kindOf,
	thresholds: {
		...thresholdsFor(['amount', 'text'], 0.6),
		// A date column that is nearly always filled, with one hole, is a total
		// line: it has no date because it is not an operation.
		date: { share: 0.6, emptyIsAnomalyAbove: 0.7 }
	}
};

/* ------------------------------------------------------------------ *
 * 3. The reader. Three methods - `repair` and `refuse` have safe defaults.
 * ------------------------------------------------------------------ */

const rowsAndAnomalies = (document) => {
	const rows = document.pages.flatMap((page) => cellsOf(page));
	return { rows, anomalies: findRowAnomalies(rows, SIGNATURE) ?? rows.map(() => undefined) };
};

const reader = {
	read(document) {
		const { rows, anomalies } = rowsAndAnomalies(document);
		const records = [];
		let declaredTotal = null;

		rows.forEach((cells, index) => {
			const amount = readNumber(cells[2] ?? '');
			// A row outside the table's own signature is not an operation. Here it
			// is the total, and the total is what the reading gets checked against.
			if (anomalies[index]) {
				if (amount !== null) declaredTotal = amount;
				return;
			}
			const date = readDate(cells[0] ?? '', NOTATION);
			if (date && amount !== null) records.push({ date, label: cells[1], amount });
		});

		return { records, header: { declaredTotal } };
	},

	selfCheck(_document, reading) {
		// The first law: set the reading against what the document says about
		// itself. Saying "it declares nothing" costs a sentence, on purpose.
		if (reading.header.declaredTotal === null) return { nothing: 'no total on this statement' };
		return {
			declared: [reading.header.declaredTotal],
			read: reading.records.reduce((sum, row) => sum + row.amount, 0),
			unit: 'EUR'
		};
	},

	rowsToReview(document) {
		// The document, not the reading: a correction screen has to show the rows
		// that were dropped, and those are not in the reading by definition.
		const { rows, anomalies } = rowsAndAnomalies(document);
		return rows.map((cells, index) => ({
			raw: cells.join(' | '),
			fields: { date: cells[0], label: cells[1], amount: cells[2] },
			droppedBecause: anomalies[index] && describeAnomaly(anomalies[index])
		}));
	}
};

/* ------------------------------------------------------------------ *
 * 4. Run it.
 * ------------------------------------------------------------------ */

const file = new File([STATEMENT], 'statement.pdf', { type: 'application/pdf' });
const document = await openDocument(file);

console.log(explainDocument(document, { signature: SIGNATURE }));

const result = readDocument(document, reader);

console.log(`\nverdict   ${result.verdict}`);
console.log(`records   ${result.reading.records.length}`);
console.log(
	`self-check declared ${result.reading.header.declaredTotal}, read ${result.selfCheck.read}` +
		` -> ${result.discrepancy?.amount ?? 0} off`
);
console.log('\nwhat the person would be shown for review:');
for (const row of result.rowsToReview) {
	console.log(`  ${row.droppedBecause ? 'dropped' : 'kept   '}  ${row.raw}`);
}

// The same reader, on a paste rather than a PDF: one call changes, nothing else.
const pasted = documentFromText('nothing here that looks like a statement', 'paste.txt');
console.log(
	`\nsame reader on a document with no substance -> ${readDocument(pasted, reader).verdict}`
);
