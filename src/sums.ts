/*
 * Which figures a sum printed on the page holds.
 *
 * A table of accounts checks itself: a total is printed under its terms, or to
 * their right. Misread one cell and the equality breaks, so every cell of a sum
 * that holds EXACTLY was read right, short of two errors that cancel out. This
 * is arithmetic on the cells of a reading and nothing else: no geometry, no
 * learned weight, no knowledge of what the rows are called.
 *
 * What a sum cannot see is kept out of what it proves, and each of these was
 * found on real annual reports, not imagined:
 *
 * - a sum still holds when every one of its cells changes sign together, so it
 *   does not answer for a sign that only a detached dash carries (`- 4,913`
 *   is often the dash of an empty neighbouring column);
 * - a sum still holds when the same note reference is glued in front of its
 *   total and of one term (`13 505 839` under `13 439 232`), so a sum that
 *   adds up both with and without that leading group proves nothing;
 * - a charge printed without its sign makes a sum that only holds once a term
 *   is subtracted. Trying every pattern of signs is trying many sums, so such
 *   a sum is believed only when a parallel column holds the same one.
 */

/** One sum that holds on a page, and where it sits. */
export interface Sum {
	/** Index into `pages`. */
	page: number;
	/** `'column'`: the total is under its terms. `'row'`: it is right of them. */
	along: 'column' | 'row';
	/** The column the sum runs down, or the row it runs along. */
	line: number;
	/** Where the total is on that line: a row index down a column, a cell index along a row. */
	total: number;
	/** Where the terms are, the same way. A proven subtotal stands for its own terms. */
	terms: number[];
	/** `'printed'`: it holds with the signs as printed. `'free'`: a term is subtracted though printed without a sign. */
	signs: 'printed' | 'free';
	/** How many parallel lines hold the same sum at the same places, this one included. */
	agreeing: number;
}

/** A cell that is one number, scaled to an integer by its own decimals. */
interface Figure {
	n: number;
	decimals: number;
	/** Its sign is a dash set apart from the digits by a space. */
	loose: boolean;
	/** A first group of one to three digits, and the number without it. */
	head?: string;
	headless?: number;
}

/** A figure and its place on the line. */
interface Placed extends Figure {
	at: number;
}

type Read = Figure | 'empty' | 'wall';

interface Found {
	total: number;
	terms: number[];
	signs: 'printed' | 'free';
	pattern: string;
	size: number;
}

/** Past this many terms a coincidence becomes likely. */
const MOST_TERMS = 12;
/** With free signs 2^k patterns are tried, so the window is kept shorter. */
const MOST_FREE_TERMS = 6;
/** A total under three digits adds up by chance too often to prove anything. */
const SMALLEST_TOTAL = 100;
/** How many parallel lines must hold a sum before it is believed. */
const AGREEING = {
	column: { printed: 1, free: 2 },
	row: { printed: 1, free: 3 }
} as const;

