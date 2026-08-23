# truecopy

**Extract tables from a PDF in TypeScript, and know when the extraction is wrong.**

Turn a document into rows, and refuse the readings you cannot trust. A PDF, a paste, a CSV, an OCR page: one engine reads all of them.

[![npm](https://img.shields.io/npm/v/truecopy)](https://www.npmjs.com/package/truecopy)
[![gate](https://github.com/truecopydev/truecopy/actions/workflows/gate.yml/badge.svg)](https://github.com/truecopydev/truecopy/actions/workflows/gate.yml)
[![license](https://img.shields.io/npm/l/truecopy)](LICENSE)

A parser that returns a plausible-looking table from a document it misread is worse than one that returns nothing, because nobody checks a table that looks right. truecopy is the pipeline around whichever reader you write: the door bytes come through, the checks that catch a wrong reading, a way to **see** what it decided, and a conformance kit that goes red the day the reading stops being honest.

## Try it on your worst document, right now

```sh
npx truecopy a-statement.pdf
```

No install, no project, no line of code. It prints the cut it made, what each column holds, how often it is filled, and then, on its own, **what it could not vouch for**.

```
page 1 - cut at 68, 229, 356, 411, 490

what this reading cannot vouch for:
  - column 5 of page 1 is filled on only 2% of its rows - the cut may have invented it
  - the pages disagree on how many columns there are (6 on 2, 7 on 1)
```

```sh
npm install truecopy
```

## Rows, in two lines

```ts
import { readTable } from 'truecopy';

const { rows, warnings, findings } = await readTable(file);
// rows     [['02/05/2026', 'CARTE AMAZON', '12,40'], …]
// warnings ['column 3 of page 2 is filled on only 8% of its rows - the cut may have invented it']
// findings [{ code: 'thin-column', page: 2, column: 3, shareFilled: 0.08, message: '…' }]
```

No `kindOf`, no thresholds, no roles. If you only want the cells, destructure `rows` and go.

`file` is whatever was dropped. **The cut does not care which ruler measured the page**, so the same two lines read a PDF, a table pasted out of one, a CSV and a TSV:

| What was dropped                        | Where a column starts                                     |
| --------------------------------------- | --------------------------------------------------------- |
| a PDF                                   | the item's **x**, in points                               |
| a table pasted with spaces              | the **character** the field starts at                     |
| a file written with a delimiter         | the field's **index**: a CSV lines nothing up             |
| prose, or a file that quotes its fields | nowhere: the row comes back whole, and `warnings` says so |

That last line is the rule and not the exception. A quoted CSV field may hold the delimiter itself, so splitting on it anyway would shift every column after it. truecopy hands the rows back uncut instead, because half-parsing is the failure this library exists to prevent.

`explainDocument` names the ruler, so a cut is never a bare list of numbers: `cut at 100, 290` on a page, `cut at characters 7, 22` on a paste, `cut on the delimiter` on a CSV, where the columns _are_ the fields and their indices would tell you nothing.

The second field is why this is not just another extractor. **An empty `warnings` is not a promise that the reading is right**: it means nothing looked wrong from the shape of the page, which is a much smaller claim. Every warning is computed without knowing anything about your document: a page with no columns at all, a column that is almost always empty, pages cut differently from one another, a blank page in the middle.

`findings` is that same list with a `code` on it, plus the page and the column it is about. A person reads the sentence; a program branches on the code, and never on English that could be reworded tomorrow.

When the rows have to be **trusted** (when something downstream acts on them), the rest of this page is how.

**A complete reader that runs, in one file and one command:**

```sh
node example/read-a-statement.mjs
```

[`example/read-a-statement.mjs`](example/read-a-statement.mjs) builds a real PDF, opens it, prints what the reading decided, and drives it through the contract. Nothing in it is stubbed, and it needs no document from you: it makes its own.

## See what the reading decided

The first thing you need when a reading comes out wrong is not a better parser. It is knowing **which of the three things** broke: the document is odd, the cut into columns is wrong, or your rule is wrong. Each calls for a different fix.

```ts
import { openDocument, explainDocument } from 'truecopy';

const document = await openDocument(file);

console.log(
	explainDocument(document, {
		signature: {
			kindOf: (cell) => (isDate(cell) ? 'date' : isAmount(cell) ? 'amount' : 'text'),
			thresholds: {
				date: { share: 0.6, emptyIsAnomalyAbove: 0.7 },
				amount: { share: 0.6 },
				text: { share: 0.6 }
			}
		},
		roles: [
			{ role: 'when', kind: 'date', minimum: 0.6, take: 'best' },
			{ role: 'money', kind: 'amount', minimum: 0.6, take: 'each' }
		]
	})
);
```

```
truecopy - statement-2026-05.pdf
pdf, 1 page(s), 6 row(s)

page 1 - cut at 100, 290

3 column(s), 6 row(s)

col  kind        filled  role
  0  date           83%  when
  1  text          100%  -
  2  amount        100%  money

   1   02/05/2026 | CARTE 28/04 AMAZON EU> | 12,40
   2   03/05/2026 | VIR SEPA LOYER MAI     | 750,00
   3   05/05/2026 | CARTE 03/05 SNCF CONN> | 68,00
   4   09/05/2026 | PRLV EDF               | 91,32
   5   12/05/2026 | CARTE 11/05 LE BOULAN> | 7,90
   6 !            | TOTAL DES DEBITS       | 929,62   <- column 0 (date) is empty
```

Text, not an image: it goes into a terminal, a CI log, a bug report, a test's expected value. It needs no canvas and no headless browser.

## No configuration per issuer

The usual way to read a table is to tune settings until one issuer's layout comes out right. It works, and it stops working at the second issuer: every new bank, every new format, every redesign is another block of settings that only its author understands.

truecopy learns the table from the table. A column full of dates **is** the date column, whatever its header says; a row that breaks what every other row does is a total, a balance, a footer.

```ts
import { findRowAnomalies } from 'truecopy/signature';

// Which rows fall outside the signature the table itself sets.
const anomalies = findRowAnomalies(rows, signature);
```

It reads no label, so it survives an issuer you have never seen. A list of forbidden words only recognises yesterday's documents.

### Where that stops, measured

What reads no label is the **judgement**: which rows belong to the table, which column holds what. The **cut** is a different problem, and it is the one that still needs help.

Measured on a real bank statement whose header labels were deliberately hidden: the page-wide spread of x proposed **twelve** columns where the table had five, because it counts the letterhead, the address block and the footer as evidence of where a column starts. Cut on the rows that share the table's shape instead (the ones carrying a date and an amount), it proposed five, and three of the five roles were named from content alone.

**`boundariesFromRecurrence` is the general answer**, and `readTable` uses it: keep only the x that come back row after row, because a real column's left edge recurs and a word inside a description does not. On the statement above it took the cut from twelve columns to seven, and named the rest as thin. Where the page gives you something better to trust (a header row, a rule), `boundariesFromAnchors` takes it.

And whatever you do, keep the self-check. On that same statement the reading still came back **wrong**, and the only reason that was visible is that the sum of the rows did not match the balances the document itself declares.

**That is the honest shape of this library.** It does not promise to read an unknown layout correctly. It promises to tell you when it did not.

## Every value knows where it came from

A value you cannot point at is a value nobody can check. Handed a list of figures, a person has to hunt through the document again; handed a **place**, they jump to it, and that difference is what makes a correction screen used or abandoned.

```ts
import { cellsOf, placesOf } from 'truecopy/layout';

const cells = cellsOf(page); // cells[3][1] is what the fourth row holds
const places = placesOf(page); // places[3][1] is where to find it
// { page: 1, x: 430, y: 700, width: 30 }
```

The two are laid out identically, so they are read together. A cell nothing fell into has **no place**: `null`, not a rectangle of nothing. `ReviewableRow.where` carries the same thing for the rows a person is asked to confirm.

No height, because none is known: a text item carries no height here, and inventing a line spacing would draw a rectangle the document never had.

## Notation is not domain

That `1 234,50` and `1,234.50` are the same quantity, that `(123,45)` is negative and so is `123,45-`, that `25/01` is a day before a month here and after it there: none of that says anything about banks or invoices. It says how the page was typeset, and it is the part everybody rewrites and everybody gets wrong once.

```ts
import { readNumber, findNumbers, readLeadingDate } from 'truecopy/notation';

readNumber('27800.50'); // 27800.5   - not 2 780 050
readNumber('(123,45)'); // -123.45   - the accounting negative
readNumber("1'234.56"); // 1234.56

// Never starts a match inside another number: a date glued to a figure
// reads as one figure, not as "026 300,00".
findNumbers('30/05/2026 300,00', 2); // [{ value: 300, ... }]

readLeadingDate('25 janv. 2026 GROCERIES', { dateOrder: 'DMY', months });
// { date, length: 13 }  - so the caller strips it and keeps the wording
```

It says `null` rather than guess. On figures somebody will act upon, a refusal costs a correction and a wrong reading costs a decision.

**None of this needs a PDF.** `truecopy/notation` takes strings, so an API field, an HTML scrape or a pasted email gets the same reading as a page, and `pdfjs-dist` is never loaded. It is the layer worth reaching for before writing a pattern of your own - because the pattern everybody writes instead has a defect nobody sees:

```ts
import { accentFree } from 'truecopy/notation';

// `\w` is [A-Za-z0-9_] in JavaScript, whatever the document is written in.
/d[ée]tach\w+/.test('détaché'); // false - the suffix is an accented letter
/d[ée]tach\p{L}*/u.test('détaché'); // true
accentFree('Détaché'); // 'detache' - or fold first and compare plainly
```

Nothing fails there: the pattern compiles, runs, and returns a plausible fraction of the matches, which then reads as a fact about the documents rather than a defect in the rule.

## A refusal you can say in your own language

```ts
try {
	await openDocument(file);
} catch (error) {
	if (error instanceof UnreadableDocument) {
		// 'empty' | 'too-big' | 'no-text' | 'too-slow' | 'no-engine' | 'not-opened'
		showInYourOwnWords(error.reason);
	}
}
```

The reason is named so the sentence is not. A library that ships only English prose forces an application that speaks anything else to keep its own copy of the door.

`no-engine` and `not-opened` are kept apart on purpose, and the difference is not cosmetic: one says _install `pdfjs-dist`_, the other says _this file will not open, look for its password_. Told the wrong one, a person hunts for a lock that does not exist and an agent writes that the document is protected. `pdfjs-dist` is a peer dependency so that a project reading only pastes and CSV does not download a PDF engine it will never call.

## One declaration, two outputs

Write the schema once and get both the check and the record type. A shape declared twice drifts, and the half that drifts silently is always the check.

```ts
import { schemaOf, validate, type RecordOf } from 'truecopy/schema';

export const CAREER = schemaOf({
	name: 'career-record',
	fields: {
		year: { format: 'year', minimum: 1930, maximum: 2030, required: true },
		quarters: { format: 'integer', minimum: 0, maximum: 4, required: false },
		pay: { format: 'number', minimum: 0, required: false }
	},
	minimumRecords: 5,
	key: 'year'
});

export type CareerRow = RecordOf<typeof CAREER>;
//   { year: number; quarters: number | null; pay: number | null }

const violation = validate(CAREER, rows);
// null, or { cause: 'too-few-records', conforming: 1, expected: 5 }
```

The schema is **pure data**: no accessor, no closure, nothing that does not survive JSON. It can be served, versioned, refined by whoever reads the documents, and swapped for another market without a deploy. What is missing is named; your application writes the sentence in its own voice.

**Already declared that row type in Zod, Valibot or ArkType?** Do not declare it twice. Any [Standard Schema](https://standardschema.dev) works, and truecopy adds the part a per-record validator cannot know: how many well-formed records make a document.

```ts
import { validateWith } from 'truecopy/schema';

validateWith(myZodSchema, rows, { minimumRecords: 5, key: 'year' });
```

## Why refusing matters

The research world arrived at the same place from the other side, and gave it a name: **calibrated abstention**. [Zero Hallucination, by Construction](https://arxiv.org/abs/2607.17883) (Raduta et al., 2026) makes it one of six layers of an architecture for enterprise document AI (_"the system declines rather than guesses when grounding is insufficient"_), paired with an evidence-based confidence that checks what was produced against the source document. Those are `refuse` and `selfCheck`, layer for layer.

It stays rare for a reason that is not technical: a benchmark rewards a confident guess and scores an abstention as a miss, so the whole machine is tuned to guess. A deterministic parser has no excuse to inherit that.

The five laws a reader is written to:

1. **The document checks itself.** A bank statement carries `opening + Σ = closing`; a career record announces its own total of quarters. Setting your reading against what the document declares is the only check that depends on no layout.
2. **Refusing beats returning a plausible table.** The worst defect is not missing an anomaly; it is inventing twenty-two of them out of a document you misread.
3. **Counting is not measuring.** Running two readings and keeping "the one that finds more rows" always picks the worse: a reader that cuts badly turns footnotes into data.
4. **The reader proposes, the person confirms.** The correction is part of the product, not the recovery path.
5. **Every quantifier is bounded.** These patterns run over a whole document, line by line.

## When a model does the reading

A model that turns cells into records fails one visible way - it misses a record - and one invisible way: it returns a **plausible value the document never printed**. A town deduced from a postcode, a rounded figure, a recomposed date, each reading exactly like a successful extraction. That failure has a deterministic answer, and it does not need a better model:

**The model never sees the PDF.** It receives the rows this library cut, numbered. It returns records that **cite the row numbers** they came from. And every value is then looked up in those rows and nowhere else - so the model cannot produce a fact, only point at one the document already carries.

```ts
import { numberedRows, citedText, carriesText, carriesNumber } from 'truecopy/cite';

const prompt = rules + '\n' + numberedRows(page); // what the model sees
const source = citedText(page, record.rows); // what it claims to have read

carriesText(source, record.town); // all its words, in order - never a substring
carriesNumber(source, record.surface, mark); // the page's numbers - never a digit soup
```

Both lookups were measured against their naive forms on a real corpus before they were written this way. A contiguous substring refused 104 of one document's 111 records, because layouts throw the tail of a name past the figure columns - the words are all there, in order, never in one piece. And flattening the source into one run of digits found a surface **three times** in a row that carries no such figure: a guard that looked strong exactly where it protected nothing.

What stays yours is policy, not mechanics: which fields are figures, which single field anchors a record, and the rule that a failed side field is dropped and counted rather than fatal. `checkExtraction` (`truecopy/contract`) is the arithmetic half - the sum of what came back, against the totals the document declares about itself.

## The kit that makes it compulsory

An interface is dodged with a `return null`; an assertion is not. Drop the kit into your gate with a corpus of your own:

```ts
import { checkContract, contractReport, failures, pdfWithText } from 'truecopy/kit';

it('holds the reading contract', async () => {
	const results = await checkContract(
		myReader,
		[
			{ name: 'balances', document: aSoundDocument, expected: 'read' },
			{ name: 'does not balance', document: aWrongDocument, expected: 'needs-review' }
		],
		{
			referencePdf: pdfWithText([{ word: '2018', x: 50, y: 700 }]),
			// YOUR door, not the kit's: what is measured is your reader,
			// extraction included.
			open: openLikeTheApp,
			foreign: [{ name: 'a payslip', document: aPayslip }]
		}
	);

	expect(failures(results)).toEqual([]);
	writeFileSync('contract.txt', contractReport(results));
});
```

The six rules, numbered on their own: the laws above are what a reader is written to, these are what a corpus checks it against from the outside.

1. The verdict the corpus announces is the verdict returned.
2. A reading that contradicts its document **never** comes back as sound.
3. Everything read is reviewable by the person.
4. The chain from bytes to records really runs, on a **real** PDF (`pdfWithText` builds one, xref table included).
5. A document without substance is **refused**, not silently returned empty.
6. A document of **another kind** is refused: you supply the corpus of what it must be told apart from, because only you know.

`contractReport` turns the run into a file you commit. A reading that quietly falls from twenty-six records to twenty-four passes every rule and no assertion notices; the diff does.

The fifth law (every quantifier bounded) is not in the kit, because a naive source scan produces false positives. It is held by `eslint-plugin-regexp` and its `no-super-linear-backtracking` and `no-super-linear-move` rules, in your own gate.

## Three methods, not five

A reader implements `read`, `selfCheck` and `rowsToReview`. Those three carry the doctrine: the work, the first law, and the person's place in it.

`repair` and `refuse` are **optional**, and their defaults err the only direction a default may err in: toward refusing. `repair` attempts nothing, because an honest gap beats a patch-up. `refuse` refuses a reading that produced no record.

Five methods before anything runs is a wall, and a wall in front of an interface gets `return null` written five times. That is the dodge [`kit.ts`](src/kit.ts) exists to catch, and the likeliest author of it is now a model writing from the types.

## The mechanisms

Each one is also its own entry point, so a project that wants one pays for one.

| Module                             | `truecopy/…` | What it does                                                                          |
| ---------------------------------- | ------------ | ------------------------------------------------------------------------------------- |
| [`open.ts`](src/open.ts)           | `open`       | bytes → pages → rows: size cap, page cap, deadline, engine released, engine swappable |
| [`layout.ts`](src/layout.ts)       | `layout`     | the pure geometry: rows, columns, cells, places, no engine, no bytes, no clock        |
| [`table.ts`](src/table.ts)         | `table`      | `readTable(file)`: the two-line path, and what it will not vouch for                  |
| [`notation.ts`](src/notation.ts)   | `notation`   | how the page writes a number and a date, never what they mean                         |
| [`classify.ts`](src/classify.ts)   | `classify`   | is this the kind of document expected, precedence included                            |
| [`columns.ts`](src/columns.ts)     | `columns`    | what each column contains, counted once                                               |
| [`roles.ts`](src/roles.ts)         | `roles`      | what each column is, deduced from that                                                |
| [`records.ts`](src/records.ts)     | `records`    | which rows belong to the same record, when a printed row is not one                   |
| [`labels.ts`](src/labels.ts)       | `labels`     | which cells could be the value a label announces, closest first                       |
| [`signature.ts`](src/signature.ts) | `signature`  | which rows break the table's own type signature                                       |
| [`schema.ts`](src/schema.ts)       | `schema`     | the fields, formats and count a reading must satisfy                                  |
| [`cite.ts`](src/cite.ts)           | `cite`       | the rows a model cited, and whether they really carry each value                      |
| [`explain.ts`](src/explain.ts)     | `explain`    | what all of the above decided, in words                                               |
| [`pattern.ts`](src/pattern.ts)     | `pattern`    | domain knowledge as **data**, compiled behind a ReDoS guard                           |
| [`contract.ts`](src/contract.ts)   | `contract`   | what an honest reading looks like                                                     |
| [`kit.ts`](src/kit.ts)             | `kit`        | what makes it compulsory                                                              |

## Precedence, and why it is stated rather than ordered

A bank statement quotes the word _invoice_ in a transaction label. Read in the wrong order it is filed as an invoice, and every operation it carries leaves the budget with it. An IBAN, or the debit/credit/balance vocabulary, settles the question before the word invoice is even looked at.

Three notions and no more: a **pattern set** (all of its patterns), a **requirement** (any one of its sets), a **kind** (all of its requirements, first match wins). `absent` inverts a requirement, so _an invoice only when there is no IBAN_ is stated rather than smuggled into an ordering that means something else.

## It knows nothing about your documents

It has never heard of a date, an amount, a debit or a quarter. You name the **kind** of a cell and the **role** you want back; this library counts, divides, compares, and says which rule broke.

That is deliberate. A library that shipped the meaning would force the next project to describe its document in a vocabulary designed for someone else's.

Everything that varies by market, by issuer or by document family is a **value**, not a branch; see `pattern.ts`. A value can be served by a backend, refined by whoever reads the documents, versioned, and swapped for another market without a deploy. A branch can only be changed by whoever can change the code. Profiles carry regular expressions and JSON does not, so they travel as `{ source, flags }` and are rebuilt here, which is exactly where the danger is, and where the guard goes. A rejected pattern compiles to one that never matches, so the feature degrades and the page stays alive.

## One reader, or two

A project plugs in one reader, or two. A statement reader may run a positional one when there are coordinates and a line grammar when there are not, and an OCR page is exactly where both apply and the richer read wins. That competition is your business; everything around it is not.

`readTable` is a reader, the default one, so that the first minute costs nothing. It is the on-ramp, not the product. The product is the pipeline and the guarantees around whichever reader ends up doing the work, and every mechanism is exposed on its own precisely so that yours can replace the default one piece at a time.

## What it will never do

A library with no stated limit grows one every release. These are refusals, not a roadmap.

- **It will never ship the meaning of your documents.** No date, no amount, no debit, no quarter, no issuer. Domain knowledge travels as **data** (`pattern.ts`, `schemaOf`), because a value can be versioned and swapped for another market, and a branch can only be changed by whoever can change the code.
- **It will never grow per-issuer configuration.** Tuning settings until one bank comes out right is the approach this library exists to replace. A layout it reads badly is a defect or a documented limit, never a preset.
- **It will never become a CSV parser.** It splits on four delimiters, and only where the count recurs line after line. A quoted file is handed back whole with a warning, because half-parsing a quoted CSV is exactly the plausible-but-wrong reading argued against everywhere else here. Reach for a real CSV library; this door exists for a paste, an export, an OCR line.
- **It will never become a validation library.** `schemaOf` bounds a reading: formats, and how many records make a document. Anything richer belongs to Zod or Valibot, and `validateWith` takes theirs rather than competing with it.
- **It will never open a format on its own.** PDFs go through `pdfjs-dist`, which stays an **optional** peer dependency. No OCR engine, no spreadsheet reader, no office format. You hand over bytes or text.
- **It will never touch the filesystem, the network or a clock you did not pass in.** It runs in a browser. `bin/truecopy.mjs` is the single exception, and it is a command, not the library.
- **It will never grow a second cut.** One vote on which left edges recur, one set of thresholds, three rulers. A format that needs its own algorithm needs its own library.

## Requirements

Node 20+, ESM. `pdfjs-dist` is an **optional** peer dependency, loaded on demand and only for PDFs: reading text, a paste or a CSV needs nothing.

pdf.js is used through its **legacy** build, deliberately: the modern one refuses to run outside a browser, which would make the whole chain untestable. **In Node, pass no engine at all** and that build is imported for you. Nine ingestion scripts across two consumers import it by hand and pass it as `pdfjs`, which works and is redundant; the option is there for a browser reader under a byte budget, which is the one case where the modern build is worth its own import.

If you want the worker, resolve its URL yourself and pass it in, because every bundler spells that differently and picking one here would lock you into it:

```ts
import workerSrc from 'pdfjs-dist/legacy/build/pdf.worker.mjs?url'; // Vite
await openDocument(file, { workerSrc, maximumPages: 200 });
```

A batch script raises the limits, and is meant to: `DEFAULT_LIMITS` (20 MB, 40 pages, 30 s) protects a browser tab, not an ingestion that runs once a year. Two consumers reading annual reports settled on 80 to 200 MB and 600 to 2000 pages. Reach for `keepPage` before `maximumPages`: it cuts at the right end of a long document.

## Use it from an assistant, with nothing installed

An agent holding a terminal already has the command above, and one that can import a module has the library. Neither is what most assistants are: a host that speaks MCP reaches a tool call and nothing else. So the same pipeline is an MCP server, over stdio, on the machine the document is already on.

```json
{
	"mcpServers": {
		"truecopy": {
			"command": "npx",
			"args": ["-y", "-p", "truecopy", "-p", "pdfjs-dist", "truecopy-mcp"]
		}
	}
}
```

Two tools, and the second is the one that is hard to get anywhere else:

- **`read_table`** turns a PDF, a CSV, a TSV or a saved paste into rows: the cut, how often each column is filled, the rows numbered, and what the reading **could not vouch for**. Bounded at 200 rows a call, and what it left is counted rather than dropped.
- **`check_citations`** takes the records a model claims to have read, each citing the rows it came from, and says which values the cited rows do not print. A JSON number is checked as a figure with the document's own decimal mark, a JSON string as its words in order. It answers "was this read or invented", never "is this complete", and it says so.

**Nothing is uploaded, because there is nowhere to upload it to.** The server runs where the file already is, makes no network call, and opens no file it was not handed. A statement, a payslip and a career record are the worst documents there are to send anywhere, and a server has nothing to compute on them that this does not compute in place. Set `TRUECOPY_MCP_ROOT` and it opens nothing outside that directory, symbolic links resolved before the check.

It speaks the 2026-07-28 revision and the ones before it, so a host that opens with `initialize` and a host that goes straight to `server/discover` both work.

Serving these tools from something larger - a server of your own, another transport - is [`truecopy/mcp`](src/mcp.ts): `TOOLS` are the descriptors, and `respond` answers one JSON-RPC message given a way to turn a path into a `File`.

## For a coding agent

This library was published after every model in service was trained, so a model
writing against it invents the API unless it is handed one. Two ways to hand it
over, both version-matched to what you installed:

```sh
# already on disk once you install the package
cp -r node_modules/truecopy/skills/truecopy ~/.claude/skills/

# or, to follow the repository
claude plugin marketplace add truecopydev/truecopy
claude plugin install truecopy@truecopy
```

[`skills/truecopy/SKILL.md`](skills/truecopy/SKILL.md) is plain markdown and
carries no Claude-specific instruction beyond its frontmatter, so it works as an
`AGENTS.md` for any other agent that reads one. `npm run skill` fails when it
names an export this package no longer has.

The documentation site serves every page as markdown at the same path with
`.md`, which is what [`llms.txt`](https://truecopy.dev/llms.txt) links to.

## Gate

```sh
npm run gate
```

Format, no typographic dash, lint (zero warnings, sonarjs + regexp), typecheck, build, knip, jscpd, tests, coverage **100 %**, ratchets that only ever go up. A kit that measures others measures itself first.

The same command runs in CI, on every push and every pull request. If it is green on your machine it is green here.

## Contributing

[`CONTRIBUTING.md`](CONTRIBUTING.md): what a change needs, and how it lands. Found a document that reads wrong? Open an issue with what `npx truecopy` printed, never the document itself.

[`RELEASING.md`](RELEASING.md): what a version number here will and will not do to you. The short version: releases are patches, the second digit stays put, and nothing is ever unpublished.

Security: [`SECURITY.md`](SECURITY.md). The library makes no network call, touches no filesystem and ships no runtime dependency, which leaves a small and specific surface: it is described there.

## Licence

MIT © Florian Mousseau
