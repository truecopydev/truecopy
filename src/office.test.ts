import { describe, expect, it } from 'vitest';
import { docxWithBody, docxWithText, odtWithBody, odtWithText } from './kit.js';
import { documentFromDocx, documentFromOdt, OPENDOCUMENT_BODY, WORD_BODY } from './office.js';

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

/*
 * OPENDOCUMENT, read onto the SAME grid as Word.
 *
 * The tests below deliberately mirror those above: two formats that disagree
 * about markup must not disagree about what a reader gets, and the only way to
 * hold that is to ask them the same questions.
 */
const readOdt = (bytes: Uint8Array, name = 'accord.odt') => documentFromOdt(bytes, name, 5_000_000);

const odtTextOf = async (blocks: (string | string[])[]): Promise<string[]> => {
	const document = await readOdt(await odtWithText(blocks));
	return document.pages[0].rows.map((row) => row.text);
};

describe('documentFromOdt', () => {
	it('reads the paragraphs of a real .odt, in order', async () => {
		const document = await readOdt(await odtWithText(['Article 1', 'Article 2']));
		expect(document.origin).toBe('odt');
		expect(document.name).toBe('accord.odt');
		expect(document.text).toBe('Article 1\nArticle 2');
	});

	it('reads a deflated part as well as a stored one', async () => {
		const document = await readOdt(await odtWithText(['Article 1'], { compress: true }));
		expect(document.text).toBe('Article 1');
	});

	it('reads a heading, which is a paragraph that carries a level', async () => {
		const document = await readOdt(
			await odtWithBody('<text:h text:outline-level="1">Titre I</text:h><text:p>Article 1</text:p>')
		);
		expect(document.text).toBe('Titre I\nArticle 1');
	});

	it('gives the same page as a .docx: one, on the index ruler', async () => {
		const document = await readOdt(await odtWithText([['A', 'B']]));
		expect(document.pages).toHaveLength(1);
		expect(document.pages[0].pageNumber).toBe(1);
		expect(document.pages[0].unit).toBe('index');
	});

	it('keeps a table row on its grid, one field per column', async () => {
		const document = await readOdt(await odtWithText([['Employes', '1 800 EUR', '23 400 EUR']]));
		expect(document.pages[0].rows[0].items.map((item) => [item.x, item.text])).toEqual([
			[0, 'Employes'],
			[1, '1 800 EUR'],
			[2, '23 400 EUR']
		]);
	});

	it('leaves an empty cell empty rather than closing the gap', async () => {
		const rows = await odtTextOf([
			['', 'Applique', 'Adapte'],
			['Autonomie', '30', '60']
		]);
		expect(rows).toEqual(['\tApplique\tAdapte', 'Autonomie\t30\t60']);
	});

	it('reads a span as the columns it covers, and skips the cells it covers', async () => {
		// `covered-table-cell` is how ODF writes the places a span already took. A
		// reader that opened a column for each of them would push every later
		// value one column right.
		const document = await readOdt(
			await odtWithBody(
				'<table:table><table:table-row>' +
					'<table:table-cell table:number-columns-spanned="2"><text:p>Total</text:p></table:table-cell>' +
					'<table:covered-table-cell/>' +
					'<table:table-cell><text:p>1 800</text:p></table:table-cell>' +
					'</table:table-row></table:table>'
			)
		);
		expect(document.pages[0].rows[0].items.map((item) => [item.x, item.text])).toEqual([
			[0, 'Total'],
			[2, '1 800']
		]);
	});

	it('writes a repeated empty cell once per column it stands for', async () => {
		// `number-columns-repeated` is not a span: it is the same cell written
		// once instead of three times. Reading it as a span would merge three
		// columns into one.
		const document = await readOdt(
			await odtWithBody(
				'<table:table><table:table-row>' +
					'<table:table-cell><text:p>A</text:p></table:table-cell>' +
					'<table:table-cell table:number-columns-repeated="3"/>' +
					'<table:table-cell><text:p>B</text:p></table:table-cell>' +
					'</table:table-row></table:table>'
			)
		);
		expect(document.pages[0].rows[0].items.map((item) => [item.x, item.text])).toEqual([
			[0, 'A'],
			[4, 'B']
		]);
	});

	it('does not quote what the document does not print: a tracked deletion', async () => {
		// ODF keeps deleted text in the file. Walking every character node would
		// put a sentence in a citation that nobody can find on the page, which is
		// the reading this library exists to refuse.
		const document = await readOdt(
			await odtWithBody(
				'<text:tracked-changes><text:changed-region><text:deletion><office:change-info/>' +
					'<text:p>Une phrase supprimee</text:p></text:deletion></text:changed-region></text:tracked-changes>' +
					'<text:p>Article 1</text:p>'
			)
		);
		expect(document.text).toBe('Article 1');
	});

	it('reads a tab and a line break for what they space', async () => {
		const document = await readOdt(
			await odtWithBody(
				'<text:p>Poste<text:tab/>Montant</text:p><text:p>A<text:line-break/>B</text:p>'
			)
		);
		expect(document.pages[0].rows.map((row) => row.text)).toEqual(['Poste\tMontant', 'A B']);
	});

	it('reads the spaces a paragraph declares by count', async () => {
		const document = await readOdt(await odtWithBody('<text:p>A<text:s text:c="3"/>B</text:p>'));
		expect(document.text).toBe('A   B');
	});

	it('reads text through an inline span, which carries style and not meaning', async () => {
		const document = await readOdt(
			await odtWithBody(
				'<text:p>Une <text:span text:style-name="T1">augmentation</text:span> de 2 %</text:p>'
			)
		);
		expect(document.text).toBe('Une augmentation de 2 %');
	});

	it('decodes the entities the format writes', async () => {
		const document = await readOdt(await odtWithText(['SAFRAN ELECTRICAL & POWER']));
		expect(document.text).toBe('SAFRAN ELECTRICAL & POWER');
	});
});

