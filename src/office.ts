/*
 * An office document, read for what it already says.
 *
 * This is the opposite of a PDF, and that is why it earns its own file. A page
 * holds pieces of text at coordinates and the cut has to work out where the
 * columns were; a `.docx` and a `.odt` write their rows and their cells down.
 * So nothing here votes, guesses a boundary or measures a gap: the grid is
 * copied, and a cell the document leaves empty stays empty in its own place.
 *
 * That is also why the ruler is `index`. There is no x to measure - the third
 * cell is the third column wherever the editor would have drawn it - which is
 * the ruler a CSV is read with, for the same reason.
 *
 * TWO FORMATS, ONE READING MODEL. Word and OpenDocument disagree about markup
 * and agree about what a document is: paragraphs, and rows of cells on a grid.
 * So there are two lexers here and one `Body`. Giving OpenDocument its own file
 * would have meant its own `Body` too, and two grids that drift apart is the
 * one thing a shared reading layer must not have.
 */

import type { Document, PositionedItem, Row, TextPage } from './document.js';
import { columnBoundaries, documentFrom, gapFor } from './layout.js';
import { fileFromArchive } from './zip.js';

/** Where the format puts the body of a Word document. Fixed by the standard, so
 *  there is nothing to search for and nothing to guess when it is absent. */
export const WORD_BODY = 'word/document.xml';

/** The five predefined XML entities, and nothing else: a `.docx` body declares
 *  no DTD, so no other named entity can appear in it. */
const ENTITIES: Record<string, string> = {
	amp: '&',
	lt: '<',
	gt: '>',
	quot: '"',
	apos: "'"
};

function decodeEntities(text: string): string {
	return text.replace(/&(#x?[0-9a-fA-F]+|[a-z]+);/g, (whole, body: string) => {
		// Lowercase `x` only: that is what XML defines, and the pattern above lets
		// nothing else through.
		if (body.startsWith('#x')) return String.fromCodePoint(Number.parseInt(body.slice(2), 16));
		if (body.startsWith('#')) return String.fromCodePoint(Number.parseInt(body.slice(1), 10));
		return ENTITIES[body] ?? whole;
	});
}

/**
 * One cell, and where it sits on its row's grid.
 *
 * `column` and `span` are kept rather than a plain list, because a cell that
 * spans three columns holds the place of three. Dropping that is how the third
 * value of a row ends up read under the second header.
 */
interface Cell {
	text: string;
	column: number;
	span: number;
}

/*
 * KNOWN, and left alone on purpose: `w:vMerge`, a cell merged DOWN a column,
 * reads as an empty cell on the rows that continue it. Word writes the value
 * once and marks the rest as continuations, so repeating it would put a value
 * on rows where the document prints none - and a reader counting filled cells
 * would then measure this library rather than the page. A caller that wants
 * the fill can carry it down itself, on rows it can see. Reconsider it with a
 * corpus, not with an opinion.
 */

interface Table {
	rows: Cell[][];
	current: Cell[] | null;
}

/** Any element of the Word namespace, opening, closing or empty. One shape for
 *  all of them: what an element MEANS is decided below, by name, which keeps
 *  this expression something a person can still read. The lookahead is what
 *  makes it linear - without it the name and the attributes can trade
 *  characters, and a long tag is walked over and over. */
const ELEMENT = /<(\/?)w:([a-zA-Z]+)(?=[\s/>])([^>]*)>/g;

const VALUE = /w:val="([^"]*)"/;

/** Tabs at the end of a row say nothing; a tab at the START says the row opens
 *  on an empty cell, which is a fact about the table. Written as a loop and not
 *  as `/\t+$/`, which backtracks quadratically on a row of nothing but tabs. */
function withoutTrailingTabs(text: string): string {
	let end = text.length;
	while (end > 0 && text[end - 1] === '\t') end--;
	return text.slice(0, end);
}

/**
 * The body of a Word document, becoming lines.
 *
 * A line is either a paragraph, which is one field, or a table row, which is one
 * field per column of the grid.
 *
 * Tables nest, so the tables in progress are a stack. A nested table is folded
 * into the cell that carries it rather than emitted on its own: emitting it
 * would break the outer row into pieces that no longer line up with its header,
 * which is the kind of plausible mess this library exists to refuse. The nested
 * grid is lost, the outer one stays true.
 */
class Body {
	readonly lines: string[][] = [];
	private readonly tables: Table[] = [];
	private paragraph = '';

