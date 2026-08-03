#!/usr/bin/env node
/*
 * The public surface, written down so that it shows up in a diff.
 *
 * knip cannot see this surface. `src/index.ts` is the entry point, so every
 * name the barrel re-exports counts as used, and a name nobody imports stays
 * green forever. Measured the day this check was written: thirty-two of
 * fifty-seven exported values had no consumer anywhere - not in this
 * repository, not in either application built on it - and the gate said
 * nothing at all.
 *
 * A library cannot fix that by deleting whatever its own tests do not call:
 * its callers are strangers. What it can do is stop adding names by accident.
 * So the surface is committed, and the gate fails when `dist` and `API.md`
 * disagree. Adding an export becomes a deliberate act, argued for in review,
 * before it becomes a promise somebody's import depends on.
 *
 *   npm run api             fail if the built surface has drifted
 *   npm run api -- --write  take the built surface as the new truth
 *
 * The names come from the type checker rather than from a regular expression
 * over the declarations: a re-export, an overload and an interface merged
 * across two files all defeat the regular expression, and none of them defeat
 * the checker.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import ts from 'typescript';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const manifest = join(root, 'API.md');
const FENCE = '```';

/** The entry points, in the order `package.json` states them: the order a
 *  document meets the mechanisms, which is worth more than the alphabet. */
function entryPoints() {
	const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
	return Object.entries(pkg.exports)
		.filter(([name]) => name !== './package.json')
		.map(([name, target]) => ({
			label: name === '.' ? pkg.name : `${pkg.name}/${name.slice(2)}`,
			declaration: resolve(root, target.types)
		}));
}

/**
 * What one entry point exports, each name marked value or type.
 *
 * A re-exported name is an alias, and an alias carries none of the flags of
 * what it points at - so it is resolved first, or every name in the barrel
 * would come back as neither.
 */
function exportsOf(checker, source) {
	const symbol = checker.getSymbolAtLocation(source);
	if (symbol === undefined) return [];
	return checker
		.getExportsOfModule(symbol)
		.map((exported) => {
			const resolved =
				exported.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(exported) : exported;
			return {
				name: exported.getName(),
				kind: resolved.flags & ts.SymbolFlags.Value ? 'value' : 'type'
			};
		})
		.sort((a, b) => a.name.localeCompare(b.name, 'en'));
}

function surface() {
	const entries = entryPoints();
	const program = ts.createProgram(
		entries.map((entry) => entry.declaration),
		{ target: ts.ScriptTarget.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler }
	);
	const checker = program.getTypeChecker();

	return entries.map((entry) => {
		const source = program.getSourceFile(entry.declaration);
		if (source === undefined) {
			throw new Error(`${entry.declaration} is missing - run \`npm run build\` first`);
		}
		return { label: entry.label, names: exportsOf(checker, source) };
	});
}

/**
 * Distinct names, not lines.
 *
 * Almost every name is reachable twice - once through its own entry point and
 * once through the barrel - so counting lines doubles the surface and makes the
 * number useless as a thing to argue about.
 */
function countDistinct(all, kind) {
	return new Set(all.filter((name) => name.kind === kind).map((name) => name.name)).size;
}

function render(entries) {
	const all = entries.flatMap((entry) => entry.names);
	const blocks = entries.map((entry) =>
		[entry.label, ...entry.names.map((name) => `  ${name.kind.padEnd(6)} ${name.name}`)].join('\n')
	);

	return [
		'# Public API',
		'',
		'Every name this package exports, by entry point. Generated from `dist` by',
		'`npm run api`, and checked by the gate: a surface that drifts from this file',
		'fails before it is published.',
		'',
		'It is committed because knip cannot see it. The barrel is the entry point, so',
		'everything it re-exports counts as used and a name nobody imports stays green',
		'forever. Here, adding one is a line in a diff.',
		'',
		`${FENCE}text`,
		`${entries.length} entry points, ${countDistinct(all, 'value')} values, ` +
			`${countDistinct(all, 'type')} types`,
		'a name reachable through its own entry point and through the barrel is listed twice',
		'',
		blocks.join('\n\n'),
		FENCE,
		''
	].join('\n');
}

const written = render(surface());
const write = process.argv.includes('--write');

if (write) {
	writeFileSync(manifest, written);
	process.stdout.write(`API.md written from dist\n`);
} else {
	const committed = readFileSync(manifest, 'utf8');
	if (committed.replace(/\r\n/g, '\n') === written) {
		process.stdout.write('the public surface matches API.md\n');
	} else {
		process.stderr.write(
			'the built surface and API.md disagree.\n\n' +
				'A name was added to or removed from the public API. If that was the\n' +
				'intent, run `npm run api -- --write` and commit API.md with the change,\n' +
				'so the new promise is visible in the diff that makes it.\n'
		);
		process.exitCode = 1;
	}
}
