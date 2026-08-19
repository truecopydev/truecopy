import { describe, expect, it } from 'vitest';
import { readTable } from './table.js';
import { pdfWithPages, pdfWithText } from './kit.js';

/*
 * The shortest path, and its second field.
 *
 * `rows` alone would make this one more table extractor, and a worse one. What
 * sets it apart is what it refuses to vouch for, and these cases measure
 * exactly that: every warning is computed without knowing anything about the
 * document.
 */
const at = (word: string, x: number, y: number) => ({ word, x, y });

const pdf = (words: { word: string; x: number; y: number }[]): File =>
	new File([pdfWithText(words)], 'table.pdf', { type: 'application/pdf' });

const STATEMENT = pdf([
	at('02/05/2026', 50, 700),
	at('CARTE', 150, 700),
	at('12,40', 430, 700),
	at('03/05/2026', 50, 680),
	at('VIREMENT', 150, 680),
	at('750,00', 430, 680),
	at('05/05/2026', 50, 660),
	at('PRELEVEMENT', 150, 660),
	at('68,00', 430, 660)
]);

describe('readTable', () => {
	it('returns the cells with not one line of configuration', async () => {
		const { rows } = await readTable(STATEMENT);
		expect(rows).toEqual([
			['02/05/2026', 'CARTE', '12,40'],
			['03/05/2026', 'VIREMENT', '750,00'],
			['05/05/2026', 'PRELEVEMENT', '68,00']
		]);
	});

	it('complains about nothing on a clean table', async () => {
		expect((await readTable(STATEMENT)).warnings).toEqual([]);
	});

	it('returns the document too, for whoever needs more than the cells', async () => {
		const { document } = await readTable(STATEMENT);
		expect(document.origin).toBe('pdf');
		expect(document.pages).toHaveLength(1);
	});

	it('keeps the rows in their pages, laid out like the cut', async () => {
		// Flattening loses which page a row came from, and some documents cannot
		// be read without it: a page printing two tables side by side carries two
		// runs of headings, and walking the rows in order alternates between them.
		const bundle = new File(
			[
				pdfWithPages([
					[at('a', 50, 700), at('b', 200, 700)],
					[at('c', 50, 700), at('d', 200, 700)]
				])
			],
			'lot.pdf',
			{ type: 'application/pdf' }
		);
		const { rows, pages, boundaries } = await readTable(bundle);
		expect(pages).toEqual([[['a', 'b']], [['c', 'd']]]);
		expect(pages.flat()).toEqual(rows);
		expect(boundaries).toHaveLength(pages.length);
	});

	it('keeps every cut row on the geometric row it came from', async () => {
		// A reader that has to place a stray line of text - which of two records
		// does it belong to? - finds no answer in the cells. The answer is which
		// baseline it sits closer to, so `pages[i][j]` has to be
		// `document.pages[i].rows[j]`, with nothing dropped in between and the
		// rows still descending down the page.
		const bundle = new File(
			[
				pdfWithPages([
					[at('a', 50, 700), at('b', 200, 700), at('suite', 50, 686)],
					[at('c', 50, 700), at('d', 200, 700)]
				])
			],
			'lot.pdf',
			{ type: 'application/pdf' }
		);
		const { pages, document } = await readTable(bundle);
		expect(pages.map((page) => page.length)).toEqual(
			document.pages.map((page) => page.rows.length)
		);
		const [haut, bas] = document.pages[0]?.rows ?? [];
		expect(haut?.y).toBeGreaterThan(bas?.y ?? 0);
		expect(pages[0]?.[1]?.[0]).toBe('suite');
	});
});