	/** The cell being filled, when there is one. */
	private get cell(): Cell | null {
		const row = this.tables[this.tables.length - 1]?.current;
		return row === undefined || row === null ? null : (row[row.length - 1] ?? null);
	}

	write(text: string): void {
		const cell = this.cell;
		if (cell === null) this.paragraph += text;
		else cell.text += text;
	}

	/** A paragraph ends a line, unless it is inside a cell: there it is a break
	 *  within the cell, and the row is what ends the line. */
	endParagraph(): void {
		const cell = this.cell;
		if (cell !== null) {
			if (cell.text !== '' && !cell.text.endsWith(' ')) cell.text += ' ';
			return;
		}
		// A tab inside a paragraph is what somebody typed to line two things up, so
		// it opens a column here as it does in a paste. Two tabs in a row leave the
		// field between them empty rather than closing the gap: that field is a
		// column the writer left blank, and closing it slides the next value under
		// the wrong heading.
		if (this.paragraph.trim() !== '') this.lines.push(this.paragraph.split('\t'));
		this.paragraph = '';
	}

	openTable(): void {
		this.tables.push({ rows: [], current: null });
	}

	closeTable(): void {
		const table = this.tables.pop();
		if (table === undefined) return;
		const held = this.cell;
		for (const row of table.rows) {
			const fields = fieldsOf(row);
			if (!fields.some((field) => field !== '')) continue;
			if (held === null) this.lines.push(fields);
			else held.text += `${fields.filter((field) => field !== '').join(' ')} `;
		}
	}

	openRow(): void {
		const table = this.tables[this.tables.length - 1];
		if (table !== undefined) table.current = [];
	}

	closeRow(): void {
		const table = this.tables[this.tables.length - 1];
		if (table === undefined) return;
		if (table.current !== null) table.rows.push(table.current);
		table.current = null;
	}

	openCell(): void {
		const row = this.tables[this.tables.length - 1]?.current;
		if (row === undefined || row === null) return;
		const last = row[row.length - 1];
		row.push({ text: '', column: last === undefined ? 0 : last.column + last.span, span: 1 });
	}

	/** How many columns the cell being filled holds. A number and not the markup
	 *  it came from: the two formats spell the same fact differently, and a body
	 *  that read attributes would have to know both. */
	spanColumns(span: number): void {
		const cell = this.cell;
		if (cell !== null && Number.isFinite(span) && span > 0) cell.span = span;
	}
}

/** A row of cells laid back onto its grid: one field per column, and a column
 *  the document left empty stays an empty field rather than closing the gap. */
function fieldsOf(cells: Cell[]): string[] {
	const width = cells.reduce((total, cell) => Math.max(total, cell.column + cell.span), 0);
	const fields: string[] = Array.from({ length: width }, () => '');
	for (const cell of cells) fields[cell.column] = cell.text.replace(/\s+/g, ' ').trim();
	return fields;
}

/**
 * The text an element holds, when it is one that holds text. Read with
 * `indexOf` rather than a second pattern: a run of text ends at its own closing
 * tag, and that is a search, not a grammar.
 *
 * When the closing tag never comes - a file cut mid-download, a converter that
 * gave up - the run stops at the next `<` all the same. Reading to the end of
 * the file instead would copy `</w:body></w:document>` into the document's text
 * as though the document had printed it.
 */
function textOf(xml: string, from: number, name: string): { text: string; next: number } {
	const closing = `</w:${name}>`;
	const end = xml.indexOf(closing, from);
	if (end !== -1) return { text: xml.slice(from, end), next: end + closing.length };
	const markup = xml.indexOf('<', from);
	const stop = markup === -1 ? xml.length : markup;
	return { text: xml.slice(from, stop), next: stop };
}

/** What each element does to the body being read. A table and not a chain of
 *  conditions, because the list is what a reader of this file wants to see: the
 *  elements that carry meaning, and nothing about the hundred that do not. */
const STRUCTURE: Record<string, (body: Body, tag: Tag) => void> = {
	tab: (body) => body.write('\t'),
	br: (body) => body.write(' '),
	gridSpan: (body, tag) =>
		body.spanColumns(Number.parseInt(VALUE.exec(tag.attributes)?.[1] ?? '1', 10)),
	p: (body, tag) => {
		if (tag.closing || tag.empty) body.endParagraph();
	},
	tbl: (body, tag) => {
		if (tag.empty) return;
		if (tag.closing) body.closeTable();
		else body.openTable();
	},
	tr: (body, tag) => {
		if (tag.empty) return;
		if (tag.closing) body.closeRow();
		else body.openRow();
	},
	tc: (body, tag) => {
		if (!tag.closing && !tag.empty) body.openCell();
	}
};

