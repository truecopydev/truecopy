/*
 * The passage a value was read from, found again in the document.
 *
 * A document read once, offline, into values that are then served for months
 * cannot re-run its extraction per reader: the reading is a build artefact and
 * the reader never sees it. What proves such a value is not the extraction. It
 * is the SENTENCE, stored nowhere, found again in the document at display time
 * from a short ANCHOR kept beside the value. A value cannot then drift from the
 * text, because nothing recopied the text; and the day the document is revised,
 * the anchor stops falling and the absence is the alarm.
 *
 * Two applications wrote this separately before it was here, on document
 * families that have nothing in common - a planning code printed as a PDF, a
 * collective agreement published as marked-up text - and the second lost a
 * lesson the first had already paid for. That is what says it belongs here.
 *
 * THE LESSON, AND IT IS THE WHOLE MODULE. A paragraph quoted alone is exact and
 * says nothing. `- under two years of service: one month` loses `- for
 * technicians`, which is half the rule, and loses the sentence above it, which
 * is the other half; quoted alone it reads as everyone's notice period. So a
 * passage is never one paragraph: it is the paragraph, its ANCESTORS, and, when
 * it announces a list, THE LIST. The symmetric mistake costs as much: a heading
 * that opens a list and is quoted without it - `the employer tops up:` followed
 * by two items - says that something is topped up and never what.
 *
 * WHAT STAYS THE CALLER'S, and both halves were measured to be judgement rather
 * than mechanics. How the passage is joined for display, and how much of it is
 * cropped to fit a screen: the answer differs per surface and per document
 * family, and cropping is where a citation stops proving what it displays. And
 * the masking a domain needs before its figures can be counted - a planning
 * code writes `50 m2`, which announces fifty and not two. Mask both sides
 * yourself, WITHOUT CHANGING LENGTH, and the spans returned here stay indices
 * into the string you passed.
 *
 * This module says WHERE the passage is and WHETHER it carries the figures the
 * value announces. What that is worth is yours.
 */

import { carriesNumber } from './cite.js';
import { findNumbers, readNumber, type DecimalMark } from './notation.js';

/**
 * How the source separates its paragraphs, and how it marks their depth.
 *
 * NEITHER IS GUESSED, because both mistakes are silent. Reading depth off a
 * source that does not mark it returns a passage with no ancestors, which is
 * the exact failure this module exists to prevent - and it returns it looking
 * like a success.
 *
 * `units` says where a paragraph ends.
 * - `lines` trusts the line breaks the source printed. Anything already cut
 *   into paragraphs is this: marked-up text, a `.docx`, a text layer that kept
 *   its structure.
 * - `prose` cuts a run-on blob itself, on numbering and on sentence ends. A
 *   regulation extracted from a PDF arrives as one paragraph of fourteen
 *   hundred characters; looking for a full stop followed by a capital finds no
 *   cut at all in `- zone UA: 9 metres. - sector UAa: 12 metres.`, so the
 *   numbering and the bullets are cut points too.
 *
 * `depth` says who is under whom.
 * - `dashes` counts the hyphens the source puts in front of a line: one for a
 *   first level, two for a second, none for a top-level paragraph. A source
 *   that marks its own structure is read, never second-guessed.
 * - `outline` infers it from typography, for a source that marks nothing: a
 *   bullet is always a child of what precedes it, a number is as deep as it has
 *   components (`1.2-` is two), a line ending in a colon opens what follows,
 *   and a line ending in a full stop is closed - it heads nothing.
 *
 * THE TWO ARE INDEPENDENT: a PDF text layer keeps its line breaks and marks
 * nothing (`lines` + `outline`), a blob may still carry hyphens.
 */
export interface PassageOptions {
	/** Default `lines`: never invent a boundary the source did not print. */
	readonly units?: 'lines' | 'prose';
	/** Default `outline`: the reading that assumes the source marks nothing. */
	readonly depth?: 'dashes' | 'outline';
}

/**
 * How far something reaches in a string, as indices into the string as passed.
 *
 * Not `Span`, which `labels` already uses for another thing: that one carries
 * the text it found, this one carries only the two ends, because what sits
 * between them is a stretch of the caller's own string.
 */
