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

import { carriesNumber, carriesText, citedText, numberedRows } from './cite.js';
import { describeDoubts, explainReading } from './explain.js';
import { decimalMarkOf, type DecimalMark } from './notation.js';
import { UnreadableDocument } from './open.js';
import { readTable, type Table } from './table.js';

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
				maximumPages: PAGES_FIELD
			},
			required: ['path'],
			additionalProperties: false
		},
		outputSchema: {
			type: 'object',
			properties: {
				file: { type: 'string' },
				origin: { type: 'string', enum: ['pdf', 'text', 'image'] },
				rows: { type: 'array', items: { type: 'array', items: { type: 'string' } } },
				firstRowNumber: { type: 'integer' },
				totalRows: { type: 'integer' },
				more: { type: 'boolean' },
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
				'origin',
				'rows',
				'firstRowNumber',
				'totalRows',
				'more',
				'pages',
				'findings'
			]
		},
		annotations: {
			readOnlyHint: true,
			destructiveHint: false,
			idempotentHint: true,
			openWorldHint: false
		}
	},
	{
		name: 'check_citations',
		title: 'Check values against the rows they were read from',
		description:
			'Verify that every value really appears in the rows it cites. A model turning cells into records fails one visible way, it misses a record, and one invisible way: it returns a plausible value the document never printed - a town deduced from a postcode, a rounded figure, a recomposed date - which reads exactly like a successful extraction. Each value is looked up in the cited rows and NOWHERE else, so nothing can be produced, only pointed at. A JSON number is checked as a figure, a JSON string as its words in order. Cite the row numbers read_table returned, for the same file and the same maximumPages: a different page bound is a different reading, and its rows are numbered differently.',
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
				maximumPages: PAGES_FIELD
			},
			required: ['path', 'records'],
			additionalProperties: false
		},
		outputSchema: {
			type: 'object',
			properties: {
				file: { type: 'string' },
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
			required: ['file', 'checked', 'carried', 'records']
		},
		annotations: {
			readOnlyHint: true,
			destructiveHint: false,
			idempotentHint: true,
			openWorldHint: false
		}
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

function integerAt(args: Record<string, unknown>, name: string): number | null {
	const value = args[name];
	return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : null;
}

/** The reading, once, for whichever tool asked. */
async function reading(
	args: Record<string, unknown>,
	capabilities: McpCapabilities,
	path: string
): Promise<Table> {
	const maximumPages = integerAt(args, 'maximumPages');
	return readTable(await capabilities.open(path), maximumPages === null ? {} : { maximumPages });
}

/**
 * The rows a call returns, and what it leaves behind.
 *
 * Bounded because a document has no bound and a context window does; ANNOUNCED
 * because a listing cut in silence reads as a document that ends there, which
 * is how a missing row becomes a row that is not there.
 */
function windowOf(table: Table, args: Record<string, unknown>) {
	const from = integerAt(args, 'from') ?? 1;
	const limit = Math.min(integerAt(args, 'limit') ?? DEFAULT_ROWS, MAXIMUM_ROWS);
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

	const table = await reading(args, capabilities, path);
	const cut = windowOf(table, args);
	/*
	 * The listing explain would print is suppressed here and printed below
	 * instead, numbered ACROSS the document rather than restarting on each page.
	 * A citation names one row of one reading, so two numberings would be one
	 * numbering too many, and the ambiguity would fall on the check that exists
	 * to remove exactly this kind of doubt.
	 */
	const report = explainReading(table, { maximumRows: 0 });
	return {
		text: [report, rowBlock(cut), describeDoubts(table.warnings)].join('\n\n'),
		data: {
			file: table.document.name,
			origin: table.document.origin,
			rows: cut.rows,
			firstRowNumber: cut.from,
			totalRows: cut.total,
			more: cut.more,
			pages: table.document.pages.map((page, index) => ({
				number: page.pageNumber,
				boundaries: table.boundaries[index]
			})),
			findings: table.findings
		}
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
function checkOne(claim: Claim, index: number, rows: string[][], mark: DecimalMark | null) {
	const source = citedText(rows, claim.rows, 1);
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
function citationText(file: string, checked: number, missing: string[]): string {
	const head = `truecopy - ${file}\n${checked} value(s) checked against the rows they cite.`;
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

	const claims = given.map(claimAt).filter((claim): claim is Claim => claim !== null);
	if (claims.length !== given.length) {
		return {
			text: 'every record must be { "rows": [1, 2], "values": { "field": "value" } }, with whole row numbers and values that are strings or numbers.',
			failed: true
		};
	}

	const table = await reading(args, capabilities, path);
	const mark = decimalMarkOf(table.document.text);
	const checked = claims.map((claim, index) => checkOne(claim, index, table.rows, mark));

	const total = claims.reduce((count, claim) => count + Object.keys(claim.values).length, 0);
	const missing = checked.flatMap((record) =>
		record.missing.map(
			({ field, value }) =>
				`  record ${record.record}, ${field}: "${value}" is not in row(s) ${record.rows.join(', ')}`
		)
	);

	return {
		text: citationText(table.document.name, total, missing),
		data: {
			file: table.document.name,
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
> = { read_table: runReadTable, check_citations: runCheckCitations };

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
	if (error instanceof UnreadableDocument) {
		return { text: `${error.message} (${error.reason})`, failed: true };
	}
	const message = error instanceof Error ? error.message : String(error);
	return { text: `could not read that file: ${message}`, failed: true };
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
	'truecopy reads tables out of documents on this machine and reports what a reading cannot vouch for. Read with read_table, then check every value you claim with check_citations before anything acts on it. No file leaves this machine.';

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
