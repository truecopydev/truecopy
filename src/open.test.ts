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
import { pdfWithText } from './kit.js';

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
