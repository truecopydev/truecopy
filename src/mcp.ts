/*
 * The reading, served to an agent over MCP.
 *
 * An agent with a terminal already has `npx truecopy`, and one that can import
 * a module has the library itself. Neither is what most hosts are: a host that
 * speaks MCP and nothing else reaches a tool call and nothing else. So the
 * pipeline is offered as tools, and an assistant that has never installed
 * anything can read a document and be told what the reading cannot vouch for.
 *
 * OVER STDIO, AND NOT OVER HTTP. The document stays on the machine it is
 * already on. A bank statement, a payslip and a career record are the worst
 * documents there are to upload, and there is nothing a server could compute
 * here that this package does not compute where the file already sits: it
 * makes no network call, and the reading is deterministic. An endpoint would
 * add a copy of somebody's document to the world and buy nothing with it.
 *
 * This module is the half that DECIDES: the protocol, the tools, and what they
 * answer. The half that talks to the world - stdin, stdout, the filesystem -
 * is `bin/truecopy-mcp.mjs`, and it is thin. Same split as the parsers, for
 * the same reason: what decides is tested, and what touches the world is small
 * enough to read in one sitting.
 *
 * TWO GENERATIONS OF THE PROTOCOL ARE IN SERVICE AND THIS ANSWERS BOTH. Up to
 * 2025-11-25 a client opens with `initialize` and the server replies with the
 * version it will speak. From 2026-07-28 there is no handshake at all: the
 * protocol is stateless, `initialize` is gone from the schema, and a client
 * either probes `server/discover` or simply calls. A server that answers
 * `initialize`, `server/discover` and the tool methods at any moment satisfies
 * both, and none of the three costs anything to keep. Answering only the new
 * one would go silent against every client shipped before July 2026.
 */

import { carriesNumber, carriesText, citedText, numberedRows, type CellJoin } from './cite.js';
import { ORIGINS } from './document.js';
import { describeDoubts, explainReading } from './explain.js';
import { decimalMarkOf, findNumbers, readLeadingDate, type DecimalMark } from './notation.js';
import { UnreadableDocument } from './open.js';
import { readTable, type Finding, type Table } from './table.js';

/** What this server needs from the world, and nothing else. */
export interface McpCapabilities {
	/**
	 * The bytes behind a path.
	 *
	 * Injected rather than imported: this module keeps the library's promise to
	 * touch no filesystem, and the confinement of what may be opened is a
	 * decision for whoever launches the server, not for the protocol.
	 */
	open: (path: string) => Promise<File>;
	/**
	 * The version this server reports as its own - the package's.
	 *
	 * Passed in rather than read from `package.json`, which a browser does not
	 * have and this module may not read.
	 */
	version: string;
}

/** One answer to one request. A notification is answered with `null`. */
export interface McpResponse {
	jsonrpc: '2.0';
	id: string | number | null;
	result?: unknown;
	error?: { code: number; message: string };
}

const SERVER = 'truecopy';

/**
 * The revisions this server speaks, newest first.
 *
 * A client that asks for one of these is answered in it; anything else is
 * answered in the newest, which is what the lifecycle of every revision up to
 * 2025-11-25 prescribes - the client then decides whether it can go on.
 */
const SPOKEN = ['2026-07-28', '2025-11-25', '2025-06-18', '2025-03-26'];

const METHOD_NOT_FOUND = -32601;
const INVALID_PARAMS = -32602;

/**
 * How long a client may hold on to the tool list.
 *
 * The list is a constant of the package: it can only change when the server is
 * replaced by another version of itself, which ends the process. An hour is a
 * bound rather than a measurement, and it costs one call to be wrong.
 */
const TOOLS_TTL_MS = 3_600_000;

/** Rows returned in one call, and the ceiling a caller may raise it to. A
 *  document has no bound and a context window does. */
const DEFAULT_ROWS = 200;
const MAXIMUM_ROWS = 2000;

const PATH_FIELD = {
	type: 'string',
	description: 'Absolute path to the file on this machine. It is read here and never uploaded.'
} as const;

const PAGES_FIELD = {
	type: 'integer',
	minimum: 1,
	description:
		'How many pages to open. Defaults to 40, which bounds a runaway read rather than describing your document: raise it for an annual report.'
} as const;

const DIGEST_FIELD = {
	type: 'string',
	pattern: '^[0-9a-f]{64}$',
	description:
		'The digest read_table returned for this file. When given, the call is refused if the file has changed since: its rows would no longer be the ones numbered.'
} as const;

const FINDING_SCHEMA = {
	type: 'object',
	properties: {
		code: {
			type: 'string',
			enum: ['blank-page', 'no-column', 'thin-column', 'merged-column', 'pages-disagree']
		},
		message: { type: 'string' },
		page: { type: 'integer' },
		column: { type: 'integer' },
		shareFilled: { type: 'number' },
		shareDoubled: { type: 'number' }
	},
	required: ['code', 'message']
} as const;

