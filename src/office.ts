/*
 * A Word document, read for what it already says.
 *
 * This is the opposite of a PDF, and that is why it earns its own file. A page
 * holds pieces of text at coordinates and the cut has to work out where the
 * columns were; a `.docx` writes its rows and its cells down. So nothing here
 * votes, guesses a boundary or measures a gap: the grid is copied, and a cell
 * the document leaves empty stays empty in its own place.
 *
 * That is also why the ruler is `index`. There is no x to measure - the third
 * cell is the third column wherever Word would have drawn it - which is the
 * ruler a CSV is read with, for the same reason.
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

	spanCell(attributes: string): void {
		const cell = this.cell;
		const span = Number.parseInt(VALUE.exec(attributes)?.[1] ?? '1', 10);
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
	gridSpan: (body, tag) => body.spanCell(tag.attributes),
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
	const lines = linesOf(new TextDecoder().decode(body));

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
	return documentFrom([page], 'docx', name);
}
