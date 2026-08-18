/*
 * The schema a reading must satisfy: the fields, their formats, the count.
 *
 * A reader written naturally is opportunistic: it looks for signals - a year, a
 * number, an amount - and takes what it finds. The only refusal it can put into
 * words is "I found nothing", so it accepts anything that happens to carry the
 * shape of what it seeks. Measured: a meeting report that merely mentioned a
 * year and four figures came back as a full reading, six findings, one of them
 * at the highest severity.
 *
 * The schema reverses the burden of proof. What is missing is named, never
 * guessed: this library says which rule broke, the application writes the
 * sentence in its own voice.
 *
 * One declaration, two outputs. A schema written once yields the check and the
 * record type - `RecordOf<typeof schema>`. Declaring the shape twice is how the
 * two drift apart, and the one that drifts silently is always the check.
 *
 * A schema is pure data, deliberately: no accessor, no closure, nothing that
 * does not survive JSON. It can be served, versioned, refined by whoever reads
 * the documents, and swapped for another market without a deploy - the same
 * argument `pattern.ts` makes for patterns. The cost is one rule: a record
 * carries each value under the field's own name. A reader whose rows are shaped
 * otherwise flattens them in its own code, where the mapping stays visible.
 *
 * The kind of the document - is it the one expected at all - belongs to
 * `classify.ts`, which asks that question with precedence rules. Two answers to
 * one question always end up disagreeing.
 */

/** What a field may be. A format is not decoration: it bounds. */
export type FieldFormat = 'year' | 'integer' | 'number';

export interface Field {
	format: FieldFormat;
	/** Inclusive. A value outside makes the record non-conforming. */
	minimum?: number;
	maximum?: number;
	/** A conforming record must carry this field. */
	required: boolean;
}

export interface Schema {
	name: string;
	/** By name - and the name is how the value is found on a record. */
	fields: Record<string, Field>;
	/** How many records must conform for the document to count. */
	minimumRecords: number;
	/**
	 * The field whose distinct values are counted, rather than the records.
	 *
	 * This is what separates a table from a document about one single thing. A
	 * payslip carries the vocabulary of retirement and repeats one year; a career
	 * record lines up forty. Counting records does not tell them apart; counting
	 * years does.
	 */
	key?: string;
}

/**
 * The record type the schema describes. A required field is a number, an
 * optional one is a number or nothing - which forces the reader to say which at
 * the point where it builds the row, rather than at the point where something
 * downstream reads it back.
 *
 *     export const CAREER = schemaOf({ ... });
 *     export type CareerRow = RecordOf<typeof CAREER>;
 */
export type RecordOf<S extends Schema> = {
	[Name in keyof S['fields']]: S['fields'][Name]['required'] extends true ? number : number | null;
};

/**
 * Keep a schema's literal types, so `RecordOf` can read them back.
 *
 * It returns its argument unchanged: the whole job is the `const` type
 * parameter, which is what stops TypeScript widening `required: true` into
 * `boolean` and taking the record type down with it.
 */
export const schemaOf = <const S extends Schema>(schema: S): S => schema;

/** What is missing, named. The application turns it into a sentence. */
export type SchemaViolation<Entry = unknown> =
	| { cause: 'too-few-records'; conforming: number; expected: number }
	| { cause: 'out-of-format'; field: string; value: number; record: Entry };

/**
 * The value a record carries for a field, or `null` when it carries none.
 *
 * Anything that is not a number reads as absent, never as zero and never as an
 * error. A record is built by a reader that has already given up on that cell,
 * and null is what giving up looks like; converting here would put into the
 * reading a number the document never held.
 */
function valueIn(record: object, name: string): number | null {
	const value = (record as Record<string, unknown>)[name];
	return typeof value === 'number' ? value : null;
}

function outOfFormat(value: number, field: Field): boolean {
	if (!Number.isFinite(value)) return true;
	if (field.format !== 'number' && !Number.isInteger(value)) return true;
	if (field.minimum !== undefined && value < field.minimum) return true;
	return field.maximum !== undefined && value > field.maximum;
}