describe('documentFromOdt, on what real deposits carry', () => {
	it('does not print the markup of a drawing as a sentence', async () => {
		// MEASURED on the DILA deposits: before the lexer matched every tag, an
		// agreement came back opening on `<draw:custom-shape svg:x="0.47708in"
		// ...>`. OpenDocument prints the characters BETWEEN tags, so an element
		// the lexer does not know is copied out as though the page showed it.
		const document = await readOdt(
			await odtWithBody(
				'<draw:custom-shape svg:x="0.47708in" draw:z-index="0"><draw:text-box>' +
					'<text:p>ACCORD RELATIF A L EGALITE PROFESSIONNELLE</text:p>' +
					'</draw:text-box><svg:title/><svg:desc/></draw:custom-shape>' +
					'<text:p>Article 1</text:p>'
			)
		);
		expect(document.text).toBe('ACCORD RELATIF A L EGALITE PROFESSIONNELLE\nArticle 1');
	});

	it('says nothing a screen reader was meant to say about a drawing', async () => {
		const document = await readOdt(
			await odtWithBody(
				'<draw:frame><svg:title>Logo de la societe</svg:title>' +
					'<svg:desc>Un rond bleu</svg:desc></draw:frame><text:p>Article 1</text:p>'
			)
		);
		expect(document.text).toBe('Article 1');
	});

	it('names the part it went looking for', () => {
		expect(OPENDOCUMENT_BODY).toBe('content.xml');
	});

	it('steps over a comment without reading it as text', async () => {
		const document = await readOdt(
			await odtWithBody('<!-- relu par le service RH --><text:p>Article 1</text:p>')
		);
		expect(document.text).toBe('Article 1');
	});
});

describe('documentFromOdt, at the edges of the format', () => {
	it('reads a lone text:s as the single space it stands for', async () => {
		const document = await readOdt(await odtWithBody('<text:p>A<text:s/>B</text:p>'));
		expect(document.text).toBe('A B');
	});

	it('does not let a count in the thousands stand for a thousand spaces', async () => {
		// A count that large describes an editor, not a document, and a reader
		// measuring a gap would then be measuring this library.
		const wide = await readOdt(await odtWithBody('<text:p>A<text:s text:c="5000"/>B</text:p>'));
		expect(wide.text).toBe(`A${' '.repeat(64)}B`);
		// Zero is the only count to turn away: the pattern reads digits, so nothing
		// else can arrive, and `text:s` always stands for at least one space.
		const nonsense = await readOdt(await odtWithBody('<text:p>A<text:s text:c="0"/>B</text:p>'));
		expect(nonsense.text).toBe('A B');
	});

	it('stops at the end of a file cut short rather than reading its markup', async () => {
		// A converter that gave up mid-file leaves a subtree that never closes.
		// Reading on would print the rest of the document inside the skipped one.
		const document = await readOdt(
			await odtWithBody('<text:p>Article 1</text:p><text:tracked-changes><text:p>Supprime')
		);
		expect(document.text).toBe('Article 1');
	});

	it('reads an empty paragraph for the break it is, not for a column', async () => {
		const document = await readOdt(
			await odtWithBody('<text:p>Article 1</text:p><text:p/><text:p>Article 2</text:p>')
		);
		expect(document.text).toBe('Article 1\nArticle 2');
	});

	it('prints nothing of a tag it does not know, markup or text', async () => {
		// Every element of an OpenDocument body is prefixed, so a bare tag is not
		// one of this format's - and text only ever sits inside a paragraph, which
		// this one never opened.
		const document = await readOdt(await odtWithBody('<p>Ceci</p><text:p>Article 1</text:p>'));
		expect(document.text).toBe('Article 1');
	});
});

