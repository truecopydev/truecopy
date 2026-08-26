/*
 * The contract kit: what makes the contract compulsory.
 *
 * An interface is dodged with a `return null`; an assertion is not dodged, it
 * goes red. `selfCheck() { return null }` compiles, passes review and ships, and
 * only a check run from the outside catches it.
 *
 * A project drops it in its gate with a corpus of its own:
 *
 *     const results = await checkContract(myReader, myCorpus, options);
 *     expect(failures(results)).toEqual([]);
 */

import { readDocument, type Reader, type Verdict } from './contract.js';
import type { Document } from './document.js';

export interface CorpusCase {
	name: string;
	document: Document;
	/** The verdict the project announces; the kit is what demands it. */
	expected: Verdict;
}

export interface CheckResult {
	rule: string;
	passed: boolean;
	detail: string;
}

export const failures = (results: CheckResult[]): string[] =>
	results.filter((result) => !result.passed).map((result) => `${result.rule}: ${result.detail}`);

/**
 * The run as a file the project can commit, and watch move.
 *
 * A green suite says the rules held today; a committed report says what held,
 * and a pull request that moves a line makes the change argue for itself.
 *
 * The counts are in it on purpose. A reading that quietly falls from twenty-six
 * records to twenty-four still passes every rule, and no assertion anywhere is
 * going to notice - the diff is.
 *
 * Nothing here touches the filesystem. This library runs in a browser, and a
 * library that imports `fs` stops doing that; the project writes the string
 * where it wants it.
 *
 *     writeFileSync('contract.txt', contractReport(results));
 */
export function contractReport(results: CheckResult[]): string {
	const failed = results.filter((result) => !result.passed).length;
	const lines = results.map(
		(result) => `${result.passed ? 'pass' : 'FAIL'} | ${result.rule} | ${result.detail}`
	);
	return [
		`truecopy contract - ${results.length} rule(s), ${results.length - failed} passed, ${failed} failed`,
		'',
		...lines,
		''
	].join('\n');
}

/**
 * Build a real PDF: a real content stream, a real xref table.
 *
 * Longer than a stub, and that is the point. What a reader must be able to do is
 * open the file the person downloaded, and a test that fakes the PDF engine
 * proves none of it. The PDF produced is pure ASCII, so its byte offsets equal
 * its character positions and the xref table can be built from string lengths.
 */
export const pdfWithText = (words: PlacedWord[]): string => pdfWithPages([words]);

export interface PlacedWord {
	word: string;
	x: number;
	y: number;
}

/**
 * The same, over several pages.
 *
 * A one-page fixture cannot exercise what only shows up across pages: a blank
 * page in the middle, or two pages cut into a different number of columns. Both
 * are ordinary in a real bundle - a statement runs to four pages and the last
 * one is a footer - and neither can be reproduced by joining single-page files.
 *
 * Object numbering: 1 catalog, 2 pages, 3 font, then each page takes two - the
 * page itself and its content stream.
 */