interface Tag {
	closing: boolean;
	empty: boolean;
	attributes: string;
}

/** The elements that hold characters rather than structure. Both are read to
 *  their own closing tag, and only one of them keeps what it finds: a field
 *  instruction is code (`PAGE \* MERGEFORMAT`), not text, and copying it prints
 *  a word the document never showed. */
const CARRIES_TEXT: Record<string, boolean> = { t: true, instrText: false };

function linesOf(xml: string): string[][] {
	const body = new Body();
	ELEMENT.lastIndex = 0;
	for (let match = ELEMENT.exec(xml); match !== null; match = ELEMENT.exec(xml)) {
		const [whole, closing, name, attributes] = match;
		const tag: Tag = { closing: closing === '/', empty: attributes.endsWith('/'), attributes };
		const opens = !tag.closing && !tag.empty;

		if (name in CARRIES_TEXT && opens) {
			const run = textOf(xml, match.index + whole.length, name);
			if (CARRIES_TEXT[name]) body.write(decodeEntities(run.text));
			// Past the run, so nothing inside it is read as structure.
			ELEMENT.lastIndex = run.next;
		} else {
			STRUCTURE[name]?.(body, tag);
		}
	}
	body.endParagraph();
	return body.lines;
}

/**
 * A Word document as this library's rows.
 *
 * One page, because a `.docx` has none. Word paginates when it renders, on the
 * fonts and the paper of whoever opens it, and the breaks stored in the file are
 * where the last renderer happened to land. Numbering pages off those would put
 * a page in a citation that the next reader cannot find.
 */
export async function documentFromDocx(
	bytes: Uint8Array,
	name: string,
	maximumBytes: number
): Promise<Document> {
	const body = await fileFromArchive(bytes, WORD_BODY, maximumBytes);
	return documentFromLines(linesOf(new TextDecoder().decode(body)), 'docx', name);
}

/**
 * Lines onto the one page an office document has.
 *
 * Shared by both formats on purpose: the page a reader gets must not depend on
 * which editor wrote the file. Word and OpenDocument disagree about markup and
 * agree about the grid, so the grid is built once.
 */
function documentFromLines(lines: string[][], origin: 'docx' | 'odt', name: string): Document {
	const rows: Row[] = lines.map((fields, index) => {
		const items: PositionedItem[] = fields
			.map((field, column) => ({ text: field.trim(), x: column, y: -index, width: 1 }))
			.filter((item) => item.text !== '');
		return { y: -index, items, text: withoutTrailingTabs(fields.join('\t')) };
	});

	const items = rows.flatMap((row) => row.items);
	const page: TextPage = {
		pageNumber: 1,
		width: 0,
		height: 0,
		items,
		rows,
		columnBoundaries: columnBoundaries(items, gapFor('index')),
		unit: 'index'
	};
	return documentFrom([page], origin, name);
}

/** Where OpenDocument puts the body. Fixed by the standard, like Word's, so
 *  there is nothing to search for. */
export const OPENDOCUMENT_BODY = 'content.xml';

/**
 * The name inside a tag, once one has been found.
 *
 * A second small pattern rather than one big one: a single expression that also
 * carried comments and processing instructions was one nobody could read
 * against the standard.
 *
 * The prefix is REQUIRED. Every element of an OpenDocument body carries one, so
 * a tag without it is not an element of this format: it matches nothing here,
 * and matching nothing is what tells `<?xml ...?>` and `<!DOCTYPE ...>` apart
 * from an element too. The tag has still been consumed by then, so nothing of
 * it is printed as text either way.
 */
const ODF_NAME = /^<(\/?)([\w.-]+):([\w.-]+)/;

const REPEATED = /table:number-columns-repeated="(\d+)"/;
const SPANNED = /table:number-columns-spanned="(\d+)"/;
const SPACES = /text:c="(\d+)"/;

