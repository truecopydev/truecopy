import { describe, expect, it } from 'vitest';
import { checkExtraction, readDocument, type Reader } from './contract.js';
import type { Document } from './document.js';
import { openDocument } from './open.js';
import { documentFromText, pageFrom, documentFrom } from './layout.js';
import {
	checkContract,
	contractReport,
	documentWithoutSubstance,
	failures,
	pdfWithText
} from './kit.js';

/*
 * A toy domain, as plainly simple as possible: rows of "LABEL <value>", and a
 * document that sometimes announces its own total. It exists only to prove that
 * the skeleton drives, and that the kit goes red.
 */
type Line = { label: string; value: number };
type Header = { announcedTotal: number | null };

const TOTAL = /^TOTAL\s+(-?\d+)$/;
const LINE = /^(\D+?)\t(-?\d+)$/;

const toy: Reader<Line, Header> = {
	read(document) {
		const records: Line[] = [];
		let announcedTotal: number | null = null;
		for (const row of document.text.split('\n')) {
			const total = TOTAL.exec(row);
			if (total) {
				announcedTotal = Number.parseInt(total[1], 10);
				continue;
			}
			const line = LINE.exec(row);
			if (line) records.push({ label: line[1].trim(), value: Number.parseInt(line[2], 10) });
		}
		return { records, header: { announcedTotal } };
	},

	selfCheck(_document, reading) {
		if (reading.header.announcedTotal === null) {
			return { nothing: 'this document announces no total' };
		}
		return {
			declared: [reading.header.announcedTotal],
			read: reading.records.reduce((sum, line) => sum + line.value, 0),
			unit: 'points'
		};
	},

	repair(reading, discrepancy) {
		// Flipping one row changes the sum by twice its value, so the row sought
		// carries half the gap. None, or several: give up, because an arbitrary
		// choice is worth less than an honest gap.
		const target = discrepancy.amount / 2;
		const candidates = reading.records.filter((line) => line.value === target);
		if (candidates.length !== 1) return null;
		return {
			...reading,
			records: reading.records.map((line) =>
				line === candidates[0] ? { ...line, value: -line.value } : line
			)
		};
	},

	refuse(_document, reading) {
		if (reading.records.length > 0) return null;
		return {
			title: 'This document carries nothing I can read',
			explanation: 'I find no numbered row in it.',
			next: 'Type the rows in by hand.'
		};
	},

	rowsToReview(_document, reading) {
		return reading.records.map((line) => ({
			raw: `${line.label}\t${line.value}`,
			fields: { label: line.label, value: line.value }
		}));
	}
};

const text = (...lines: string[]): Document => documentFromText(lines.join('\n'), 'toy.txt');

const TOY_PDF = pdfWithText([
	{ word: 'Supplies', x: 50, y: 700 },
	{ word: '4', x: 400, y: 700 },
	{ word: 'Transport', x: 50, y: 680 },
	{ word: '6', x: 400, y: 680 }
]);

/*
 * A reader whose self-check hands back every total the page could be announcing,
 * which is what `labelledValues` produces: a label with several candidate cells
 * under it. The skeleton has to settle on one, and this is the only way to see
 * from the outside which one it settles on.
 */
const announcing = (declared: number[]): Reader<Line, Header> => ({
	...toy,
	repair: undefined,
	selfCheck(_document, reading) {
		return {
			declared,
			read: reading.records.reduce((sum, line) => sum + line.value, 0),
			unit: 'points'
		};
	}
});

describe('the gap between a reading and what its document announces', () => {
	const nineRead = text('A\t4', 'B\t5');

	it('finds no gap when the document announces no candidate at all', () => {
		// An empty list is not a total of zero: nothing was announced, so there is
		// nothing to contradict, and the reading comes back sound.
		const result = readDocument(nineRead, announcing([]));
		expect(result.discrepancy).toBeNull();
		expect(result.verdict).toBe('read');
	});

	it('keeps the smallest gap among the announced values', () => {
		expect(readDocument(nineRead, announcing([20, 8])).discrepancy).toMatchObject({
			amount: 1,
			declared: 8
		});
	});

	it('keeps the first when it is already the best', () => {
		expect(readDocument(nineRead, announcing([9, 20])).discrepancy).toMatchObject({
			amount: 0,
			declared: 9
		});
	});
});

