#!/usr/bin/env node
/*
 * What a stranger gets when they run `npm i truecopy`.
 *
 * A green suite proves the SOURCE works; only this proves the PACKAGE does -
 * the exports map, the file list, and the `.js` extensions ESM insists on. It
 * packs the tarball, installs it into a throwaway project outside the repo,
 * and imports it the way a consumer would.
 *
 * WHY A FILE AND NOT A HEREDOC IN gate.yml. It lived inlined in the workflow,
 * so the one check that speaks for the consumer was the one check nobody could
 * run before pushing. The script is the list; CI runs the script.
 *
 * Two absolute paths and no shell: spawning `npm` by name is a PATH lookup,
 * spawning `npm.cmd` without a shell is refused by node 24, and an argument
 * array with a shell is deprecated. `npm_execpath` is npm's own cli, set by
 * npm when it runs a script - so this file is only ever reached through
 * `npm run paquet`, and says so rather than guessing a path.
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const npmCli = process.env.npm_execpath;
if (!npmCli) {
	console.error('Run this through `npm run paquet`: npm_execpath is unset.');
	process.exit(1);
}

const repo = process.cwd();
const npm = (args, cwd) =>
	execFileSync(process.execPath, [npmCli, ...args], { cwd, encoding: 'utf8', stdio: 'pipe' });

const consumer = mkdtempSync(join(tmpdir(), 'truecopy-consumer-'));
try {
	npm(['pack', '--pack-destination', consumer], repo);
	const tarball = readdirSync(consumer).find((name) => name.endsWith('.tgz'));
	if (!tarball) throw new Error('npm pack produced no tarball');

	writeFileSync(
		join(consumer, 'package.json'),
		JSON.stringify({ name: 'consumer', private: true, version: '1.0.0', type: 'module' }, null, 2)
	);
	npm(
		['install', '--ignore-scripts', '--no-audit', '--no-fund', join(consumer, tarball)],
		consumer
	);

	// Exactly what the workflow imported, run from the consumer's own directory
	// so the resolution is the consumer's and not this repository's.
	const check = `
    import { schemaOf, validate, explainRows } from 'truecopy';
    import { findRowAnomalies } from 'truecopy/signature';
    const schema = schemaOf({
      name: 'y',
      fields: { year: { format: 'year', required: true } },
      minimumRecords: 2
    });
    if (validate(schema, [{ year: 2018 }, { year: 2019 }]) !== null) {
      throw new Error('the published package does not read its own schema');
    }
    if (typeof findRowAnomalies !== 'function') {
      throw new Error('the subpath exports do not resolve');
    }
    if (!explainRows([['2018']]).includes('1 column(s)')) {
      throw new Error('explain does not run from the package');
    }
  `;
	execFileSync(process.execPath, ['--input-type=module', '-e', check], {
		cwd: consumer,
		stdio: 'inherit'
	});
	console.log(`the published package imports (${tarball})`);
} finally {
	rmSync(consumer, { recursive: true, force: true });
}
