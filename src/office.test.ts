import { describe, expect, it } from 'vitest';
import { docxWithBody, docxWithText } from './kit.js';
import { documentFromDocx, WORD_BODY } from './office.js';

const read = (bytes: Uint8Array, name = 'accord.docx') => documentFromDocx(bytes, name, 5_000_000);

const textOf = async (blocks: (string | string[])[]): Promise<string[]> => {
	const document = await read(await docxWithText(blocks));
	return document.pages[0].rows.map((row) => row.text);
};

describe('documentFromDocx', () => {
	it('reads the paragraphs of a real .docx, in order', async () => {
		const document = await read(await docxWithText(['Article 1', 'Article 2']));
		expect(document.origin).toBe('docx');
		expect(document.name).toBe('accord.docx');
		expect(document.text).toBe('Article 1\nArticle 2');
	});

	it('reads a deflated part as well as a stored one', async () => {
		// Word deflates; the fixture builder stores. Two paths, both shipped.
		const document = await read(await docxWithText(['Article 1'], { compress: true }));
		expect(document.text).toBe('Article 1');
	});

	it('says the ruler it measured with, and it is the one a CSV uses', async () => {
		// There is no x in a .docx: the third cell is the third column, wherever
		// Word would have drawn it.
		const document = await read(await docxWithText([['A', 'B']]));
		expect(document.pages[0].unit).toBe('index');
		expect(document.pages).toHaveLength(1);
	});

	it('numbers one page, because a .docx has none', async () => {
		const document = await read(await docxWithText(['Article 1']));
		expect(document.pages[0].pageNumber).toBe(1);
	});

	it('keeps a table row on its grid, one field per column', async () => {
		const document = await read(await docxWithText([['Employes', '1 800 EUR', '23 400 EUR']]));
		expect(document.pages[0].rows[0].items.map((item) => [item.x, item.text])).toEqual([
			[0, 'Employes'],
			[1, '1 800 EUR'],
			[2, '23 400 EUR']
		]);
	});

	it('leaves an empty cell empty rather than closing the gap', async () => {
		// The trap this exists for: dropping the blank corner cell of a header
		// row slides every value one column left, under the wrong heading.
		const rows = await textOf([
			['', 'Applique', 'Adapte'],
			['Autonomie', '30', '60']
		]);
		expect(rows).toEqual(['\tApplique\tAdapte', 'Autonomie\t30\t60']);
	});

	// A cell that spans columns holds the place of all of them, so what follows
	// it lands where the document put it. A span that says nothing usable is one
	// column, never a guess.
	it.each([
		{ span: ' w:val="2"', kept: 'is held', columns: [0, 2] },
		{ span: ' w:val="x"', kept: 'is not a number', columns: [0, 1] },
		{ span: ' w:val="0"', kept: 'is zero', columns: [0, 1] },
		{ span: '', kept: 'says nothing at all', columns: [0, 1] }
	])('lays the next cell down when a span $kept', async ({ span, columns }) => {
		const body = `<w:tbl><w:tr>
			<w:tc><w:tcPr><w:gridSpan${span}/></w:tcPr><w:p><w:r><w:t>2026</w:t></w:r></w:p></w:tc>
			<w:tc><w:p><w:r><w:t>Total</w:t></w:r></w:p></w:tc>
		</w:tr></w:tbl>`;
		const document = await read(await docxWithBody(body));
		expect(document.pages[0].rows[0].items.map((item) => item.x)).toEqual(columns);
	});

	it('folds a nested table into the cell that carries it', async () => {
		// Emitting its rows on their own would break the outer row into pieces
		// that no longer line up with its header.
		const body = `<w:tbl><w:tr>
			<w:tc><w:p><w:r><w:t>Cadres</w:t></w:r></w:p></w:tc>
			<w:tc><w:tbl><w:tr><w:tc><w:p><w:r><w:t>2 100</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>2 300</w:t></w:r></w:p></w:tc></w:tr></w:tbl></w:tc>
		</w:tr></w:tbl>`;
		const document = await read(await docxWithBody(body));
		expect(document.pages[0].rows.map((row) => row.text)).toEqual(['Cadres\t2 100 2 300']);
	});

	// One shape, several rules: a body of markup goes in, and what the document
	// SAYS comes out. Each case names the rule it stands for.
	it.each([
		{
			rule: 'the paragraphs of one cell stay in that cell',
			body: '<w:tbl><w:tr><w:tc><w:p><w:r><w:t>Prime</w:t></w:r></w:p><w:p><w:r><w:t>annuelle</w:t></w:r></w:p></w:tc></w:tr></w:tbl>',
			text: 'Prime annuelle'
		},
		{
			rule: 'a tab opens a column and a line break is a space',
			body: '<w:p><w:r><w:t>Cadres</w:t><w:tab/><w:t>2 100</w:t><w:br/><w:t>euros</w:t></w:r></w:p>',
			text: 'Cadres	2 100 euros'
		},
		{
			rule: 'a field instruction is code, and is dropped',
			body: '<w:p><w:r><w:instrText>PAGE MERGEFORMAT</w:instrText><w:t>Page 3</w:t></w:r></w:p>',
			text: 'Page 3'
		},
		{
			rule: 'the five predefined entities are decoded, and nothing else is',
			body: '<w:p><w:r><w:t>Fran&#231;ois &#xE9;t&#xE9; &amp; C&#xIE;&lt;&gt;&quot;&apos;&unknown;</w:t></w:r></w:p>',
			text: 'François été & C&#xIE;<>"\'&unknown;'
		},
		{
			rule: 'a blank paragraph is not a row',
			body: '<w:p/><w:p><w:r><w:t>A</w:t></w:r></w:p>',
			text: 'A'
		},
		{
			rule: 'a table row with nothing in it is not a row',
			body: '<w:tbl><w:tr><w:tc><w:p/></w:tc></w:tr></w:tbl><w:p><w:r><w:t>A</w:t></w:r></w:p>',
			text: 'A'
		},
		{
			rule: 'a self-closed table or row holds nothing',
			body: '<w:tbl/><w:tbl><w:tr/></w:tbl><w:p><w:r><w:t>A</w:t></w:r></w:p>',
			text: 'A'
		},
		{
			// What a broken converter emits. The text is still what the document
			// says, so it is kept - as one field, because there is no grid for it.
			rule: 'a row outside any table keeps its text and invents no column',
			body: '<w:tr><w:tc><w:p><w:r><w:t>lost</w:t></w:r></w:p></w:tc></w:tr></w:tbl>',
			text: 'lost'
		},
		{
			// The mirror of the leading one, and the opposite answer: a column
			// nobody filled at the END of a row bounds nothing and says nothing.
			rule: 'an empty cell at the end of a row is dropped',
			body: '<w:tbl><w:tr><w:tc><w:p><w:r><w:t>A</w:t></w:r></w:p></w:tc><w:tc><w:p/></w:tc></w:tr></w:tbl>',
			text: 'A'
		},
		{
			rule: 'a row that opens no cell still gives up its text',
			body: '<w:tbl><w:tr><w:p><w:r><w:t>A</w:t></w:r></w:p></w:tr></w:tbl>',
			text: 'A'
		},
		{
			rule: 'a row that closes without opening closes nothing',
			body: '<w:tbl></w:tr></w:tbl><w:p><w:r><w:t>A</w:t></w:r></w:p>',
			text: 'A'
		},
		{
			rule: 'a span outside any cell spans nothing',
			body: '<w:p><w:gridSpan w:val="2"/><w:r><w:t>A</w:t></w:r></w:p>',
			text: 'A'
		},
		{
			// Truncated mid-run, which is what half a download looks like. What was
			// written before the cut is what the document says.
			rule: 'a run of text that never closes is read to the end',
			body: '<w:p><w:r><w:t>A',
			text: 'A'
		}
	])('$rule', async ({ body, text }) => {
		expect((await read(await docxWithBody(body))).text).toBe(text);
	});

	it('stops a run of text at the end of a file that stops mid-run', async () => {
		// The file is cut with nothing after the run at all, not even the closing
		// of the body. A fixture cannot be built with the builder - it always
		// closes what it opened - so the stored part is overwritten in place, which
		// keeps every offset in the archive valid.
		const bytes = await docxWithBody(`<w:p><w:r><w:t>${'A'.repeat(23)}`);
		const xml = new TextDecoder('latin1').decode(bytes);
		const cut = xml.replace('</w:body></w:document>', ' '.repeat(22));
		const document = await read(Uint8Array.from(cut, (character) => character.charCodeAt(0)));
		expect(document.text.trim()).toBe('A'.repeat(23));
	});

	it('names the part it went looking for', async () => {
		expect(WORD_BODY).toBe('word/document.xml');
	});
});
