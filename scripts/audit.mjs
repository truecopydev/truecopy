/*
 * THE WHOLE TREE IS AUDITED, AND AN EXCEPTION IS WRITTEN DOWN OR IT IS NOT ONE.
 *
 *     node scripts/audit.mjs
 *
 * `npm audit --audit-level=high` judges the development tools too, on purpose:
 * a compromised build tool ships in the tarball it builds. But `npm audit` has
 * no way to set one advisory aside, and an advisory published with NO fixed
 * version turns the gate red for every pull request, with nothing anybody can
 * install to turn it green again. A gate that stays red for a week gets
 * bypassed, which is worse than the advisory.
 *
 * So an exception exists, and it holds only while four things are true, each
 * checked on every run and none taken on trust:
 *
 *   1. it names the advisory and the package, and says why it cannot be reached;
 *   2. its review date has not passed;
 *   3. the advisory still has no fixed version: the day one is published the
 *      exception falls and the gate asks for the upgrade;
 *   4. the package is absent from what a consumer installs (`npm ls
 *      --omit=dev`, read off the lockfile): an exception never covers
 *      something that ships.
 *
 * An advisory database that cannot be read fails the run: unknown is not safe.
 *
 * The four flags below replace the outside world, for the test that proves
 * each way out without waiting for a real advisory: `--report <file>` (the
 * JSON of `npm audit`), `--today <date>`, `--fixed <ids>` (advisories that
 * have a fixed version, or `unreadable`), `--shipped <packages>`.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

/** One line each. `why` is read by whoever reviews it on `reviewBefore`. */
const EXCEPTIONS = [
	{
		advisory: 'GHSA-fc5q-39xc-vjpf',
		package: 'picomatch',
		reviewBefore: '2026-12-18',
		why: 'reached through vitest, vite and knip only, whose glob patterns come from this repository and never from outside input; every published version is affected, so there is nothing to upgrade to'
	}
];

const flag = (name) => {
	const at = process.argv.indexOf(`--${name}`);
	return at === -1 ? null : process.argv[at + 1];
};

/** npm, through the binary that is running this script: `npm run audit` sets it. */
function npm(args) {
	const cli = process.env.npm_execpath;
	if (!cli) throw new Error('run this through `npm run audit`: npm_execpath is unset');
	return execFileSync(process.execPath, [cli, ...args], {
		encoding: 'utf8',
		stdio: 'pipe',
		maxBuffer: 64 * 1024 * 1024
	});
}

function auditReport() {
	const given = flag('report');
	if (given !== null) return readFileSync(given, 'utf8');
	try {
		return npm(['audit', '--json']);
	} catch (error) {
		// npm audit exits 1 as soon as it finds anything: its output is still the report.
		if (error.stdout) return error.stdout;
		throw error;
	}
}

/** The high and critical advisories of a report, one per identifier. */
function seriousAdvisories(report) {
	const found = new Map();
	for (const [name, entry] of Object.entries(report.vulnerabilities ?? {})) {
		for (const via of entry.via ?? []) {
			if (typeof via !== 'object' || !['high', 'critical'].includes(via.severity)) continue;
			const id = /GHSA-[\w-]+/.exec(via.url ?? '')?.[0] ?? String(via.source);
			found.set(id, { id, package: name, title: via.title, severity: via.severity });
		}
	}
	return [...found.values()];
}

async function hasFixedVersion(id) {
	const given = flag('fixed');
	if (given === 'unreadable') throw new Error('unreadable');
	if (given !== null) return given.split(',').includes(id);
	const token = process.env.GITHUB_TOKEN;
	const response = await fetch(`https://api.github.com/advisories/${id}`, {
		headers: {
			accept: 'application/vnd.github+json',
			...(token ? { authorization: `Bearer ${token}` } : {})
		}
	});
	if (!response.ok) throw new Error(`HTTP ${response.status}`);
	const advisory = await response.json();
	return (advisory.vulnerabilities ?? []).some((entry) => entry.first_patched_version);
}

function isShipped(name) {
	const given = flag('shipped');
	if (given !== null) return given.split(',').includes(name);
	let listed;
	try {
		listed = npm(['ls', name, '--omit=dev', '--all', '--json', '--package-lock-only']);
	} catch (error) {
		// npm ls exits 1 when nothing matches: its output is still the answer.
		listed = error.stdout;
	}
	try {
		return Object.keys(JSON.parse(listed).dependencies ?? {}).length > 0;
	} catch {
		// No readable answer: then nothing is proven absent.
		return true;
	}
}

/** Why an exception does not hold today, or `null` when it does. */
async function refusal(advisory, exception, today) {
	if (exception.reviewBefore < today) {
		return `${advisory.id}: the exception was to be reviewed before ${exception.reviewBefore}`;
	}
	if (isShipped(exception.package)) {
		return `${advisory.id}: ${exception.package} is in what a consumer installs, no exception covers that`;
	}
	try {
		if (await hasFixedVersion(advisory.id)) {
			return `${advisory.id}: a fixed version is published, the exception falls - upgrade`;
		}
	} catch (error) {
		return `${advisory.id}: the advisory database could not be read (${error.message})`;
	}
	return null;
}

const today = flag('today') ?? new Date().toISOString().slice(0, 10);
const advisories = seriousAdvisories(JSON.parse(auditReport()));
const failures = [];
for (const advisory of advisories) {
	const exception = EXCEPTIONS.find(
		(one) => one.advisory === advisory.id && one.package === advisory.package
	);
	if (!exception) {
		failures.push(`${advisory.severity} ${advisory.id} (${advisory.package}): ${advisory.title}`);
		continue;
	}
	const refused = await refusal(advisory, exception, today);
	if (refused) failures.push(refused);
	else console.log(`excepted ${advisory.id} (${advisory.package}): ${exception.why}`);
}
const seen = new Set(advisories.map((advisory) => advisory.id));
for (const { advisory } of EXCEPTIONS) {
	if (!seen.has(advisory))
		console.log(`${advisory} is no longer in the audit: remove its exception`);
}
if (failures.length > 0) {
	console.error(failures.map((line) => `FAIL ${line}`).join('\n'));
	process.exit(1);
}
console.log('audit: no high or critical advisory outside a written exception.');