describe('readDocument', () => {
	it('reads as sound when the reading meets what the document announces', () => {
		const result = readDocument(text('A\t4', 'B\t6', 'TOTAL 10'), toy);
		expect(result.verdict).toBe('read');
		expect(result.repaired).toBe(false);
		expect(result.rowsToReview).toHaveLength(2);
	});

	it('reads as sound too when the document announces nothing to check against', () => {
		expect(readDocument(text('A\t4'), toy).verdict).toBe('read');
	});

	it('repairs when the repair is unique, and checks itself again', () => {
		const result = readDocument(text('A\t4', 'B\t3', 'TOTAL 1'), toy);
		expect(result.repaired).toBe(true);
		expect(result.verdict).toBe('read');
		expect(result.reading.records[1].value).toBe(-3);
	});

	it('never returns a reading that contradicts its document as sound', () => {
		const result = readDocument(text('A\t4', 'B\t6', 'TOTAL 99'), toy);
		expect(result.verdict).toBe('needs-review');
		expect(result.discrepancy).toMatchObject({ amount: -89, unit: 'points' });
	});

	it('refuses a document it got nothing out of', () => {
		const result = readDocument(documentWithoutSubstance(), toy);
		expect(result.verdict).toBe('refused');
		expect(result.refusal?.next).toBeTruthy();
	});
});

describe('the kit', () => {
	it('passes a reading that holds the contract', async () => {
		const results = await checkContract(
			toy,
			[
				{ name: 'balances', document: text('A\t4', 'B\t6', 'TOTAL 10'), expected: 'read' },
				{
					name: 'does not balance',
					document: text('A\t4', 'B\t6', 'TOTAL 99'),
					expected: 'needs-review'
				}
			],
			{ referencePdf: TOY_PDF, open: openDocument }
		);
		expect(failures(results)).toEqual([]);
	});

	it('accepts a without-substance document supplied by the project', async () => {
		const results = await checkContract(toy, [], {
			referencePdf: TOY_PDF,
			open: openDocument,
			withoutSubstance: text('Terms and conditions, without a single figure.')
		});
		expect(failures(results)).toEqual([]);
	});

	it('goes red on a reading that never refuses and cannot be reviewed', async () => {
		const mute: Reader<Line, Header> = {
			...toy,
			refuse: () => null,
			rowsToReview: () => [],
			repair: () => null
		};
		const results = await checkContract(
			mute,
			[{ name: 'contradicts', document: text('A\t4', 'TOTAL 99'), expected: 'read' }],
			{ referencePdf: TOY_PDF, open: openDocument }
		);
		const red = failures(results).join(' | ');
		expect(red).toMatch(/expected verdict/);
		expect(red).toMatch(/reviewable/);
		expect(red).toMatch(/without substance/);
	});

	it('goes red when the whole chain yields nothing on a real PDF', async () => {
		const results = await checkContract(toy, [], {
			referencePdf: pdfWithText([{ word: 'Nothing', x: 50, y: 700 }]),
			open: openDocument
		});
		expect(failures(results).join(' | ')).toMatch(/whole chain/);
	});

	it('demands the refusal of a document of another kind', async () => {
		// The rule every reader lacks: a foreign document carries the shape of what
		// is sought without being it.
		const results = await checkContract(toy, [], {
			referencePdf: TOY_PDF,
			open: openDocument,
			foreign: [{ name: 'a meeting report', document: text('A\t4', 'B\t6') }]
		});
		expect(failures(results).join(' | ')).toMatch(/another kind/);
	});
});

