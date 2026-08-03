import { describe, expect, it } from 'vitest';
import {
	NEVER_MATCHES,
	compilePattern,
	compilePatterns,
	countMatches,
	toRawPattern,
	toRawPatterns
} from './pattern.js';

describe('a pattern travelling as data', () => {
	it('goes out and comes back unchanged', () => {
		const raw = toRawPattern(/sol(de|d)/i);
		expect(raw).toEqual({ source: 'sol(de|d)', flags: 'i' });
		expect(compilePattern(raw).test('SOLDE')).toBe(true);
	});

	it('handles whole lists both ways', () => {
		const patterns = [/a/, /b/i];
		expect(compilePatterns(toRawPatterns(patterns)).map((p) => p.source)).toEqual(['a', 'b']);
	});

	it('adds the case-insensitive flag when the profile forgot it', () => {
		expect(
			compilePattern({ source: 'solde', flags: '' }, { caseInsensitive: true }).test('SOLDE')
		).toBe(true);
		// And does not double it when it is already there.
		expect(compilePattern({ source: 'solde', flags: 'i' }, { caseInsensitive: true }).flags).toBe(
			'i'
		);
	});
});

/*
 * The guard is the point. A profile served over the wire is untrusted input,
 * applied to untrusted input. A rejected rule must cost its own feature and
 * nothing else: throwing would take the whole reading down with it.
 */
describe('the guard on a pattern that cannot be trusted', () => {
	it('rejects a nested quantifier, which is how a tab is hung', () => {
		expect(compilePattern({ source: '(a+)+$', flags: '' })).toBe(NEVER_MATCHES);
		expect(compilePattern({ source: '(\\d*)*', flags: '' })).toBe(NEVER_MATCHES);
	});

	it('rejects a source too long to be a rule someone wrote', () => {
		expect(compilePattern({ source: 'a'.repeat(1001), flags: '' })).toBe(NEVER_MATCHES);
	});

	it('rejects what does not compile, without throwing', () => {
		expect(compilePattern({ source: '([', flags: '' })).toBe(NEVER_MATCHES);
	});

	it('a rejected pattern matches nothing, so the feature degrades quietly', () => {
		expect(NEVER_MATCHES.test('anything at all')).toBe(false);
	});
});

describe('countMatches', () => {
	it('counts whether or not the pattern was written global', () => {
		expect(countMatches('solde, solde', /solde/)).toBe(2);
		expect(countMatches('solde, solde', /solde/g)).toBe(2);
	});

	it('counts none without failing', () => {
		expect(countMatches('nothing here', /solde/)).toBe(0);
	});
});
