import { describe, expect, it } from 'vitest';
import {
	findRowAnomalies,
	thresholdsFor,
	type KindThreshold,
	type SignatureOptions
} from './signature.js';

const IS_DATE = /^\d{2}\/\d{2}(?:\/\d{4})?$/;
const IS_AMOUNT = /^-?\d+(?:[ .]\d{3})*,\d{2}$/;

function kindOf(cell: string): string | null {
	if (IS_DATE.test(cell)) return 'date';
	return IS_AMOUNT.test(cell) ? 'amount' : null;
}

const OPTIONS: SignatureOptions = {
	kindOf,
	thresholds: {
		date: { share: 0.5, emptyIsAnomalyAbove: 0.7 },
		amount: { share: 0.7 }
	},
	filledThreshold: 0.9
};

const OPERATIONS = [
	['15/01', 'PRLV ASSURANCE', '58,49'],
	['24/01', 'VIR PAULINE', '45,00'],
	['27/02', 'CB CARREFOUR', '115,00'],
	['03/03', 'LOYER MARS', '1 250,00'],
	['12/03', 'SALAIRE', '3 200,00']
];

describe('findRowAnomalies', () => {
	it('judges nothing when there are too few rows to learn from', () => {
		expect(findRowAnomalies(OPERATIONS.slice(0, 3), OPTIONS)).toBeNull();
	});

	it('lets the rows that hold the signature through', () => {
		expect(findRowAnomalies(OPERATIONS, OPTIONS)).toEqual([
			undefined,
			undefined,
			undefined,
			undefined,
			undefined
		]);
	});

	it('drops the total row without knowing the word total', () => {
		// The whole point: no label is recognised, only the shape speaks. An issuer
		// never seen falls under the same rule.
		const withTotal = [...OPERATIONS, ['TOTAL DES OPERATIONS', '', '4 668,49']];
		const anomalies = findRowAnomalies(withTotal, OPTIONS)!;
		expect(anomalies.slice(0, 5)).toEqual([undefined, undefined, undefined, undefined, undefined]);
		expect(anomalies[5]).toEqual({ cause: 'wrong-kind', column: 0, expected: 'date' });
	});

	it('drops a row whose date is missing, when the column is nearly always filled', () => {
		const withBalance = [...OPERATIONS, ['', 'NOUVEAU SOLDE', '2 821,51']];
		expect(findRowAnomalies(withBalance, OPTIONS)![5]).toEqual({
			cause: 'empty',
			column: 0,
			kind: 'date'
		});
	});

	it('says nothing of an empty money cell, because empty is ordinary there', () => {
		const withoutAmount = [...OPERATIONS, ['18/03', 'VIREMENT EN COURS', '']];
		expect(findRowAnomalies(withoutAmount, OPTIONS)![5]).toBeUndefined();
	});

	it('drops a hole in an always-filled column, whatever its kind', () => {
		// The label is neither a date nor an amount: no kind describes it, only the
		// filled share speaks, and it has to reach the threshold - nine rows in ten.
		const rows = OPERATIONS.map((row) => [...row]);
		for (const day of [18, 19, 20, 21]) rows.push([`${day}/03`, `LABEL ${day}`, '12,00']);
		rows.push(['22/03', '', '13,00']);
		expect(findRowAnomalies(rows, OPTIONS)![9]).toEqual({ cause: 'empty', column: 1 });
	});

	it('judges only the columns whose role is known', () => {
		const withTotal = [...OPERATIONS, ['TOTAL DES OPERATIONS', '', '4 668,49']];
		expect(findRowAnomalies(withTotal, OPTIONS, (column) => column !== 0)![5]).toBeUndefined();
	});

	it('invents no kind where none dominates', () => {
		const vague = [
			['a', 'b'],
			['c', 'd'],
			['e', 'f'],
			['g', 'h'],
			['i', 'j']
		];
		expect(findRowAnomalies(vague, OPTIONS)).toEqual([
			undefined,
			undefined,
			undefined,
			undefined,
			undefined
		]);
	});

	it('holds a row shorter than the others, and condemns nobody for a missing cell', () => {
		// OCR and flattened rows both produce them. Reading past the end must not
		// invent an anomaly: without evidence, say nothing.
		expect(findRowAnomalies([...OPERATIONS, ['18/03']], OPTIONS)![5]).toBeUndefined();
	});

	it('takes a default filled threshold when none is given', () => {
		const options: SignatureOptions = { kindOf: () => null, thresholds: {} };
		const rows = OPERATIONS.map((row) => [...row]);
		for (const day of [18, 19, 20, 21]) rows.push([`${day}/03`, `LABEL ${day}`, '12,00']);
		rows.push(['22/03', '', '13,00']);
		expect(findRowAnomalies(rows, options)![9]).toEqual({ cause: 'empty', column: 1 });
	});
});

describe('thresholdsFor', () => {
	it('gives every kind the same share, which is what most callers want', () => {
		expect(thresholdsFor(['date', 'amount', 'text'], 0.6)).toEqual({
			date: { share: 0.6 },
			amount: { share: 0.6 },
			text: { share: 0.6 }
		});
	});

	it('is spread over, so one kind can keep a rule of its own', () => {
		const thresholds: Record<string, KindThreshold> = {
			...thresholdsFor(['amount', 'text'], 0.6),
			date: { share: 0.6, emptyIsAnomalyAbove: 0.7 }
		};
		expect(thresholds.date.emptyIsAnomalyAbove).toBe(0.7);
		expect(thresholds.amount).toEqual({ share: 0.6 });
	});

	it('names nothing when given nothing', () => {
		expect(thresholdsFor([], 0.6)).toEqual({});
	});
});