/**
 * The one word a model reads before it leans on a figure.
 *
 * `unreadable`: the file did not open, so there is no row to lean on.
 * `doubtful`: it opened, and at least one thing looked wrong from the shape
 * of the page; the findings say what and where.
 * `reliable`: nothing looked wrong. That is NOT "this reading is right": it
 * is the smaller claim this package can make, and it is only ever made in
 * those words, so the sentence travels with the word everywhere it is shown.
 * A host that passes on the data and not the text still gets the word, and a
 * model that reads it as a guarantee has read the opposite of what was
 * measured - which is why no tool here answers without it.
 */
export type Verdict = 'reliable' | 'doubtful' | 'unreadable';

const VERDICT_FIELD = { type: 'string', enum: ['reliable', 'doubtful', 'unreadable'] } as const;

const REASON_FIELD = {
	type: 'string',
	description:
		'Why the file did not open, when the library could tell: empty, too-big, no-text, too-slow, or the kind of bytes it was. Only on an unreadable verdict.'
} as const;

/**
 * What a tool answers: the reading, or the refusal every tool shares.
 *
 * A refusal travels as `{ verdict: 'unreadable', reason? }`, with no row, no
 * file name and no count, and the schema has to say so. A host that validates
 * `structuredContent` against a schema requiring `rows` rejects the refusal,
 * and the one answer that says "do not lean on this" is the one that is lost.
 */
function answerOrRefusal<Properties extends object, Required extends readonly string[]>(answer: {
	properties: Properties;
	required: Required;
}) {
	return {
		type: 'object',
		properties: { ...answer.properties, reason: REASON_FIELD },
		required: ['verdict'],
		oneOf: [
			{
				properties: { verdict: { type: 'string', enum: ['reliable', 'doubtful'] } },
				required: answer.required
			},
			{ properties: { verdict: { type: 'string', enum: ['unreadable'] } }, required: ['verdict'] }
		]
	} as const;
}

/**
 * The verdict of a reading that opened: doubtful as soon as one thing looked
 * wrong, or as soon as `maximumPages` left a page unread. A reading cut at the
 * bound has nothing wrong on the pages it holds, and is still not the document.
 */
export function verdictOf(findings: readonly Finding[], pagesUnread = 0): Verdict {
	return findings.length === 0 && pagesUnread === 0 ? 'reliable' : 'doubtful';
}

const tableVerdict = (table: Table): Verdict =>
	verdictOf(table.findings, table.document.pagesUnread);

const RELIABLE_MEANS =
	'nothing looked wrong from the shape of the page. That is not the same as "this reading is right".';

function verdictLine(table: Table): string {
	if (tableVerdict(table) === 'reliable') return `verdict: reliable - ${RELIABLE_MEANS}`;
	const unread = table.document.pagesUnread ?? 0;
	const reasons = [
		...(table.findings.length === 0 ? [] : [`${table.findings.length} thing(s) looked wrong`]),
		...(unread === 0 ? [] : [`${unread} page(s) left unread past maximumPages`])
	];
	return `verdict: doubtful - ${reasons.join(', and ')}. Read the doubts below before leaning on a figure.`;
}

const ROWS_FIELDS = {
	from: {
		type: 'integer',
		minimum: 1,
		description:
			'First row to look in, 1 for the start. Rows keep the numbers read_table gave them.'
	},
	limit: {
		type: 'integer',
		minimum: 1,
		maximum: MAXIMUM_ROWS,
		description: `Rows to look in, at most ${MAXIMUM_ROWS}. Defaults to ${DEFAULT_ROWS}. What is left is counted and named, never silently dropped.`
	}
} as const;

const PLACED_FIELDS = {
	row: {
		type: 'integer',
		description: 'The row, numbered as read_table numbers it: cite it in check_citations.'
	},
	column: { type: 'integer', description: 'The column, 1 for the leftmost.' },
	written: { type: 'string', description: 'The characters the page printed, untouched.' }
} as const;

const READ_ONLY = {
	readOnlyHint: true,
	destructiveHint: false,
	idempotentHint: true,
	openWorldHint: false
} as const;

/**
 * The tools, and the sentences a model chooses between them by.
 *
 * A description here is not documentation, it is the prompt a host pastes in
 * front of a model, so each one says what the tool answers and what it does
 * NOT prove. The second half is the one that matters: this package exists
 * because a plausible table nobody checks is worse than no table, and a model
 * that reads "reads tables from PDFs" and stops has learnt the opposite.
 */
