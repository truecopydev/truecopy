import { describe, expect, it } from 'vitest';
import { ORIGINS } from './document.js';
import { pdfWithPages, pdfWithText } from './kit.js';
import { TOOLS, respond, type McpCapabilities, type McpResponse } from './mcp.js';

/*
 * The protocol is driven exactly as a client drives it: a message in, a
 * message out. Nothing here mocks the reading, because the reading is what a
 * tool call is for - the only thing injected is the one impure capability the
 * server takes, which is what makes this file possible at all.
 */

const VERSION = '9.9.9';

/** A paste, so most of these run with no PDF engine at all. */
function pasted(name: string, body: string): File {
	return new File([body], name, { type: 'text/plain' });
}

const STATEMENT = [
	'02/05/2026;CARTE AMAZON EU SARL;12,40',
	'03/05/2026;VIR SEPA LOYER MAI;750,00',
	'05/05/2026;CARTE SNCF CONNECT;68,00'
].join('\n');

function serving(file: File | (() => Promise<File>)): McpCapabilities {
	return { open: typeof file === 'function' ? file : async () => file, version: VERSION };
}

async function call(name: string, args: object, capabilities: McpCapabilities) {
	const answer = await respond(
		{ jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name, arguments: args } },
		capabilities
	);
	return (answer as McpResponse).result as {
		content: { type: string; text: string }[];
		structuredContent?: Record<string, unknown>;
		isError?: boolean;
	};
}

/** The words a model is shown, which is the only part some hosts pass on. */
async function said(name: string, args: object, capabilities: McpCapabilities) {
	return (await call(name, args, capabilities)).content[0].text;
}

const ask = (method: string, params: object = {}) =>
	respond({ jsonrpc: '2.0', id: 1, method, params }, serving(pasted('x.txt', 'a b')));

describe('the protocol', () => {
	it('answers nothing to a notification, which carries no id', async () => {
		// Answering one is a protocol error, and the client has no request to
		// attach the answer to.
		expect(
			await respond(
				{ jsonrpc: '2.0', method: 'notifications/initialized' },
				serving(pasted('x.txt', 'a'))
			)
		).toBeNull();
	});

	it('answers nothing to a message that is not one', async () => {
		expect(await respond(null, serving(pasted('x.txt', 'a')))).toBeNull();
	});

	it('speaks the revision the client asked for, when it speaks it', async () => {
		const answer = await ask('initialize', { protocolVersion: '2025-06-18' });
		expect((answer?.result as { protocolVersion: string }).protocolVersion).toBe('2025-06-18');
	});

	it('offers the newest revision for one it does not speak', async () => {
		// The lifecycle up to 2025-11-25 says so: the client then decides whether
		// it can go on, rather than being told a version that is not served.
		const answer = await ask('initialize', { protocolVersion: '2024-01-01' });
		expect((answer?.result as { protocolVersion: string }).protocolVersion).toBe('2026-07-28');
	});

	it('offers the newest revision when none is asked for', async () => {
		const answer = await ask('initialize', {});
		expect((answer?.result as { protocolVersion: string }).protocolVersion).toBe('2026-07-28');
	});

	it('discovers without a handshake, which is all 2026-07-28 offers', async () => {
		const result = (await ask('server/discover'))?.result as {
			supportedVersions: string[];
			capabilities: object;
			instructions: string;
			cacheScope: string;
		};
		expect(result.supportedVersions).toContain('2026-07-28');
		expect(result.supportedVersions).toContain('2025-06-18');
		expect(result.capabilities).toEqual({ tools: { listChanged: false } });
		expect(result.instructions).toContain('check_citations');
		expect(result.cacheScope).toBe('public');
	});

	it('names itself and the shape of its result on every answer', async () => {
		// Both are required of a server from 2026-07-28: a result with no
		// `resultType` is read as an older server's, and it is not one.
		const result = (await ask('ping'))?.result as Record<string, unknown>;
		expect(result.resultType).toBe('complete');
		expect(result._meta).toEqual({
			'io.modelcontextprotocol/serverInfo': { name: 'truecopy', version: VERSION }
		});
	});

	it('lists both tools, with how long the list may be held', async () => {
		const result = (await ask('tools/list'))?.result as {
			tools: { name: string }[];
			ttlMs: number;
		};
		expect(result.tools.map((tool) => tool.name)).toEqual(['read_table', 'check_citations']);
		expect(result.ttlMs).toBeGreaterThan(0);
	});

	it('answers a request that carries no params at all', async () => {
		// The stateless revision sends `_meta` and little else, and a client is
		// free to send none of it: a server that needs params to answer `ping`
		// goes silent against the liveness check of every host.
		const answer = await respond(
			{ jsonrpc: '2.0', id: 2, method: 'ping' },
			serving(pasted('x.txt', 'a'))
		);
		expect((answer?.result as { resultType: string }).resultType).toBe('complete');
	});

	it('refuses a call that names no tool', async () => {
		const answer = await respond(
			{ jsonrpc: '2.0', id: 4, method: 'tools/call', params: {} },
			serving(pasted('x.txt', 'a'))
		);
		expect(answer?.error?.code).toBe(-32602);
	});

	it('refuses a method it does not have', async () => {
		expect((await ask('resources/list'))?.error).toEqual({
			code: -32601,
			message: 'unknown method: resources/list'
		});
	});

	it('refuses a tool it does not have, which is a protocol error and not a result', async () => {
		// The one class of failure the specification keeps out of the result: a
		// model cannot self-correct its way to a tool that is not there.
		const answer = await respond(
			{ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'ocr' } },
			serving(pasted('x.txt', 'a'))
		);
		expect(answer?.error).toEqual({ code: -32602, message: 'unknown tool: ocr' });
	});
});

