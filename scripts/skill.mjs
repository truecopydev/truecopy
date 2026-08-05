#!/usr/bin/env node
/*
 * THE SKILL DESCRIBES THIS LIBRARY, NOT THE ONE IT DESCRIBED LAST YEAR.
 *
 *     npm run skill
 *
 * `skills/truecopy/SKILL.md` is instructions for a model about an API it has
 * never seen: truecopy was published after every model in service was trained,
 * so a model writing against it invents the surface unless it is handed one.
 * That makes the file useful, and it makes it dangerous in exactly one way -
 * it is a SECOND copy of the API, and a second copy drifts.
 *
 * A rename is the case that hurts. `KindThreshold.column` became `share` once
 * already; nothing about that change would have touched a prose file, and the
 * skill would have gone on teaching a field that no longer exists, confidently,
 * to the one reader least able to notice.
 *
 * So three things are checked, all of them cheap:
 *
 *   1. every function the skill CALLS is still exported (against API.md, which
 *      the type checker generates - not a regular expression over the source);
 *   2. every entry point it names is still in `package.json`;
 *   3. the plugin manifest carries the version of the package it ships with.
 *
 * The version is pinned rather than left to the git SHA on purpose: the skill
 * documents a surface, so it should say WHICH surface. Bumping it belongs to
 * the release, beside the package version, and this check is what says so.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (...path) => readFileSync(join(root, ...path), 'utf8');

const skill = read('skills', 'truecopy', 'SKILL.md');
const api = read('API.md');
const pkg = JSON.parse(read('package.json'));
const plugin = JSON.parse(read('.claude-plugin', 'plugin.json'));

const problems = [];

/* 1. Everything the skill calls. `(?<![.\w])` drops member calls - `.map(`
 *    belongs to the language, `readTable(` belongs to us - and the paren has to
 *    touch the name, or every word in the prose that precedes a bracket comes
 *    back as an undefined export. */
const exported = new Set(
	[...api.matchAll(/^\s{2}(?:value|type)\s{2}(\S+)$/gm)].map((match) => match[1])
);

/* The language, and the names the snippets declare for themselves. Kept short
 * on purpose: a long list here is a check that has stopped checking. */
const NOT_OURS = new Set([
	'Set',
	'Map',
	'Math',
	'Number',
	'JSON',
	'Promise',
	'Array',
	'Object',
	'require',
	'import',
	'if',
	'for',
	'while',
	'switch',
	'catch',
	'return',
	'typeof',
	'yourModel',
	'read',
	'selfCheck',
	'rowsToReview',
	'repair',
	'refuse',
	'kindOf'
]);

const called = new Set(
	[...skill.matchAll(/(?<![.\w$])([a-z_$][\w$]*)\(/gi)]
		.map((match) => match[1])
		.filter((name) => !NOT_OURS.has(name))
);

for (const name of called) {
	if (!exported.has(name)) {
		problems.push(`the skill calls ${name}(), which this package does not export`);
	}
}

/* 2. Every entry point it names. */
const entryPoints = new Set(
	Object.keys(pkg.exports)
		.filter((name) => name !== './package.json')
		.map((name) => (name === '.' ? pkg.name : `${pkg.name}/${name.slice(2)}`))
);

for (const [, named] of skill.matchAll(/`(truecopy\/[a-z-]+)`/g)) {
	if (!entryPoints.has(named))
		problems.push(`the skill names \`${named}\`, which is not an entry point`);
}

/* 3. The manifest ships the version it documents. */
if (plugin.version !== pkg.version) {
	problems.push(
		`.claude-plugin/plugin.json says ${plugin.version} and the package is ${pkg.version} - ` +
			`bump both in the release, or the skill claims to document a surface it does not`
	);
}

/* And the frontmatter a skill is loaded by. Absent, it never triggers at all. */
const frontmatter = skill.match(/^---\n([\s\S]*?)\n---/);
if (frontmatter === null) problems.push('SKILL.md has no frontmatter');
else {
	for (const field of ['name', 'description']) {
		if (!new RegExp(`^${field}:\\s*\\S`, 'm').test(frontmatter[1])) {
			problems.push(`SKILL.md frontmatter has no ${field}`);
		}
	}
}

if (problems.length > 0) {
	process.stderr.write('the skill and the library disagree:\n');
	for (const problem of problems) process.stderr.write(`  ${problem}\n`);
	process.exit(1);
}

process.stdout.write(
	`skill: ${called.size} call(s) and ${
		[...skill.matchAll(/`(truecopy\/[a-z-]+)`/g)].length
	} entry point(s) all exist, manifest at ${plugin.version}.\n`
);