export const TOOLS = [
	{
		name: 'read_table',
		title: 'Read a table out of a document',
		description:
			'Read a PDF, a CSV, a TSV or a saved paste on this machine into rows, and say what the reading cannot vouch for. Returns the cut into columns, what each column holds, the rows numbered for check_citations, and the doubts. An empty list of doubts is NOT a promise that the reading is right: it means nothing looked wrong from the shape of the page. The file is read on this machine and never uploaded.',
		inputSchema: {
			type: 'object',
			properties: {
				path: PATH_FIELD,
				from: {
					type: 'integer',
					minimum: 1,
					description: 'First row to return, 1 for the start. Rows keep these numbers.'
				},
				limit: {
					type: 'integer',
					minimum: 1,
					maximum: MAXIMUM_ROWS,
					description: `Rows to return, at most ${MAXIMUM_ROWS}. Defaults to ${DEFAULT_ROWS}. What is left is counted and named, never silently dropped.`
				},
				maximumPages: PAGES_FIELD,
				digest: DIGEST_FIELD
			},
			required: ['path'],
			additionalProperties: false
		},
		outputSchema: answerOrRefusal({
			properties: {
				file: { type: 'string' },
				digest: { type: 'string' },
				verdict: VERDICT_FIELD,
				origin: { type: 'string', enum: [...ORIGINS] },
				rows: { type: 'array', items: { type: 'array', items: { type: 'string' } } },
				firstRowNumber: { type: 'integer' },
				totalRows: { type: 'integer' },
				more: { type: 'boolean' },
				pagesUnread: { type: 'integer', minimum: 0 },
				pages: {
					type: 'array',
					items: {
						type: 'object',
						properties: {
							number: { type: 'integer' },
							boundaries: { type: 'array', items: { type: 'number' } }
						},
						required: ['number', 'boundaries']
					}
				},
				findings: { type: 'array', items: FINDING_SCHEMA }
			},
			required: [
				'file',
				'verdict',
				'origin',
				'rows',
				'firstRowNumber',
				'totalRows',
				'more',
				'pagesUnread',
				'pages',
				'findings'
			]
		}),
		annotations: READ_ONLY
	},
	{
		name: 'find_amounts',
		title: 'Find the figures a document prints, with the row to cite',
		description:
			'Find every figure written with a given number of decimals in a document on this machine: the value, the characters as printed, and the row and column they sit in, numbered as read_table numbers them. Two decimals is how a page tells a sum of money from a reference number without knowing what money is; ask for 0 decimals to take every number. The answer opens with the verdict of the reading, reliable, doubtful or unreadable, and reliable only means nothing looked wrong. What a figure MEANS - a debit, a balance, a date written as digits - is not read here: that is the reading, and check_citations is how a claim about it is checked. The file is read on this machine and never uploaded.',
		inputSchema: {
			type: 'object',
			properties: {
				path: PATH_FIELD,
				decimals: {
					type: 'integer',
					minimum: 0,
					maximum: 6,
					description:
						'Exactly how many decimals a figure must be written with. Defaults to 2. 0 takes every number, reference numbers included.'
				},
				...ROWS_FIELDS,
				maximumPages: PAGES_FIELD
			},
			required: ['path'],
			additionalProperties: false
		},
		outputSchema: answerOrRefusal({
			properties: {
				file: { type: 'string' },
				verdict: VERDICT_FIELD,
				decimals: { type: 'integer' },
				amounts: {
					type: 'array',
					items: {
						type: 'object',
						properties: { ...PLACED_FIELDS, value: { type: 'number' } },
						required: ['row', 'column', 'written', 'value']
					}
				},
				firstRowNumber: { type: 'integer' },
				totalRows: { type: 'integer' },
				more: { type: 'boolean' },
				findings: { type: 'array', items: FINDING_SCHEMA }
			},
			required: [
				'file',
				'verdict',
				'decimals',
				'amounts',
				'firstRowNumber',
				'totalRows',
				'more',
				'findings'
			]
		}),
		annotations: READ_ONLY
	},
	{
		name: 'find_dates',
		title: 'Find the dates a document prints, with the row to cite',
		description:
			'Find every cell that starts with a date in a document on this machine: the calendar date, the characters as printed, and the row and column they sit in, numbered as read_table numbers them. The order of day and month is STATED, never guessed: there is no reading of 01/02/2026 that is right everywhere. A row that prints a day and a month without a year is a date only when the year is given, which is how a statement dates its rows. The answer opens with the verdict of the reading, reliable, doubtful or unreadable, and reliable only means nothing looked wrong. The file is read on this machine and never uploaded.',
		inputSchema: {
			type: 'object',
			properties: {
				path: PATH_FIELD,
				dateOrder: {
					type: 'string',
					enum: ['DMY', 'MDY'],
					description:
						'Which of the first two numbers is the day. Defaults to DMY, which is how most of the world outside the United States writes a date.'
				},
				year: {
					type: 'integer',
					minimum: 1900,
					maximum: 2200,
					description:
						'The year a row without one belongs to, stated once at the top of the document. Left out, such a row is not a date.'
				},
				...ROWS_FIELDS,
				maximumPages: PAGES_FIELD
			},
			required: ['path'],
			additionalProperties: false
		},
		outputSchema: answerOrRefusal({
			properties: {
				file: { type: 'string' },
				verdict: VERDICT_FIELD,
				dateOrder: { type: 'string', enum: ['DMY', 'MDY'] },
				dates: {
					type: 'array',
					items: {
						type: 'object',
						properties: {
							...PLACED_FIELDS,
							date: { type: 'string', description: 'The calendar date, as YYYY-MM-DD.' }
						},
						required: ['row', 'column', 'written', 'date']
					}
				},
				firstRowNumber: { type: 'integer' },
				totalRows: { type: 'integer' },
				more: { type: 'boolean' },
				findings: { type: 'array', items: FINDING_SCHEMA }
			},
			required: [
				'file',
				'verdict',
				'dateOrder',
				'dates',
				'firstRowNumber',
				'totalRows',
				'more',
				'findings'
			]
		}),
		annotations: READ_ONLY
	},
	{
		name: 'check_citations',
		title: 'Check values against the rows they were read from',
		description:
			'Verify that every value really appears in the rows it cites. A model turning cells into records fails one visible way, it misses a record, and one invisible way: it returns a plausible value the document never printed - a town deduced from a postcode, a rounded figure, a recomposed date - which reads exactly like a successful extraction. Each value is looked up in the cited rows and NOWHERE else, so nothing can be produced, only pointed at. A JSON number is checked as a figure, a JSON string as its words in order. Cite the row numbers read_table returned, for the same file and the same maximumPages: a different page bound is a different reading, and its rows are numbered differently. Pass back the digest read_table returned, and a file changed since is refused rather than checked against rows it no longer has.',
		inputSchema: {
			type: 'object',
			properties: {
				path: PATH_FIELD,
				records: {
					type: 'array',
					description: 'The records read, each citing the rows it came from.',
					items: {
						type: 'object',
						properties: {
							rows: {
								type: 'array',
								items: { type: 'integer', minimum: 1 },
								minItems: 1,
								description: 'Row numbers as read_table numbered them.'
							},
							values: {
								type: 'object',
								description:
									'The fields claimed for this record. A JSON number is checked as a figure, a JSON string as words in order.',
								additionalProperties: { type: ['string', 'number'] }
							}
						},
						required: ['rows', 'values'],
						additionalProperties: false
					}
				},
				maximumPages: PAGES_FIELD,
				digest: DIGEST_FIELD,
				cells: {
					type: 'string',
					enum: ['joined', 'apart'],
					description:
						'joined (default) reads the cited cells as one text, so a figure the cut split in two is still found, and two cells 12 and 345 also carry 12345. apart reads no number and no word across two cells.'
				}
			},
			required: ['path', 'records'],
			additionalProperties: false
		},
		outputSchema: answerOrRefusal({
			properties: {
				file: { type: 'string' },
				digest: { type: 'string' },
				verdict: VERDICT_FIELD,
				checked: { type: 'integer' },
				carried: { type: 'integer' },
				records: {
					type: 'array',
					items: {
						type: 'object',
						properties: {
							record: { type: 'integer' },
							rows: { type: 'array', items: { type: 'integer' } },
							missing: {
								type: 'array',
								items: {
									type: 'object',
									properties: { field: { type: 'string' }, value: { type: 'string' } },
									required: ['field', 'value']
								}
							}
						},
						required: ['record', 'rows', 'missing']
					}
				}
			},
			required: ['file', 'verdict', 'checked', 'carried', 'records']
		}),
		annotations: READ_ONLY
	}
] as const;