export interface Extent {
	readonly start: number;
	/** Exclusive, so `text.slice(start, end)` is what was found. */
	readonly end: number;
}

/**
 * A passage, in the three parts a caller has to be able to tell apart.
 *
 * Kept apart rather than joined because the join is a display decision and the
 * PARTS are not: a surface too narrow for the whole passage sheds ancestors
 * from the outside in, and it can only do that if it knows which lines they
 * are. Joining here would make every caller cut a string back up.
 */
export interface Passage {
	/** The ancestors that say what the line is about, outermost first. */
	readonly heading: readonly string[];
	/** The paragraph the anchor fell in. */
	readonly line: string;
	/** The list the line opens, when it opens one. Empty when it opens none. */
	readonly opened: readonly string[];
}

/**
 * The shape an anchor is matched in.
 *
 * Three tolerances. Curly apostrophes and long dashes, because an extractor
 * hands both forms back FROM THE SAME DOCUMENT - one planning code writes
 * `l'unite fonciere` and `l’unite fonciere` two lines apart - so an anchor
 * demanding the exact sign would fall one time in two, and the page would
 * report a perfectly present rule as unreadable. And runs of horizontal
 * whitespace, because the cut inserts and swallows spaces.
 *
 * NEITHER ACCENTS NOR CASE, which is not the choice `cite` makes and is
 * deliberate: an anchor is chosen by whoever compiled the value, out of the
 * document itself, so it can be required to match letter for letter. Folding
 * accents would widen a short anchor until it matches in two places, and the
 * second place is another rule.
 *
 * LINE BREAKS SURVIVE UNDER `lines` AND NOT UNDER `prose`, and that is the
 * whole difference: where the source cut its own paragraphs the break carries
 * the structure, and where it did not it is an artefact of the page width that
 * would cut anchors in half.
 */
