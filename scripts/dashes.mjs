/*
 * NO TYPOGRAPHIC DASH IN WHAT THIS REPOSITORY SAYS.
 *
 *     node scripts/dashes.mjs
 *
 * Most of the prose here was written with a model, and a model has a tell: it
 * reaches for an em dash where the sentence wanted a colon, a comma, a full
 * stop or a bracket. 83 of them had piled up across eleven files, all of them
 * in the documentation, none in the source. The README is the page npm shows,
 * so it is the one place the tell is read by everybody.
 *
 * It is checked rather than written down in CONTRIBUTING.md, because a rule
 * nobody runs is a wish: the next generated paragraph puts them straight back.
 *
 * The fix is never a search and replace. A colon introduces what follows, a
 * comma joins, a full stop ends, brackets hold an aside, and ` - ` is what the
 * output of this library already uses. Which one it is depends on the sentence.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/* Generated or vendored: nothing here is written, so nothing here is ours. */
const SKIP = new Set(['node_modules', 'dist', 'coverage', '.git', 'package-lock.json', 'LICENSE']);

/* Everything that carries a sentence. */
const CARRIES_PROSE = /\.(?:md|ts|mjs|js|json|txt|ya?ml)$/;

/*
 * U+2010 to U+2015 is the whole dash block, not only the em dash: an en dash
 * reads as a near-miss correction of one and would walk straight back in. U+2212
 * and U+FF0D are the same character wearing another name. Written as escapes so
 * this file passes its own check.
 */
const DASHES = /[\u2010-\u2015\u2212\uFF0D]/gu;

function walk(directory) {
	return readdirSync(directory).flatMap((entry) => {
		if (SKIP.has(entry)) return [];
		const path = join(directory, entry);
		return statSync(path).isDirectory() ? walk(path) : [path];
	});
}

const files = walk(root).filter((file) => CARRIES_PROSE.test(file));

let found = 0;
for (const file of files) {
	const where = relative(root, file).replaceAll('\\', '/');
	const lines = readFileSync(file, 'utf8').split('\n');

	for (const [index, line] of lines.entries()) {
		for (const match of line.matchAll(DASHES)) {
			/* Enough of the sentence around it to see which punctuation it wanted. */
			const from = Math.max(0, match.index - 45);
			process.stderr.write(
				`dash: ${where}:${index + 1}\n      …${line.slice(from, match.index + 45).trim()}…\n`
			);
			found++;
		}
	}
}

if (found > 0) {
	process.stderr.write(
		`\n${found} typographic dash(es). Use a colon, a comma, a full stop, brackets, or ' - '.\n`
	);
	process.exitCode = 1;
} else {
	process.stdout.write(`dashes: ${files.length} file(s), not one typographic dash.\n`);
}