/** What a tool answers: the words for the model, the data for the program. */
interface Outcome {
	text: string;
	data?: unknown;
	failed?: boolean;
}

/* An argument, read defensively. A host validates against `inputSchema`, and
 * a host that does not is exactly the one whose mistakes have to be answered
 * rather than thrown. */
function stringAt(args: Record<string, unknown>, name: string): string | null {
	const value = args[name];
	return typeof value === 'string' && value.trim() !== '' ? value : null;
}

/**
 * A whole number within the bounds its schema states: the default when absent,
 * null when what came is neither. Null is ANSWERED, never rounded or dropped:
 * `decimals: 2.5` read as 2, or a year out of range read as no year, returns
 * plausible figures under a `reliable` verdict, which is the one failure this
 * server exists to prevent.
 */
function boundedAt(
	args: Record<string, unknown>,
	name: string,
	fallback: number,
	lowest: number,
	highest: number
): number | null;
function boundedAt(
	args: Record<string, unknown>,
	name: string,
	fallback: undefined,
	lowest: number,
	highest: number
): number | undefined | null;
function boundedAt(
	args: Record<string, unknown>,
	name: string,
	fallback: number | undefined,
	lowest: number,
	highest: number
): number | undefined | null {
	const value = args[name] ?? fallback;
	if (value === undefined) return undefined;
	return typeof value === 'number' && Number.isInteger(value) && value >= lowest && value <= highest
		? value
		: null;
}

/** The order of day and month, stated or defaulted, and never read off a typo. */
function dateOrderAt(args: Record<string, unknown>): 'DMY' | 'MDY' | null {
	const value = args.dateOrder ?? 'DMY';
	return value === 'DMY' || value === 'MDY' ? value : null;
}

/** How the cited cells are joined, stated or defaulted, and never read off a typo. */
function cellsAt(args: Record<string, unknown>): CellJoin | null {
	const value = args.cells ?? 'joined';
	return value === 'joined' || value === 'apart' ? value : null;
}

/** An argument the schema does not admit is refused by name, so the caller fixes the call. */
function badArgument(tool: string, name: string, expected: string): Outcome {
	return { text: `${tool}: ${name} must be ${expected}.`, failed: true };
}