describe('the two methods a reader may leave out', () => {
	/*
	 * Five methods before anything runs is a wall, and a wall in front of an
	 * interface gets `return null` written five times. So two of them have a
	 * default, and both defaults err toward refusing.
	 */
	const bare: Reader<Line, Header> = {
		read: toy.read,
		selfCheck: toy.selfCheck,
		rowsToReview: toy.rowsToReview
	};

	it('attempts no repair, which is the honest default', () => {
		// The full reader mends this one by flipping a sign; a reader that wrote no
		// repair is left with the gap, and the gap is said out loud.
		const result = readDocument(text('A\t4', 'B\t3', 'TOTAL 1'), bare);
		expect(result.repaired).toBe(false);
		expect(result.verdict).toBe('needs-review');
	});

	it('refuses a reading that produced no record', () => {
		const result = readDocument(documentWithoutSubstance(), bare);
		expect(result.verdict).toBe('refused');
		expect(result.refusal?.next).toBeTruthy();
	});

	it('lets a sound reading through all the same', () => {
		expect(readDocument(text('A\t4', 'B\t6', 'TOTAL 10'), bare).verdict).toBe('read');
	});

	it('holds the kit with three methods and no more', async () => {
		const results = await checkContract(
			bare,
			[{ name: 'balances', document: text('A\t4', 'B\t6', 'TOTAL 10'), expected: 'read' }],
			{ referencePdf: TOY_PDF, open: openDocument }
		);
		expect(failures(results)).toEqual([]);
	});
});

describe('the report a project commits', () => {
	const run = () =>
		checkContract(
			toy,
			[{ name: 'balances', document: text('A\t4', 'TOTAL 4'), expected: 'read' }],
			{
				referencePdf: TOY_PDF,
				open: openDocument
			}
		);

	it('counts what held and what did not, on the first line', async () => {
		const report = contractReport(await run());
		expect(report.split('\n')[0]).toBe('truecopy contract - 5 rule(s), 5 passed, 0 failed');
	});

	it('carries the counts, so a silent drop shows up as a diff', async () => {
		expect(contractReport(await run())).toContain('1 records, 1 reviewable rows');
	});

	it('is the same text twice, or it could not be diffed at all', async () => {
		expect(contractReport(await run())).toBe(contractReport(await run()));
	});

	it('marks a broken rule so it is found by eye, not only by count', async () => {
		const mute: Reader<Line, Header> = { ...toy, rowsToReview: () => [] };
		const results = await checkContract(
			mute,
			[{ name: 'balances', document: text('A\t4', 'TOTAL 4'), expected: 'read' }],
			{ referencePdf: TOY_PDF, open: openDocument }
		);
		expect(contractReport(results)).toContain('FAIL | 3. everything read is reviewable');
	});
});

describe('a positioned document', () => {
	it('goes through the door then the skeleton', () => {
		const document = documentFrom(
			[
				pageFrom(1, 595, 842, [
					{ text: 'Supplies', x: 50, y: 700, width: 40 },
					{ text: '4', x: 400, y: 700, width: 5 }
				])
			],
			'pdf',
			'note.pdf'
		);
		expect(readDocument(document, toy).reading.records).toEqual([{ label: 'Supplies', value: 4 }]);
	});
});

