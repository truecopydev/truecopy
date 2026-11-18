/*
 * How far each figure of a reading can be trusted, cell by cell.
 *
 * The doubts of `readTable` are written by hand and speak for a page or a
 * column. Measured on real annual reports they do not sort the wrong cells from
 * the right ones: a reading with no doubt at all still carried wrong figures.
 * So this signal was LEARNED instead: a logistic regression over what the
 * reading itself shows of a cell (how many fragments it was built from, the
 * gaps between them, the width of its column, its brackets, how many numbers
 * it holds), fitted once on cells whose true value was known, then frozen.
 *
 * Nothing here reads the truth, a network or a model file: the weights below
 * are the whole of it, and the arithmetic is a dot product.
 *
 * What was measured is narrow, and the claim is kept as narrow: tables of
 * annual reports rendered to PDF, cut with the default options. A page in
 * another unit, a page with no column, a column the cut merged: the model never
 * saw one of those with a known truth, so it gives `null` there, not a number.
 */

import type { Document, PositionedItem } from './document.js';
import { columnAt } from './layout.js';
import type { Finding } from './table.js';

/**
 * At or above this confidence, a figure is served as sure.
 *
 * Fixed before the tables it was judged on were collected, then measured on
 * tables of annual reports from outside the country the model learned on. The
 * figures of that measure are in the changelog entry of the release that
 * shipped it; the threshold itself does not move with a release.
 */
export const CONFIDENT_ABOVE = 0.9891277595297994;

/** What the frozen model reads of one cell. `null` where it cannot be computed. */
interface Traits {
	items: number;
	gapMin: number | null;
	gapMax: number | null;
	gapMinShare: number | null;
	gapMaxShare: number | null;
	columnWidth: number | null;
	columnWidthShare: number | null;
	rightMargin: number | null;
	opensOnly: number;
	closesOnly: number;
	unbalanced: number;
	numbers: number;
	oneNumber: number;
	alone: number;
	rowRank: number;
	columnRank: number;
	firstColumn: number;
	lastColumn: number;
	heightShare: number | null;
	findings: number;
	thinColumn: number;
	pagesDisagree: number;
	characters: number;
	digits: number;
	star: number;
	percent: number;
	leadingNote: number;
}

const INTERCEPT = -5.1875825643138365;

/**
 * The frozen model: per trait, the mean and spread it was standardised with,
 * its weight, and the weight of its absence where an absence was ever seen.
 * A trait that never varied while learning carried no weight and is not here.
 */
const MODEL: Record<keyof Traits, readonly [number, number, number, number?]> = {
	items: [1.4867731201072514, 0.8531752048174105, -1.319063294899439],
	gapMin: [1.614273519426434, 7.7354434250583, 2.291334057128206, -0.23803119128439895],
	gapMax: [2.1559564813822476, 8.70849911324282, 2.512045306378635, -0.23803119128439895],
	gapMinShare: [0.1174332429994406, 6.888119140455273, -0.007839516060731735, -0.23803119128439895],
	gapMaxShare: [1.1034340539636784, 99.20575525760687, -0.052098217266081985, -0.23803119128439895],
	columnWidth: [93.45637456026792, 53.55261535600553, -0.5637844440161024],
	columnWidthShare: [1.0532458859721967, 0.5115231655032357, 0.3502395024009057],
	rightMargin: [19.887544625993414, 19.48328692758697, 0.438050281208684],
	opensOnly: [0.00045486102798592324, 0.021322620135231177, 0.01922196954644141],
	closesOnly: [0.003112207033587896, 0.05570028007981868, 0.03191349767329446],
	unbalanced: [0.003567068061573819, 0.05961832006200428, 0.03669096196175975],
	numbers: [1.047209786694118, 0.2651595745528245, 0.19441390448090026],
	oneNumber: [0.9823561801249671, 0.13165301172120103, -1.782960126468332],
	alone: [0.0004069809197768787, 0.020169662523403978, -0.061550803986596604],
	rowRank: [0.5701319848255395, 0.2802688705762042, -0.07319057574372755],
	columnRank: [0.7008256495897401, 0.25246123277890287, -0.8202196235607192],
	firstColumn: [0.004428910009336621, 0.06640252077644865, 0.2472765813117616],
	lastColumn: [0.2694213688922937, 0.44365921029155647, 0.28292478602369103],
	heightShare: [1.0005189975825324, 0.027946706565001582, -0.19334539073699422],
	findings: [1.2612578104426515, 1.1077962376905481, 0.0695143734740666],
	thinColumn: [0.009671781858226999, 0.09786847548575402, 0.18099185968924347],
	pagesDisagree: [0.6746546647195423, 0.46850373327396316, 0.4114895713380505],
	characters: [5.365564626176055, 2.6908573225136774, 0.9354937015231262],
	digits: [3.622608987096311, 1.6716453632866217, -0.3939057145067606],
	star: [2.3940054104522276e-5, 0.004892798890036272, 5.173611955917607e-12],
	percent: [0.003734648440305475, 0.060997547830488975, -0.09128722653356276],
	leadingNote: [0.2437576308922458, 0.42934816672945086, -0.6316376366249625]
};