/** The pages a call opens and the rows it looks in, each as its schema states. */
type Bounds = { maximumPages: number | undefined; from: number; limit: number };

/**
 * The bounds of a call, or the refusal owed to the first one its schema does
 * not admit. A `limit` over the maximum used to be cut down to it and a
 * `from` of 0 read as the start, both in silence: a caller that asked for
 * rows 0 to 5000 got rows 1 to 2000 under a `reliable` verdict, with
 * nothing to tell it the window was not the one it asked for.
 */
function boundsOf(args: Record<string, unknown>, tool: string): Bounds | Outcome {
	const whole = Number.MAX_SAFE_INTEGER;
	const maximumPages = boundedAt(args, 'maximumPages', undefined, 1, whole);
	if (maximumPages === null)
		return badArgument(tool, 'maximumPages', 'a whole number of 1 or more');
	const from = boundedAt(args, 'from', 1, 1, whole);
	if (from === null) return badArgument(tool, 'from', 'a whole number of 1 or more');
	const limit = boundedAt(args, 'limit', DEFAULT_ROWS, 1, MAXIMUM_ROWS);
	if (limit === null) {
		return badArgument(tool, 'limit', `a whole number from 1 to ${MAXIMUM_ROWS}`);
	}
	return { maximumPages, from, limit };
}

const refused = (bounds: Bounds | Outcome): bounds is Outcome => 'text' in bounds;

/** The reading, once, for whichever tool asked. */
async function reading(
	capabilities: McpCapabilities,
	path: string,
	maximumPages: number | undefined
): Promise<Table> {
	return readTable(
		await capabilities.open(path),
		maximumPages === undefined ? {} : { maximumPages }
	);
}

/**
 * The refusal owed to a call made against an earlier version of the file, or
 * null. Every call opens the path again, so a second page or a check could
 * otherwise land on a file replaced in between, with row numbers that belong
 * to the first one. A caller that sends no digest has asked for no such check.
 */
function changedSince(args: Record<string, unknown>, table: Table): Outcome | null {
	const expected = stringAt(args, 'digest');
	if (expected === null || expected === table.document.digest) return null;
	return {
		text: `${table.document.name} has changed since the reading of digest ${expected}: its rows are no longer the ones numbered. Call read_table again.`,
		failed: true
	};
}

/**
 * The rows a call returns, and what it leaves behind.
 *
 * Bounded because a document has no bound and a context window does; ANNOUNCED
 * because a listing cut in silence reads as a document that ends there, which
 * is how a missing row becomes a row that is not there.
 */
function windowOf(table: Table, { from, limit }: Bounds) {
	const rows = table.rows.slice(from - 1, from - 1 + limit);
	return { from, rows, total: table.rows.length, more: from - 1 + rows.length < table.rows.length };
}

function rowBlock(cut: ReturnType<typeof windowOf>): string {
	if (cut.rows.length === 0) {
		return `no row at ${cut.from}: this reading has ${cut.total} row(s).`;
	}
	const last = cut.from + cut.rows.length - 1;
	const rest = cut.more
		? `\n\n... ${cut.total - last} more row(s). Call read_table again with from: ${last + 1}.`
		: '';
	return [
		`rows ${cut.from} to ${last} of ${cut.total}, in full and numbered as check_citations`,
		'reads them - the listing above is cut to the width of a column, this one is not:',
		'',
		numberedRows(cut.rows, cut.from) + rest
	].join('\n');
}

async function runReadTable(
	args: Record<string, unknown>,
	capabilities: McpCapabilities
): Promise<Outcome> {
	const path = stringAt(args, 'path');
	if (path === null) return { text: 'read_table needs a path to a file.', failed: true };
	const bounds = boundsOf(args, 'read_table');
	if (refused(bounds)) return bounds;

	const table = await reading(capabilities, path, bounds.maximumPages);
	const changed = changedSince(args, table);
	if (changed !== null) return changed;
	const cut = windowOf(table, bounds);
	/*
	 * The listing explain would print is suppressed here and printed below
	 * instead, numbered ACROSS the document rather than restarting on each page.
	 * A citation names one row of one reading, so two numberings would be one
	 * numbering too many, and the ambiguity would fall on the check that exists
	 * to remove exactly this kind of doubt.
	 */
	const report = explainReading(table, { maximumRows: 0 });
	return {
		text: [report, verdictLine(table), rowBlock(cut), describeDoubts(table.warnings)].join('\n\n'),
		data: {
			file: table.document.name,
			digest: table.document.digest,
			verdict: tableVerdict(table),
			origin: table.document.origin,
			rows: cut.rows,
			firstRowNumber: cut.from,
			totalRows: cut.total,
			more: cut.more,
			pagesUnread: table.document.pagesUnread ?? 0,
			pages: table.document.pages.map((page, index) => ({
				number: page.pageNumber,
				boundaries: table.boundaries[index]
			})),
			findings: table.findings
		}
	};
}

/** Something found in a cell, placed where a citation can point at it. */
interface Placed {
	row: number;
	column: number;
	written: string;
}

