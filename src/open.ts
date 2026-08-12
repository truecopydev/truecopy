/*
 * The door: the only way from bytes to rows.
 *
 * What lives here forces, and it forces for a reason no interface can match -
 * there is no other route. A size cap, a page cap, a deadline, the engine
 * released, the engine loaded on demand, and the legacy build so that the whole
 * chain can be exercised outside a browser.
 *
 * No byte leaves the process.
 */

import type { Document, PositionedItem, TextPage } from './document.js';
import { documentFrom, documentFromText, pageFrom } from './layout.js';

/**
 * Why a document could not be opened. Named, never only worded: this library
 * says which rule broke and the application writes the sentence in its own
 * voice. A message alone would force an application speaking anything but
 * English to keep a copy of this whole file.
 */
export type Unreadable =
	| 'empty'
	| 'too-big'
	/** A PDF carrying no text at all: a scan, a photo. */
	| 'no-text'
	/** The deadline ran out. */
	| 'too-slow'
	/**
	 * There is no PDF engine to read with: `pdfjs-dist` is not installed and
	 * none was passed in `options.pdfjs`.
	 *
	 * Named apart from `not-opened` because the two send whoever reads them in
	 * opposite directions. Under one message the answer is "install the
	 * engine"; under the other it is "find the password of a file that has
	 * none". A caller told the wrong one looks for a lock that does not exist,
	 * and an agent told the wrong one writes that the document is protected.
	 */
	| 'no-engine'
	/** The engine would not open it: password-protected, damaged. */
	| 'not-opened';

/** A document this reader will not open. The `reason` is for the code, the
 *  message for whoever has no application to write the sentence for them. */
export class UnreadableDocument extends Error {
	readonly reason: Unreadable;

	/*
	 * `reason` and not `cause`: Error already has a `cause`, and it means the
	 * error underneath this one. Two meanings on one name is how a catch block
	 * ends up reading the wrong thing.
	 */
	constructor(reason: Unreadable, message: string, options?: ErrorOptions) {
		super(message, options);
		this.reason = reason;
	}
}

export interface Limits {
	/** Past this it is not the document expected: refuse rather than freeze the tab. */
	maximumBytes: number;
	maximumPages: number;
	/**
	 * A read that never returns leaves the screen on "reading the file..." for
	 * ever, with no button, no message and no way out - the one state from which
	 * a person cannot even fall back on typing it in.
	 */
	deadlineMilliseconds: number;
}

export const DEFAULT_LIMITS: Limits = {
	maximumBytes: 20 * 1024 * 1024,
	maximumPages: 40,
	deadlineMilliseconds: 30_000
};

export interface OpenOptions extends Partial<Limits> {
	/**
	 * Where the pdf.js worker lives, when the caller wants one.
	 *
	 * The caller supplies it and this library never resolves it, because every
	 * bundler spells that resolution differently - Vite wants an import with a
	 * `?url` suffix, webpack wants `new URL(..., import.meta.url)`, a plain page
	 * wants a path it can serve. Picking one here would lock every caller into
	 * that bundler for the sake of one line.
	 *
	 * Left out, pdf.js runs inline on the calling thread: slower on a long
	 * document, correct everywhere, and the only thing that works in Node - which
	 * is what makes the whole chain testable outside a browser.
	 */
	workerSrc?: string;
	/**
	 * The pdf.js module to read with. Left out, the legacy build is imported on
	 * demand.
	 *
	 * It is an option because the two builds answer to two different masters. The
	 * legacy one runs in Node, so the chain from real bytes to a parsed row can be
	 * tested; the modern one is smaller - measured at over a hundred kilobytes
	 * brotli in one bundle - which decides it for a reader under a byte budget.
	 * Neither choice is right for both, so neither is made here.
	 */
	pdfjs?: PdfEngine;
	/**
	 * Which pages to open at all. Left out, every page up to `maximumPages`.
	 *
	 * `maximumPages` cuts at the END and only there, which is the wrong end of a
	 * long document: an annual report prints its portfolio from page 313 to page
	 * 1427, and reading the first 40 pages of it reads a cover, a letter and an
	 * auditor's opinion. Opening the engine on a page is what a reading costs -
	 * measured at 99 % of it on a 381-page report - so a page nobody wants is
	 * better not opened than opened and dropped.
	 *
	 * The pages that are kept keep the number the document gives them: a finding
	 * about page 313 says 313, whether or not page 312 was opened. `maximumPages`
	 * then counts the pages OPENED, so it still bounds the work.
	 */
	keepPage?: (pageNumber: number) => boolean;
	/**
	 * Where pdf.js finds its standard font pack, and its character maps.
	 *
	 * The interface could not carry these, so no reader could pass them, which is
	 * a gap worth closing on its own. What it is NOT is a repair for garbled
	 * text, and that deserves saying because the warning invites the mistake.
	 *
	 * MEASURED, on 125 real annual reports: pdf.js prints `Ensure that the
	 * standardFontDataUrl API parameter is provided` on every one of them, three
	 * come back with genuinely broken text (`difOciqe e defa..abqe` where the page
	 * prints a French sentence), and passing the pack changes **not one character
	 * of any of them**. The corruption is a subsetted font whose `ToUnicode` map
	 * is absent or wrong: the glyphs are embedded, their mapping to characters is
	 * not, and a pack of STANDARD fonts has nothing to say about a custom one.
	 *
	 * So this silences a warning and serves a document that really does use an
	 * unmapped standard font. It does not rescue a document like those three, and
	 * nothing here can: that text is lost at the source.
	 *
	 * The URL is the caller's to resolve, for the same reason as `workerSrc`: the
	 * pack ships inside `pdfjs-dist` and every bundler spells the path
	 * differently. Nothing here guesses one.
	 *
	 *     // Node
	 *     const url = new URL('./node_modules/pdfjs-dist/standard_fonts/', import.meta.url).href;
	 *     await openDocument(file, { pdfjs, standardFontDataUrl: url });
	 */
	standardFontDataUrl?: string;
	/** Where pdf.js finds its character maps, for a document written in a CJK
	 *  encoding. Same reasoning as `standardFontDataUrl`, and `cMapPacked` is
	 *  true for the maps `pdfjs-dist` ships. */
	cMapUrl?: string;
	cMapPacked?: boolean;
}