export function pdfWithPages(pages: PlacedWord[][]): string {
	const streams = pages.map((words) =>
		words.map(({ word, x, y }) => `BT /F1 10 Tf ${x} ${y} Td (${word}) Tj ET`).join('\n')
	);
	const first = 4;
	const kids = pages.map((_, index) => `${first + index * 2} 0 R`).join(' ');
	const objects = [
		'<< /Type /Catalog /Pages 2 0 R >>',
		`<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>`,
		'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
		...streams.flatMap((content, index) => [
			`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R >> >> /Contents ${first + index * 2 + 1} 0 R >>`,
			`<< /Length ${content.length} >>\nstream\n${content}\nendstream`
		])
	];

	let pdf = '%PDF-1.4\n';
	const offsets: number[] = [];
	objects.forEach((body, index) => {
		offsets.push(pdf.length);
		pdf += `${index + 1} 0 obj\n${body}\nendobj\n`;
	});

	const xrefStart = pdf.length;
	pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
	for (const offset of offsets) pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
	pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`;
	return pdf;
}

/** A document carrying nothing checkable, for rule 5. A project may hand in one
 *  of its own. */
export function documentWithoutSubstance(): Document {
	return {
		pages: [
			{
				pageNumber: 1,
				width: 595,
				height: 842,
				items: [],
				rows: [],
				columnBoundaries: []
			}
		],
		text: 'Terms and conditions. This document carries no figure of any kind.',
		origin: 'text',
		name: 'without-substance.txt'
	};
}

export interface ContractOptions {
	/** A real PDF, for rule 4. `pdfWithText` makes one. */
	referencePdf: string;
	/**
	 * How this project opens a file.
	 *
	 * The kit does not impose its own door. A kit that imposed one would stop
	 * measuring the project's reader and start measuring its own, which is the one
	 * thing a conformance suite must never do.
	 */
	open: (file: File) => Promise<Document>;
	withoutSubstance?: Document;
	/**
	 * Documents of another kind, which the reading must refuse.
	 *
	 * The rule nobody writes and every reader lacks: a foreign document often
	 * carries the shape of what is sought - years, numbers, amounts - without
	 * being it. The corpus comes from the project, because only it knows what it
	 * has to be told apart from.
	 */
	foreign?: { name: string; document: Document }[];
}

/**
 * The six rules a corpus is run against. Not one of them knows the domain.
 *
 * 1. The verdict the corpus announces is the verdict returned.
 * 2. A reading that contradicts its document never comes back as sound.
 * 3. Everything read is reviewable by the person.
 * 4. The chain from bytes to records really runs, on a real PDF.
 * 5. A document without substance is refused, not silently returned empty.
 * 6. A document of another kind is refused.
 */
export async function checkContract<Entry, Header>(
	reader: Reader<Entry, Header>,
	corpus: CorpusCase[],
	options: ContractOptions
): Promise<CheckResult[]> {
	const results: CheckResult[] = [];

	for (const entry of corpus) {
		const result = readDocument(entry.document, reader);

		results.push({
			rule: `1. expected verdict (${entry.name})`,
			passed: result.verdict === entry.expected,
			detail: `expected ${entry.expected}, got ${result.verdict}`
		});

		const gap = result.discrepancy;
		const contradicts = gap !== null && gap.amount !== 0;
		results.push({
			rule: `2. a discrepancy never reads as sound (${entry.name})`,
			passed: !contradicts || result.verdict !== 'read',
			detail: contradicts
				? `off by ${gap.amount} ${gap.unit}, verdict ${result.verdict}`
				: 'no discrepancy'
		});

		results.push({
			rule: `3. everything read is reviewable (${entry.name})`,
			passed: result.reading.records.length === 0 || result.rowsToReview.length > 0,
			detail: `${result.reading.records.length} records, ${result.rowsToReview.length} reviewable rows`
		});
	}

	const opened = await options.open(
		new File([options.referencePdf], 'reference.pdf', { type: 'application/pdf' })
	);
	const fromPdf = readDocument(opened, reader);
	results.push({
		rule: '4. the whole chain runs on a real PDF',
		passed: fromPdf.reading.records.length > 0,
		detail: `${opened.pages.length} page(s), ${fromPdf.reading.records.length} records`
	});

	const empty = readDocument(options.withoutSubstance ?? documentWithoutSubstance(), reader);
	results.push({
		rule: '5. a document without substance is refused',
		passed: empty.verdict === 'refused',
		detail: `verdict ${empty.verdict}, refusal ${empty.refusal ? 'written' : 'MISSING'}`
	});

	for (const entry of options.foreign ?? []) {
		const result = readDocument(entry.document, reader);
		results.push({
			rule: `6. a document of another kind is refused (${entry.name})`,
			passed: result.verdict === 'refused',
			detail: `verdict ${result.verdict}, ${result.reading.records.length} records kept`
		});
	}

	return results;
}

/**
 * Build a real `.docx`: a real ZIP, a real CRC, a real body part.
 *
 * Same reasoning as `pdfWithText`, and it costs about as much. What a reader
 * must be able to do is open the file somebody attached to an email, and a test
 * that hands the parser a string of XML proves none of the container.
 *
 * `compress` is not decoration either: Word writes deflated parts and this
 * builder writes stored ones, so the two paths through the archive reader are
 * two different code paths and both ship.
 */
export async function docxWithBody(
	bodyXml: string,
	options: { compress?: boolean } = {}
): Promise<Uint8Array> {
	const document = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${bodyXml}</w:body></w:document>`;
	const relationships = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`;
	return archiveOf(
		[
			{ name: '_rels/.rels', text: relationships },
			{ name: 'word/document.xml', text: document }
		],
		options.compress ?? false
	);
}

/**
 * The same, from what the document says rather than from its markup.
 *
 * A string is a paragraph, an array of strings is a table row: those are the two
 * shapes a Word document has, and a fixture that spells the XML out for either
 * of them tests the fixture more than the reader.
 */
export const docxWithText = (
	blocks: (string | string[])[],
	options: { compress?: boolean } = {}
): Promise<Uint8Array> => {
	const escape = (text: string): string =>
		text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
	const paragraph = (text: string): string =>
		`<w:p><w:r><w:t xml:space="preserve">${escape(text)}</w:t></w:r></w:p>`;
	const cellXml = (text: string): string => `<w:tc>${paragraph(text)}</w:tc>`;
	const rowXml = (cells: string[]): string =>
		`<w:tbl><w:tr>${cells.map(cellXml).join('')}</w:tr></w:tbl>`;
	const body = blocks
		.map((block) => (typeof block === 'string' ? paragraph(block) : rowXml(block)))
		.join('');
	return docxWithBody(body, options);
};

/**
 * Build a real `.odt`: a real ZIP, a real CRC, a real `content.xml`.
 *
 * Same reasoning as `docxWithBody`, and the same reason it is not a string of
 * XML handed to the parser: what a reader must be able to do is open the file
 * somebody attached to an email.
 *
 * The `mimetype` entry is written first and STORED, which is what the standard
 * asks for. Nothing here depends on it - the extension is what decides the
 * format - but a fixture that skipped it would not be the file an editor
 * writes, and that is the whole point of building a real one.
 */
export async function odtWithBody(
	bodyXml: string,
	options: { compress?: boolean } = {}
): Promise<Uint8Array> {
	const content = `<?xml version="1.0" encoding="UTF-8"?>
<office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0"><office:automatic-styles><style:style style:name="P1"/></office:automatic-styles><office:body><office:text>${bodyXml}</office:text></office:body></office:document-content>`;
	return archiveOf(
		[
			{ name: 'mimetype', text: 'application/vnd.oasis.opendocument.text' },
			{ name: 'content.xml', text: content }
		],
		options.compress ?? false
	);
}