/**
 * Every cell of the window, with the row and column a citation names.
 *
 * Walked cell by cell rather than over the row's text: a figure is where the
 * page printed it, and the column is half of where. The window is the same
 * one read_table serves, so the numbers agree.
 */
function placedCells(
	cut: ReturnType<typeof windowOf>
): { cell: string; row: number; column: number }[] {
	return cut.rows.flatMap((cells, offset) =>
		cells.map((cell, column) => ({ cell, row: cut.from + offset, column: column + 1 }))
	);
}

/** What a listing says about the rows it did not reach. */
function leftBehind(cut: ReturnType<typeof windowOf>, tool: string): string {
	if (cut.rows.length === 0) return `no row at ${cut.from}: this reading has ${cut.total} row(s).`;
	const last = cut.from + cut.rows.length - 1;
	const span = `in rows ${cut.from} to ${last} of ${cut.total}`;
	return cut.more
		? `${span}; ${cut.total - last} more row(s) not looked in. Call ${tool} again with from: ${last + 1}.`
		: span;
}

/** The whole answer of a finder: the verdict first, then the list, then the doubts. */
function foundText(table: Table, head: string, lines: string[], tail: string): string {
	return [
		`truecopy - ${table.document.name}`,
		verdictLine(table),
		'',
		head,
		...lines,
		'',
		tail,
		'',
		describeDoubts(table.warnings)
	].join('\n');
}

function foundData(table: Table, cut: ReturnType<typeof windowOf>, own: object) {
	return {
		file: table.document.name,
		verdict: tableVerdict(table),
		...own,
		firstRowNumber: cut.from,
		totalRows: cut.total,
		more: cut.more,
		findings: table.findings
	};
}

async function runFindAmounts(
	args: Record<string, unknown>,
	capabilities: McpCapabilities
): Promise<Outcome> {
	const path = stringAt(args, 'path');
	if (path === null) return { text: 'find_amounts needs a path to a file.', failed: true };

	const decimals = boundedAt(args, 'decimals', 2, 0, 6);
	if (decimals === null) {
		return badArgument('find_amounts', 'decimals', 'a whole number from 0 to 6');
	}
	const bounds = boundsOf(args, 'find_amounts');
	if (refused(bounds)) return bounds;
	const table = await reading(capabilities, path, bounds.maximumPages);
	const cut = windowOf(table, bounds);
	const amounts: (Placed & { value: number })[] = placedCells(cut).flatMap(
		({ cell, row, column }) =>
			findNumbers(cell, decimals === 0 ? undefined : decimals).map((found) => ({
				row,
				column,
				written: found.raw.trim(),
				value: found.value
			}))
	);
	const which = decimals === 0 ? 'number(s)' : `figure(s) written with ${decimals} decimal(s)`;
	return {
		text: foundText(
			table,
			`${amounts.length} ${which} ${leftBehind(cut, 'find_amounts')}`,
			amounts.map(
				(amount) =>
					`  row ${amount.row}, column ${amount.column}: ${amount.written} -> ${amount.value}`
			),
			'a figure is where the page printed it, with the row to cite in check_citations. What it means - a debit, a balance, a reference - is not read here.'
		),
		data: foundData(table, cut, { decimals, amounts })
	};
}

/**
 * A calendar date as YYYY-MM-DD, read in LOCAL time on purpose: `readLeadingDate`
 * builds its Date with `new Date(year, month, day)`, in local time, so the UTC
 * getters would shift a date west of Greenwich to the day before.
 */
function isoDay(date: Date): string {
	const two = (part: number) => String(part).padStart(2, '0');
	return `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())}`;
}

async function runFindDates(
	args: Record<string, unknown>,
	capabilities: McpCapabilities
): Promise<Outcome> {
	const path = stringAt(args, 'path');
	if (path === null) return { text: 'find_dates needs a path to a file.', failed: true };

	const dateOrder = dateOrderAt(args);
	if (dateOrder === null) {
		return badArgument('find_dates', 'dateOrder', 'DMY or MDY: the order is stated, never guessed');
	}
	const year = boundedAt(args, 'year', undefined, 1900, 2200);
	if (year === null) return badArgument('find_dates', 'year', 'a whole year from 1900 to 2200');
	const bounds = boundsOf(args, 'find_dates');
	if (refused(bounds)) return bounds;
	const table = await reading(capabilities, path, bounds.maximumPages);
	const cut = windowOf(table, bounds);
	const dates: (Placed & { date: string })[] = placedCells(cut).flatMap(({ cell, row, column }) => {
		const found = readLeadingDate(cell, { dateOrder }, year);
		return found === null
			? []
			: [{ row, column, written: cell.slice(0, found.length).trim(), date: isoDay(found.date) }];
	});
	return {
		text: foundText(
			table,
			`${dates.length} date(s), day and month read as ${dateOrder}, ${leftBehind(cut, 'find_dates')}`,
			dates.map(
				(found) => `  row ${found.row}, column ${found.column}: ${found.written} -> ${found.date}`
			),
			'the order of day and month was stated, not read off the page: a date that reads both ways is a date in the order you gave.'
		),
		data: foundData(table, cut, { dateOrder, dates })
	};
}

