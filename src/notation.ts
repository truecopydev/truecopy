/*
 * How a document writes a number and a date.
 *
 * Notation is not domain. That `1 234,50` and `1,234.50` are the same quantity,
 * that `(123,45)` is negative and `123,45-` is too, that `25/01` is a day before
 * a month in one country and after it in another - none of that says anything
 * about banks, careers or invoices. It says how the page was typeset.
 *
 * Two defects live here, both pinned by tests below, both the kind that passes
 * every test written by whoever caused it:
 *
 *   - reading every dot as a thousands separator turns `27800.50` into
 *     2 780 050, a hundred times over, on figures a person acts upon;
 *   - bounding the run of spaces after an opening parenthesis too tightly makes
 *     the match start later and drop the parenthesis, turning an accounting
 *     negative into a positive amount in silence.
 *
 * What this file never does is decide what a number means. It does not know an
 * amount from a quantity. It reads what is written, says null when it cannot,
 * and leaves the meaning to the caller.
 */

/** The notation a document is written in. */
export interface Notation {
	/**
	 * Which of the first two numbers of a delimited date is the day. There is no
	 * reading of `01/02/2026` that is right everywhere, and no amount of cleverness
	 * makes one: it is stated, or it is guessed.
	 */
	dateOrder: 'DMY' | 'MDY';
	/**
	 * Month names to their index, 0 for January. Accent-free and lower-case: the
	 * lookup normalises what it is given, so `Janv.` finds `janv`.
	 *
	 * Data and not code, like everything else that varies by market - see
	 * `pattern.ts`. A profile served by a backend can carry these.
	 */
	months?: Record<string, number>;
}

/**
 * Spaces a typesetter puts inside a number, written as escapes.
 *
 * A narrow no-break space is invisible in a source file, and a rule written
 * with the literal character cannot be reviewed - the reader sees a space and
 * has no way to know which one. U+202F is what a French PDF puts between
 * thousands, U+00A0 what an HTML export puts there.
 */
const IN_NUMBER = " \\t\\u00A0\\u202F\\u2009'";

/**
 * A token that could be a number.
 *
 * The lookarounds keep a match from starting or ending inside another number.
 * Without them a date glued to a figure - `30/05/2026 300,00` on a flattened
 * line with no column boundary - reads as `026 300,00`, and a rate written
 * `0,000000 %` yields a bogus `0,00`.
 *
 * The run of spaces after an opening parenthesis is bounded, and generously so.
 * Unbounded, the scan goes quadratic on every line of every document. Bounded
 * tightly, it is worse than quadratic: past the bound the match simply starts
 * later and drops the parenthesis, which silently flips the sign. Twelve is far
 * beyond any real gap and still bounded.
 */
export function numberToken(decimals?: number): RegExp {
	const fraction = decimals === undefined ? `(?:[.,]\\d+)?` : `[.,]\\d{${decimals}}(?!\\d)`;
	return new RegExp(
		`(?<![\\d.,/])[-+]?\\(?[${IN_NUMBER}]{0,12}(?:\\d{1,3}(?:[${IN_NUMBER}.]\\d{3})+|\\d+)${fraction}\\)?-?`
	);
}

/** Peel the sign off a token. Parentheses, a trailing minus and a leading minus
 *  each mark it negative; a leading plus is dropped. All three forms appear on
 *  real documents, and two of them are easy to read as no sign at all. */
function stripSign(text: string): { negative: boolean; body: string } {
	let body = text;
	let negative = false;
	if (/^\(.*\)$/.test(body)) {
		negative = true;
		body = body.slice(1, -1);
	}
	if (body.endsWith('-')) {
		negative = true;
		body = body.slice(0, -1);
	}
	if (body.startsWith('-')) {
		negative = true;
		body = body.slice(1);
	}
	if (body.startsWith('+')) body = body.slice(1);
	return { negative, body };
}