describe('every tool description', () => {
	it('says what the tool does not prove, and not only what it does', () => {
		// The description is the prompt a host puts in front of a model. One that
		// says "reads tables" and stops has taught the opposite of this library.
		const [read, check] = TOOLS;
		expect(read.description).toContain('NOT a promise that the reading is right');
		expect(check.description).toContain('NOWHERE else');
	});

	it('declares itself read-only and closed, because it is both', () => {
		for (const tool of TOOLS) {
			expect(tool.annotations.readOnlyHint).toBe(true);
			expect(tool.annotations.openWorldHint).toBe(false);
		}
	});
});

describe('read_table', () => {
	it('reads a paste into rows and ends on what it cannot vouch for', async () => {
		const text = await said(
			'read_table',
			{ path: 'statement.txt' },
			serving(pasted('statement.txt', STATEMENT))
		);
		expect(text).toContain('truecopy - statement.txt');
		expect(text).toContain('CARTE AMAZON EU SARL');
		expect(text.trimEnd().endsWith('that is not the same as "this reading is right".')).toBe(true);
	});

	it('numbers the rows the way check_citations reads them', async () => {
		const text = await said('read_table', { path: 's.txt' }, serving(pasted('s.txt', STATEMENT)));
		expect(text).toContain('1 | 02/05/2026 | CARTE AMAZON EU SARL | 12,40');
		expect(text).toContain('3 | 05/05/2026 | CARTE SNCF CONNECT | 68,00');
	});

	it('hands the rows, the cut and the doubts to a program', async () => {
		const result = await call('read_table', { path: 's.txt' }, serving(pasted('s.txt', STATEMENT)));
		const data = result.structuredContent as {
			file: string;
			origin: string;
			rows: string[][];
			firstRowNumber: number;
			totalRows: number;
			more: boolean;
			pages: { number: number; boundaries: number[] }[];
			findings: unknown[];
		};
		expect(data.file).toBe('s.txt');
		expect(data.origin).toBe('text');
		expect(data.rows[0]).toEqual(['02/05/2026', 'CARTE AMAZON EU SARL', '12,40']);
		expect(data.firstRowNumber).toBe(1);
		expect(data.totalRows).toBe(3);
		expect(data.more).toBe(false);
		expect(data.pages[0].number).toBe(1);
		expect(Array.isArray(data.findings)).toBe(true);
		expect(result.isError).toBeUndefined();
	});

	it('bounds what it returns and says what it left, never silently', async () => {
		// A listing cut in silence reads as a document that ends there, and that
		// is how a missing row becomes a row that is not there.
		const result = await call(
			'read_table',
			{ path: 's.txt', limit: 2 },
			serving(pasted('s.txt', STATEMENT))
		);
		expect((result.structuredContent as { more: boolean }).more).toBe(true);
		expect(result.content[0].text).toContain(
			'... 1 more row(s). Call read_table again with from: 3.'
		);
	});

	it('keeps the numbers of the window it was asked for', async () => {
		const result = await call(
			'read_table',
			{ path: 's.txt', from: 3, limit: 5000 },
			serving(pasted('s.txt', STATEMENT))
		);
		expect((result.structuredContent as { firstRowNumber: number }).firstRowNumber).toBe(3);
		expect(result.content[0].text).toContain('3 | 05/05/2026');
	});

	it('says there is no such row rather than pretending there is', async () => {
		const text = await said(
			'read_table',
			{ path: 's.txt', from: 40 },
			serving(pasted('s.txt', STATEMENT))
		);
		expect(text).toContain('no row at 40: this reading has 3 row(s).');
	});

	it('opens the pages it was told to and no more', async () => {
		const two = pdfWithPages([
			[{ word: 'FIRST', x: 50, y: 700 }],
			[{ word: 'SECOND', x: 50, y: 700 }]
		]);
		const file = new File([two], 'two.pdf', { type: 'application/pdf' });
		const result = await call('read_table', { path: '/x.pdf', maximumPages: 1 }, serving(file));
		expect((result.structuredContent as { pages: unknown[] }).pages).toHaveLength(1);
	});

	it('refuses a call with no path, in the result so the model can retry', async () => {
		const result = await call('read_table', {}, serving(pasted('x.txt', 'a')));
		expect(result.isError).toBe(true);
		expect(result.content[0].text).toBe('read_table needs a path to a file.');
	});

	it('refuses a call carrying no arguments at all', async () => {
		const answer = await respond(
			{ jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'read_table' } },
			serving(pasted('x.txt', 'a'))
		);
		const result = answer?.result as { isError?: boolean };
		expect(result.isError).toBe(true);
	});

	it('refuses a blank path the same way', async () => {
		const result = await call('read_table', { path: '   ' }, serving(pasted('x.txt', 'a')));
		expect(result.isError).toBe(true);
	});

	it('reports a document it will not open as an answer, with its reason', async () => {
		// The reason is what sends a person in the right direction, and a tool
		// error would send the model nowhere at all.
		const result = await call('read_table', { path: '/x.pdf' }, serving(pasted('empty.pdf', '')));
		expect(result.isError).toBe(true);
		expect(result.content[0].text).toContain('(empty)');
	});

	it('reports a file it could not reach, and says which failure it was', async () => {
		const missing = serving(async () => {
			throw new Error('ENOENT: no such file');
		});
		const result = await call('read_table', { path: '/nowhere.pdf' }, missing);
		expect(result.content[0].text).toBe('could not read that file: ENOENT: no such file');
		expect(result.structuredContent).toBeUndefined();
	});

	it('reports a rejection that is not an Error rather than crashing on it', async () => {
		const odd = serving(async () => {
			throw 'denied';
		});
		expect((await call('read_table', { path: '/x' }, odd)).content[0].text).toBe(
			'could not read that file: denied'
		);
	});
});