/**
 * The same, from what the document says rather than from its markup.
 *
 * A string is a paragraph, an array of strings is a table row - the same two
 * shapes `docxWithText` takes, so a test can be written once against both
 * formats and prove they read alike.
 */
export const odtWithText = (
	blocks: (string | string[])[],
	options: { compress?: boolean } = {}
): Promise<Uint8Array> => {
	const escape = (text: string): string =>
		text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
	const paragraph = (text: string): string =>
		`<text:p text:style-name="P1">${escape(text)}</text:p>`;
	const cellXml = (text: string): string =>
		`<table:table-cell office:value-type="string">${paragraph(text)}</table:table-cell>`;
	const rowXml = (cells: string[]): string =>
		`<table:table table:name="Tableau1"><table:table-row>${cells.map(cellXml).join('')}</table:table-row></table:table>`;
	const body = blocks
		.map((block) => (typeof block === 'string' ? paragraph(block) : rowXml(block)))
		.join('');
	return odtWithBody(body, options);
};

/** CRC-32, the one the ZIP format checks its entries with. Table-free: a
 *  fixture builder runs a handful of times, and the table is more code than the
 *  loop it saves. */
function crc32(bytes: Uint8Array): number {
	let crc = 0xffffffff;
	for (const byte of bytes) {
		crc ^= byte;
		for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
	}
	return (crc ^ 0xffffffff) >>> 0;
}

async function deflate(bytes: Uint8Array): Promise<Uint8Array> {
	const stream = new Blob([bytes as BlobPart])
		.stream()
		.pipeThrough(new CompressionStream('deflate-raw'));
	return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** A ZIP holding the given files, written the way the format reads: local
 *  headers, then a central directory, then the end record that points at it. */
async function archiveOf(
	files: { name: string; text: string }[],
	compress: boolean
): Promise<Uint8Array> {
	const encoder = new TextEncoder();
	const parts: Uint8Array[] = [];
	const directory: Uint8Array[] = [];
	let offset = 0;

	for (const file of files) {
		const name = encoder.encode(file.name);
		const content = encoder.encode(file.text);
		const stored = compress ? await deflate(content) : content;

		const local = new Uint8Array(30 + name.byteLength);
		const localView = new DataView(local.buffer);
		localView.setUint32(0, 0x04034b50, true);
		localView.setUint16(4, 20, true);
		localView.setUint16(8, compress ? 8 : 0, true);
		localView.setUint32(14, crc32(content), true);
		localView.setUint32(18, stored.byteLength, true);
		localView.setUint32(22, content.byteLength, true);
		localView.setUint16(26, name.byteLength, true);
		local.set(name, 30);

		const entry = new Uint8Array(46 + name.byteLength);
		const entryView = new DataView(entry.buffer);
		entryView.setUint32(0, 0x02014b50, true);
		entryView.setUint16(6, 20, true);
		entryView.setUint16(10, compress ? 8 : 0, true);
		entryView.setUint32(16, crc32(content), true);
		entryView.setUint32(20, stored.byteLength, true);
		entryView.setUint32(24, content.byteLength, true);
		entryView.setUint16(28, name.byteLength, true);
		entryView.setUint32(42, offset, true);
		entry.set(name, 46);

		parts.push(local, stored);
		directory.push(entry);
		offset += local.byteLength + stored.byteLength;
	}

	const directorySize = directory.reduce((total, entry) => total + entry.byteLength, 0);
	const end = new Uint8Array(22);
	const endView = new DataView(end.buffer);
	endView.setUint32(0, 0x06054b50, true);
	endView.setUint16(8, files.length, true);
	endView.setUint16(10, files.length, true);
	endView.setUint32(12, directorySize, true);
	endView.setUint32(16, offset, true);

	const all = [...parts, ...directory, end];
	const size = all.reduce((total, part) => total + part.byteLength, 0);
	const archive = new Uint8Array(size);
	let at = 0;
	for (const part of all) {
		archive.set(part, at);
		at += part.byteLength;
	}
	return archive;
}
