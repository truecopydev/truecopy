# Changelog

## 1.0.0

The API is what it is going to be. Everything published under 0.x is here
unchanged; what 1.0.0 adds is the undertaking that it stays. From here the
version moves in its third number, and the first two move only for a reason
written down in this file.

One engine, three rulers: the reading was general everywhere except in the one
place where it advertised generality.

### Fixed

- **`readTable` no longer empties a file it cannot cut.** Handed a CSV, it
  returned one empty cell per line — not uncut, empty: the caller got a table
  of the right shape holding nothing, which is the single outcome this library
  exists to prevent. A row with no geometry now comes back with its text, and
  the reading says `every row came back whole`.
- **A paste is one page, not one page per line.** A nineteen-line file
  announced `text, 19 page(s)` and made every per-page count meaningless.
  Blank lines are no longer rows either: kept, they dragged every column's fill
  rate under the threshold that says a cut invented it.
- **`thresholdsFor` documented a field that does not exist.** Its example wrote
  `{ column: 0.6 }` where the field is `share` — copied as it stood, it does not
  compile.
- **A dangling doc comment on `PositionedItem`** described the type below it
  instead, and `Place.x` claimed PDF units on a page measured in characters or
  in field indices.

### Added

- **Columns out of text, through the same cut that reads a page.** The cut
  votes on which left edges come back row after row, and that question does not
  care which ruler measured them. So text only has to say where its fields
  start: the **character** for a table pasted with spaces, the field's
  **index** for a file written with a delimiter. No second algorithm, no second
  set of thresholds — `TextPage.unit` names the ruler, `gapFor` turns it into
  the one number the cut needs, and `boundariesFromRecurrence` and
  `columnBoundaries` take that number.
- **The reading names the unit it measured in.** A list of numbers with no unit
  is a riddle: `cut at 1, 2` on a CSV sent somebody looking for a defect that
  was not there — the numbers were the indices of the fields, and right. A
  paste now reads `cut at characters 7, 22`. A delimited file names what
  happened instead — `cut on the delimiter` — because there the columns are the
  fields, and their indices tell a reader nothing. Points stay unlabelled: they
  are what a page has always been measured in.
- **Tab, semicolon, pipe and comma**, in that order, and only when the count
  recurs line after line — what makes a delimiter real is what makes a column
  real.
- **`CoordinateUnit` and `gapFor`, from the package root.** `TextPage.unit` is a
  public field whose type could not be named: `document.ts` has no entry point
  of its own, and the barrel did not re-export it. `gapFor` was reachable only
  through `truecopy/layout`.
- **`sharesByKind`** — a `SignatureOptions` turned into the shares
  `dominantKind` reads. `signature` and `explain` each derived it their own way.

### Refused, on purpose

- **A file that quotes its fields is not split.** A quoted field may hold the
  delimiter itself, and splitting anyway shifts every column after it. The rows
  come back whole with a warning, because half-parsing a CSV is the
  plausible-but-wrong reading this library argues against.
- **An aligned paste is not read as a CSV because its amounts hold commas.**
  Every French amount does, so counting commas finds exactly one on every line
  of a pasted statement — and cutting on it would turn `12,40` into two
  columns. Alignment wins; only a tab overrides it, a tab never being
  punctuation.

### Changed

- **A generic type parameter named `Record` became `Entry`.** It shadowed
  TypeScript's own `Record<K, V>`, and in `contract.ts` the same name meant two
  different things in one file. Type parameters are positional, so nothing a
  caller wrote changes.
- **The repository moved to its own organisation.** Same package, same licence,
  same author; `repository` and `bugs` name the new address.

## 0.1.2

Everything here answers one question: what separates a library that is good
from one that is worth choosing. The research on document extraction converged
in 2026 on an answer this library already half had.

### Added

- **`npx truecopy a-document.pdf`.** No install, no project, no line of code.
  It prints the cut it made, what each column holds, and then — on its own —
  what it could not vouch for. It is the shortest way to find out whether this
  is any use on YOUR documents, and it needs nothing from you first.
- **Provenance: `Place`, `placeOf`, `placesOf`, `ReviewableRow.where`.** Every
  document-extraction service converged on the same thing this year: a value
  that cannot be pointed at cannot be checked. Handed figures, a person hunts
  through the document again; handed a place, they jump to it. This library
  HELD those coordinates all along and dropped them — a positioned item knows
  its x and its baseline, and by the time a row reached the person only its
  text was left. `placesOf(page)` is laid out exactly like `cellsOf(page)`, so
  the two are read together. No height, because none is known: inventing a line
  spacing would draw a rectangle the document never had.