/** One claimed field, against the text of the rows it cited. */
function carried(source: string, value: string | number, mark: DecimalMark | null): boolean {
	if (typeof value === 'string') return carriesText(source, value);
	/*
	 * Written with the document's own mark before it is looked up. `42.5` handed
	 * to a page that separates its thousands with a dot reads as 425, and the
	 * check would then refuse a figure the document does carry.
	 */
	const written = mark === ',' ? String(value).replace('.', ',') : String(value);
	return carriesNumber(source, written, mark);
}

/** What a caller must have sent for one record. */
interface Claim {
	rows: number[];
	values: Record<string, string | number>;
}

/**
 * One record as claimed, or nothing.
 *
 * Read strictly, and a caller that sends something else is refused rather than
 * partly understood: a record whose `rows` came through as a string would be
 * checked against no text at all and every one of its values reported missing,
 * which is a wrong answer wearing the shape of a right one.
 */
function claimAt(value: unknown): Claim | null {
	if (typeof value !== 'object' || value === null) return null;
	const { rows, values } = value as { rows?: unknown; values?: unknown };
	if (!Array.isArray(rows) || rows.some((row) => !Number.isInteger(row))) return null;
	if (typeof values !== 'object' || values === null || Array.isArray(values)) return null;

	const fields = Object.entries(values);
	if (fields.some(([, field]) => typeof field !== 'string' && typeof field !== 'number'))
		return null;
	return { rows: rows as number[], values: Object.fromEntries(fields) as Claim['values'] };
}

/** One record checked: which of its values the rows it cited do not carry. */
function checkOne(
	claim: Claim,
	index: number,
	rows: string[][],
	mark: DecimalMark | null,
	cells: CellJoin
) {
	const source = citedText(rows, claim.rows, 1, cells);
	return {
		record: index + 1,
		rows: claim.rows,
		missing: Object.entries(claim.values)
			.filter(([, value]) => !carried(source, value, mark))
			.map(([field, value]) => ({ field, value: String(value) }))
	};
}

/**
 * What the check says, and what it deliberately does not say.
 *
 * A clean result gets the second sentence for the same reason an empty list of
 * doubts does: this check sees an INVENTED value, never a missing record, and
 * a reader who takes "all carried" for "the reading is complete" has been told
 * the opposite of what was measured.
 */
function citationText(table: Table, checked: number, missing: string[]): string {
	const head = `truecopy - ${table.document.name}\n${verdictLine(table)}\n\n${checked} value(s) checked against the rows they cite.`;
	if (missing.length === 0) {
		return [
			head,
			'',
			'every value is carried by the rows it cites.',
			'that is not a promise the records are complete: a record nobody claimed is',
			'the other failure, and this check cannot see it.'
		].join('\n');
	}
	return [
		head,
		'',
		`${missing.length} not printed by the rows cited:`,
		...missing,
		'',
		'a value the cited rows do not print was not read from them. Re-read it or drop it.'
	].join('\n');
}

async function runCheckCitations(
	args: Record<string, unknown>,
	capabilities: McpCapabilities
): Promise<Outcome> {
	const path = stringAt(args, 'path');
	const given = args.records;
	if (path === null || !Array.isArray(given)) {
		return { text: 'check_citations needs a path and a records array.', failed: true };
	}

	const cells = cellsAt(args);
	if (cells === null) {
		return badArgument('check_citations', 'cells', 'joined or apart');
	}

	const claims = given.map(claimAt).filter((claim): claim is Claim => claim !== null);
	if (claims.length !== given.length) {
		return {
			text: 'every record must be { "rows": [1, 2], "values": { "field": "value" } }, with whole row numbers and values that are strings or numbers.',
			failed: true
		};
	}
	const bounds = boundsOf(args, 'check_citations');
	if (refused(bounds)) return bounds;

	const table = await reading(capabilities, path, bounds.maximumPages);
	const changed = changedSince(args, table);
	if (changed !== null) return changed;
	const mark = decimalMarkOf(table.document.text);
	const checked = claims.map((claim, index) => checkOne(claim, index, table.rows, mark, cells));

	const total = claims.reduce((count, claim) => count + Object.keys(claim.values).length, 0);
	const missing = checked.flatMap((record) =>
		record.missing.map(
			({ field, value }) =>
				`  record ${record.record}, ${field}: "${value}" is not in row(s) ${record.rows.join(', ')}`
		)
	);

	return {
		text: citationText(table, total, missing),
		data: {
			file: table.document.name,
			digest: table.document.digest,
			verdict: tableVerdict(table),
			checked: total,
			carried: total - missing.length,
			records: checked
		}
		/*
		 * NOT marked in error. `isError` says the tool could not do its job, and a
		 * check that names an invented value did exactly its job: the verdict is
		 * the answer, not a failure of the answering. Reported as an error it
		 * would invite a host to retry a call whose result will never change.
		 */
	};
}

const RUNNERS: Record<
	string,
	(args: Record<string, unknown>, capabilities: McpCapabilities) => Promise<Outcome>