/**
 * What this library needs of a PDF engine, and nothing more.
 *
 * Structural on purpose: both pdf.js builds satisfy it without knowing this
 * type exists, and so would another engine. Naming the module would have made
 * a hard dependency out of an optional one.
 */
export interface PdfEngine {
	/**
	 * `data` is what this library needs. The two font parameters are optional
	 * here and passed through untouched: pdf.js reads them, nothing in this file
	 * does, and an engine that ignores them still satisfies this type.
	 */
	getDocument(source: {
		data: Uint8Array;
		standardFontDataUrl?: string;
		cMapUrl?: string;
		cMapPacked?: boolean;
	}): {
		promise: Promise<PdfFile>;
		destroy(): Promise<void>;
	};
	GlobalWorkerOptions: { workerSrc: string };
}

interface PdfFile {
	numPages: number;
	getPage(pageNumber: number): Promise<PdfPage>;
}

interface PdfPage {
	getViewport(parameters: { scale: number }): { width: number; height: number };
	getTextContent(): Promise<{ items: unknown[] }>;
	cleanup(): void;
}

/**
 * Bound a promise in time. The timer is always cleared, even when the read wins
 * the race: a forgotten timer keeps the process awake and fails tests long
 * after they passed.
 */
export async function withDeadline<T>(
	work: Promise<T>,
	milliseconds = DEFAULT_LIMITS.deadlineMilliseconds
): Promise<T> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	const tooLong = new Promise<never>((_, reject) => {
		timer = setTimeout(
			() => reject(new UnreadableDocument('too-slow', 'This document does not finish opening.')),
			milliseconds
		);
	});
	try {
		return await Promise.race([work, tooLong]);
	} finally {
		clearTimeout(timer);
	}
}

/**
 * A pdf.js text content into positioned items. Pure, and exported on purpose:
 * it is the one step between the engine and this library's own data, so a test
 * driving a real engine over real bytes calls it to prove the chain joins up.
 *
 * Items with no text are dropped here rather than downstream. An empty fragment
 * has an x, and an x it has no business voting with: it would open a column of
 * nothing.
 */
export function positionedItems(items: unknown[]): PositionedItem[] {
	const placed: PositionedItem[] = [];
	for (const raw of items) {
		if (typeof raw !== 'object' || raw === null || !('str' in raw)) continue;
		const item = raw as { str: string; transform: number[]; width?: number };
		if (item.str.trim() === '') continue;
		// transform = [a, b, c, d, e, f]; e is x, f is the baseline.
		placed.push({
			text: item.str,
			x: item.transform[4],
			y: item.transform[5],
			width: item.width ?? 0
		});
	}
	return placed;
}

