/*
 * What a document is, once it is open.
 *
 * Every reader downstream works on this and nothing else, so the parsing can be
 * exercised without a PDF engine, without a browser, and without the file the
 * person actually dropped.
 */

/**
 * What measured the x on a page. One engine reads a PDF, a pasted table and a
 * delimited file; what changes between them is only the ruler.
 *
 *   - `points` - a PDF's own unit, origin bottom-left.
 *   - `characters` - the character a field starts at, for a table that lines
 *     its columns up with spaces.
 *   - `index` - the field's position in the line, for a file written with a
 *     delimiter. A CSV lines nothing up, so the third field is the third column
 *     wherever it happens to begin.
 */
export type CoordinateUnit = 'points' | 'characters' | 'index';

/** A fragment of text with its place on the page. A PDF holds no lines and no
 *  table: it holds pieces of text at coordinates, and that is all. */
export interface PositionedItem {
	text: string;
	/**
	 * Left edge, in the page's `CoordinateUnit`.
	 *
	 * The cut never needed points. It votes on which x come back row after row,
	 * and that question is the same whichever ruler measured them - which is why
	 * one engine reads a page, a paste and a CSV.
	 */
	x: number;
	/** Baseline, in the same unit (higher is further up the page). */
	y: number;
	width: number;
	/**
	 * Glyph height, in the same unit. Absent when the source reports none.
	 *
	 * It exists to tell a SUPERSCRIPT from a line of its own: a raised ordinal
	 * or a footnote marker sits a few units above its line and is set smaller,
	 * and height is the only thing that separates the two. A paste, a CSV and a
	 * .docx carry no glyph box, so the field is left off and nothing reads it.
	 */
	height?: number;
}

/**
 * Where on the page a reading came from.
 *
 * A value that cannot be pointed at cannot be checked: a person handed a list of
 * figures has to find each one in the document again, and a person handed a
 * place jumps to it. That difference is what makes a correction screen usable or
 * abandoned.
 *
 * No height, because none is known. A text item carries none here, and inventing
 * one - a guess at the line spacing - would put a rectangle on the page that the
 * document never had. The caller draws the band it wants; it knows its own
 * renderer better than this library does.
 */
export interface Place {
	/** 1-based, as the document numbers its own pages. */
	page: number;
	/** Left edge of the leftmost item, in the page's `CoordinateUnit`. */
	x: number;
	/** The baseline shared by the items. */
	y: number;
	/** To the right edge of the rightmost item. */
	width: number;
}

/** Items that share a horizontal band, left to right. */
export interface Row {
	y: number;
	items: PositionedItem[];
	/** The items joined, one tab between columns. */
	text: string;
}

export interface TextPage {
	pageNumber: number;
	width: number;
	height: number;
	/**
	 * The raw items, always exposed.
	 *
	 * A reader may want a cut of its own - off the x of the header labels rather
	 * than off the spread of every item, re-anchored page by page. The boundaries
	 * below are a convenience, never the only view.
	 */
	items: PositionedItem[];
	rows: Row[];
	/** Column boundaries read off the spread of x over the whole page. */
	columnBoundaries: number[];
	/**
	 * The ruler this page's coordinates were measured with. Left out on a page
	 * that came from a PDF, which is `points`.
	 *
	 * Everything that reads an x needs it: eighteen apart means "a column apart"
	 * in points and "nine columns apart" in characters, so a reading that names a
	 * cut without naming the unit leaves whoever reads it to guess.
	 */
	unit?: CoordinateUnit;
	/** The engine's own line segmentation, when it has one (OCR). A tilted photo
	 *  shifts word baselines across the page, so re-clustering by y splits real
	 *  lines that the engine had right. */
	lines?: string[];
}

/**
 * What a document was read from.
 *
 * A list and not a union written by hand, because it is declared twice: here,
 * and in the output schema the MCP server advertises. Written twice it drifts,
 * and a client that validates against the advertised schema then rejects a
 * perfectly good reading - which is exactly what happened the day `docx` was
 * added.
 */
export const ORIGINS = ['pdf', 'text', 'image', 'docx', 'odt'] as const;

export type Origin = (typeof ORIGINS)[number];

export interface Document {
	pages: TextPage[];
	/** Every row of every page, joined. The reader that works on text alone - a
	 *  paste grammar, a line reader - needs nothing more than this. */
	text: string;
	origin: Origin;
	name: string;
}
