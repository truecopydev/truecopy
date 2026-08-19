/*
 * truecopy - a reading you can certify against the document it came from.
 *
 * Eleven mechanisms, in the order a document meets them:
 *
 *   open       bytes -> pages -> rows, with the caps, the deadline, the release
 *   notation   how the page writes a number and a date, never what they mean
 *   classify   is this the kind of document expected, precedence included
 *   columns    what each column contains, counted once
 *   roles      what each column is, deduced from that
 *   records    which rows belong to the same record, when a row is not one
 *   labels     which cells could be the value a label announces
 *   signature  which rows break the table's own type signature
 *   schema     the fields, the formats, the count a reading must satisfy
 *   cite       the rows a model cited, and whether they carry each value
 *   explain    what all of the above decided, in words, when it went wrong
 *
 * Around them: `contract` says what an honest reading looks like, `kit` makes it
 * compulsory, and `pattern` carries the domain knowledge as data rather than as
 * code.
 *
 * Every mechanism is also its own entry point - `truecopy/signature` - so a
 * project that wants one pays for one.
 */

export type { CoordinateUnit, PositionedItem, Place, Row, TextPage, Document } from './document.js';

export type { Limits, OpenOptions, PdfEngine, Unreadable } from './open.js';
export {
	DEFAULT_LIMITS,
	UnreadableDocument,
	openDocument,
	positionedItems,
	withDeadline
} from './open.js';

export {
	boundariesFromAnchors,
	boundariesFromRecurrence,
	cellsOf,
	columnAt,
	columnBoundaries,
	documentFrom,
	documentFromText,
	gapFor,
	pageFrom,
	placeOf,
	placesOf,
	rowToCells,
	rowsFrom
} from './layout.js';

export type { Doubt, Finding, Table, TableOptions } from './table.js';
export { readTable } from './table.js';

export type { DecimalMark, Notation, FoundNumber, LeadingDate } from './notation.js';
export {
	accentFree,
	decimalMarkOf,
	findNumbers,
	isOnlyNumber,
	numberToken,
	readDate,
	readLeadingDate,
	readNumber,
	wellGrouped
} from './notation.js';

export type { RawPattern, CompileOptions } from './pattern.js';
export { NEVER_MATCHES, compilePattern, countMatches, toRawPattern } from './pattern.js';

export type { PatternSet, Requirement, DocumentKind } from './classify.js';
export { classifyDocument } from './classify.js';

export type { ColumnProfile, ProfileOptions } from './columns.js';
export { cellAt, columnCount, dominantKind, profileColumns } from './columns.js';

export type { RoleRule } from './roles.js';
export { assignRoles } from './roles.js';

export type {
	RecordBlock,
	RecordDoubt,
	RecordFinding,
	Records,
	RecordsOptions
} from './records.js';
export { recordsFrom, spineWidthOf } from './records.js';

export type { Candidate, Cell, Labelled, LabelOptions, Look } from './labels.js';
export { columnOfHeader, labelledValues } from './labels.js';

export type { KindThreshold, SignatureOptions, RowAnomaly } from './signature.js';
export { findRowAnomalies, sharesByKind, thresholdsFor } from './signature.js';

export type {
	FieldFormat,
	Field,
	Schema,
	RecordOf,
	SchemaViolation,
	StandardSchema
} from './schema.js';
export { conforms, schemaOf, validate, validateWith } from './schema.js';

export { carriesNumber, carriesText, citedText, numberedRows } from './cite.js';

export type { ExplainOptions } from './explain.js';
export { describeAnomaly, explainDocument, explainRows } from './explain.js';

export type {
	SelfCheck,
	Discrepancy,
	Extraction,
	Refusal,
	ReviewableRow,
	Reading,
	Reader,
	Verdict,
	ReadResult
} from './contract.js';
export { checkExtraction, readDocument } from './contract.js';

export type { CorpusCase, CheckResult, ContractOptions, PlacedWord } from './kit.js';
export {
	checkContract,
	contractReport,
	documentWithoutSubstance,
	failures,
	pdfWithPages,
	pdfWithText
} from './kit.js';