/**
 * Rewrite the separators into something `parseFloat` reads.
 *
 * The dot is not always a thousands separator, and the rule that decides is
 * counting: a group of thousands is exactly three digits, so one or two digits
 * behind the last separator can only be a decimal. `27.800` is twenty-seven
 * thousand eight hundred; `27800.50` is twenty-seven thousand eight hundred and
 * fifty centimes; `1.2` is one point two, not twelve.
 */
function normaliseSeparators(text: string): string {
	const lastComma = text.lastIndexOf(',');
	const lastDot = text.lastIndexOf('.');

	// Both present: the rightmost one is the decimal separator.
	if (lastComma >= 0 && lastDot >= 0) {
		return lastComma > lastDot ? text.replace(/\./g, '').replace(',', '.') : text.replace(/,/g, '');
	}
	const last = Math.max(lastComma, lastDot);
	if (last < 0) return text;

	const behind = text.length - last - 1;
	// Not a decimal: the separator is a thousands mark, and what follows it is
	// part of the number. Keeping only what came before turns 27.800 into 27.
	if (behind < 1 || behind > 2) return text.replace(/[.,]/g, '');
	return `${text.slice(0, last).replace(/[.,]/g, '')}.${text.slice(last + 1)}`;
}

/** Currency marks, every kind of space, and the Swiss apostrophe. None of them
 *  carries a digit, so none of them survives into the reading. */
const NOT_IN_NUMBER = /[€$£¥\s']/g;

/**
 * The number a token holds, or `null` when it holds none.
 *
 * Null and never a guess: on figures that a person will act upon, an honest
 * refusal costs a correction and a wrong reading costs a decision.
 */
export function readNumber(raw: string): number | null {
	if (!raw) return null;
	const { negative, body } = stripSign(raw.trim());
	const digits = body.replace(NOT_IN_NUMBER, '');
	if (!/\d/.test(digits)) return null;
	const value = Number.parseFloat(normaliseSeparators(digits));
	if (!Number.isFinite(value)) return null;
	return negative ? -value : value;
}

export interface FoundNumber {
	value: number;
	raw: string;
	/** Where it starts, so a caller can strip it or judge what it sits next to. */
	index: number;
}

/** Every number on a line, in order. `decimals` narrows the search to figures
 *  written with exactly that many - which is how a page tells a sum of money
 *  from a reference number without knowing what money is. */
export function findNumbers(text: string, decimals?: number): FoundNumber[] {
	const token = new RegExp(numberToken(decimals).source, 'g');
	const found: FoundNumber[] = [];
	for (const match of text.matchAll(token)) {
		const value = readNumber(match[0]);
		if (value !== null) found.push({ value, raw: match[0], index: match.index });
	}
	return found;
}

/** True when the whole cell is one number and nothing else. What tells a cell
 *  of a figures column from a cell of prose that happens to quote one. */
export function isOnlyNumber(text: string, decimals?: number): boolean {
	const trimmed = text.trim();
	if (trimmed === '') return false;
	const match = numberToken(decimals).exec(trimmed);
	return match !== null && match[0].length === trimmed.length;
}

/** A calendar date, or null when the three numbers do not make one. Rolling
 *  over - a 31st in a 30-day month - is a misread, never a date. */
function makeDate(year: number, monthIndex: number, day: number): Date | null {
	if (monthIndex < 0 || monthIndex > 11 || day < 1 || day > 31) return null;
	// Two digits are this century. Left alone they would be the nineteen
	// hundreds, which is what `new Date(24, ...)` means and nobody writes.
	const fullYear = year < 100 ? year + 2000 : year;
	const date = new Date(fullYear, monthIndex, day);
	// Rolling over is the tell: a 31st in a 30-day month comes back as the 1st.
	if (date.getMonth() !== monthIndex || date.getDate() !== day) return null;
	return date;
}

/** Lower-case and stripped of its accents, so a table of month names does not
 *  have to carry every spelling of the same word. NFD splits a letter from its
 *  accent, and `\p{M}` is what an accent is. */
const accentFree = (text: string): string =>
	text.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '');

