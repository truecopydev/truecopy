/*
 * Just enough of the ZIP container to reach one file inside it.
 *
 * An Office document is a ZIP, so reading one starts here. This is not a ZIP
 * library and must not become one: it finds a named entry, inflates it, and
 * refuses everything it does not understand rather than returning bytes it
 * guessed at. Nothing here writes, lists for a user, or follows a path outside
 * the archive.
 *
 * No dependency, on purpose. `DecompressionStream` is in Node 20 and in every
 * browser this library already runs in, so the one thing that would have
 * justified a package - inflate - is already there.
 */

/** Why an archive could not be read. Named, never only worded, for the same
 *  reason `Unreadable` is: the caller decides what to say. */
type Unarchivable =
	/** Not a ZIP at all: the end of central directory record is missing. */
	| 'not-an-archive'
	/** A ZIP this reader will not follow: ZIP64, a compression method other than
	 *  stored or deflate, an entry whose header contradicts the directory. */
	| 'unsupported-archive'
	/** The entry asked for is not in the archive. */
	| 'entry-absent'
	/** The entry inflates to more than the caller allowed. A small archive can
	 *  carry a very large member, and a reader that trusts the declared size
	 *  hands a browser tab a gigabyte it never agreed to. */
	| 'entry-too-big';

export class UnreadableArchive extends Error {
	readonly reason: Unarchivable;

	constructor(reason: Unarchivable, message: string) {
		super(message);
		this.reason = reason;
	}
}

/** Signatures, little endian, as the format writes them. */
const END_OF_CENTRAL_DIRECTORY = 0x06054b50;
const CENTRAL_FILE_HEADER = 0x02014b50;
const LOCAL_FILE_HEADER = 0x04034b50;

const STORED = 0;
const DEFLATED = 8;

/** The value a ZIP32 field carries when the real one lives in a ZIP64 extra
 *  field. Met here, the archive is refused rather than misread. */
const NEEDS_ZIP64 = 0xffffffff;

/** The end of central directory record is 22 bytes plus a comment of up to
 *  65535. Scanning back that far and no further is the whole search. */
const MAXIMUM_COMMENT = 0xffff;

interface Entry {
	name: string;
	method: number;
	compressedSize: number;
	uncompressedSize: number;
	localHeaderOffset: number;
}

/**
 * Where the central directory starts, or a refusal.
 *
 * Searched from the end because that is where the format puts it, and because a
 * ZIP is allowed to have anything at all in front of it: a self-extracting
 * archive is an executable followed by a ZIP, and the offsets inside are still
 * counted from the start of the file.
 */
function endOfCentralDirectory(view: DataView): { offset: number; entries: number } {
	const from = Math.max(0, view.byteLength - MAXIMUM_COMMENT - 22);
	for (let at = view.byteLength - 22; at >= from; at--) {
		if (view.getUint32(at, true) !== END_OF_CENTRAL_DIRECTORY) continue;
		const offset = view.getUint32(at + 16, true);
		const entries = view.getUint16(at + 10, true);
		if (offset === NEEDS_ZIP64 || entries === 0xffff) {
			throw new UnreadableArchive('unsupported-archive', 'This archive is ZIP64.');
		}
		return { offset, entries };
	}
	throw new UnreadableArchive('not-an-archive', 'This file is not a ZIP archive.');
}

/**
 * The entries the central directory declares.
 *
 * The directory is read rather than the local headers walked, because only the
 * directory is authoritative: a local header may carry zeroed sizes with the
 * real ones in a data descriptor after the data, which cannot be found without
 * decompressing blind.
 */