export function foldAnchor(text: string, options: PassageOptions = {}): string {
	/* The dash block is written as escapes because this repository refuses a
	   typographic dash in its own prose, and its check does not read regexes. */
	const folded = text.replace(/['‘‛’ʼ]/g, "'").replace(/[\u2010-\u2015\u2212\uFF0D]/g, '-');
	if (options.units === 'prose') return folded.replace(/\s+/g, ' ').trim();
	return (
		folded
			.replace(/\r\n?/g, '\n')
			.replace(/[^\S\n]+/g, ' ')
			/* ` ?` and not ` *`: the line above has just brought every run of
			   horizontal whitespace down to one, so at most one can remain on either
			   side of a break. ` *` describes the same strings and backtracks in
			   super-linear time on a long run of spaces that never reaches a break. */
			.replace(/ ?\n ?/g, '\n')
			.trim()
	);
}

/** A paragraph, its depth, and where its children start. */
interface Unit {
	readonly text: string;
	readonly level: number;
	/**
	 * The level a following paragraph must reach to be UNDER this one, when this
	 * one opens a list. `Infinity` when it opens none.
	 *
	 * It does not follow from `level`: a bullet that announces is passed under
	 * its children, which are bullets like itself, while the bullet beside it
	 * stays out.
	 */
	readonly below: number;
}

/* A bullet, including the private-use glyphs a font substitution leaves behind
   in a text layer. They carry no meaning of their own and are dropped from the
   text, but only AFTER the depth is read: read the other way round, a bullet in
   a symbol font looks like a closed sentence, so its line loses its heading. */
const BULLETS = '\\u{E000}-\\u{F8FF}•▪·◦‣►';
const MUTE = /^[\u{E000}-\u{F8FF}]+\s*/u;
const NUMBERING = '\\d+(?:\\.\\d+)*\\s?[-.)](?=\\s)';
const OPENS_A_UNIT = new RegExp(`(?<=^|\\s)(?:${NUMBERING}|-(?=\\s)|[${BULLETS}]+\\s?)`, 'gu');
const IS_BULLET = new RegExp(`^(?:-\\s|[${BULLETS}])`, 'u');
const IS_NUMBERED = new RegExp(`^${NUMBERING}`, 'u');
/* A full stop, a space and a capital. Not `\b`, and not a lookbehind on the
   letter alone: an initial closes nothing, and neither does the dot of a
   number. `\p{Lu}` and not a range of Latin capitals, which would take in the
   multiplication sign and leave out every capital past the first accents. */
const SENTENCE_END = /^\.\s\p{Lu}/u;
const AN_INITIAL = /(?:^|\s)\p{Lu}$/u;

/**
 * The depth of a line, on a source that marks nothing.
 *
 *   99      a bullet: always a child of what precedes it
 *   1 to 3  a number, by how many components it has (`1.2-` is two)
 *   0       a line that ANNOUNCES a list, so one ending in a colon
 *   -1      a closed sentence: never a heading, and it stops the climb
 *
 * A TRAILING COLON LIFTS A LINE ABOVE WHAT IT ANNOUNCES whatever its own shape.
 * One planning code opens an article on a bullet, `In every sector:`, followed
 * by two bullets of the same rank: without this rule both distances quote
 * without the only clause that says where they apply.
 */
function byOutline(text: string): { level: number; below: number } {
	const announces = text.endsWith(':');
	if (IS_BULLET.test(text)) return { level: announces ? 98 : 99, below: announces ? 99 : Infinity };
	const head = IS_NUMBERED.exec(text);
	if (head !== null) {
		const depth = head[0].replace(/\s?[-.)]$/, '').split('.').length;
		return { level: announces ? depth - 1 : depth, below: announces ? depth + 1 : Infinity };
	}
	return { level: announces ? 0 : -1, below: announces ? 1 : Infinity };
}

/**
 * The depth of a line, on a source that marks it with hyphens.
 *
 * THE HYPHENS OF ONE LEVEL ARE SOMETIMES SPACED APART - `- -` rather than `--`
 * - WITHIN ONE DOCUMENT. Counting `-+` in one run therefore ranks the spaced
 * form level with the line that carries it, the parent stops climbing, and the
 * passage says how much without saying for whom. The hyphens are counted, not
 * their contiguity.
 *
 * A marked source needs no announcement to have children: its depth IS the
 * structure, so `below` is the next level down, always.
 */
function byDashes(text: string): { level: number; below: number } {
	/* A class, not a repeated group. `(?:-\s*)+` describes the same strings and
	   backtracks in super-linear time on a line of hyphens, which is exactly what
	   a rule of a table renders as. The prefix is taken whole, then counted, and
	   both are measured by what a replacement REMOVES: a match that always
	   succeeds still hands back a nullable, and a fallback nothing can reach is a
	   branch no test will ever cover. */
	const prefix = text.slice(0, text.length - text.replace(/^[- \t]*/u, '').length);
	const level = prefix.length - prefix.replace(/-/gu, '').length;
	return { level, below: level + 1 };
}

/**
 * The text, cut into paragraphs with their depth.
 *
 * The depth is read on the RAW line and the mute glyphs are dropped after, for
 * the reason written on `BULLETS`.
 */
function units(text: string, options: PassageOptions): Unit[] {
	const depth = options.depth === 'dashes' ? byDashes : byOutline;
	const raw = options.units === 'prose' ? proseUnits(text) : text.split('\n');
	return raw
		.map((line) => ({ text: line.replace(MUTE, '').trim(), ...depth(line.trim()) }))
		.filter((unit) => unit.text !== '');
}

/** A run-on blob, cut on its numbering, its bullets and its sentence ends. */
function proseUnits(text: string): string[] {
	const cuts = new Set<number>([0]);
	/* THE FULL STOP OF A NUMBER IS NOT A SENTENCE END. `1.2. Along other roads`
	   carries both shapes at once: without this reservation the number leaves in
	   a paragraph of its own and the passage opens on `Along other roads`, having
	   lost which paragraph it comes from. */
	const inNumbering = new Set<number>();
	for (const found of text.matchAll(OPENS_A_UNIT)) {
		cuts.add(found.index);
		for (let i = found.index; i < found.index + found[0].length; i += 1) inNumbering.add(i);
	}
	for (let i = 0; i < text.length - 2; i += 1) {
		if (inNumbering.has(i) || AN_INITIAL.test(text.slice(Math.max(0, i - 2), i))) continue;
		if (text[i] === '.' && SENTENCE_END.test(text.slice(i, i + 3))) cuts.add(i + 2);
	}
	const order = [...cuts].sort((a, b) => a - b);
	return order.map((from, n) => text.slice(from, order[n + 1] ?? text.length));
}

/**
 * The passage that carries an anchor: its paragraph, its ancestors, and the
 * list it opens.
 *
 * `null` when the anchor no longer falls. THAT IS THE ALARM AND NOT AN ERROR:
 * it is how a document revised under a stored reading announces itself, and the
 * surface says so rather than displaying a value with no sentence.
 *
 * THE ANCESTORS ARE THE NEAREST PRECEDING LINE OF EACH SHALLOWER LEVEL, from
 * the outside in, and the climb stops at the first line that heads nothing - a
 * top-level paragraph is the context of what follows it, and what precedes IT
 * is another rule, not more context.
 *
 * ONLY WHAT THE LINE OPENS COMES WITH IT, never its neighbour. Quoting the
 * paragraph beside it puts the next sector's twelve metres inside the citation
 * of a nine, and nothing then says which of the two the displayed value proves.
 */
export function anchoredPassage(
	text: string,
	anchor: string,
	options: PassageOptions = {}
): Passage | null {
	const sought = foldAnchor(anchor, options);
	if (sought === '') return null;
	const parts = units(foldAnchor(text, options), options);
	const at = parts.findIndex((unit) => unit.text.includes(sought));
	const line = parts[at];
	if (line === undefined) return null;

	const heading: string[] = [];
	let ceiling = line.level;
	for (let i = at - 1; i >= 0 && ceiling > 0; i -= 1) {
		const above = parts[i];
		if (above === undefined || above.level < 0) break;
		if (above.level >= ceiling) continue;
		heading.unshift(above.text);
		ceiling = above.level;
	}

	const opened: string[] = [];
	if (Number.isFinite(line.below)) {
		for (let i = at + 1; i < parts.length; i += 1) {
			const child = parts[i];
			if (child === undefined || child.level < line.below) break;
			opened.push(child.text);
		}
	}
	return { heading, line: line.text, opened };
}

/**
 * What a domain writes instead of digits, and it is the localisation point.
 *
 * A REGULATION WRITES ITS SMALL NUMBERS OUT. `One space per dwelling` does
 * carry the 1 of `1 space`, and ignoring that accuses the most faithful
 * citation of the batch of missing its figure. Which words those are is a
 * property of the language the document is written in, so it arrives from the
 * caller, the way `readDate` takes its notation.
 *
 * `decimal` is the document's own mark, from `decimalMarkOf(document.text)`.
 * Left out, each figure is read on its own, which is a guess and inherits a
 * guess's failures.
 */
export interface FigureOptions {
	readonly decimal?: DecimalMark | null;
	/** Word to figure, lower case: `one` to `1`. Matched whole, case-insensitively. */
	readonly spelled?: ReadonlyMap<string, string>;
}

/**
 * Every figure a value announces, kept AS THE VALUE WRITES IT.
 *
 * The written form is what a lookup needs: `1 655` and `1655` are one figure
 * written twice, and only the document's own mark tells which comma is a
 * decimal one. Two forms of the same figure count once - a value repeating
 * itself does not have to be proved twice.
 */
function announced(value: string, options: FigureOptions): string[] {
	const figures = new Map<number, string>();
	const keep = (raw: string): void => {
		const read = readNumber(raw, options.decimal);
		if (read !== null && !figures.has(read)) figures.set(read, raw);
	};
	for (const found of findNumbers(value)) keep(found.raw);
	for (const [word, figure] of options.spelled ?? []) {
		if (wordAt(value, word) >= 0) keep(figure);
	}
	return [...figures.values()];
}

/**
 * Where a word is written out, whole. `-1` when it is not.
 *
 * The bounds are `\p{L}` and not `\b`, because `\b` sits between a letter and
 * an accent on some engines and inside a word is exactly where a small word
 * must not match: `un` is a figure, `une` in `chacune` is not.
 */
function wordAt(text: string, word: string): number {
	const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	return new RegExp(`(?<!\\p{L})${escaped}(?!\\p{L})`, 'iu').exec(text)?.index ?? -1;
}

/** The words this domain writes for one figure, compared by value and not by sign. */
function wordsFor(figure: string, options: FigureOptions): string[] {
	const sought = readNumber(figure, options.decimal);
	return [...(options.spelled ?? [])]
		.filter(([, spelled]) => readNumber(spelled, options.decimal) === sought)
		.map(([word]) => word);
}

/** Where one announced figure is first READ in the source, in any of its forms. */
function firstReading(source: string, figure: string, options: FigureOptions): Extent | null {
	let best: Extent | null = null;
	const keep = (span: Extent): void => {
		if (best === null || span.end < best.end) best = span;
	};
	const sought = readNumber(figure, options.decimal);
	for (const found of findNumbers(source)) {
		if (readNumber(found.raw, options.decimal) === sought) {
			/*
			 * THE TOKEN IS WIDER THAN THE FIGURE, DELIBERATELY, and a span must not
			 * inherit that. `findNumbers` takes what sits in FRONT of the digits -
			 * the blank of a gutter, the apostrophe some notations group thousands
			 * with - because that is how it tells a group of thousands from two
			 * numbers. Kept here, the start would point at the space before the
			 * figure, and the distance to the proof would read shorter than the one
			 * an eye travels.
			 */
			const lead = found.raw.length - found.raw.replace(/^[\s']+/u, '').length;
			keep({ start: found.index + lead, end: found.index + found.raw.length });
		}
	}
	for (const word of wordsFor(figure, options)) {
		const at = wordAt(source, word);
		if (at >= 0) keep({ start: at, end: at + word.length });
	}
	return best;
}

/**
 * The figures a value announces that its source does not carry.
 *
 * THE CHECK THAT SEPARATES A CITATION FROM A DECORATION. An anchor that still
 * falls proves that the paragraph exists; it proves nothing about what the
 * paragraph SAYS. Measured on one planning code: a rule displayed as `35 m from
 * the axis` sat beside a sentence about the same road that reads `a minimum
 * setback of 10 metres` - anchor green, value invented, and no mechanical check
 * saw it until this one.
 *
 * Empty means every announced figure is carried. A value announcing no figure
 * at all - `At the building line`, `Not regulated`, and that is a third of one
 * measured corpus - announces nothing to miss, and is empty too: its proof is
 * its anchor, not a figure.
 */
export function missingFigures(
	source: string,
	value: string,
	options: FigureOptions = {}
): readonly string[] {
	return announced(value, options).filter(
		(figure) =>
			!carriesNumber(source, figure, options.decimal) &&
			wordsFor(figure, options).every((word) => wordAt(source, word) < 0)
	);
}

/**
 * How far into the source a reader travels before every announced figure is in
 * view.
 *
 * `null` TWICE OVER, and `missingFigures` tells the two apart: when the value
 * announces no figure at all, and when it announces one the source does not
 * carry. Neither has a span to point at, and treating either as a distance of
 * zero would report a proof that is on screen because it does not exist.
 *
 * WHAT IT IS FOR, AND IT IS NOT A CURIOSITY. A citation is bounded twice - by
 * the string a check reads, and by the box a screen draws - and the two do not
 * talk. Measured on one served corpus: of 610 values whose citation did carry
 * the announced figure, 331 put it past the cut of a phone screen, and the gate
 * called all 331 correct. The distance to the proof is what a caller crops
 * against; the number of characters its own surface shows is the caller's, and
 * a threshold measured on one screen is worth nothing on another.
 *
 * BOTH ENDS ARE RETURNED BECAUSE BOTH ARE USED. The end says what the screen
 * has to reach; the start says what a crop must not eat. Keeping only the end
 * moves the start of `2 spaces per 50 m2` past its 2: the figure is won on the
 * screen and lost in the text.
 *
 * EACH FIGURE COUNTS AT ITS FIRST READING, the one an eye finds, and the WORST
 * of them decides: a citation showing the 1 of `1 space per 40 m2` without its
 * 40 proves half of what it displays.
 */
export function proofSpan(
	source: string,
	value: string,
	options: FigureOptions = {}
): Extent | null {
	const figures = announced(value, options);
	if (figures.length === 0) return null;
	let start = Infinity;
	let end = -1;
	for (const figure of figures) {
		const span = firstReading(source, figure, options);
		if (span === null) return null;
		start = Math.min(start, span.start);
		end = Math.max(end, span.end);
	}
	return { start, end };
}
