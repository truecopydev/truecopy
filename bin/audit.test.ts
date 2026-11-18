import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/*
 * An exception to the audit holds on four conditions, and each one has to be
 * seen failing: an exception nobody can make fall is a rule switched off.
 */
const advisory = (id: string, name: string, severity = 'high'): object => ({
	[name]: {
		via: [
			{ source: 1, url: `https://github.com/advisories/${id}`, title: 'a flaw', severity },
			'a-parent-package'
		]
	}
});

const PICOMATCH = advisory('GHSA-fc5q-39xc-vjpf', 'picomatch');

function audit(
	vulnerabilities: object,
	{ today = '2026-11-18', fixed = '', shipped = '' } = {}
): { out: string; code: number } {
	const report = join(mkdtempSync(join(tmpdir(), 'truecopy-audit-')), 'report.json');
	writeFileSync(report, JSON.stringify({ vulnerabilities }));
	const args = ['--report', report, '--today', today, '--fixed', fixed, '--shipped', shipped];
	try {
		const out = execFileSync(process.execPath, ['scripts/audit.mjs', ...args], {
			encoding: 'utf8',
			stdio: 'pipe'
		});
		return { out, code: 0 };
	} catch (error) {
		const failure = error as { stdout?: string; stderr?: string; status?: number };
		return { out: (failure.stdout ?? '') + (failure.stderr ?? ''), code: failure.status ?? 1 };
	}
}

describe('the audit', () => {
	it('passes on a tree with nothing serious in it', () => {
		const { out, code } = audit(advisory('GHSA-aaaa-bbbb-cccc', 'some-tool', 'moderate'));
		expect(code).toBe(0);
		expect(out).toContain('GHSA-fc5q-39xc-vjpf is no longer in the audit');
	});

	it('fails on a serious advisory nobody wrote an exception for', () => {
		const { out, code } = audit(advisory('GHSA-aaaa-bbbb-cccc', 'some-tool'));
		expect(code).toBe(1);
		expect(out).toContain('FAIL high GHSA-aaaa-bbbb-cccc (some-tool)');
	});

	it('lets a written exception through, and says why', () => {
		const { out, code } = audit(PICOMATCH);
		expect(code).toBe(0);
		expect(out).toContain('excepted GHSA-fc5q-39xc-vjpf (picomatch)');
	});

	it('drops the exception once its review date has passed', () => {
		const { out, code } = audit(PICOMATCH, { today: '2026-12-19' });
		expect(code).toBe(1);
		expect(out).toContain('was to be reviewed before 2026-12-18');
	});

	it('drops the exception the day a fixed version is published', () => {
		const { out, code } = audit(PICOMATCH, { fixed: 'GHSA-fc5q-39xc-vjpf' });
		expect(code).toBe(1);
		expect(out).toContain('a fixed version is published');
	});

	it('drops the exception when the package reaches what a consumer installs', () => {
		const { out, code } = audit(PICOMATCH, { shipped: 'picomatch' });
		expect(code).toBe(1);
		expect(out).toContain('is in what a consumer installs');
	});

	it('fails when the advisory database cannot be read', () => {
		const { out, code } = audit(PICOMATCH, { fixed: 'unreadable' });
		expect(code).toBe(1);
		expect(out).toContain('could not be read');
	});
});