describe('check_citations', () => {
	const cited = (records: unknown) =>
		call('check_citations', { path: '/s.txt', records }, serving(pasted('s.txt', STATEMENT)));

	it('says what a clean result does not prove', async () => {
		const result = await cited([{ rows: [1], values: { label: 'CARTE AMAZON EU SARL' } }]);
		expect(result.content[0].text).toContain('every value is carried by the rows it cites.');
		expect(result.content[0].text).toContain('a record nobody claimed is');
		expect(result.isError).toBeUndefined();
	});

	it('names a value the cited rows do not print', async () => {
		const result = await cited([
			{ rows: [1], values: { label: 'CARTE AMAZON EU SARL', town: 'Lyon' } }
		]);
		expect(result.content[0].text).toContain('record 1, town: "Lyon" is not in row(s) 1');
		expect(result.structuredContent).toMatchObject({ checked: 2, carried: 1 });
	});

	it('is a verdict and not a failure of the tool', async () => {
		// Marked in error it would invite a host to retry a call whose answer
		// cannot change.
		const result = await cited([{ rows: [1], values: { town: 'Lyon' } }]);
		expect(result.isError).toBeUndefined();
		expect(result.content[0].text).toContain('Re-read it or drop it.');
	});

	it('reads a figure with the mark the document writes, not the one JSON does', async () => {
		// 12.4 against a page that writes 12,40. Read with the wrong mark the
		// check refuses a figure the document does carry.
		const result = await cited([{ rows: [1], values: { amount: 12.4 } }]);
		expect(result.structuredContent).toMatchObject({ checked: 1, carried: 1 });
	});

	it('reads a figure on a page that marks its decimals with a dot', async () => {
		// The other half of the rule above: written with the page's own mark,
		// which here is the one JSON writes anyway.
		const dotted = pasted('us.txt', 'INVOICE 4021;WIDGETS;1234.56\nINVOICE 4022;BOLTS;78.90');
		const result = await call(
			'check_citations',
			{ path: '/us.txt', records: [{ rows: [1], values: { total: 1234.56 } }] },
			serving(dotted)
		);
		expect(result.structuredContent).toMatchObject({ checked: 1, carried: 1 });
	});

	it('still refuses a figure the document rounded away', async () => {
		expect(
			(await cited([{ rows: [2], values: { amount: 750.5 } }])).structuredContent
		).toMatchObject({ carried: 0 });
	});

	it('counts a row number nobody printed as carrying nothing', async () => {
		const result = await cited([{ rows: [99], values: { label: 'CARTE AMAZON EU SARL' } }]);
		expect(result.structuredContent).toMatchObject({ carried: 0 });
	});

	it('refuses a records array that is not records', async () => {
		// Half understood, a record whose rows came through as a string would be
		// checked against no text and every value reported missing: a wrong
		// answer wearing the shape of a right one.
		for (const bad of [
			[null],
			['a record'],
			[{ rows: '1', values: {} }],
			[{ rows: [1.5], values: {} }],
			[{ rows: [1] }],
			[{ rows: [1], values: [] }],
			[{ rows: [1], values: { a: null } }]
		]) {
			const result = await cited(bad);
			expect(result.isError).toBe(true);
			expect(result.content[0].text).toContain('every record must be');
		}
	});

	it('refuses a call with no path or no records', async () => {
		const capabilities = serving(pasted('s.txt', STATEMENT));
		expect((await call('check_citations', { records: [] }, capabilities)).isError).toBe(true);
		expect((await call('check_citations', { path: '/s.txt' }, capabilities)).isError).toBe(true);
	});

	it('checks against a real PDF, the whole chain and not a stub', async () => {
		const pdf = pdfWithText([
			{ word: '02/05/2026', x: 50, y: 700 },
			{ word: 'CARTE AMAZON', x: 150, y: 700 },
			{ word: '12,40', x: 430, y: 700 }
		]);
		const capabilities = serving(new File([pdf], 'one.pdf', { type: 'application/pdf' }));
		const result = await call(
			'check_citations',
			{
				path: '/one.pdf',
				records: [{ rows: [1], values: { amount: 12.4, label: 'CARTE AMAZON' } }]
			},
			capabilities
		);
		expect(result.structuredContent).toMatchObject({ file: 'one.pdf', checked: 2, carried: 2 });
	});
});

describe('the schema the server advertises', () => {
	it('offers every origin a reading can carry, and no other', () => {
		// Declared twice - the type and the schema - and the day `docx` was added
		// to one, the other still said `pdf, text, image`. A client validating
		// against the advertised schema rejects a perfectly good reading.
		const read = TOOLS.find((tool) => tool.name === 'read_table');
		const origin = read?.outputSchema.properties.origin;
		expect(origin).toEqual({ type: 'string', enum: [...ORIGINS] });
	});
});
