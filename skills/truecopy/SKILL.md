---
name: truecopy
description: Read tables out of a PDF, a paste, a CSV or an OCR page in TypeScript with the truecopy library, and check a reading before anything downstream acts on it - including rows a model extracted. Use when the task is to pull a table or records out of a document in JavaScript or TypeScript, to write or fix a document reader, to decide whether an extraction can be trusted, or to verify what an LLM pulled out of a PDF.
---

# Reading a document with truecopy

`truecopy` is the pipeline and the guarantees around a reader, not a parser. It
never learns what your documents mean: you name what a cell IS, it counts,
divides and compares. TypeScript, ESM, Node 20+, MIT, runs in a browser.

```sh
npm install truecopy                 # pdfjs-dist is an optional peer, PDFs only
npx truecopy a-document.pdf          # try it on a real file before writing any code
npx truecopy --json a-document.pdf   # the same reading as data: rows, pages, cut, findings
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

const { rows, pages, boundaries, warnings, findings, document } = await readTable(file);
```

One engine, three rulers, and the reading says which one it used: a PDF cuts on
the item x in points, a space-aligned paste on the character, a delimited file
on the field index. Prose and quoted files come back whole rather than
half-parsed.

**The one thing to get right: an empty `warnings` is NOT a promise that the
reading is right.** It means nothing looked wrong from the shape of the page.
Never phrase it to a user as "the extraction succeeded". Everything below exists
because of that distinction.

Three fields decide how you write the rest, and each has a wrong first instinct:

- **`findings`, never the sentences.** It is `warnings` with a `code` on it -
  `blank-page`, `no-column`, `thin-column`, `merged-column`, `pages-disagree` -
  plus the `page` and `column` it is about. Branch on the code. Matching the
  prose is what breaks the day a message is reworded.
- **`merged-column` is the one to act on first.** A thin column was invented by
  the cut and is usually harmless; a merged one was never separated, is filled on
  every row exactly like a good column, and every figure read from it is two
  figures glued. Do not publish that column: re-cut the page from
  `pages[i]`/`boundaries[i]`, or refuse it.
- **`pages`, when a page prints more than one table.** `rows` is flat and equals
  `pages.flat()`, which loses which page a row came from. A page printing two
  tables side by side carries two runs of headings, and walking the rows in
  order alternates between them: a row silently inherits the heading of the
  other column. `pages[i]` and `boundaries[i]` are the same page.
- **`keepPage`, on a long document.** `openDocument(file, { keepPage: (n) => n >= 313 })`.
  Opening a page is 99 % of what a reading costs, `maximumPages` cuts at the end
  only, and the kept pages keep their own numbers.

## When a row is not a record

Check this before writing any loop over `rows`. In a great many real documents
a record occupies two or three PRINTED rows - a street on one line, the figures
on the next, the postcode on a third - and one row per record undercounts by
three to five times, silently.

```ts
import { recordsFrom } from 'truecopy/records';

const { records, loose, findings } = recordsFrom(rows);
// records[i].rows are the row indices of one record, spine included
// loose are the rows it could not place: a cover page, a letterhead
```

Three things to know, and each has a wrong first instinct:

- **It says WHICH rows, never joins their text.** How to join half a name to
  its other half differs by document, so that stays yours.
- **`loose` is not a failure list.** Every row comes back either in a record or
  in `loose`, because a mechanism may be wrong about where a fragment belongs
  and is never allowed to be silent about a row.
- **`spine-not-sharp` means take over, not retry.** Some documents genuinely
  cannot be split by width - a record that leaves a column empty is as wide as
  a rich fragment. Pass `spineWidth` if your document tells you which; do not
  hunt for a threshold that makes one file land.

On a table where a record IS a row, it returns one record per row and changes
nothing. Measured on two real documents: 185 records from 185 instalments with
no cover-page row swallowed, and 61 records from 214 rows where a judged 65
buildings live.

## Finding the figure a document announces about itself

`selfCheck` needs what the document declares, and that figure is rarely where
you would put it: a heading with its amount to the right, a heading with prose
and a form reference before its amount, a unit announced once in a column
header.

```ts
import { labelledValues, columnOfHeader } from 'truecopy/labels';

// Every label, with the cells that could be its value, CLOSEST FIRST.
const found = labelledValues(rows, isTotal, isAmount);
found[0].values.map((cell) => readNumber(cell.raw, mark)); // -> SelfCheck.declared

// A unit announced once, in a header: the column its bare numbers live in.
const surface = columnOfHeader(rows, (cell) => /\(en m2\)/i.test(cell));
```

- **`isLabel` and `isValue` are yours.** This library does not know a total from
  a heading, and a list of words meaning "total" would be a domain shipped in a
  parser.
- **It hands back a LIST and will not pick.** That list is what
  `SelfCheck.declared` takes, and `discrepancyOf` keeps the one that fits, so the
  document decides instead of a rule about how far a number sits from a heading.
- **A search stops at the next label**, which is not a detail: two headings
  printed close together otherwise let the second one's figure count for the
  first as well, and a doubled total refuses a reading that was right.
- **`columnOfHeader` returns `null` when SEVERAL columns match**, not the first.

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
go through the same check as rows a reader produced. That is one call:

```ts
import { checkExtraction, openDocument } from 'truecopy';

const document = await openDocument(file);
const result = checkExtraction(document, {
	records: rowsFromTheModel,
	amountOf: (row) => row.amount,
	// What the DOCUMENT declares about the same total, read from the document.
	// An empty list is allowed and is not a pass: the result then says, in as
	// many words, that nothing was checked against.
	declared: [declaredTotal],
	unit: 'EUR',
	describe: (row) => row.label
});

result.verdict; // 'read' | 'needs-review' | 'refused'
result.discrepancy; // what is missing, against what the document announced
result.rowsToReview; // rows carrying a figure the document contains NOWHERE
```

It does two things that are easy to get wrong by hand: it rounds the sum to the
document's precision, because `discrepancy` compares a float subtraction against
exactly zero and a cent-sized residue turns a correct reading into
`needs-review`; and it reads the document's figures with the document's own
decimal mark, so a page printing `48,275,477.16` in a French report is not
treated as containing none of the numbers on it.

This does not compare the model against the truth. It compares it against what
the document says about itself, which is the only check that can call a reading
wrong rather than odd. Two errors that cancel out still pass.

Reach for `readDocument` above instead when the reading is yours to write and
has to be repeated: it takes the three methods and drives them.

## Traps that cost an afternoon

- Column boundaries come from the spread of x over the WHOLE page
  (`boundariesFromRecurrence`), never from the gap between two neighbours on one
  row: that gap glues cells together as soon as they touch.
- `findRowAnomalies` returns `null` below `minimumRows` (5). Too few rows to
  learn anything, and saying nothing beats learning from nothing. Handle the
  `null`.
- `readNumber('1,234')` guesses, and a guess is what it is: 1234 in Luxembourg,
  1.234 in Paris. On a whole document, ask it once - `decimalMarkOf(document.text)` -
  and pass the answer, `null` included. A report translated into another
  language keeps its figures and changes their punctuation, and that is the case
  where guessing corrupts every amount at once.
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
