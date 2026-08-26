import { describe, expect, it } from 'vitest';
import {
	DEFAULT_LIMITS,
	UnreadableDocument,
	openDocument,
	positionedItems,
	withDeadline,
	type OpenOptions,
	type PdfEngine
} from './open.js';
import { docxWithBody, docxWithText, odtWithText, pdfWithPages, pdfWithText } from './kit.js';

describe('withDeadline', () => {
	it('lets a read that finishes through', async () => {
		await expect(withDeadline(Promise.resolve('read'), 50)).resolves.toBe('read');
	});

	it('gives up on a read that never returns', async () => {
		// Without this bound the screen stays on "reading the file..." with no
		// button, no message and no way out.
		await expect(withDeadline(new Promise<string>(() => {}), 20)).rejects.toBeInstanceOf(
			UnreadableDocument
		);
	});
});

describe('openDocument', () => {
	it('refuses an empty file', async () => {
		await expect(openDocument(new File([], 'empty.pdf'))).rejects.toThrow(/empty/);
	});

	it('refuses an oversized file, and says the cap', async () => {
		const huge = new File(['x'], 'huge.pdf');
		Object.defineProperty(huge, 'size', { value: DEFAULT_LIMITS.maximumBytes + 1 });
		await expect(openDocument(huge)).rejects.toThrow(/20 MB/);
	});

	it('reads a text file without loading the PDF engine', async () => {
		const document = await openDocument(new File(['a\nb'], 'list.csv', { type: 'text/csv' }));
		expect(document.origin).toBe('text');
		// One page: a paste was never paginated. Two rows, and they keep their text.
		expect(document.pages).toHaveLength(1);
		expect(document.pages[0].rows.map((row) => row.text)).toEqual(['a', 'b']);
	});

	it('extracts a real PDF, from the bytes to the rows', async () => {
		const pdf = pdfWithText([
			{ word: 'Year', x: 50, y: 750 },
			{ word: 'Qtr', x: 430, y: 750 },
			{ word: '2018', x: 50, y: 700 },
			{ word: '2', x: 430, y: 700 }
		]);
		const document = await openDocument(new File([pdf], 'record.pdf', { type: 'application/pdf' }));
		expect(document.origin).toBe('pdf');
		expect(document.pages[0].rows.map((row) => row.text)).toEqual(['Year\tQtr', '2018\t2']);
	});

	it('says what to do with a PDF that carries no text layer', async () => {
		await expect(
			openDocument(new File([pdfWithText([])], 'scan.pdf', { type: 'application/pdf' }))
		).rejects.toThrow(/scan/);
	});

	it('says what to do with an unreadable PDF rather than failing in silence', async () => {
		await expect(
			openDocument(new File(['this is not a PDF'], 'fake.pdf', { type: 'application/pdf' }))
		).rejects.toThrow(/password/);
	});

	it('caps how many pages it reads', async () => {
		const pdf = pdfWithText([{ word: 'only', x: 10, y: 10 }]);
		const document = await openDocument(new File([pdf], 'short.pdf', { type: 'application/pdf' }), {
			...DEFAULT_LIMITS,
			maximumPages: 1
		});
		expect(document.pages).toHaveLength(1);
	});

	/*
	 * A cap that only cuts at the end is the wrong end of a long document: an
	 * annual report prints its portfolio from page 313, and the first forty pages
	 * are a cover and an auditor's opinion. Opening a page is what a reading
	 * costs, so a page nobody wants is better never opened.
	 */
	const threePages = (): File =>
		new File(
			[
				pdfWithPages([
					[{ word: 'cover', x: 10, y: 700 }],
					[{ word: 'portfolio', x: 10, y: 700 }],
					[{ word: 'notes', x: 10, y: 700 }]
				])
			],
			'report.pdf',
			{ type: 'application/pdf' }
		);

	it('opens only the pages asked for, and they keep their own numbers', async () => {
		const document = await openDocument(threePages(), { keepPage: (page) => page >= 2 });
		expect(document.pages.map((page) => page.pageNumber)).toEqual([2, 3]);
	});

	it('counts the pages it opened against the cap, never the ones it skipped', async () => {
		const document = await openDocument(threePages(), {
			keepPage: (page) => page >= 2,
			maximumPages: 1
		});
		expect(document.pages.map((page) => page.pageNumber)).toEqual([2]);
	});
});