/** Open a dropped file. The only path. */
export async function openDocument(file: File, options: OpenOptions = {}): Promise<Document> {
	const limits = { ...DEFAULT_LIMITS, ...options };
	if (file.size === 0) throw new UnreadableDocument('empty', 'This file is empty.');
	if (file.size > limits.maximumBytes) {
		const megabytes = Math.round(limits.maximumBytes / 1048576);
		throw new UnreadableDocument('too-big', `This file is over ${megabytes} MB.`);
	}

	const looksLikePdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
	if (!looksLikePdf) return documentFromText(await file.text(), file.name);

	try {
		const document = await withDeadline(
			pagesFromPdf(await file.arrayBuffer(), file.name, limits, options),
			limits.deadlineMilliseconds
		);
		if (document.text.trim() === '') {
			throw new UnreadableDocument(
				'no-text',
				'This PDF carries no text: it is most likely a scan or a photo.'
			);
		}
		return document;
	} catch (error) {
		// Refusals already named (blank page, deadline) pass through as they are;
		// everything else is the engine saying no, for a reason it does not share.
		if (error instanceof UnreadableDocument) throw error;
		throw new UnreadableDocument(
			'not-opened',
			'I could not open this PDF. If it is password-protected, save an unprotected copy.'
		);
	}
}

/**
 * The engine this library falls back on, or a refusal that names the reason.
 *
 * `pdfjs-dist` is a peer, not a dependency: a caller reading pastes and CSV
 * should not download a PDF engine, and a caller under a byte budget wants to
 * choose its build. The cost of that choice is this failure mode, and it has
 * to be told apart from a file that will not open - otherwise the message
 * sends people looking for a password on a document that has none.
 */
async function loadDefaultEngine(): Promise<PdfEngine> {
	try {
		return (await import('pdfjs-dist/legacy/build/pdf.mjs')) as PdfEngine;
	} catch (error) {
		/*
		 * Outside coverage, and it is the one honest way: this branch runs only
		 * when `pdfjs-dist` is absent, and it is present here - the suite reads
		 * real PDFs with it. Uninstalling it for the length of one test would
		 * take down every other PDF test in the file. The refusal it throws is
		 * covered instead by a test that builds it directly.
		 */
		/* v8 ignore next 5 */
		throw new UnreadableDocument(
			'no-engine',
			'No PDF engine: install pdfjs-dist, or pass one as the `pdfjs` option.',
			{ cause: error }
		);
	}
}

async function pagesFromPdf(
	data: ArrayBuffer,
	name: string,
	limits: Limits,
	options: OpenOptions
): Promise<Document> {
	/*
	 * The legacy build by default, and it is a deliberate choice: the modern one
	 * refuses to run outside a browser, which would make this function untestable.
	 * A caller under a byte budget passes the modern one in - see `pdfjs` on
	 * OpenOptions, where that trade is weighed.
	 */
	const pdfjs = options.pdfjs ?? (await loadDefaultEngine());

	/*
	 * The worker exists only in a browser, and only when the caller resolved its
	 * URL for us. Outside one, pdf.js falls back to running inline on its own,
	 * which is exactly what a test wants - and that is why this line, and only
	 * this one, sits outside coverage.
	 */
	/* v8 ignore next */
	if (options.workerSrc !== undefined) pdfjs.GlobalWorkerOptions.workerSrc = options.workerSrc;

	// The loading task is kept, not just the document: the task is what carries
	// destroy(), and destroy() is what stops the worker.
	/*
	 * The font parameters go through only when the caller gave them. Passing
	 * `undefined` is not the same as leaving a key out for pdf.js: it takes the
	 * key as given and resolves it against its own base, which is a path that
	 * does not exist outside a browser.
	 */
	const task = pdfjs.getDocument({
		data: new Uint8Array(data),
		...(options.standardFontDataUrl === undefined
			? {}
			: { standardFontDataUrl: options.standardFontDataUrl }),
		...(options.cMapUrl === undefined ? {} : { cMapUrl: options.cMapUrl }),
		...(options.cMapPacked === undefined ? {} : { cMapPacked: options.cMapPacked })
	});
	const pdf = await task.promise;
	try {
		const pages: TextPage[] = [];
		const wanted = options.keepPage ?? (() => true);
		// The cap counts the pages OPENED, so it bounds the work whichever pages
		// are asked for. Skipping is what costs nothing: a page that is never
		// opened is never laid out, and that is the whole saving.
		for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
			if (pages.length >= limits.maximumPages) break;
			if (!wanted(pageNumber)) continue;
			const page = await pdf.getPage(pageNumber);
			const viewport = page.getViewport({ scale: 1 });
			const content = await page.getTextContent();
			const items = positionedItems(content.items);
			pages.push(pageFrom(pageNumber, viewport.width, viewport.height, items));
			page.cleanup();
		}
		return documentFrom(pages, 'pdf', name);
	} finally {
		await task.destroy();
	}
}