describe('documentFromOdt, a cell that stands for no column', () => {
	it('gives a repeat of zero its own single column', async () => {
		// `table:number-columns-repeated="0"` is a cell standing for no column at
		// all, which is not a thing a grid can hold: it stands for itself.
		const document = await readOdt(
			await odtWithBody(
				'<table:table><table:table-row>' +
					'<table:table-cell table:number-columns-repeated="0"><text:p>A</text:p></table:table-cell>' +
					'<table:table-cell><text:p>B</text:p></table:table-cell>' +
					'</table:table-row></table:table>'
			)
		);
		expect(document.pages[0].rows[0].items.map((item) => [item.x, item.text])).toEqual([
			[0, 'A'],
			[1, 'B']
		]);
	});
});

describe('documentFromOdt, when the body is not where it should be', () => {
	it('reads the whole part rather than nothing', async () => {
		// A converter that wrote no `office:body`. Reading from the top costs the
		// style declarations, which carry no text, and it is the only alternative
		// to returning an empty document for a file that plainly has one.
		const bytes = await odtWithText(['Article 1']);
		// Renamed in place, so every offset in the archive stays valid.
		const xml = new TextDecoder('latin1').decode(bytes).replace('<office:body>', '<office:x0dy>');
		const document = await readOdt(Uint8Array.from(xml, (character) => character.charCodeAt(0)));
		expect(document.text).toBe('Article 1');
	});
});

describe('documentFromOdt, on a content.xml somebody pretty-printed', () => {
	it('reads the paragraphs and not the indentation around them', async () => {
		// Editors write content.xml on one line; converters do not always. A reader
		// that took what lies between two structural tags would give every row the
		// indentation of its markup.
		const document = await readOdt(
			await odtWithBody('\n\t<text:p>Article 1</text:p>\n\t<text:p>Article 2</text:p>\n')
		);
		expect(document.text).toBe('Article 1\nArticle 2');
	});
});

describe('documentFromOdt, on a file that stops in the middle', () => {
	it('stops on a tag that never closes rather than reading it as text', async () => {
		// Cut mid-tag, with nothing after it at all - not even the closing of the
		// body. The builder always closes what it opened, so the tail is
		// overwritten in place, which keeps every offset in the archive valid.
		const bytes = await odtWithBody('<text:p>Article 1</text:p><text:p');
		const tail = '</office:text></office:body></office:document-content>';
		const xml = new TextDecoder('latin1').decode(bytes).replace(tail, ' '.repeat(tail.length));
		const document = await readOdt(Uint8Array.from(xml, (character) => character.charCodeAt(0)));
		expect(document.text).toBe('Article 1');
	});

	it('stops when nothing is left to open', async () => {
		// The file trails off after its last tag. A fixture cannot be built with
		// the builder - it always closes what it opened - so the closing tag is
		// overwritten in place, which keeps every offset in the archive valid.
		const bytes = await odtWithBody('<text:p>Article 1</text:p>');
		const closing = '</office:document-content>';
		const xml = new TextDecoder('latin1')
			.decode(bytes)
			.replace(closing, ' '.repeat(closing.length));
		const document = await readOdt(Uint8Array.from(xml, (character) => character.charCodeAt(0)));
		expect(document.text).toBe('Article 1');
	});
});

describe('documentFromOdt, when a skipped subtree sits mid-sentence', () => {
	it('keeps the end of a sentence that carries a footnote', async () => {
		// A footnote is anchored INLINE. Closing the paragraph at the anchor drops
		// the rest of the sentence, which the page really does print: the mirror
		// of quoting what it does not.
		const document = await readOdt(
			await odtWithBody(
				'<text:p>Les salaires augmentent de 2 %<text:note text:note-class="footnote">' +
					'<text:note-citation>1</text:note-citation>' +
					'<text:note-body><text:p>Hors primes.</text:p></text:note-body>' +
					'</text:note> au 1er janvier.</text:p>'
			)
		);
		expect(document.text).toBe('Les salaires augmentent de 2 %1 au 1er janvier.');
	});

	it('keeps the end of a sentence that carries a comment in the margin', async () => {
		const document = await readOdt(
			await odtWithBody(
				'<text:p>Article 1<office:annotation><text:p>a revoir</text:p></office:annotation>' +
					' et sa suite.</text:p>'
			)
		);
		expect(document.text).toBe('Article 1 et sa suite.');
	});
});