function entriesOf(bytes: Uint8Array, view: DataView): Entry[] {
	const { offset, entries: count } = endOfCentralDirectory(view);
	const names = new TextDecoder();
	const entries: Entry[] = [];
	let at = offset;
	for (let index = 0; index < count; index++) {
		if (at + 46 > view.byteLength || view.getUint32(at, true) !== CENTRAL_FILE_HEADER) {
			throw new UnreadableArchive('unsupported-archive', 'This archive ends before it says.');
		}
		const nameLength = view.getUint16(at + 28, true);
		const extraLength = view.getUint16(at + 30, true);
		const commentLength = view.getUint16(at + 32, true);
		entries.push({
			name: names.decode(bytes.subarray(at + 46, at + 46 + nameLength)),
			method: view.getUint16(at + 10, true),
			compressedSize: view.getUint32(at + 20, true),
			uncompressedSize: view.getUint32(at + 24, true),
			localHeaderOffset: view.getUint32(at + 42, true)
		});
		at += 46 + nameLength + extraLength + commentLength;
	}
	return entries;
}

/** The bytes of one entry, still compressed. The local header is read for its
 *  own name and extra lengths only: they are allowed to differ from the
 *  directory's, and reading the data at the wrong offset is how an archive
 *  reader returns a plausible mess. */
function compressedBytes(bytes: Uint8Array, view: DataView, entry: Entry): Uint8Array {
	const at = entry.localHeaderOffset;
	if (at + 30 > view.byteLength || view.getUint32(at, true) !== LOCAL_FILE_HEADER) {
		throw new UnreadableArchive('unsupported-archive', 'This archive points at nothing.');
	}
	const nameLength = view.getUint16(at + 26, true);
	const extraLength = view.getUint16(at + 28, true);
	const from = at + 30 + nameLength + extraLength;
	const to = from + entry.compressedSize;
	if (to > bytes.byteLength) {
		throw new UnreadableArchive('unsupported-archive', 'This archive ends before its content.');
	}
	return bytes.subarray(from, to);
}

/** Inflate, bounded. The bound is checked as the chunks arrive and not against
 *  the declared size: the declaration is the archive's word, and the archive is
 *  what is being doubted. */
async function inflate(data: Uint8Array, maximumBytes: number): Promise<Uint8Array> {
	const stream = new Blob([data as BlobPart])
		.stream()
		.pipeThrough(new DecompressionStream('deflate-raw'));
	const chunks: Uint8Array[] = [];
	let size = 0;
	const reader = stream.getReader();
	for (;;) {
		const { done, value } = await reader.read();
		if (done) break;
		size += value.byteLength;
		if (size > maximumBytes) {
			await reader.cancel();
			throw new UnreadableArchive('entry-too-big', 'This archive holds more than expected.');
		}
		chunks.push(value);
	}
	const joined = new Uint8Array(size);
	let at = 0;
	for (const chunk of chunks) {
		joined.set(chunk, at);
		at += chunk.byteLength;
	}
	return joined;
}

/**
 * One named entry of a ZIP, decompressed, or a refusal that names the reason.
 *
 * The name is matched exactly. An Office part is at a path the format fixes
 * (`word/document.xml`), so there is nothing to search for and nothing to guess
 * when it is absent.
 */
export async function fileFromArchive(
	bytes: Uint8Array,
	name: string,
	maximumBytes: number
): Promise<Uint8Array> {
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	const entry = entriesOf(bytes, view).find((candidate) => candidate.name === name);
	if (entry === undefined) {
		throw new UnreadableArchive('entry-absent', `This archive holds no ${name}.`);
	}
	if (entry.compressedSize === NEEDS_ZIP64 || entry.uncompressedSize === NEEDS_ZIP64) {
		throw new UnreadableArchive('unsupported-archive', 'This archive is ZIP64.');
	}
	const data = compressedBytes(bytes, view, entry);
	if (entry.method === STORED) {
		if (data.byteLength > maximumBytes) {
			throw new UnreadableArchive('entry-too-big', 'This archive holds more than expected.');
		}
		return data;
	}
	if (entry.method !== DEFLATED) {
		throw new UnreadableArchive(
			'unsupported-archive',
			'This archive is compressed in a way this reader does not know.'
		);
	}
	return inflate(data, maximumBytes);
}

/** Whether these bytes open like a ZIP. Two bytes, and it is what tells a
 *  container apart from the text a caller may also hand over. */
export const looksLikeArchive = (bytes: Uint8Array): boolean =>
	bytes.byteLength >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b;
