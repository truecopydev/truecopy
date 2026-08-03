# Changelog

## 1.0.0

The first release. The API is what it is going to be: from here the version
moves in its third number, and the first two move only for a reason written
down in this file.

A parser that returns a plausible-looking table from a document it misread is
worse than one that returns nothing, because nobody checks a table that looks
right. This library is the pipeline around whichever reader ends up doing the
work — the door bytes come through, the checks that catch a wrong reading, a
way to see what it decided, and a conformance kit that goes red the day the
reading stops being honest.

### The mechanisms

Eight, in the order a document meets them — `open`, `notation`, `classify`,
`columns`, `roles`, `signature`, `schema`, `explain` — plus `layout` for the
geometry, `table` for the two-line path, `pattern` for domain knowledge held as
data, `contract` for the shape of an honest reading and `kit` for what makes it
compulsory. Each is also its own entry point, so a project that wants one pays
for one.

`pdfjs-dist` is an optional peer dependency. Reading text, a paste or a CSV
loads nothing at all.

### What it does that a table extractor does not

- **It says what it cannot vouch for.** `readTable(file)` returns the rows and
  a list of warnings computed without knowing anything about the document: a
  column filled on 2 % of its rows, a page that shows no column at all, pages
  that disagree on how many columns there are. An empty list is not a promise
  that the reading is right — it says nothing looked wrong from the shape of
  the page, and the difference between the two is the whole argument here.
- **The document checks itself.** A reading that contradicts what the document
  declares about itself never comes back as sound. Refusing beats a plausible
  table, and every value can be pointed at — `Place`, `placeOf`, `placesOf`,
  `ReviewableRow.where` — because a person confirms what they can find again.
- **No configuration per issuer.** The table is learnt from the table: a column
  full of dates is the date column whatever its header says, and a row that
  breaks what every other row does is a total, a balance or a footer. Reading
  no label is what survives an issuer never seen.
- **The cut keeps what recurs.** The spread of x over a whole page counts the
  letterhead, the address block and every word inside a description — measured
  on a real statement, twelve columns where the table has five.
  `boundariesFromRecurrence` keeps only the left edges that come back row after
  row, which needs no knowledge of the document at all. Where the page offers
  something better, `boundariesFromAnchors` takes it.
- **One engine, three rulers.** A PDF is measured in points, a table pasted
  with spaces in characters, a delimited file in the index of the field. The
  cut does not care which ruler measured them, so there is no second algorithm
  and no second set of thresholds — and the reading names the unit it worked
  in, because `cut at 1, 2` with no unit is a riddle.
- **One declaration, two outputs.** `schemaOf` yields the check and the record
  type, `RecordOf<typeof schema>`. A schema is pure data, so it survives JSON
  and can be served, versioned and swapped for another market without a deploy.
  `validateWith` takes any Standard Schema, so a row type declared in Zod or
  Valibot is not declared twice.
- **`explainDocument` puts the decision into words** — the cut, what each
  column holds, which rows were dropped and why. Reach for it first when a
  reading comes out wrong.
- **The kit makes the contract compulsory.** An interface is dodged with a
  `return null`; an assertion is not. `checkContract` runs six rules against a
  corpus of your own, and `contractReport` writes the run as a file you commit
  and watch move in a diff.

### The gate this library holds itself to

Format, lint with zero warnings, typecheck, build, the public surface, knip,
jscpd, and **100 % coverage** as a ratchet. A kit that measures others measures
itself first.

`API.md` is part of it: every exported name, by entry point, committed. knip
cannot see that surface — the barrel is the entry point, so everything it
re-exports counts as used and a name nobody imports stays green forever.
Measured while this file was being drawn up, thirty-two of fifty-seven exported
values had no consumer anywhere and nothing said so. `npm run api` reads the
built declarations through the TypeScript checker, because a re-export, an
overload and a merged interface each defeat a regular expression and none of
them defeat the checker. Adding an export is now a line in a diff before it is
a promise in somebody's import, which is what a 1.0 has to be able to say.

### Refused, on purpose

- **The library states what it will never do.** No domain meaning, no
  per-issuer configuration, no CSV parser, no validation library, no format
  opened on its own, no filesystem, no second cut. The README carries the list.
  A library with no stated limit grows one every release.
- **`readTable` is the default reader, and is named as such.** It is the
  on-ramp, so that the first minute costs nothing; the product is the pipeline
  and the guarantees around whichever reader ends up doing the work.
- **A file that quotes its fields is not split.** A quoted field may hold the
  delimiter itself, and splitting anyway shifts every column after it. The rows
  come back whole with a warning, because half-parsing a CSV is the
  plausible-but-wrong reading this library argues against.
- **An aligned paste is not read as a CSV because its amounts hold commas.**
  Every French amount does, so counting commas finds exactly one on every line
  of a pasted statement — and cutting on it would turn `12,40` into two
  columns. Alignment wins; only a tab overrides it, a tab never being
  punctuation.
- **No height on a `Place`, because none is known.** Inventing a line spacing
  would draw a rectangle on the page the document never had.
- **The pdf.js worker URL is not resolved for you.** Every bundler spells it
  differently, and picking one here would lock you into it.