describe('the reason a document was refused', () => {
	/*
	 * Named and not only worded. An application writes its refusal in its own
	 * voice and its own language; without a name it has to match on an English
	 * sentence, or keep a copy of this whole file to say the same thing.
	 */
	const refusal = async (file: File, options?: OpenOptions): Promise<UnreadableDocument> => {
		try {
			await openDocument(file, options);
		} catch (error) {
			return error as UnreadableDocument;
		}
		throw new Error('this file was opened, and should not have been');
	};

	it('names an empty file', async () => {
		expect((await refusal(new File([], 'nothing.pdf'))).reason).toBe('empty');
	});

	it('names a file over the cap', async () => {
		const big = new File(['x'.repeat(64)], 'big.txt');
		try {
			await openDocument(big, { maximumBytes: 8 });
		} catch (error) {
			expect((error as UnreadableDocument).reason).toBe('too-big');
		}
	});

	it('names a PDF that carries no text', async () => {
		const file = new File([pdfWithText([])], 'scan.pdf', { type: 'application/pdf' });
		expect((await refusal(file)).reason).toBe('no-text');
	});

	it('names a PDF the engine would not open', async () => {
		const file = new File(['not a PDF at all'], 'fake.pdf', { type: 'application/pdf' });
		expect((await refusal(file)).reason).toBe('not-opened');
	});

	it('hands the font pack to the engine, and leaves the key out when it has none', async () => {
		/*
		 * The interface could not carry these, so no reader could pass them. What
		 * it does NOT do is rescue garbled text, measured on 125 real reports: the
		 * three that come back broken are broken by a subsetted font with no
		 * `ToUnicode` map, and the pack changes not one character of them.
		 *
		 * And the key is LEFT OUT rather than passed as undefined: pdf.js takes
		 * the key as given and resolves it against a base that does not exist
		 * outside a browser.
		 */
		const seen: Record<string, unknown>[] = [];
		const spy = {
			getDocument: (source: Record<string, unknown>) => {
				seen.push(source);
				throw new Error('far enough');
			}
		} as unknown as PdfEngine;
		const file = new File([pdfWithText([{ word: 'a', x: 10, y: 700 }])], 'ok.pdf', {
			type: 'application/pdf'
		});

		await refusal(file, {
			pdfjs: spy,
			standardFontDataUrl: 'file:///fonts/',
			cMapUrl: 'file:///maps/',
			cMapPacked: true
		});
		expect(seen[0]).toMatchObject({
			standardFontDataUrl: 'file:///fonts/',
			cMapUrl: 'file:///maps/',
			cMapPacked: true
		});

		await refusal(file, { pdfjs: spy });
		expect(seen[1]).not.toHaveProperty('standardFontDataUrl');
		expect(seen[1]).not.toHaveProperty('cMapUrl');
		expect(seen[1]).not.toHaveProperty('cMapPacked');
	});

	it('tells a missing engine apart from a file that will not open', async () => {
		// The two refusals send a reader in opposite directions: install the
		// engine, or hunt for the password of a file that has none. Conflating
		// them is what makes an agent write "this document is protected" about a
		// project that simply never installed pdfjs-dist.
		const file = new File([pdfWithText([{ word: 'a', x: 10, y: 700 }])], 'ok.pdf', {
			type: 'application/pdf'
		});
		const broken = {
			getDocument: () => {
				throw new Error('engine missing');
			}
		} as unknown as PdfEngine;
		expect((await refusal(file, { pdfjs: broken })).reason).toBe('not-opened');

		// And the message of a missing engine must name what to install.
		const missing = new UnreadableDocument(
			'no-engine',
			'No PDF engine: install pdfjs-dist, or pass one as the `pdfjs` option.'
		);
		expect(missing.reason).toBe('no-engine');
		expect(missing.message).toContain('pdfjs-dist');
	});

	it('names a read that ran out of time', async () => {
		const forever = new Promise<never>(() => {});
		await expect(withDeadline(forever, 1)).rejects.toMatchObject({ reason: 'too-slow' });
	});
});