- **`boundariesFromRecurrence`** — the cut that keeps only the x that come back
  row after row. The spread of x over a whole page counts the letterhead, the
  address block and every word inside a description: measured on a real
  statement, twelve columns where the table has five. What separates a column
  from furniture needs no knowledge of the document at all — a real column's
  left edge recurs. `readTable` uses it, and hands the boundaries back so a
  caller can explain or re-cut the same page. On that statement: twelve columns
  down to seven, and the rest named as thin.
- **`validateWith` accepts any [Standard Schema](https://standardschema.dev).**
  Zod, Valibot, ArkType and TypeBox all implement it. A project that declared
  its row type over there should not declare it again here; what this adds is
  the part a per-record validator cannot know — how many well-formed records
  make a document. Synchronous only, and it says so rather than quietly
  awaiting.
- **`ExplainOptions.boundariesOf`** — the cut to read a page by, when it is not
  the page's own. Without it the heading and the cells could tell two different
  stories.
- **A corpus of layouts** (`corpus.test.ts`): a French statement, an English
  one, a table under a letterhead, a bundle whose last page is a footer, a page
  of prose. Synthetic, and honest about it — but the case that comes out
  badly is pinned there saying so. A corpus that only holds what passes is a
  corpus that flatters.

### Changed

- **The README says where the reading STOPS.** It promised that reading no
  label makes the library work on an issuer never seen. That is true of the
  judgement - which rows belong to the table, which column holds what - and it
  was being read as a promise about the whole reading, which measurement does
  not support: on a real statement with its header labels hidden, the page-wide
  cut proposed twelve columns where the table had five, and the reading came
  back wrong. Visible only because the sum did not match the balances the
  document declares.

  The library does not promise to read an unknown layout correctly. It promises
  to tell you when it did not, and the README now says so in those words.

## 0.1.1

No behaviour changes. Two things a published library should never have shipped
with.

### Changed

- **The applications it came from are no longer named.** The source called one
  of them by name eight times, and the README quoted their line counts and one
  of their bundle budgets. A library carries the LESSON, never the address it
  was learnt at: the measurements stay, the projects are gone.
- **The last French left the source.** Two files carried French headers, test
  names and comments in a library written in English. What a failing test
  prints is read by whoever did not write it.

## 0.1.0

A pass over the whole library against SOLID and KISS. Two findings were real,
the rest is stated in the README rather than churned into the code.

### Changed

- **`open.ts` splits in two.** It carried four hundred lines and two jobs: the
  door the bytes come through, and the cut a page is read by — under a name
  that described only the first. A caller who wanted `cellsOf` had to import
  the module that loads a PDF engine to get it. The geometry and the assembly
  are **`layout.ts`** now (`truecopy/layout`), which is pure: no engine, no
  bytes, no clock. Nothing is renamed, and the barrel still exports everything,
  so an application importing from `truecopy` changes nothing.
- **`KindThreshold.column` is now `share`.** A field holding a share, named
  after an index, is the first kind of name Clean Code calls disinformation.
  The second parameter of `thresholdsFor` had the same problem. **Breaking**
  for anyone writing `{ column: 0.6 }` in a signature.
- Test files follow their unit: `layout.test.ts` splits out of `open.test.ts`.

## 0.0.5

### Added

- **`RoleRule.among`** — `'rows'` (the default, unchanged) or `'filled'`. What
  the share is taken OUT OF, and the two answers are not interchangeable. A
  column of dates empty on a third of the rows is not a column of dates, it is
  a mess, and that is what `signature` needs to know. But a statement leaves
  the date empty on every continuation line of a wrapped description, and that
  column is still the date column — there the question is not whether the
  column is reliable, it is what is in it.

  Measured on a real statement: a date column filled on 26 rows out of 60, of
  which 16 were dates, scores **0.27** out of the rows and **0.62** out of the
  filled ones. Past a threshold of a half, the first answer loses the column
  entirely - and with it every role that depended on it.

## 0.0.4

### Added

- **`readTable(file)`** - rows and cells in two lines, with no configuration at
  all. Whoever types "extract tables from pdf" wants exactly that, and making
  them write a `kindOf`, choose thresholds and learn what a role is before the
  first result is twenty minutes of reading that most people do not spend.

  It does not return a bare array, and that is the argument of the whole
  library: a plausible-looking table out of a document that was misread is
  worse than nothing, because nobody checks a table that looks right. It
  returns `{ rows, warnings, document }` - same two lines for whoever only
  wants `rows`, and a second field for whoever wonders whether to trust them.
  **An empty `warnings` is not a promise that the reading is right**, and the
  distance between those two claims is what the rest of the library is for.

  Every warning is computed without knowing anything about the document: a page
  with no column at all, a column filled on a fraction of its rows, pages cut
  differently from one another, a blank page in the middle.

- **`pdfWithPages`** - the fixture builder over SEVERAL pages. A one-page
  fixture cannot exercise what only appears across pages, and both new warnings
  above needed it.

### Fixed

- Two checks written for `readTable` could never have fired, and writing their
  tests is what showed it: rows are cut into as many cells as there are
  boundaries, always, so counting cells per row says nothing - what varies is
  how often a column is filled. And a document with no text at all is refused
  by `openDocument` long before, so only a blank page inside a longer document
  can reach that branch.

## 0.0.3

Everything here comes from integrating the library three times in one day and
writing down what got in the way.

### Added

- **A runnable example.** `node example/read-a-statement.mjs` builds a real
  PDF, opens it, prints what the reading decided, and drives it through the
  contract - one file, one command, no document to supply. The README's
  snippets could not be run: they named `isDate`, `myReader`, `openLikeTheApp`.
  A test runs the example as a subprocess against the built package, resolved
  by its own name, so it cannot rot and the `exports` map is checked with it.
- **`cellsOf(page)`** - a page as a table of cells. Every reader written
  against this library wrote `page.rows.map((row) => rowToCells(row,
page.columnBoundaries))` by hand, and `profileColumns`, `findRowAnomalies`
  and `explainRows` all want exactly that shape.
- **`thresholdsFor(kinds, share)`** - the same threshold for every kind named,
  spread over for the one kind that needs a rule of its own. A signature used
  to repeat `{ column: 0.6 }` until the shape drowned the one number that
  mattered.
- **`llms.txt`** - what the library is, the shortest thing that works, which
  methods must not be stubbed, and the traps.

### Changed

- **`repair` and `refuse` are optional.** Five methods before anything runs is
  a wall, and a wall in front of an interface gets `return null` written five
  times - the very dodge `kit.ts` exists to catch, and the likeliest author of
  it is now a model writing from the types. Both defaults err the safe way:
  `repair` attempts nothing, `refuse` refuses a reading that produced no
  record. The three that carry the doctrine stay required.

## 0.0.2

Everything here comes from drawing one line: what is business stays in the
application, what is parsing comes here. Four things were on the wrong side of
it.

### Added

- **`notation`** — how a page writes a number and a date, never what they mean.
  `readNumber`, `findNumbers`, `isOnlyNumber`, `numberToken`, `readDate`,
  `readLeadingDate`. Two defects had each shipped once: reading every dot as a
  thousands separator turned `27800.50` into 2 780 050, and bounding a run of
  spaces too tightly made the accounting negative `( 123,45)` come back
  positive. Both are now pinned by tests in one place.
- **`UnreadableDocument.reason`** — `'empty' | 'too-big' | 'no-text' |
'too-slow' | 'not-opened'`. The library shipped English sentences and nothing
  else, which broke its own rule: it names the rule that broke, the application
  writes the sentence in its own voice. An application speaking French had to
  keep a copy of the whole door to say so.
- **`boundariesFromAnchors`** — column boundaries from anchors the caller
  already trusts (the x of a header label), in the same shape `columnAt` and
  `rowToCells` already read. The spread of x works on any page and knows
  nothing; an anchor knows exactly where a column starts. A reader wants both.
- **`positionedItems`** — the pure step between a PDF engine and this
  library's data, exported so a test driving a real engine over real bytes can
  prove the chain joins up.
- **`OpenOptions.pdfjs`** — the engine to read with. The legacy build runs in
  Node, so the whole chain stays testable; the modern one is smaller, measured
  by over a hundred kilobytes brotli, which decides it under a byte budget.
  Neither is right for both, so neither is chosen here.

### Changed

- **`new UnreadableDocument(reason, message)`** — the constructor takes the
  reason first. Breaking, and the only breaking change.

### Fixed

- `27.800` read as `27`: a thousands separator dropped everything after it.
  Found by a test written for the opposite defect.

## 0.0.1

First published version: the five rules a reader is written to, the mechanisms
that hold them, and the kit that makes them compulsory.

- `open`, `classify`, `columns`, `roles`, `signature`, `schema`, `explain`,
  `pattern`, `contract`, `kit` — each also its own entry point.
- `schemaOf` / `RecordOf`: one declaration yields the check and the record type.
- `explainDocument`: what the reading decided, and why, as text.
- `contractReport`: the conformance run as a file a project commits and diffs.