describe('checkExtraction', () => {
	/*
	 * The rows may come from anywhere - a reader, a spreadsheet, a model handed
	 * the PDF and asked for a table. Nothing here asks where they came from, and
	 * that is precisely why the same check applies to all three.
	 */
	const page = documentFromText(
		['CARTE 12,40', 'VIREMENT 750,00', 'PRELEVEMENT 68,00', 'TOTAL 830,40'].join('\n'),
		'statement.txt'
	);
	const rows = [
		{ label: 'CARTE', amount: 12.4 },
		{ label: 'VIREMENT', amount: 750 },
		{ label: 'PRELEVEMENT', amount: 68 }
	];
	const extraction = {
		records: rows,
		amountOf: (row: { amount: number }) => row.amount,
		declared: [830.4],
		unit: 'EUR'
	};

	it('reads rows that land on what the document declares', () => {
		const result = checkExtraction(page, extraction);
		expect(result.verdict).toBe('read');
		expect(result.discrepancy?.amount).toBe(0);
	});

	it('rounds to the document precision, so a float residue is not a discrepancy', () => {
		// `discrepancy` compares a float subtraction against exactly zero. Left
		// unrounded, a reading that is right to the cent comes back as
		// needs-review, and a check that cries wolf is a check nobody reads.
		const cents = documentFromText(['A 0,10', 'B 0,20', 'TOTAL 0,30'].join('\n'), 'cents.txt');
		const halves = [{ amount: 0.1 }, { amount: 0.2 }];
		expect(halves.reduce((total, row) => total + row.amount, 0)).not.toBe(0.3);
		const result = checkExtraction(cents, {
			records: halves,
			amountOf: (row: { amount: number }) => row.amount,
			declared: [0.3],
			unit: 'EUR'
		});
		expect(result.verdict).toBe('read');
	});

	it('does not let a reading that contradicts its document come back as read', () => {
		const invented = { ...extraction, records: [...rows, { label: 'INVENTED', amount: 99 }] };
		const result = checkExtraction(page, invented);
		expect(result.verdict).toBe('needs-review');
		expect(result.discrepancy?.amount).toBe(99);
	});

	it('flags a row carrying a figure the document does not contain anywhere', () => {
		const invented = { ...extraction, records: [...rows, { label: 'INVENTED', amount: 99 }] };
		expect(checkExtraction(page, invented).rowsToReview).toEqual([
			{ raw: '99', fields: { amount: 99 } }
		]);
	});

	it('shows a flagged row the way the caller words it', () => {
		const invented = {
			...extraction,
			records: [{ label: 'INVENTED', amount: 99 }],
			amountOf: (row: { label: string; amount: number }) => row.amount,
			describe: (row: { label: string; amount: number }) => row.label
		};
		expect(checkExtraction(page, invented).rowsToReview[0].raw).toBe('INVENTED');
	});

	it('counts a figure the document prints with the opposite sign as written', () => {
		const signed = {
			...extraction,
			records: [{ label: 'CARTE', amount: -12.4 }],
			declared: [-12.4]
		};
		expect(checkExtraction(page, signed).rowsToReview).toEqual([]);
	});

	it('reads a figure with the decimal mark the document itself uses', () => {
		// English notation on the page: without it, 48 275 477,16 is nowhere in
		// this document and every row would be flagged.
		const english = documentFromText('TOTAL ACTIF NET 48,275,477.16', 'report.txt');
		const result = checkExtraction(english, {
			records: [{ amount: 48275477.16 }],
			amountOf: (row: { amount: number }) => row.amount,
			declared: [48275477.16],
			unit: 'EUR'
		});
		expect(result.rowsToReview).toEqual([]);
		expect(result.verdict).toBe('read');
	});

	it('says out loud that the caller named nothing to check against', () => {
		// An empty list is not a pass. The reading is not contradicted because
		// nothing was compared, and the result says so in as many words.
		const result = checkExtraction(page, { ...extraction, declared: [] });
		expect(result.selfCheck).toEqual({
			nothing: 'the caller named no figure this document declares about itself'
		});
		expect(result.discrepancy).toBeNull();
	});

	it('refuses an extraction that carries no row at all', () => {
		const result = checkExtraction(page, { ...extraction, records: [] });
		expect(result.verdict).toBe('refused');
	});

	it('takes the decimals the caller says the document prints', () => {
		const grams = documentFromText('TOTAL 1,005', 'weights.txt');
		const result = checkExtraction(grams, {
			records: [{ amount: 0.5025 }, { amount: 0.5025 }],
			amountOf: (row: { amount: number }) => row.amount,
			declared: [1.005],
			unit: 'kg',
			decimals: 3
		});
		expect(result.verdict).toBe('read');
	});
});