const dayMonth = (first: number, second: number, notation: Notation): [number, number] =>
	notation.dateOrder === 'MDY' ? [second, first] : [first, second];

const DELIMITED = /(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})/;

/** A delimited date anywhere in the text, read in the notation's order. */
export function readDate(text: string, notation: Notation): Date | null {
	const match = DELIMITED.exec(text);
	if (!match) return null;
	const [day, month] = dayMonth(Number(match[1]), Number(match[2]), notation);
	return makeDate(Number(match[3]), month - 1, day);
}

export interface LeadingDate {
	date: Date;
	/** How much of the text the date took, so the caller can strip it and keep
	 *  what follows - which on a table line is the wording. */
	length: number;
}

const ISO = /^(\d{4})-(\d{2})-(\d{2})/;
const LEADING_DELIMITED = /^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})/;
const LEADING_DAY_MONTH = /^(\d{1,2})[/\-.](\d{1,2})(?!\d)/;
/** `\p{L}` and not a range of Latin letters: a month name is a word, in
 *  whichever alphabet the document is set in. */
const LEADING_NAMED = /^(\d{1,2})\s{1,4}([\p{L}.]{3,12})\.?\s{1,4}(\d{4})/u;

/** A date, and the text it took, or null when the shape matched but the numbers
 *  do not make a day. */
const dateOfLength = (date: Date | null, length: number): LeadingDate | null =>
	date === null ? null : { date, length };

function fromIso(text: string): LeadingDate | null {
	const match = ISO.exec(text);
	if (!match) return null;
	return dateOfLength(
		makeDate(Number(match[1]), Number(match[2]) - 1, Number(match[3])),
		match[0].length
	);
}

function fromDelimited(text: string, notation: Notation): LeadingDate | null {
	const match = LEADING_DELIMITED.exec(text);
	if (!match) return null;
	const [day, month] = dayMonth(Number(match[1]), Number(match[2]), notation);
	return dateOfLength(makeDate(Number(match[3]), month - 1, day), match[0].length);
}

function fromDayMonth(text: string, notation: Notation, year: number): LeadingDate | null {
	const match = LEADING_DAY_MONTH.exec(text);
	if (!match) return null;
	const [day, month] = dayMonth(Number(match[1]), Number(match[2]), notation);
	return dateOfLength(makeDate(year, month - 1, day), match[0].length);
}

function fromNamedMonth(text: string, notation: Notation): LeadingDate | null {
	const match = LEADING_NAMED.exec(text);
	if (!match || !notation.months) return null;
	const month = notation.months[accentFree(match[2]).replace('.', '')];
	if (month === undefined) return null;
	return dateOfLength(makeDate(Number(match[3]), month, Number(match[1])), match[0].length);
}

/**
 * The date a line starts with, and how long it is.
 *
 * `yearWhenMissing` is what a document without years on its rows is read
 * against - a statement dates its rows by day and month and states the year
 * once, at the top. Left out, a row without a year is not a date, which is the
 * honest answer when nothing says which year it belongs to.
 */
export function readLeadingDate(
	text: string,
	notation: Notation,
	yearWhenMissing?: number
): LeadingDate | null {
	const trimmed = text.trimStart();
	const skipped = text.length - trimmed.length;
	const found = leadingIn(trimmed, notation, yearWhenMissing);
	return found ? { date: found.date, length: skipped + found.length } : null;
}

/** The four shapes a line may start with, tried in order. A shape that matches
 *  but yields no calendar date lets the next one try. */
function leadingIn(text: string, notation: Notation, year?: number): LeadingDate | null {
	return (
		fromIso(text) ??
		fromDelimited(text, notation) ??
		(year === undefined ? null : fromDayMonth(text, notation, year)) ??
		fromNamedMonth(text, notation)
	);
}