> = {
	read_table: runReadTable,
	find_amounts: runFindAmounts,
	find_dates: runFindDates,
	check_citations: runCheckCitations
};

/**
 * A refusal is an answer, and it belongs in the RESULT rather than in a
 * protocol error.
 *
 * A tool that fails through the transport is invisible to the model: the host
 * reports a broken tool and the turn ends. Reported as a result marked in
 * error, the model reads "this file will not open, look for its password" and
 * does something about it. That is the protocol's own rule, and it happens to
 * be this library's: a refusal is worded for whoever has to act on it.
 */
function refusal(error: unknown): Outcome {
	const unreadable = { verdict: 'unreadable' as const };
	if (error instanceof UnreadableDocument) {
		return {
			text: `verdict: unreadable - ${error.message} (${error.reason})`,
			data: { ...unreadable, reason: error.reason },
			failed: true
		};
	}
	const message = error instanceof Error ? error.message : String(error);
	return {
		text: `verdict: unreadable - could not read that file: ${message}`,
		data: unreadable,
		failed: true
	};
}

function resultOf(payload: object, version: string): object {
	return {
		...payload,
		resultType: 'complete',
		_meta: { 'io.modelcontextprotocol/serverInfo': { name: SERVER, version } }
	};
}

async function callTool(params: Record<string, unknown>, capabilities: McpCapabilities) {
	const name = typeof params.name === 'string' ? params.name : '';
	const run = RUNNERS[name];
	if (run === undefined) return { unknownTool: name };

	const args = (params.arguments ?? {}) as Record<string, unknown>;
	const outcome = await run(args, capabilities).catch(refusal);
	return {
		content: [{ type: 'text', text: outcome.text }],
		...(outcome.data === undefined ? {} : { structuredContent: outcome.data }),
		...(outcome.failed === true ? { isError: true } : {})
	};
}

/**
 * The instructions a host may put in front of a model, once, for the server as
 * a whole. It says the one thing no tool description can say on its own: what
 * the two are FOR together.
 */
const INSTRUCTIONS =
	'truecopy reads documents on this machine and says when a reading cannot be trusted. Every answer opens with a verdict - reliable, doubtful or unreadable - and reliable only means nothing looked wrong: read it before leaning on a figure. Read with read_table, pick out figures with find_amounts and dates with find_dates, then check every value you claim with check_citations before anything acts on it. No file leaves this machine.';

const CAPABILITIES = { tools: { listChanged: false } };

function discover(version: string) {
	return resultOf(
		{
			supportedVersions: SPOKEN,
			capabilities: CAPABILITIES,
			instructions: INSTRUCTIONS,
			ttlMs: TOOLS_TTL_MS,
			cacheScope: 'public'
		},
		version
	);
}

/**
 * The handshake of every revision up to 2025-11-25.
 *
 * The version asked for is echoed when it is one this server speaks, and the
 * newest is offered otherwise. Answering with something the client did not ask
 * for is what the lifecycle prescribes: the client then decides whether it can
 * go on, and a client too old to decide reads a version it does not know and
 * disconnects, which is the honest outcome.
 */
function initialize(params: Record<string, unknown>, version: string) {
	const asked = params.protocolVersion;
	return resultOf(
		{
			protocolVersion: typeof asked === 'string' && SPOKEN.includes(asked) ? asked : SPOKEN[0],
			capabilities: CAPABILITIES,
			serverInfo: { name: SERVER, version, title: 'truecopy' },
			instructions: INSTRUCTIONS
		},
		version
	);
}

/**
 * Answer one message.
 *
 * `null` for a notification, which by the JSON-RPC rules is any message with
 * no `id`: answering one is a protocol error, and a client that receives an
 * answer to `notifications/initialized` has to decide what it belongs to.
 */
export async function respond(
	message: unknown,
	capabilities: McpCapabilities
): Promise<McpResponse | null> {
	const { id, method, params } = (message ?? {}) as {
		id?: string | number;
		method?: unknown;
		params?: unknown;
	};
	if (id === undefined || id === null) return null;

	const answer = (result: object): McpResponse => ({ jsonrpc: '2.0', id, result });
	const refuse = (code: number, text: string): McpResponse => ({
		jsonrpc: '2.0',
		id,
		error: { code, message: text }
	});
	const given = (params ?? {}) as Record<string, unknown>;

	if (method === 'server/discover') return answer(discover(capabilities.version));
	if (method === 'initialize') return answer(initialize(given, capabilities.version));
	if (method === 'ping') return answer(resultOf({}, capabilities.version));
	if (method === 'tools/list') {
		return answer(
			resultOf({ tools: TOOLS, ttlMs: TOOLS_TTL_MS, cacheScope: 'public' }, capabilities.version)
		);
	}
	if (method === 'tools/call') {
		const called = await callTool(given, capabilities);
		if ('unknownTool' in called) {
			return refuse(INVALID_PARAMS, `unknown tool: ${called.unknownTool}`);
		}
		return answer(resultOf(called, capabilities.version));
	}
	return refuse(METHOD_NOT_FOUND, `unknown method: ${String(method)}`);
}
