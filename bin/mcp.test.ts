import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { pdfWithText } from '../src/kit.js';

/*
 * The server has to RUN, and only running it says whether it does. What is
 * tested here is the half `src/mcp.test.ts` cannot reach: the framing of the
 * stream, the filesystem, and the one rule a stdio server dies of breaking -
 * that standard output carries the protocol and nothing else.
 */
const SERVER = 'bin/truecopy-mcp.mjs';

interface Answer {
	id?: number | string | null;
	result?: Record<string, unknown>;
	error?: { code: number; message: string };
}

/** Drive the server as a client does: lines in, lines out, then end. */
function drive(
	messages: object[],
	options: { env?: Record<string, string>; split?: boolean } = {}
): Promise<{ answers: Answer[]; out: string; err: string; code: number | null }> {
	return new Promise((resolve, reject) => {
		const child = spawn(process.execPath, [SERVER], {
			env: { ...process.env, ...options.env },
			stdio: ['pipe', 'pipe', 'pipe']
		});
		let out = '';
		let err = '';
		child.stdout.setEncoding('utf8').on('data', (chunk: string) => (out += chunk));
		child.stderr.setEncoding('utf8').on('data', (chunk: string) => (err += chunk));
		child.on('error', reject);
		child.on('close', (code) => {
			const answers = out
				.split('\n')
				.filter((line) => line.trim() !== '')
				.map((line) => JSON.parse(line) as Answer);
			resolve({ answers, out, err, code });
		});

		const lines = messages.map((message) => `${JSON.stringify(message)}\n`).join('');
		if (options.split !== true) {
			child.stdin.end(lines);
			return;
		}
		// Two chunks with a turn of the event loop between them, so the tail
		// really is left half-read: a chunk ending mid-object is the normal case
		// on a pipe, and treating it as a parse error drops a live request.
		const at = Math.floor(lines.length / 2);
		child.stdin.write(lines.slice(0, at));
		setTimeout(() => child.stdin.end(lines.slice(at)), 20);
	});
}

const call = (name: string, args: object, id = 1) => ({
	jsonrpc: '2.0',
	id,
	method: 'tools/call',
	params: { name, arguments: args }
});

/** A file on disk, because a server reads paths and not buffers. */
function onDisk(name: string, contents: string, into = mkdtempSync(join(tmpdir(), 'truecopy-'))) {
	const path = join(into, name);
	writeFileSync(path, contents);
	return { path, directory: into };
}

const STATEMENT = onDisk(
	'statement.pdf',
	pdfWithText(
		[
			['02/05/2026', 'CARTE AMAZON', '12,40'],
			['03/05/2026', 'VIR LOYER', '750,00']
		].flatMap((cells, row) =>
			cells.map((word, column) => ({ word, x: [50, 150, 430][column], y: 700 - row * 20 }))
		)
	)
);

describe('truecopy-mcp', () => {
	it('opens, lists its tools and reads a document, over one stream', async () => {
		const { answers } = await drive([
			{ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } },
			{ jsonrpc: '2.0', method: 'notifications/initialized' },
			{ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} },
			call('read_table', { path: STATEMENT.path }, 3)
		]);

		// Three answers and not four: a notification carries no id and is not
		// answered, which is the rule a client breaks its session on.
		expect(answers.map((answer) => answer.id)).toEqual([1, 2, 3]);
		expect((answers[0].result as { serverInfo: { version: string } }).serverInfo.version).toMatch(
			/^\d+\.\d+\.\d+/
		);
		expect((answers[2].result as { content: { text: string }[] }).content[0].text).toContain(
			'CARTE AMAZON'
		);
	});

	it('reports the version of the package it was installed with', async () => {
		const { answers } = await drive([{ jsonrpc: '2.0', id: 1, method: 'ping' }]);
		const meta = answers[0].result?._meta as {
			'io.modelcontextprotocol/serverInfo': { name: string; version: string };
		};
		const { version } = JSON.parse(
			readFileSync(new URL('../package.json', import.meta.url), 'utf8')
		) as { version: string };
		expect(meta['io.modelcontextprotocol/serverInfo']).toEqual({ name: 'truecopy', version });
	});

	it('keeps standard output free of everything that is not the protocol', async () => {
		// pdf.js prints a warning on almost every real document. One line of it on
		// this stream and the client stops being able to parse anything at all.
		const { out, err } = await drive([call('read_table', { path: STATEMENT.path })]);
		for (const line of out.split('\n').filter((line) => line !== '')) {
			expect(() => JSON.parse(line)).not.toThrow();
		}
		expect(err).toContain('standardFontDataUrl');
	});

	it('answers nothing to a line that carries no request', async () => {
		const { answers, err } = await drive([{ not: 'a request' }]);
		expect(answers).toEqual([]);
		expect(err).toBe('');
	});

	it('answers a line that is not JSON, rather than dying on it', async () => {
		// One malformed line ends the session if the server exits on it, and every
		// request behind it in the pipe is lost with no answer at all.
		const { answers } = await drive([]);
		expect(answers).toEqual([]);

		const broken = await new Promise<string>((resolve) => {
			const child = spawn(process.execPath, [SERVER]);
			let out = '';
			child.stdout.setEncoding('utf8').on('data', (chunk: string) => (out += chunk));
			child.on('close', () => resolve(out));
			child.stdin.end('{ this is not json }\n{"jsonrpc":"2.0","id":8,"method":"ping"}\n');
		});
		const [refused, answered] = broken
			.split('\n')
			.filter((line) => line !== '')
			.map((line) => JSON.parse(line) as Answer);
		expect(refused).toEqual({
			jsonrpc: '2.0',
			id: null,
			error: { code: -32700, message: 'invalid JSON' }
		});
		expect(answered.id).toBe(8);
	});

	it('reads a request that arrived in two pieces', async () => {
		const { answers } = await drive(
			[
				{ jsonrpc: '2.0', id: 1, method: 'ping' },
				{ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }
			],
			{ split: true }
		);
		expect(answers.map((answer) => answer.id)).toEqual([1, 2]);
	});

	it('reads inside the root it was given', async () => {
		const { answers } = await drive([call('read_table', { path: STATEMENT.path })], {
			env: { TRUECOPY_MCP_ROOT: STATEMENT.directory }
		});
		expect((answers[0].result as { isError?: boolean }).isError).toBeUndefined();
	});

	it('stops rather than widening when its root cannot be resolved', async () => {
		// Reading the whole disk because a directory was mistyped is the one
		// outcome nobody would notice. It fails closed, and it names the setting.
		const { code, err, answers } = await drive([{ jsonrpc: '2.0', id: 1, method: 'ping' }], {
			env: { TRUECOPY_MCP_ROOT: join(tmpdir(), 'truecopy-no-such-root') }
		});
		expect(code).toBe(1);
		expect(answers).toEqual([]);
		expect(err).toContain('TRUECOPY_MCP_ROOT is not a directory here');
	});

	it('opens nothing outside it', async () => {
		// A document is a file, and so is a private key. Whoever launches the
		// server decides where it may look; the model choosing the path does not.
		const elsewhere = onDisk('secret.txt', 'one;two;three\nfour;five;six');
		const { answers } = await drive([call('read_table', { path: elsewhere.path })], {
			env: { TRUECOPY_MCP_ROOT: STATEMENT.directory }
		});
		const result = answers[0].result as { isError: boolean; content: { text: string }[] };
		expect(result.isError).toBe(true);
		expect(result.content[0].text).toContain('outside TRUECOPY_MCP_ROOT');
	});
});