function confidenceOf(traits: Traits): number {
	let score = INTERCEPT;
	for (const name of Object.keys(MODEL) as (keyof Traits)[]) {
		const [mean, spread, weight, absent = 0] = MODEL[name];
		const value = traits[name];
		score += value === null ? absent : weight * ((value - mean) / spread);
	}
	// The model scores the FAULT; what is served is its complement.
	return 1 / (1 + Math.exp(score));
}

const BLANKS = /[ \t\u00a0\u2009\u202f]+/;
const UNIT_TOKENS = new Set(['%', '\u20ac', '$', 'k\u20ac', 'M\u20ac', 'x']);
const NUMERIC_TOKEN = /^[-+\u2212(]?\d+(?:[.,]\d+)?%?\)?$/;
const THOUSANDS_GROUP = /^\d{3}%?\)?$/;
const GROUP_HEAD = /^[-+\u2212(]?\d{1,3}$/;
const GROUP_END = /[%)]$/;

/** Where the number opening at `start` ends, its thousands groups rejoined. */
function endOfNumber(tokens: string[], start: number): number {
	let end = start;
	if (!GROUP_HEAD.test(tokens[start])) return end;
	while (end + 1 < tokens.length && THOUSANDS_GROUP.test(tokens[end + 1])) {
		end++;
		if (GROUP_END.test(tokens[end])) break;
	}
	return end;
}

/**
 * How many numbers a cell holds, "1 234" counting as one.
 *
 * A space is what French notation puts between thousands, so a head of one to
 * three digits takes every group of exactly three that follows it. Two is the
 * sign of two columns that landed in one cell.
 */
function countNumbers(cell: string): number {
	const tokens = cell.split(BLANKS).filter((token) => token !== '' && !UNIT_TOKENS.has(token));
	let found = 0;
	let at = 0;
	while (at < tokens.length) {
		if (NUMERIC_TOKEN.test(tokens[at])) {
			at = endOfNumber(tokens, at);
			found++;
		}
		at++;
	}
	return found;
}

