/*
 * Domain knowledge as data, not as code.
 *
 * Everything that varies by market, by issuer or by document family - the header
 * words, the noise lines, the vocabulary that names a kind - is a value, not a
 * branch. A value can be served by a backend, refined by whoever reads the
 * documents, versioned, and swapped for another market without a deploy. A
 * branch can only be edited by whoever can edit the code.
 *
 * A profile carries regular expressions, and JSON does not. They travel as
 * `{ source, flags }` and are rebuilt here - which is exactly where the danger
 * is, and where the guard goes.
 *
 * The guard is the point. A profile that comes over the wire is untrusted input,
 * and it is applied to untrusted input: a hostile or garbled pattern hangs the
 * tab on a document nobody wrote. A rejected pattern compiles to one that never
 * matches, so the feature degrades and the page stays alive - the opposite of
 * throwing, which would take the whole read down with it.
 */

/** A pattern as it travels: JSON has no regular expressions. */
export interface RawPattern {
	source: string;
	flags: string;
}

/**
 * Matches nothing, ever: end-of-input followed by start-of-input, which no
 * string can satisfy. What a rejected pattern becomes.
 */
export const NEVER_MATCHES = /$^/;

/** Past this, a pattern is not a rule someone wrote: it is a payload. */
const LONGEST_REASONABLE_SOURCE = 1000;

/**
 * The classic catastrophic shape: a quantified group whose body is itself
 * quantified, as in `(a+)+` or `(\d*)*`.
 *
 * The first segment excludes `+*` so the quantifier character is matched only
 * by the explicit class and not also by the surrounding one - removing that
 * overlap keeps the exact same set of matches while making this guard itself
 * free of backtracking. A guard that can hang is not a guard.
 */
const NESTED_QUANTIFIER = /\([^()+*]*[+*][^()]*\)\s*[+*]/;

export interface CompileOptions {
	/** Add `i` when the profile did not. A noise line is noise in any case. */
	caseInsensitive?: boolean;
}

/**
 * Rebuild one pattern, or `NEVER_MATCHES` when it cannot be trusted. Never
 * throws: a bad rule must cost its own feature, not the whole reading.
 */
export function compilePattern(raw: RawPattern, options: CompileOptions = {}): RegExp {
	if (raw.source.length > LONGEST_REASONABLE_SOURCE) return NEVER_MATCHES;
	if (NESTED_QUANTIFIER.test(raw.source)) return NEVER_MATCHES;
	const flags =
		options.caseInsensitive === true && !raw.flags.includes('i') ? raw.flags + 'i' : raw.flags;
	try {
		return new RegExp(raw.source, flags);
	} catch {
		return NEVER_MATCHES;
	}
}

export const compilePatterns = (raw: RawPattern[], options?: CompileOptions): RegExp[] =>
	raw.map((one) => compilePattern(one, options));

/** The wire form of a pattern, to generate or export a profile. */
export const toRawPattern = (pattern: RegExp): RawPattern => ({
	source: pattern.source,
	flags: pattern.flags
});

export const toRawPatterns = (patterns: RegExp[]): RawPattern[] => patterns.map(toRawPattern);

/** Count what a pattern matches in a text, whether or not it was written
 *  global. */
export function countMatches(text: string, pattern: RegExp): number {
	const flags = pattern.flags.includes('g') ? pattern.flags : pattern.flags + 'g';
	return text.match(new RegExp(pattern.source, flags))?.length ?? 0;
}
