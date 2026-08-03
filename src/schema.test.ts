import { describe, expect, expectTypeOf, it } from 'vitest';
import {
	conforms,
	schemaOf,
	validate,
	validateWith,
	type RecordOf,
	type StandardSchema
} from './schema.js';

/*
 * A toy domain: years of a career. It exists only to show what the schema
 * refuses - the business detail lives in the project, never here.
 *
 * The kind of the document is another question, asked by `classify.ts`.
 */
const SCHEMA = schemaOf({
	name: 'years',
	fields: {
		year: { format: 'year', minimum: 1930, maximum: 2030, required: true },
		quarters: { format: 'integer', minimum: 0, maximum: 4, required: false },
		pay: { format: 'number', minimum: 0, required: false }
	},
	minimumRecords: 2
});

type Year = RecordOf<typeof SCHEMA>;

const year = (over: Partial<Year> = {}): Year => ({
	year: 2019,
	quarters: 4,
	pay: 28_500,
	...over
});

describe('the record type, read back off the schema', () => {
	it('makes a required field a number and an optional one nullable', () => {
		expectTypeOf<Year['year']>().toEqualTypeOf<number>();
		expectTypeOf<Year['quarters']>().toEqualTypeOf<number | null>();
	});

	it('carries exactly the declared fields, and no other', () => {
		expectTypeOf<keyof Year>().toEqualTypeOf<'year' | 'quarters' | 'pay'>();
	});
});

describe('conforms', () => {
	it('accepts a record carrying everything, within bounds', () => {
		expect(conforms(SCHEMA, year())).toBe(true);
	});

	it('accepts a record without an optional field', () => {
		expect(conforms(SCHEMA, year({ quarters: null, pay: null }))).toBe(true);
	});

	it('refuses a record without the required field', () => {
		expect(conforms(SCHEMA, { ...year(), year: null })).toBe(false);
	});

	it('refuses a record where the field is not a number at all', () => {
		// A reader that gave up on a cell leaves anything but a number behind, and
		// a required field it gave up on is a record that does not conform.
		expect(conforms(SCHEMA, { ...year(), year: '2019' })).toBe(false);
	});

	it('refuses a value out of bounds, optional or not', () => {
		expect(conforms(SCHEMA, year({ quarters: 7 }))).toBe(false);
		expect(conforms(SCHEMA, year({ quarters: -1 }))).toBe(false);
	});

	it('refuses a decimal where the format asks for an integer', () => {
		expect(conforms(SCHEMA, year({ quarters: 2.5 }))).toBe(false);
		// And accepts it where the format is a number.
		expect(conforms(SCHEMA, year({ pay: 28_500.5 }))).toBe(true);
	});

	it('refuses what is not a finite number', () => {
		expect(conforms(SCHEMA, year({ pay: Number.NaN }))).toBe(false);
	});
});

describe('validate', () => {
	it('lets a reading that holds its schema through', () => {
		expect(validate(SCHEMA, [year({ year: 2018 }), year()])).toBeNull();
	});

	it('names the field out of format, and the record carrying it', () => {
		const wrong = year({ year: 2199 });
		expect(validate(SCHEMA, [year({ year: 2018 }), wrong])).toMatchObject({
			cause: 'out-of-format',
			field: 'year',
			value: 2199,
			record: wrong
		});
	});

	it('takes format before the count: an absurd value says the cut was wrong', () => {
		expect(validate(SCHEMA, [year({ year: 2199 })])).toMatchObject({ cause: 'out-of-format' });
	});

	it('refuses a reading with too few conforming records', () => {
		expect(validate(SCHEMA, [year(), { ...year(), year: null }])).toMatchObject({
			cause: 'too-few-records',
			conforming: 1,
			expected: 2
		});
	});
});

describe('the key, when a document speaks of one single thing', () => {
	const byYear = { ...SCHEMA, key: 'year' };

	it('counts distinct keys and not records', () => {
		// A payslip carries the vocabulary of retirement and repeats one year.
		// Three records, one year: this is not a table.
		const sameYear = [year(), year({ pay: 1 }), year({ pay: 2 })];
		expect(validate(byYear, sameYear)).toMatchObject({
			cause: 'too-few-records',
			conforming: 1,
			expected: 2
		});
	});

	it('lets two distinct years through', () => {
		expect(validate(byYear, [year({ year: 2018 }), year()])).toBeNull();
	});
});

describe('a schema written somewhere else', () => {
	/*
	 * Standard Schema is what Zod, Valibot, ArkType and TypeBox all implement.
	 * A project that declared its row type over there should not declare it again
	 * here - and what this library adds is the part a per-record validator cannot
	 * know: how many well-formed records make a document.
	 *
	 * The stand-in below is what any of them looks like from here.
	 */
	const yearIsPresent = (vendor = 'stand-in'): StandardSchema => ({
		'~standard': {
			version: 1,
			vendor,
			validate: (value) =>
				typeof (value as { year?: unknown }).year === 'number'
					? {}
					: { issues: [{ message: 'year is missing' }] }
		}
	});

	it('counts the records the foreign schema accepts', () => {
		expect(
			validateWith(yearIsPresent(), [{ year: 2018 }, { year: 2019 }], { minimumRecords: 2 })
		).toBeNull();
	});

	it('refuses when too few of them pass', () => {
		expect(
			validateWith(yearIsPresent(), [{ year: 2018 }, { year: null }], { minimumRecords: 2 })
		).toMatchObject({ cause: 'too-few-records', conforming: 1, expected: 2 });
	});

	it('counts distinct keys when asked, which is what tells a table from one thing', () => {
		const sameYear = [{ year: 2019 }, { year: 2019 }, { year: 2019 }];
		expect(
			validateWith(yearIsPresent(), sameYear, { minimumRecords: 2, key: 'year' })
		).toMatchObject({ conforming: 1 });
	});

	it('says so rather than quietly awaiting an asynchronous schema', () => {
		// A reading runs inside a render path. Turning it async would spread
		// through every caller for the sake of validators nobody writes that way.
		const slow: StandardSchema = {
			'~standard': { version: 1, vendor: 'slow', validate: () => Promise.resolve({}) }
		};
		expect(() => validateWith(slow, [{ year: 2018 }], { minimumRecords: 1 })).toThrow(
			/validates asynchronously/
		);
	});
});
