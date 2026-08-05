---
name: truecopy
description: Read tables out of a PDF, a paste, a CSV or an OCR page in TypeScript with the truecopy library, and check a reading before anything downstream acts on it - including rows a model extracted. Use when the task is to pull a table or records out of a document in JavaScript or TypeScript, to write or fix a document reader, to decide whether an extraction can be trusted, or to verify what an LLM pulled out of a PDF.
---

# Reading a document with truecopy

`truecopy` is the pipeline and the guarantees around a reader, not a parser. It
never learns what your documents mean: you name what a cell IS, it counts,
divides and compares. TypeScript, ESM, Node 20+, MIT, runs in a browser.

```sh
npm install truecopy          # pdfjs-dist is an optional peer, PDFs only
npx truecopy a-document.pdf   # try it on a real file before writing any code
```

## Decide first whether this is the right tool

Reach for it when a program turns a document somebody dropped into records that
something downstream will act upon, and being WRONG matters more than being
fast.

Do not reach for it for these, and do not try to add them - they are refusals,
not gaps:

- domain meaning. It has never heard of an invoice, a date or a debit.
- per-issuer configuration. A layout it reads badly is a defect or a documented
  limit, never a preset.
- parsing CSV properly. It splits on tab, semicolon, pipe or comma only where
  the field count recurs line after line, and hands a quoted file back WHOLE
  with a warning. Use a real CSV library for CSV.
- validation. `schemaOf` bounds a reading; richer belongs to zod or valibot,
  and `validateWith` accepts any Standard Schema.
- opening formats. PDFs go through `pdfjs-dist`. No OCR engine, no spreadsheet,
  no office format.
- a filesystem, a network or a clock you did not pass in.

## The two-line path

```ts
import { readTable } from 'truecopy';

const { rows, boundaries, warnings, document } = await readTable(file);
```

One engine, three rulers, and the reading says which one it used: a PDF cuts on
the item x in points, a space-aligned paste on the character, a delimited file
on the field index. Prose and quoted files come back whole rather than
half-parsed.

**The one thing to get right: an empty `warnings` is NOT a promise that the
reading is right.** It means nothing looked wrong from the shape of the page.
Never phrase it to a user as "the extraction succeeded". Everything below exists
because of that distinction.

## When the rows have to be trusted

`readDocument(document, reader)` returns
`{ verdict, reading, selfCheck, discrepancy, refusal, rowsToReview }` where
`verdict` is `'read' | 'needs-review' | 'refused'`.

Three methods are REQUIRED. Do not stub them - stubbing them is the exact dodge
the library exists to catch:

- `read(document)` -> `{ records, header }`. `header` carries what the document
  says about ITSELF (a declared total, a closing balance). Without it there is
  nothing to check against.
- `selfCheck(document, reading)` -> `{ declared: number[], read: number, unit: string }`
  or `{ nothing: 'why this document declares nothing' }`. Saying "nothing" costs
  a sentence on purpose.
- `rowsToReview(document, reading)` -> `ReviewableRow[]`. Takes the DOCUMENT,
  because a correction screen must show the rows that were dropped, and those
  are not in the reading.

Two are optional and already have safe defaults. Leave them out rather than
stub them: `repair` defaults to no repair, `refuse` defaults to refusing a
reading that produced no record.

The pipeline enforces one rule: **a reading that contradicts its document never
comes back as `read`.**

## Checking rows that came from a model

Nothing in the pipeline asks where a reading came from, so rows an LLM returned
go through the same check. Have `read` hand back the model's rows, and let
`selfCheck` confront their sum with what the document declares.

```ts
const written = new Set(findNumbers(document.text, 2).map((found) => found.value));

const result = readDocument(document, {
	read: () => ({ records: rowsFromTheModel, header: { declared } }),
	selfCheck: (_document, reading) => ({
		declared: [reading.header.declared],
		// ROUND to the document's precision. `discrepancy` is a float subtraction
		// compared against exactly zero, so a cent-sized residue turns a correct
		// reading into `needs-review`.
		read: Math.round(reading.records.reduce((sum, row) => sum + row.amount, 0) * 100) / 100,
		unit: 'EUR'
	}),
	// The rows a person should confirm: those carrying a figure the document
	// does not contain anywhere. Catches a value invented outright.
	rowsToReview: (_document, reading) =>
		reading.records
			.filter((row) => !written.has(row.amount) && !written.has(-row.amount))
			.map((row) => ({ raw: row.label, fields: { ...row } }))
});
```

This does not compare the model against the truth. It compares it against what
the document says about itself, which is the only check that can call a reading
wrong rather than odd. Two errors that cancel out still pass.

## Traps that cost an afternoon

- Column boundaries come from the spread of x over the WHOLE page
  (`boundariesFromRecurrence`), never from the gap between two neighbours on one
  row: that gap glues cells together as soon as they touch.
- `findRowAnomalies` returns `null` below `minimumRows` (5). Too few rows to
  learn anything, and saying nothing beats learning from nothing. Handle the
  `null`.
- The pdf.js worker URL is NOT resolved for you. Pass `workerSrc` in a browser,
  or leave it out and pdf.js runs inline, which is what makes the chain testable
  in Node.
- Regular expressions run over whole documents line by line. Bound every
  quantifier.
- Reach for `explainDocument(document, { signature, roles })` FIRST when a
  reading comes out wrong. It prints the cut, what each column holds and which
  rows were dropped, as text that goes into a terminal, a CI log or a test.

## Where the rest is

Every documentation page is served as markdown at the same path with `.md`, so
fetching one costs a fraction of the HTML page:

- <https://truecopy.dev/llms.txt> - the map, one line per page
- <https://truecopy.dev/docs/quickstart.md> - two lines to rows, then the three
  steps that make a reading check itself
- <https://truecopy.dev/docs/contract.md> - the reader interface in full
- <https://truecopy.dev/docs/verify.md> - the six checks that catch a wrong table
- <https://truecopy.dev/docs/verify-llm-extraction.md> - the section above, in full
- <https://truecopy.dev/docs/api.md> - every export, by entry point
- <https://truecopy.dev/llms-full.txt> - all of it in one file

Each module is also its own entry point (`truecopy/table`, `truecopy/layout`,
`truecopy/notation`, `truecopy/contract`, `truecopy/kit`, ...) and the package is
side-effect free, so importing one costs one.
