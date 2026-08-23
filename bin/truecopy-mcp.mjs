#!/usr/bin/env node
/*
 * truecopy as an MCP server, over stdio.
 *
 *     {
 *       "mcpServers": {
 *         "truecopy": {
 *           "command": "npx",
 *           "args": ["-y", "-p", "truecopy", "-p", "pdfjs-dist", "truecopy-mcp"]
 *         }
 *       }
 *     }
 *
 * This file is the half that touches the world: standard input, standard
 * output, and the filesystem. Everything it decides is in `src/mcp.ts`, which
 * touches none of the three and is tested on its own. Same reason the command
 * next to it is thin - what talks to the world should be short enough to read
 * in one sitting.
 *
 * STANDARD OUTPUT CARRIES THE PROTOCOL AND NOTHING ELSE. One stray line there
 * is not a cosmetic defect: the client is parsing a stream of JSON-RPC and a
 * sentence in the middle of it ends the session. pdf.js prints a warning on
 * almost every real document, so the two console channels that would land on
 * stdout are moved to stderr before anything is loaded.
 */

import { readFile } from 'node:fs/promises';
import { readFileSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { respond } from '../dist/mcp.js';

console.log = console.info = (...parts) => process.stderr.write(`${parts.join(' ')}\n`);

const here = dirname(dirname(fileURLToPath(import.meta.url)));
const { version } = JSON.parse(readFileSync(join(here, 'package.json'), 'utf8'));

/*
 * Where this server may read, when whoever launched it says so.
 *
 * A model choosing the path is the whole point of the tool and also the whole
 * risk: a document is a file, and so is a private key. Left unset the server
 * reads what the account running it can read, exactly like the command; set,
 * nothing outside that directory is opened, symbolic links included - the
 * check is made on the resolved path, or a link inside the root would walk
 * straight back out of it.
 */
const ROOT = process.env.TRUECOPY_MCP_ROOT;
const root = ROOT === undefined || ROOT === '' ? null : realpathSync(resolve(ROOT));

function within(path) {
	if (root === null) return path;
	const step = relative(root, realpathSync(path));
	if (step === '' || (!step.startsWith('..') && !isAbsolute(step))) return path;
	throw new Error(`outside TRUECOPY_MCP_ROOT: ${basename(path)}`);
}

/** The one impure capability the protocol needs: bytes behind a path. */
async function open(path) {
	const full = within(resolve(path));
	const bytes = await readFile(full);
	return new File([bytes], basename(full), {
		type: full.toLowerCase().endsWith('.pdf') ? 'application/pdf' : 'text/plain'
	});
}

function send(message) {
	process.stdout.write(`${JSON.stringify(message)}\n`);
}

/*
 * A message is a line, and a line can arrive in pieces or several at a time.
 * The tail is kept rather than parsed: a chunk that ends mid-object is the
 * normal case on a pipe, and treating it as a parse error would drop a request
 * the client believes it sent.
 */
let pending = '';

async function take(line) {
	if (line.trim() === '') return;
	let message;
	try {
		message = JSON.parse(line);
	} catch {
		send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'invalid JSON' } });
		return;
	}
	/*
	 * Handled as they arrive rather than one after another. A reading has a
	 * thirty second deadline, and a client that cannot get an answer to `ping`
	 * while one runs concludes the server is dead. Each answer is written by a
	 * single call, so two of them cannot interleave on the stream.
	 */
	const answer = await respond(message, { open, version });
	if (answer !== null) send(answer);
}

process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
	const lines = (pending + chunk).split('\n');
	pending = lines.pop() ?? '';
	for (const line of lines) {
		void take(line).catch((error) => process.stderr.write(`truecopy-mcp: ${error.message}\n`));
	}
});
process.stdin.on('end', () => {
	process.exitCode = 0;
});