describe('what readTable refuses to vouch for', () => {
	it('says when a page shows no column at all', async () => {
		// Everything landed in one column: either the page is prose, or the cut
		// failed and every row came back whole.
		const prose = pdf([at('one whole sentence with no column', 50, 700)]);
		expect((await readTable(prose)).warnings).toEqual([
			'page 1 shows no column at all - every row came back whole'
		]);
	});

	it('says when a column is almost always empty', async () => {
		// Counting cells would say nothing: a row is cut into as many cells as there
		// are boundaries, always. What varies is how often a column is filled, and a
		// column empty on nine rows out of ten was invented by the cut.
		const sparse = pdf([
			at('a', 50, 700),
			at('b', 200, 700),
			at('rare', 400, 700),
			at('c', 50, 680),
			at('d', 200, 680),
			at('e', 50, 660),
			at('f', 200, 660),
			at('g', 50, 640),
			at('h', 200, 640),
			at('i', 50, 620),
			at('j', 200, 620),
			at('k', 50, 600),
			at('l', 200, 600)
		]);
		expect((await readTable(sparse)).warnings).toEqual([
			'column 2 of page 1 is filled on only 17% of its rows - the cut may have invented it'
		]);
	});

	it('says when a column was never separated, which a fill rate cannot see', async () => {
		/*
		 * The opposite failure to a thin column, and the dangerous one: a column
		 * the cut never separated is filled on every row, exactly like a good one,
		 * so no fill rate finds it. Read as one figure, one such column produced
		 * 97 wrong values out of 162 on a real property schedule, and the merged
		 * money column of a real loan schedule went unremarked for a week.
		 */
		const merged = pdf([
			at('a', 50, 700),
			at('1,00 2 000,00', 200, 700),
			at('b', 50, 680),
			at('3,00 4 000,00', 200, 680),
			at('c', 50, 660),
			at('5,00 6 000,00', 200, 660),
			at('d', 50, 640),
			at('7,00 8 000,00', 200, 640)
		]);
		const { findings } = await readTable(merged);
		const merges = findings.filter((finding) => finding.code === 'merged-column');
		expect(merges).toHaveLength(1);
		expect(merges[0]).toMatchObject({ column: 1, page: 1, shareDoubled: 1 });
	});

	it('does not call two integers a merged column, a space being a thousands mark', async () => {
		/*
		 * The condition that stops this crying wolf, and it was measured: without
		 * it the doubt fires on 48 % of a column that is perfectly well cut,
		 * because `30 418 3 741` reads as two numbers and as one. Only a decimal
		 * mark on each makes the boundary certain.
		 */
		const ambiguous = pdf([
			at('a', 50, 700),
			at('30 418 3 741', 200, 700),
			at('b', 50, 680),
			at('12 345 6 789', 200, 680),
			at('c', 50, 660),
			at('98 765 4 321', 200, 660),
			// This row is what makes the test say what it claims. Without a decimal
			// anywhere, the document settles no mark and the doubt is skipped whole -
			// so the assertion would pass without ever reaching the rule it is about.
			at('total 9 876,54', 50, 620)
		]);
		const { findings } = await readTable(ambiguous);
		expect(findings.filter((finding) => finding.code === 'merged-column')).toEqual([]);
	});

	it('does not call a comma-grouped column merged, under English notation', async () => {
		/*
		 * The same trap one notation over, and the reason the mark comes from the
		 * document rather than from a regular expression. Under English notation
		 * `1,234` is a plain thousands integer, so a test for "any dot or comma
		 * before a digit" would call an accidentally split comma-grouped column
		 * merged - exactly the failure the decimal condition exists to rule out.
		 */
		const english = pdf([
			at('a', 50, 700),
			at('1,234 5,678', 200, 700),
			at('b', 50, 680),
			at('2,345 6,789', 200, 680),
			at('c', 50, 660),
			at('3,456 7,890', 200, 660),
			// What settles the notation for the whole document: a decimal written
			// the English way, which is what makes the commas above thousands.
			at('total 9,876.54', 50, 620)
		]);
		const { findings } = await readTable(english);
		expect(findings.filter((finding) => finding.code === 'merged-column')).toEqual([]);
	});

	it('raises no merged-column doubt when the document settles no decimal mark', async () => {
		// A fraction cannot be told from a thousands group without one, so nothing
		// here is CERTAIN - and a doubt this library cannot substantiate is one it
		// does not raise.
		const undecided = pdf([
			at('a', 50, 700),
			at('1,234 5,678', 200, 700),
			at('b', 50, 680),
			at('2,345 6,789', 200, 680),
			at('c', 50, 660),
			at('3,456 7,890', 200, 660)
		]);
		const { findings } = await readTable(undecided);
		expect(findings.filter((finding) => finding.code === 'merged-column')).toEqual([]);
	});

	it('does not call an address a merged column', async () => {
		// A cell holding a number and a word is one value with a name on it.
		const address = pdf([
			at('18,00 Rue Lecourbe 75015,00', 50, 700),
			at('x', 200, 700),
			at('20,00 Rue Cler 75007,00', 50, 680),
			at('y', 200, 680),
			at('22,00 Rue Bara 92100,00', 50, 660),
			at('z', 200, 660)
		]);
		const { findings } = await readTable(address);
		expect(findings.filter((finding) => finding.code === 'merged-column')).toEqual([]);
	});

	it('says when a page of the document is blank', async () => {
		// A blank page in the middle of a bundle is ordinary - a footer sheet, a
		// verso - and joining single-page files does not reproduce one.
		const bundle = new File(
			[pdfWithPages([[at('a', 50, 700), at('b', 200, 700)], []])],
			'lot.pdf',
			{
				type: 'application/pdf'
			}
		);
		expect((await readTable(bundle)).warnings.join(' ')).toMatch(/page 2 carries no text at all/);
	});

	it('says when the pages are not cut the same way', async () => {
		// A page out of step is usually a different table, and joining them makes a
		// third one that is neither.
		const bundle = new File(
			[
				pdfWithPages([
					[at('a', 50, 700), at('b', 200, 700), at('c', 400, 700)],
					[at('d', 50, 700), at('e', 200, 700)]
				])
			],
			'lot.pdf',
			{ type: 'application/pdf' }
		);
		expect((await readTable(bundle)).warnings.join(' ')).toMatch(
			/pages disagree on how many columns/
		);
	});

	it('names each doubt, so a program does not match English to act on it', async () => {
		const sparse = pdf([
			at('a', 50, 700),
			at('b', 200, 700),
			at('rare', 400, 700),
			at('c', 50, 680),
			at('d', 200, 680),
			at('e', 50, 660),
			at('f', 200, 660),
			at('g', 50, 640),
			at('h', 200, 640),
			at('i', 50, 620),
			at('j', 200, 620),
			at('k', 50, 600),
			at('l', 200, 600)
		]);
		const { findings } = await readTable(sparse);
		expect(findings).toHaveLength(1);
		expect(findings[0].code).toBe('thin-column');
		expect(findings[0].page).toBe(1);
		expect(findings[0].column).toBe(2);
		expect(findings[0].shareFilled).toBeCloseTo(1 / 6);
	});

	it('says the same thing twice on purpose: a sentence and a code', async () => {
		// The sentences are derived from the findings rather than written twice,
		// so a message can never say one thing and a code another.
		const prose = pdf([at('one whole sentence with no column', 50, 700)]);
		const { warnings, findings } = await readTable(prose);
		expect(findings.map((finding) => finding.code)).toEqual(['no-column']);
		expect(warnings).toEqual(findings.map((finding) => finding.message));
	});

	it('names a blank page and the pages that disagree, both by code', async () => {
		const bundle = new File(
			[
				pdfWithPages([
					[at('a', 50, 700), at('b', 200, 700), at('c', 400, 700)],
					[],
					[at('d', 50, 700), at('e', 200, 700)]
				])
			],
			'lot.pdf',
			{ type: 'application/pdf' }
		);
		const { findings } = await readTable(bundle);
		expect(findings.map((finding) => finding.code)).toContain('blank-page');
		expect(findings.find((finding) => finding.code === 'blank-page')?.page).toBe(2);
		// A doubt about the whole document names no page, and says so by leaving
		// it out rather than by inventing a zero.
		const disagree = findings.find((finding) => finding.code === 'pages-disagree');
		expect(disagree?.page).toBeUndefined();
	});

	it('a table with no warning is not a promise of correctness', async () => {
		// Three rows cut cleanly, and a fourth that is a total: the shape is
		// faultless, the meaning is not. That is exactly the limit of this short
		// path, and why the rest of the library exists.
		const withTotal = pdf([
			at('02/05/2026', 50, 700),
			at('CARTE', 150, 700),
			at('12,40', 430, 700),
			at('03/05/2026', 50, 680),
			at('VIREMENT', 150, 680),
			at('750,00', 430, 680),
			at('05/05/2026', 50, 660),
			at('PRELEVEMENT', 150, 660),
			at('68,00', 430, 660),
			at('TOTAL', 150, 640),
			at('830,40', 430, 640)
		]);
		const { rows, warnings } = await readTable(withTotal);
		expect(warnings).toEqual([]);
		expect(rows).toHaveLength(4);
	});
});