describe('positionedItems', () => {
	const from = (transform: number[], str: string, width?: number) => ({ str, transform, width });

	it('keeps the x and the baseline off the transform', () => {
		expect(positionedItems([from([1, 0, 0, 1, 50, 700], 'MAY')])).toEqual([
			{ text: 'MAY', x: 50, y: 700, width: 0 }
		]);
	});

	it('drops what carries no text, rather than letting it vote on a column', () => {
		// An empty fragment still has an x, and an x it has no business voting
		// with: it would open a column of nothing.
		expect(positionedItems([from([1, 0, 0, 1, 50, 700], '   ')])).toEqual([]);
	});

	it('ignores anything that is not a text item at all', () => {
		expect(positionedItems([null, 42, {}, { width: 3 }])).toEqual([]);
	});

	it('keeps the width when the engine gives one', () => {
		expect(positionedItems([from([1, 0, 0, 1, 50, 700], 'MAY', 18)])[0].width).toBe(18);
	});
});

describe('openDocument, on what is neither a PDF nor plain text', () => {
	const WORD_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
	const paragraph = (text: string) => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`;

	const reasonOf = async (file: File, options?: OpenOptions): Promise<string> => {
		try {
			await openDocument(file, options);
		} catch (error) {
			if (error instanceof UnreadableDocument) return error.reason;
			throw error;
		}
		throw new Error('this file was read, and it should not have been');
	};

	it('reads a real .docx, from the bytes to the rows', async () => {
		const bytes = await docxWithText(['Accord du 5 juin 2026', ['Employes', '1 800 EUR']]);
		const document = await openDocument(new File([bytes as BlobPart], 'accord.docx'));
		expect(document.origin).toBe('docx');
		expect(document.pages[0].rows.map((row) => row.text)).toEqual([
			'Accord du 5 juin 2026',
			'Employes\t1 800 EUR'
		]);
	});

	it('takes the type the browser gives, when the name says nothing', async () => {
		const bytes = await docxWithText(['Accord']);
		const document = await openDocument(
			new File([bytes as BlobPart], 'download', { type: WORD_TYPE })
		);
		expect(document.origin).toBe('docx');
	});

	it('refuses a container that is not a Word document, and says which formats it reads', async () => {
		// The extension decides, not the ZIP signature: .xlsx and .pptx are the
		// same container, and opening one as a Word document would report damage
		// rather than the wrong format.
		const bytes = await docxWithText(['Accord']);
		const file = new File([bytes as BlobPart], 'comptes.xlsx');
		expect(await reasonOf(file)).toBe('binary');
		await expect(openDocument(file)).rejects.toThrow(/\.docx/);
	});

	it('reads a .odt, which used to be refused as a container', async () => {
		// MEASURED on auregistre: 4 767 agreements out of 395 581 came back with no
		// citation because their document was an .odt, and the only thing standing
		// between the text and the reader was this dispatch.
		const bytes = await odtWithText(['Accord relatif a la NAO 2025']);
		const document = await openDocument(new File([bytes as BlobPart], 'accord.odt'));
		expect(document.origin).toBe('odt');
		expect(document.text).toBe('Accord relatif a la NAO 2025');
	});

	it('takes the OpenDocument type the browser gives, when the name says nothing', async () => {
		const bytes = await odtWithText(['Accord']);
		const document = await openDocument(
			new File([bytes as BlobPart], 'download', { type: 'application/vnd.oasis.opendocument.text' })
		);
		expect(document.origin).toBe('odt');
	});

	it('still refuses a spreadsheet, whichever suite wrote it', async () => {
		// .ods and .xlsx are the same container as the documents above: the
		// extension is what decides, and neither of them is a text document.
		const bytes = await odtWithText(['Accord']);
		expect(await reasonOf(new File([bytes as BlobPart], 'comptes.ods'))).toBe('binary');
		await expect(openDocument(new File([bytes as BlobPart], 'comptes.ods'))).rejects.toThrow(
			/.odt/
		);
	});

	it('refuses an archive with no Word document in it', async () => {
		const bytes = await docxWithText(['Accord']);
		// Rename the part, in the directory and in the local header both.
		const renamed = new TextDecoder('latin1')
			.decode(bytes)
			.replaceAll('word/document.xml', 'word/document.XXX');
		const file = new File([Uint8Array.from(renamed, (c) => c.charCodeAt(0)) as BlobPart], 'a.docx');
		expect(await reasonOf(file)).toBe('binary');
	});

	it('refuses a .docx that inflates to more than the caller allowed', async () => {
		// A small file holding a very large part: the reader must not hand a tab a
		// megabyte it never agreed to.
		const bytes = await docxWithBody(paragraph('x').repeat(4000), { compress: true });
		const file = new File([bytes as BlobPart], 'bomb.docx');
		expect(await reasonOf(file, { maximumBytes: 20_000 })).toBe('too-big');
	});

	it('refuses a .docx whose bytes are damaged', async () => {
		const bytes = await docxWithBody(paragraph('Accord'), { compress: true });
		const damaged = bytes.slice();
		const view = new DataView(damaged.buffer);
		// The body is the last entry written, so its local header is the last one,
		// and its deflate stream starts right after the header and the name.
		let header = 0;
		for (let at = 0; at + 4 <= damaged.length; at++) {
			if (view.getUint32(at, true) === 0x04034b50) header = at;
		}
		const stream = header + 30 + view.getUint16(header + 26, true);
		for (let index = stream; index < stream + 16; index++) damaged[index] ^= 0xff;
		expect(await reasonOf(new File([damaged as BlobPart], 'accord.docx'))).toBe('not-opened');
	});

	it('refuses a .docx whose archive is cut short', async () => {
		// Truncated download: the container opens on PK and has no end record. It
		// is not a Word document that failed to open, and it is not text either.
		const bytes = await docxWithText(['Accord']);
		const cut = bytes.slice(0, bytes.byteLength - 30);
		expect(await reasonOf(new File([cut as BlobPart], 'accord.docx'))).toBe('not-opened');
	});

	it('says a .docx carries no text rather than returning an empty reading', async () => {
		const bytes = await docxWithBody('<w:p/>');
		expect(await reasonOf(new File([bytes as BlobPart], 'images.docx'))).toBe('no-text');
	});

	it('refuses bytes that are not text at all', async () => {
		// A PNG: eight bytes of signature, a NUL among them.
		const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00]);
		expect(await reasonOf(new File([png as BlobPart], 'scan.png'))).toBe('binary');
	});

	it.each([
		{ order: 'little endian', mark: [0xff, 0xfe], bytes: [0x41, 0x00, 0x09, 0x00, 0x42, 0x00] },
		{ order: 'big endian', mark: [0xfe, 0xff], bytes: [0x00, 0x41, 0x00, 0x09, 0x00, 0x42] }
	])(
		'reads a text file that declares UTF-16, $order, rather than calling it binary',
		async ({ mark, bytes }) => {
			// A byte order mark is the only thing a plain text file says about itself,
			// and decoding one of these as UTF-8 gives a line of NUL-riddled mojibake.
			const utf16 = new Uint8Array([...mark, ...bytes]);
			const document = await openDocument(new File([utf16 as BlobPart], 'export.txt'));
			expect(document.origin).toBe('text');
			expect(document.text).toBe('A\tB');
		}
	);
});