const TRAILING_UNIT = /(?:[%\u20ac$]|EUR|k\u20ac|M\u20ac)$/i;
const LEADING_UNIT = /^[\u20ac$]/;
const GROUPED_FIGURE = /^\d{1,3}(?:[ .,'\u2019]\d{3})*(?:[.,]\d+)?$/;
const PLAIN_FIGURE = /^\d+(?:[.,]\d+)?$/;

/** Whether a cell is exactly ONE number, its sign, brackets and unit set aside. */
function isOneNumber(cell: string): boolean {
	let text = cell.replace(/\s+/g, ' ').trim();
	text = text.replace(TRAILING_UNIT, '').trimEnd().replace(LEADING_UNIT, '');
	while (text.endsWith('*')) text = text.slice(0, -1);
	text = text.trim();
	if (/^\(.*\)$/.test(text)) text = text.slice(1, -1).trim();
	text = text
		.replace(/^[-\u2212\u2013+]/, '')
		.trim()
		.replace(/[-\u2212]$/, '')
		.trim();
	return GROUPED_FIGURE.test(text) || PLAIN_FIGURE.test(text);
}

function median(values: number[]): number | null {
	const sorted = [...values].sort((a, b) => a - b);
	if (sorted.length === 0) return null;
	const middle = Math.floor(sorted.length / 2);
	return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

/** The gaps between consecutive items, left to right. */
function gapsOf(items: PositionedItem[]): number[] {
	const sorted = [...items].sort((a, b) => a.x - b.x);
	return sorted.slice(1).map((item, at) => item.x - (sorted[at].x + sorted[at].width));
}

const share = (value: number | null, of: number | null): number | null =>
	value === null || !of ? null : value / of;

const least = (values: number[]): number | null => (values.length ? Math.min(...values) : null);
const most = (values: number[]): number | null => (values.length ? Math.max(...values) : null);
const count = (text: string, what: RegExp): number => (text.match(what) ?? []).length;

const HAS_DIGIT = /\d/;
const LEADING_NOTE = /^\d{1,2}\s+[-\u2212(]?\d/;

/** What a reading hands over: the four fields of a `Table` this is computed from. */
interface Reading {
	pages: string[][][];
	boundaries: number[][];
	findings: Finding[];
	document: Document;
}

/**
 * The confidence of every cell of a reading, laid out like `pages`.
 *
 * A number from 0 to 1 for a cell that carries a digit, `null` for every other
 * cell and wherever the model was never measured: a page that is not in points
 * (a paste, a CSV, a Word table), a page with no column, a column the cut
 * merged.
 */
export function cellConfidence(reading: Reading): (number | null)[][][] {
	const { pages, boundaries, findings, document } = reading;
	const aboutDocument = findings.filter((finding) => finding.page === undefined);
	return pages.map((rows, at) => {
		const page = document.pages[at];
		const cut = boundaries[at];
		const here = [
			...findings.filter((finding) => finding.page === page.pageNumber),
			...aboutDocument
		];
		const unmeasured = (page.unit ?? 'points') !== 'points' || cut.length === 0;
		const all = page.rows.flatMap((row) => row.items);
		const gapMedian = median(page.rows.flatMap((row) => gapsOf(row.items)).filter((g) => g > 0));
		const heightMedian = median(all.flatMap((item) => item.height ?? []));
		const edges = [
			Math.min(...all.map((item) => item.x)),
			...cut,
			Math.max(...all.map((item) => item.x + item.width))
		];
		const widths = edges.slice(1).map((edge, k) => edge - edges[k]);
		const widthMedian = median(widths.filter((width) => width > 0));
		const marked = (code: Finding['code'], column: number): boolean =>
			here.some((finding) => finding.code === code && finding.column === column);

		return rows.map((cells, r) => {
			const filled = cells.filter((cell) => cell.trim() !== '').length;
			return cells.map((cell, c) => {
				if (!HAS_DIGIT.test(cell) || unmeasured || marked('merged-column', c)) return null;
				const items = page.rows[r].items.filter((item) => columnAt(item.x, cut) === c);
				const gaps = gapsOf(items);
				const heights = items.flatMap((item) => item.height ?? []);
				const opens = count(cell, /\(/g);
				const closes = count(cell, /\)/g);
				const right = most(items.map((item) => item.x + item.width));
				const width = widths[c] ?? null;
				return confidenceOf({
					items: items.length,
					gapMin: least(gaps),
					gapMax: most(gaps),
					gapMinShare: share(least(gaps), gapMedian),
					gapMaxShare: share(most(gaps), gapMedian),
					columnWidth: width,
					columnWidthShare: share(width, widthMedian),
					rightMargin: right === null || width === null ? null : edges[c + 1] - right,
					opensOnly: Number(opens > closes),
					closesOnly: Number(closes > opens),
					unbalanced: Number(opens !== closes),
					numbers: countNumbers(cell),
					oneNumber: Number(isOneNumber(cell)),
					alone: Number(filled === 1),
					rowRank: r / Math.max(rows.length - 1, 1),
					columnRank: c / Math.max(cells.length - 1, 1),
					firstColumn: Number(c === 0),
					lastColumn: Number(c === cells.length - 1),
					heightShare: share(
						heights.length ? heights.reduce((sum, h) => sum + h, 0) / heights.length : null,
						heightMedian
					),
					findings: here.length,
					thinColumn: Number(marked('thin-column', c)),
					pagesDisagree: Number(here.some((finding) => finding.code === 'pages-disagree')),
					characters: cell.length,
					digits: count(cell, /\d/g),
					star: Number(cell.includes('*')),
					percent: Number(cell.includes('%')),
					leadingNote: Number(LEADING_NOTE.test(cell.trim()))
				});
			});
		});
	});
}