/** What counts towards the minimum: the conforming records, or the distinct
 *  values they carry for the key field. */
const conformingCount = (kept: object[], key?: string): number =>
	key ? new Set(kept.map((record) => valueIn(record, key))).size : kept.length;

/**
 * Does the record carry every required field, each within its format?
 *
 * One record, and only its own fields: it knows nothing of how many records a
 * schema demands, nor of the key that makes them distinct. Those are properties
 * of a reading rather than of a row, and `validate` is where they are checked.
 * A caller filtering rows one by one wants this one; a caller judging a whole
 * extraction wants that one.
 */
export function conforms(schema: Schema, record: object): boolean {
	for (const [name, field] of Object.entries(schema.fields)) {
		const value = valueIn(record, name);
		if (value === null) {
			if (field.required) return false;
			continue;
		}
		if (outOfFormat(value, field)) return false;
	}
	return true;
}

/**
 * A schema written somewhere else.
 *
 * Standard Schema is a sixty-line interface that Zod, Valibot, ArkType and
 * TypeBox all implement, and that tRPC and TanStack Form already consume. A
 * project that has declared its row type once, over there, should not declare it
 * again over here - which is the same "one declaration" argument `schemaOf`
 * makes, applied to somebody else's declaration.
 *
 * Only the shape this library needs is named. Depending on the package would
 * turn an interop courtesy into a dependency, over sixty lines of types.
 */
export interface StandardSchema {
	readonly '~standard': {
		readonly version: 1;
		readonly vendor: string;
		readonly validate: (value: unknown) => StandardOutcome | Promise<StandardOutcome>;
	};
}

type StandardOutcome = { readonly issues?: readonly { readonly message: string }[] };

/**
 * The counting rule of this library, over a validator from another one.
 *
 * What the foreign schema decides is whether one record is well formed. What
 * this adds is the part it cannot know: how many well-formed records a document
 * must carry before it counts as that document at all, and whether to count
 * records or distinct keys.
 *
 * Synchronous only, and it says so rather than quietly awaiting: a reading runs
 * inside a screen's render path, and turning it async would spread through every
 * caller for the sake of validators nobody writes asynchronously.
 */
export function validateWith<Entry extends object>(
	schema: StandardSchema,
	records: Entry[],
	rule: { minimumRecords: number; key?: string }
): SchemaViolation<Entry> | null {
	const kept: Entry[] = [];
	for (const record of records) {
		const outcome = schema['~standard'].validate(record);
		if (outcome instanceof Promise) {
			throw new TypeError(
				'truecopy: validateWith cannot use a schema that validates asynchronously'
			);
		}
		if (outcome.issues === undefined || outcome.issues.length === 0) kept.push(record);
	}

	const conforming = conformingCount(kept, rule.key);
	if (conforming < rule.minimumRecords) {
		return { cause: 'too-few-records', conforming, expected: rule.minimumRecords };
	}
	return null;
}

/**
 * Validate a reading against its schema. `null` when it holds, otherwise the
 * first rule that broke - one, because a screen listing three failures is a
 * screen nobody reads.
 *
 * The order is not arbitrary: format first. An absurd value says the document
 * was cut up wrongly, and counting the records of a wrong cut tells you nothing.
 */
export function validate<Entry extends object>(
	schema: Schema,
	records: Entry[]
): SchemaViolation<Entry> | null {
	for (const record of records) {
		for (const [name, field] of Object.entries(schema.fields)) {
			const value = valueIn(record, name);
			if (value !== null && outOfFormat(value, field)) {
				return { cause: 'out-of-format', field: name, value, record };
			}
		}
	}

	const kept = records.filter((record) => conforms(schema, record));
	const conforming = conformingCount(kept, schema.key);
	if (conforming < schema.minimumRecords) {
		return { cause: 'too-few-records', conforming, expected: schema.minimumRecords };
	}

	return null;
}
