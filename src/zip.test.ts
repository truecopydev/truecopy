import { describe, expect, it } from 'vitest';
import { docxWithBody } from './kit.js';
import { fileFromArchive, looksLikeArchive, UnreadableArchive } from './zip.js';

const BODY = 'word/document.xml';

const archive = (): Promise<Uint8Array> =>
	docxWithBody('<w:p><w:r><w:t>Article 1</w:t></w:r></w:p>');

/** Where a signature sits, searched from the end: the central directory and the
 *  end record are both at the back of the file. */
function lastAt(bytes: Uint8Array, signature: number): number {
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	for (let at = bytes.byteLength - 4; at >= 0; at--) {
		if (view.getUint32(at, true) === signature) return at;
	}
	throw new Error('signature absent from the fixture');
}

/** The same archive with one field rewritten. Every refusal below is a field
 *  that says something the reader will not follow. */
function withField(
	bytes: Uint8Array,
	signature: number,
	offset: number,
	value: number,
	bits: 16 | 32
): Uint8Array {
	const copy = bytes.slice();
	const view = new DataView(copy.buffer);
	const at = lastAt(copy, signature) + offset;
	if (bits === 16) view.setUint16(at, value, true);
	else view.setUint32(at, value, true);
	return copy;
}

const END = 0x06054b50;
const CENTRAL = 0x02014b50;

const reasonOf = async (bytes: Uint8Array, name = BODY, maximum = 5_000_000): Promise<string> => {
	try {
		await fileFromArchive(bytes, name, maximum);
	} catch (error) {
		if (error instanceof UnreadableArchive) return error.reason;
		throw error;
	}
	throw new Error('this archive was read, and it should not have been');
};

describe('fileFromArchive', () => {
	it('reads a named entry out of a real archive', async () => {
		const body = await fileFromArchive(await archive(), BODY, 5_000_000);
		expect(new TextDecoder().decode(body)).toContain('Article 1');
	});

	it('refuses bytes that are not an archive', async () => {
		expect(await reasonOf(new TextEncoder().encode('not a zip at all'))).toBe('not-an-archive');
	});

	it('names the entry it could not find', async () => {
		await expect(fileFromArchive(await archive(), 'xl/workbook.xml', 5_000_000)).rejects.toThrow(
			/xl\/workbook\.xml/
		);
	});

	it('refuses an archive whose directory starts past 4 GB', async () => {
		// ZIP64. The real offset lives in an extra field this reader does not read,
		// so following the 32-bit one would land in the middle of the data.
		expect(await reasonOf(withField(await archive(), END, 16, 0xffffffff, 32))).toBe(
			'unsupported-archive'
		);
	});

	it('refuses an archive that says it holds 65535 entries or more', async () => {
		expect(await reasonOf(withField(await archive(), END, 10, 0xffff, 16))).toBe(
			'unsupported-archive'
		);
	});

	it('refuses an archive whose entry sizes are held in a ZIP64 field', async () => {
		expect(await reasonOf(withField(await archive(), CENTRAL, 20, 0xffffffff, 32))).toBe(
			'unsupported-archive'
		);
		expect(await reasonOf(withField(await archive(), CENTRAL, 24, 0xffffffff, 32))).toBe(
			'unsupported-archive'
		);
	});

	it('refuses an archive that declares more entries than it wrote', async () => {
		expect(await reasonOf(withField(await archive(), END, 10, 9, 16))).toBe('unsupported-archive');
	});

	it('refuses an entry whose header is not where the directory says', async () => {
		expect(await reasonOf(withField(await archive(), CENTRAL, 42, 3, 32))).toBe(
			'unsupported-archive'
		);
	});

	it('refuses an entry that runs past the end of the file', async () => {
		expect(await reasonOf(withField(await archive(), CENTRAL, 20, 100_000, 32))).toBe(
			'unsupported-archive'
		);
	});

	it('refuses a compression method it does not know', async () => {
		expect(await reasonOf(withField(await archive(), CENTRAL, 10, 14, 16))).toBe(
			'unsupported-archive'
		);
	});

	it('refuses a stored entry larger than the caller allowed', async () => {
		expect(await reasonOf(await archive(), BODY, 10)).toBe('entry-too-big');
	});

	it('refuses a deflated entry larger than the caller allowed, as it inflates', async () => {
		// Checked on the chunks, not on the declared size: the declaration is the
		// archive's word, and the archive is what is being doubted.
		const compressed = await docxWithBody('<w:p><w:r><w:t>Article 1</w:t></w:r></w:p>', {
			compress: true
		});
		expect(await reasonOf(compressed, BODY, 10)).toBe('entry-too-big');
	});
});

describe('looksLikeArchive', () => {
	it('knows a container from text', async () => {
		expect(looksLikeArchive(await archive())).toBe(true);
		expect(looksLikeArchive(new TextEncoder().encode('Article 1'))).toBe(false);
		expect(looksLikeArchive(new Uint8Array([0x50]))).toBe(false);
	});
});

describe('an archive that does not end on its own record', () => {
	it('finds the end record behind a comment', async () => {
		// A ZIP is allowed to carry a comment after its end record, and a
		// self-extracting one carries a whole program in front of it. Reading only
		// the last 22 bytes would call both of those "not an archive".
		const bytes = await docxWithBody('<w:p><w:r><w:t>Article 1</w:t></w:r></w:p>');
		const withComment = new Uint8Array(bytes.byteLength + 5);
		withComment.set(bytes, 0);
		new DataView(withComment.buffer).setUint16(bytes.byteLength - 2, 5, true);
		withComment.set(new TextEncoder().encode('hello'), bytes.byteLength);
		const body = await fileFromArchive(withComment, BODY, 5_000_000);
		expect(new TextDecoder().decode(body)).toContain('Article 1');
	});
});