const DASH = '-\\u2212\\u2013';
/** The units a figure may end on, lower case, the longer ones first. */
const UNITS_AFTER = ['k\u20ac', 'm\u20ac', '\u20ac', 'eur', '$'];
const UNIT_BEFORE = /^[\u20ac$]\s*/;
const LEADING_SIGN = new RegExp(`^[${DASH}+]`);
const TRAILING_SIGN = /[-\u2212]$/;
const GROUPED = /^\d{1,3}(?:[ .,'\u2019]\d{3})*(?:[.,]\d+)?$/;
const UNGROUPED = /^\d+(?:[.,]\d+)?$/;
const LOOSE_DASH = new RegExp(`^[${DASH}]\\s+\\d|\\d\\s+[${DASH}]$`);
const HEAD = new RegExp(`^(\\(?\\s*(?:[${DASH}+]\\s*)?)(\\d{1,3})\\s+(?=\\d)`);
const FINAL_DECIMALS = /[.,](\d{1,2})$/;

const withoutTrailing = (text: string, character: string): string => {
	let end = text.length;
	while (end > 0 && text[end - 1] === character) end -= 1;
	return text.slice(0, end);
};

/** A cell without the unit it ends on, if it ends on one. */
const withoutUnit = (text: string): string => {
	const unit = UNITS_AFTER.find((suffix) => text.toLowerCase().endsWith(suffix));
	return unit === undefined ? text : text.slice(0, -unit.length).trimEnd();
};

const withoutLeadingZeros = (digits: string): string => {
	let start = 0;
	while (start < digits.length - 1 && digits[start] === '0') start += 1;
	return digits.slice(start);
};

/** The sign peeled off a cell: brackets, a leading sign, a trailing minus. */
function peelSign(text: string): { negative: boolean; body: string } {
	let body = text;
	let negative = false;
	if (body.startsWith('(') && body.endsWith(')')) {
		negative = true;
		body = body.slice(1, -1).trim();
	}
	if (LEADING_SIGN.test(body)) {
		negative = !body.startsWith('+');
		body = body.slice(1).trim();
	}
	if (TRAILING_SIGN.test(body)) {
		negative = true;
		body = body.slice(0, -1).trim();
	}
	return { negative, body };
}

/** The integer a cell prints once its marks are dropped, or null when it is not ONE number. */
function integerOf(cell: string): number | null {
	const text = cell.replace(/\s+/g, ' ').trim();
	const bare = withoutTrailing(withoutUnit(text).replace(UNIT_BEFORE, ''), '*').trim();
	const { negative, body } = peelSign(bare);
	if (!GROUPED.test(body) && !UNGROUPED.test(body)) return null;
	const magnitude = Number(withoutLeadingZeros(body.replace(/\D/g, '')));
	return negative ? -magnitude : magnitude;
}

/** How many decimals a cell prints: one or two digits behind its last mark. */
function decimalsOf(text: string): number {
	let end = text.length;
	while (end > 0 && !/\d/.test(text[end - 1])) end -= 1;
	return FINAL_DECIMALS.exec(text.slice(0, end))?.[1].length ?? 0;
}

/**
 * What a cell is to a sum: a figure, nothing (`'empty'`: a blank, a dash), or
 * a `'wall'` no sum crosses: two numbers melted into one cell, a date, a rate.
 */
function readCell(cell: string): Read {
	const text = cell.trim();
	if (!/\d/.test(text)) return 'empty';
	const n = integerOf(text);
	if (n === null || !Number.isSafeInteger(n)) return 'wall';
	const figure: Figure = { n, decimals: decimalsOf(text), loose: LOOSE_DASH.test(text) };
	const head = HEAD.exec(text);
	if (!head) return figure;
	// The other reading of the same cell: the first group was a reference, not thousands.
	return { ...figure, head: head[2], headless: integerOf(text.replace(HEAD, '$1')) as number };
}

/** The total a pattern of signs makes of the terms: bit i - 1 subtracts term i. */
function signedSum(values: number[], pattern: number): number {
	let sum = Math.abs(values[0]);
	for (let i = 1; i < values.length; i++) {
		const value = Math.abs(values[i]);
		sum += pattern & (1 << (i - 1)) ? -value : value;
	}
	return sum;
}

/** The one pattern of signs that makes the total, or null when none or several do. */
function freePattern(values: number[], total: number): number | null {
	const fits: number[] = [];
	// The first term keeps its plus: the opposite pattern makes the same total, sign aside.
	for (let pattern = 0; pattern < 1 << (values.length - 1); pattern++) {
		if (Math.abs(signedSum(values, pattern)) === Math.abs(total)) fits.push(pattern);
	}
	// Two patterns that both fit: the sum no longer says which, so it proves nothing.
	return fits.length === 1 ? fits[0] : null;
}

/** How the terms make the total: as printed, under one free pattern, or not at all. */
function fit(
	terms: Placed[],
	total: Placed
): { signs: 'printed' | 'free'; pattern: string } | null {
	const values = terms.map((term) => term.n);
	if (values.reduce((sum, value) => sum + value, 0) === total.n) {
		return { signs: 'printed', pattern: 'p' };
	}
	if (terms.length > MOST_FREE_TERMS || values.includes(0)) return null;
	const pattern = freePattern(values, total.n);
	return pattern === null ? null : { signs: 'free', pattern: `f${pattern}` };
}

/** True when the sum also holds without the leading group its total shares with a term. */
function holdsHeadless(terms: Placed[], total: Placed, pattern: string): boolean {
	if (total.head === undefined || !terms.some((term) => term.head === total.head)) return false;
	const values = terms.map((term) =>
		term.head === total.head ? (term.headless as number) : term.n
	);
	const headless = total.headless as number;
	if (pattern === 'p') return values.reduce((sum, value) => sum + value, 0) === headless;
	return Math.abs(signedSum(values, Number(pattern.slice(1)))) === Math.abs(headless);
}

/** True when nothing in the sum pins down the sign a detached dash gave. */
function signUnheld(terms: Placed[], total: Placed, signs: 'printed' | 'free'): boolean {
	const cells = [...terms, total].filter((cell) => cell.n !== 0);
	if (!cells.some((cell) => cell.loose)) return false;
	return signs === 'free' || cells.every((cell) => cell.loose);
}

/** The nearest run of terms above `at` that makes its figure, and how. */
function sumEndingAt(
	items: Placed[],
	at: number
): { from: number; signs: 'printed' | 'free'; pattern: string } | null {
	const total = items[at];
	if (total.n === 0) return null;
	for (let from = at - 2; from >= Math.max(0, at - MOST_TERMS); from--) {
		const terms = items.slice(from, at);
		if (terms.some((term) => term.decimals !== total.decimals)) return null;
		if (terms.filter((term) => term.n !== 0).length < 2) continue;
		const found = fit(terms, total);
		if (found) return { from, ...found };
	}
	return null;
}

/** One walk down a run: each sum found is recorded and folded into its total. */
function foldOnce(run: Placed[], found: Found[]): Placed[] {
	let items = run;
	let at = 2;
	while (at < items.length) {
		const sum = sumEndingAt(items, at);
		const total = items[at];
		const terms = sum ? items.slice(sum.from, at) : [];
		if (!sum || holdsHeadless(terms, total, sum.pattern) || signUnheld(terms, total, sum.signs)) {
			at += 1;
			continue;
		}
		found.push({
			total: total.at,
			terms: terms.map((term) => term.at),
			signs: sum.signs,
			pattern: sum.pattern,
			size: Math.abs(total.n)
		});
		items = [...items.slice(0, sum.from), ...items.slice(at)];
		at = sum.from + 1;
	}
	return items;
}

/** The sums of one run of figures. A proven total stands for its terms, so a
 *  grand total is proven over its subtotals. */
function sumsOfRun(run: Placed[]): Found[] {
	const found: Found[] = [];
	let items = run;
	let before: number;
	do {
		before = items.length;
		items = foldOnce(items, found);
	} while (items.length < before);
	return found;
}

/** The sums of one line of cells: a column read down, or a row read across. */
function sumsOfLine(line: Read[]): Found[] {
	const found: Found[] = [];
	let run: Placed[] = [];
	const close = () => {
		if (run.length >= 3) found.push(...sumsOfRun(run));
		run = [];
	};
	line.forEach((cell, at) => {
		if (cell === 'wall') close();
		else if (cell !== 'empty') run.push({ at, ...cell });
	});
	close();
	return found;
}

/** The sums along every line of one direction, each with the lines that agree with it. */
function sumsAlong(along: 'column' | 'row', lines: Read[][], page: number): Sum[] {
	const groups = new Map<string, { sum: Sum; size: number }[]>();
	lines.forEach((line, at) => {
		for (const { total, terms, signs, pattern, size } of sumsOfLine(line)) {
			const key = `${total}|${terms.join(',')}|${pattern}`;
			const group = groups.get(key) ?? [];
			group.push({ sum: { page, along, line: at, total, terms, signs, agreeing: 0 }, size });
			groups.set(key, group);
		}
	});
	return [...groups.values()]
		.filter((group) => group.length >= AGREEING[along][group[0].sum.signs])
		.flatMap((group) =>
			group
				.filter(({ size }) => size >= SMALLEST_TOTAL)
				.map(({ sum }) => ({ ...sum, agreeing: group.length }))
		);
}

/**
 * Every sum that holds on the pages of a reading, and is strong enough to be
 * believed: `pages[i][j][k]` is the text of a cell, as `readTable` gives it.
 */
export function provenSums(pages: string[][][]): Sum[] {
	return pages.flatMap((rows, page) => {
		const width = Math.max(0, ...rows.map((row) => row.length));
		const read = rows.map((row) => Array.from({ length: width }, (_, k) => readCell(row[k] ?? '')));
		const columns = Array.from({ length: width }, (_, k) => read.map((row) => row[k]));
		return [...sumsAlong('column', columns, page), ...sumsAlong('row', read, page)];
	});
}

/** The cells the sums hold, laid out like `pages`: true for a term or a total. */
export function provenCells(pages: string[][][], sums: Sum[]): boolean[][][] {
	const proven = pages.map((rows) => rows.map((row) => row.map(() => false)));
	for (const sum of sums) {
		for (const at of [...sum.terms, sum.total]) {
			if (sum.along === 'column') proven[sum.page][at][sum.line] = true;
			else proven[sum.page][sum.line][at] = true;
		}
	}
	return proven;
}
