import { describe, expect, it } from 'vitest';
import { discrepancyOf, readDocument, type Reader } from './contract.js';
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

describe('discrepancyOf', () => {
	it('returns nothing when the document announces nothing', () => {
		expect(discrepancyOf({ nothing: 'none' })).toBeNull();
		expect(discrepancyOf({ declared: [], read: 3, unit: 'points' })).toBeNull();
	});

	it('keeps the smallest gap among the announced values', () => {
		expect(discrepancyOf({ declared: [20, 8], read: 9, unit: 'points' })).toMatchObject({
			amount: 1,
			declared: 8
		});
		// And keeps the first when it is already the best.
		expect(discrepancyOf({ declared: [9, 20], read: 9, unit: 'points' })).toMatchObject({
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