/**
 * The subtrees an OpenDocument body carries and does NOT print where they sit.
 *
 * Tracked changes is the one that matters: ODF keeps deleted text in the file,
 * inside `text:tracked-changes`, so a reader walking every character node
 * quotes sentences the document does not show - and a citation the reader
 * cannot find on the page is exactly what this library refuses. An annotation
 * is a comment in the margin. `svg:title` and `svg:desc` are what a screen
 * reader says about a drawing, not what the drawing prints.
 *
 * KNOWN, and left alone like `w:vMerge` above: `text:note-body` is a footnote,
 * and a footnote IS printed - at the bottom of the page. It sits inline in the
 * markup, so reading it would drop the note into the middle of the sentence
 * that calls it, and a reader would find a citation the page never runs
 * together. Losing it loses text; keeping it in place would invent a sentence.
 * Reconsider it with a corpus, not with an opinion.
 *
 * Qualified names, not local ones: `svg:title` is a caption and `text:title` is
 * a field that prints the document's own title.
 */
const SKIPPED = new Set([
	'text:tracked-changes',
	'office:annotation',
	'text:note-body',
	'svg:title',
	'svg:desc'
]);

/**
 * How many columns a cell holds, and how many times it repeats.
 *
 * They are two different attributes and both are ordinary in a spreadsheet-like
 * table: `spanned` is one cell covering three columns, `repeated` is the same
 * empty cell written once instead of forty times. Reading `repeated` as a span
 * would merge forty columns into one; ignoring it would lose thirty-nine.
 */
function cellShape(attributes: string): { span: number; repeat: number } {
	// The patterns capture digits and nothing else, so what comes back is always
	// a finite number: only zero has to be turned away, and a cell standing for
	// no column at all is a cell that stands for itself.
	const read = (pattern: RegExp): number =>
		Number.parseInt(pattern.exec(attributes)?.[1] ?? '1', 10) || 1;
	// A row padded out to a thousand empty columns is a spreadsheet habit, not a
	// document: past this, the repeat says more about the editor than the table.
	return { span: read(SPANNED), repeat: Math.min(read(REPEATED), 64) };
}

/**
 * The body of an OpenDocument file, becoming lines.
 *
 * The one structural difference with Word: text is the character data of a
 * paragraph, not the content of a run element. So this lexer reads what lies
 * BETWEEN two tags, which is why the skipped subtrees above have to be jumped
 * over rather than merely ignored - ignoring the tag would still copy the text
 * inside it.
 */
function odfLinesOf(xml: string): string[][] {
	// From the body only. What precedes it declares fonts and styles, and a
	// style name is not something the document printed.
	const opens = xml.indexOf('<office:body');
	const source = opens === -1 ? xml : xml.slice(opens);

	const body = new Body();
	let at = 0;
	/*
	 * WHETHER A PARAGRAPH IS OPEN, and it is the whole reason this lexer can be
	 * trusted with character data.
	 *
	 * In OpenDocument text only ever sits inside a `text:p` or a `text:h`. What
	 * lies between two structural tags is the file's own indentation, and a
	 * reader that took it would hand back a first row opening on a newline - and
	 * on a content.xml some converter pretty-printed, EVERY row would carry the
	 * indentation of its markup.
	 */
	let inParagraph = false;

	/*
	 * WALKED WITH `indexOf`, NOT SCANNED WITH A PATTERN, and that is a fix rather
	 * than a taste. A comment is the one thing in XML that may hold a `<`, so it
	 * cannot be recognised by a pattern that also has to stop at one - and every
	 * pattern that did not stop at one walked the file again from each `<` it
	 * met. Both shapes were flagged, one as quadratic on a run of `<!--` and one
	 * as a sanitiser that leaves what it removes. Here every character is looked
	 * at once, because `at` only ever moves forward.
	 */
	while (at < source.length) {
		const open = source.indexOf('<', at);
		if (open === -1) break;
		// Whatever lay between the previous tag and this one is what the paragraph
		// prints, when there is a paragraph to print it.
		if (inParagraph && open > at) body.write(decodeEntities(source.slice(at, open)));

		const found = tagAt(source, open);
		// A tag that never closes: the file stops here, and so does the reading.
		if (found === null) break;
		at = found.next;
		if (found.whole === '') continue;
		({ at, inParagraph } = applyTag(body, source, found.whole, at, inParagraph));
	}
	body.endParagraph();
	return body.lines;
}

/** The tag that starts at `open`, and where the text starts again after it. A
 *  comment has no name and nothing to apply, so it comes back empty; a tag that
 *  never closes comes back as nothing at all. */
function tagAt(source: string, open: number): { whole: string; next: number } | null {
	if (source.startsWith('<!--', open)) return { whole: '', next: jumpPast(source, '-->', open) };
	const shut = source.indexOf('>', open);
	return shut === -1 ? null : { whole: source.slice(open, shut + 1), next: shut + 1 };
}

/** One tag, applied. It gives back the only two things the walk carries: where
 *  the text starts again, and whether a paragraph is open. */
function applyTag(
	body: Body,
	source: string,
	whole: string,
	at: number,
	inParagraph: boolean
): { at: number; inParagraph: boolean } {
	const named = ODF_NAME.exec(whole);
	// A processing instruction or a doctype: it took its place in the text and
	// says nothing about the structure.
	if (named === null) return { at, inParagraph };

	const [, closing, namespace, name] = named;
	const qualified = `${namespace}:${name}`;
	const tag: Tag = { closing: closing === '/', empty: whole.endsWith('/>'), attributes: whole };
	/*
	 * A SKIPPED SUBTREE IS STEPPED OVER, AND NOTHING ELSE CHANGES.
	 *
	 * `inParagraph` is carried across untouched, and the first version of this
	 * forced it to false - which read as harmless and was not. An annotation and
	 * a footnote are anchored INLINE, mid-sentence: `<text:p>a sentence<text:note>
	 * ...</text:note> and its end.</text:p>`. Closing the paragraph at the anchor
	 * dropped ` and its end.`, text the page really does print. The mirror of the
	 * failure this reader exists to prevent, and just as bad.
	 */
	if (!tag.closing && !tag.empty && SKIPPED.has(qualified)) {
		return { at: jumpPast(source, `</${qualified}>`, at), inParagraph };
	}
	odfElement(body, name, tag);
	const opensParagraph = name === 'p' || name === 'h';
	return { at, inParagraph: opensParagraph ? !tag.closing && !tag.empty : inParagraph };
}

/**
 * What each element does to the body being read.
 *
 * One function for all three shapes of a tag, and not an opening table beside a
 * closing one: in ODF a cell arrives BOTH ways. `<table:table-cell/>` written
 * empty is an empty cell that still holds its column, and routing it to a
 * closing handler is how a row loses three columns and slides its last value
 * left. Measured on the fixture the day this was written.
 */
function odfElement(body: Body, name: string, tag: Tag): void {
	if (tag.closing) {
		if (name === 'p' || name === 'h') body.endParagraph();
		else if (name === 'table') body.closeTable();
		else if (name === 'table-row') body.closeRow();
		return;
	}
	if (name === 'tab') body.write('\t');
	else if (name === 'line-break') body.write(' ');
	else if (name === 's') body.write(' '.repeat(spaceCount(tag.attributes)));
	else if (name === 'table-cell') openCells(body, tag.attributes);
	else if (tag.empty) {
		// An empty `p` is a blank line, and `covered-table-cell` is a place a span
		// already took: it holds no text and must NOT open a column, or every
		// later value moves one column right.
		if (name === 'p' || name === 'h') body.endParagraph();
	} else if (name === 'table') body.openTable();
	else if (name === 'table-row') body.openRow();
}

/** How many spaces `text:s` stands for. Bounded, like the repeat below: a count
 *  in the thousands describes an editor, not a document. */
function spaceCount(attributes: string): number {
	// Same as the cell shape above: the pattern captures digits, so zero is the
	// only value to turn away, and `text:s` always stands for at least one space.
	return Math.min(Number.parseInt(SPACES.exec(attributes)?.[1] ?? '1', 10) || 1, 64);
}

/** Past the end of something that has to be stepped over. A file cut short
 *  never comes back, so a missing end means the rest of it is not text. */
function jumpPast(source: string, closing: string, from: number): number {
	const end = source.indexOf(closing, from);
	return end === -1 ? source.length : end + closing.length;
}

/** A cell, and the columns it stands for. */
function openCells(body: Body, attributes: string): void {
	const { span, repeat } = cellShape(attributes);
	for (let copy = 0; copy < repeat; copy++) {
		body.openCell();
		body.spanColumns(span);
	}
}

/**
 * An OpenDocument text file as this library's rows.
 *
 * One page, for the same reason a `.docx` has one: OpenDocument paginates at
 * render time, on the fonts and the paper of whoever opens it.
 */
export async function documentFromOdt(
	bytes: Uint8Array,
	name: string,
	maximumBytes: number
): Promise<Document> {
	const body = await fileFromArchive(bytes, OPENDOCUMENT_BODY, maximumBytes);
	return documentFromLines(odfLinesOf(new TextDecoder().decode(body)), 'odt', name);
}
