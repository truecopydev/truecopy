# Changelog

Every change a caller could notice, and why it was made. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); what each number
means and when one is published is [RELEASING.md](RELEASING.md).

Entries land here under `## [Unreleased]`, with no version and no date. A
release PR is what stamps them.

## [Unreleased]

### Fixed

- **A column of figures is set flush right, and the cut could not see it.** `boundariesFromRecurrence` voted on the left edge of every item, and the doc comment said why: a real column's left edge recurs. That is true of a date, a label, an address. It is false of a column of figures, whose left edge moves with the digit count - so it never recurs, and two such columns fall into ONE band as soon as the widest value of the second reaches back towards the first. Nothing in the left edges tells them apart afterwards.

  **This is the cause of the `merged-column` doubt this library already raises.** Measured on page 27 of a real property schedule, 72 rows: the right edges of its five figure columns come back on 62 to 65 rows each, at 351, 394, 448, 502 and 556, while the left edges of the same columns scatter over seven bands, none reaching 31. The cut missed the boundary near 395, so a surface and a price came back in one cell - `896 2 415 065` where the page prints 896 m2 and 2 415 065 EUR - on 126 of that document's 233 rows.

  **And notation cannot repair geometry.** `93 580 000` is a perfectly well formed number, and it is also `93` followed by `580 000`. `findNumbers` returns one, and it is right to. The answer is not in the text: it is in the fact that no character is printed between the two on any row of the page.

  So the right edge is read too, and **only inside a band**. Four conditions, each one keeping a real failure out: the right edge has to recur on as many rows as a band does; nothing may be printed ACROSS the cut; nothing may START just after it, which is what separates a column from a run of words; and a column has to begin at or after the cut. The cut sits exactly where the left column's text ends, which is safe because `columnAt` places a cell by its left edge and nothing else.

  **Measured over 125 real annual reports**, 398 989 rows: cells holding several glued numbers fall from 20 852 to 16 356, a fifth of them, and 16 973 values that were welded to their neighbour come back as cells of their own (736 181 filled cells become 753 154). The widest row of the corpus does not move, at 25 columns: no page gains a column it did not have. The worst document goes from 1 444 glued cells to 312.

  **What was tried first, and what it cost**, because the shape of this fix is not obvious. Letting right edges form the bands themselves - the direct reading of "vote on both edges" - welds a page into two columns: a text column of varying width ends at a different x on every row, and those ends are dense enough to bridge every gap. Measured on the same corpus, that lost 127 458 of 736 181 filled cells, and the application reading them fell from 69 documents read to 40. Reading right edges only where the left edges already agreed keeps that impossible: the bands, and therefore every boundary between them, are exactly what they were.

## [2.0.0] - 2026-08-19

### Removed

- **Five exports nobody imports leave the public surface: `compilePatterns`, `dominantKinds`, `toRawPatterns`, `discrepancyOf`, `requirementHolds`.** 65 values became 60; no type was touched. Every one of the five was measured against six repositories that install this package, and none of them names any of the five. The three plural helpers were one-line loops over a singular that stays - `compilePattern`, `toRawPattern`, `dominantKind` - and `map` writes them in the caller's own file. The other two are steps inside a public function and are still there, unexported: `classifyDocument` runs the requirement, `readDocument` picks the closest announced total.

  **This is why the first digit moved**, and it is the only reason: code importing one of those five names stops compiling. Nothing reads differently, no default changed, and every other name is where it was. An application that imports none of the five upgrades by changing the number.

  What the same measurement did NOT justify, and it is the more useful half: 81 of 123 exports were imported by nobody, and 49 of those 81 are types. A type is annotated, never called, so counting imports says nothing about whether it can go. Asked of the compiler instead - which types a living export's signature drags in behind it - **38 of the 49 came back reachable**. `OpenOptions` is in that list: it is the options type of `readTable` and of `openDocument`, the two most used entries of the package. Removing types on the strength of the import count would have taken the middle out of the library.

### Added

- **`few-spines`: almost nothing was grouped, and now it says so.** A spine belongs to a TABLE, and a whole document handed to `recordsFrom` flat has its width set by the widest row printed anywhere in it. Measured on a real annual report: 3115 rows, a widest row of eight, and SEVEN records - while the same document read page by page gives eleven hundred. The answer came back almost empty and said nothing, which is the one failure this library exists to prevent.

  The threshold is measured on 20 real reports, both ways round: handed a document flat the share of rows reaching the full width is 0,5 % at the median and under two per cent on 90 % of them, handed one page at a time it is 30 % at the median and under two on 3 % of them. A doubt that misfires on three pages in a hundred is the right trade against silence on an empty answer.

### Changed

- **Nine exports now say where they stop.** No behaviour moved; the sentence above the declaration did. Two of the nine are worth reading before the next upgrade, because both bounds were measured against a real corpus of 125 annual reports rather than reasoned out:

  - **`columnOfHeader` reads ONE table, not a whole document.** Handed the flattened rows of a 43-page report it answers `null` far more often than it should: the heading is reprinted on pages the cut does not align, the same logical column lands at several indices, and several matching columns is exactly what it refuses. Of 125 reports, 24 carried a heading a caller could find and this refused 12 of them. Cut the document with `Table.pages` and ask once per page.
  - **`recordsFrom` groups a table, never a document located by what it says.** The spine is a WIDTH. Against a reader that walks the same 125 files by their addresses instead: 2 309 records here, 2 900 there. When the entries are found by an address, a heading or a date rather than by how wide the row is, this is not the mechanism - and it does not raise a doubt about it, it just returns fewer.

  The other seven: `DEFAULT_LIMITS` (sized for a browser tab, refuses an ingestion corpus), `columnCount`, `countMatches` (non-overlapping), `sharesByKind`, `thresholdsFor` (sets `share` and nothing else), `describeAnomaly` (one cell, never a verdict on the row), `conforms` (one record, not the count a schema demands), `placeOf` (no height, and the page's own unit).

### Fixed

- **A lone zero in front of a mark is a decimal point, not a group of thousands.** `readNumber('0,280')` came back as two hundred and eighty. The rule that decides the mark is counting - three digits behind it is a group of thousands - and three digits is exactly what `0,280` shows. No group of thousands begins with a zero, which is the rule `wellGrouped` already states one field over, and it settles this without counting anything.

  A thousandfold error, on money, and silent: 280 is a well formed figure that closes every arithmetic it enters, so nothing downstream can catch it. Met on a fidelity premium a listed company prints as `0,280 euro par action`, in a document that prints its ordinary dividend as `2,80` two lines above.

- **A year the text layer broke across spaces is still a year.** `28 mai 202 6` is what `readTable` produced on a real filing, from a page that prints `28 mai 2026`, and `readLeadingDate` read it as no date at all. `IN_NUMBER` exists one field over for exactly this and `readNumber('202 6')` has always returned 2026, so the date was inconsistent with the number rather than careful.

  Digits gathered across a space are held to 1900-2099 and contiguous ones are not, and that asymmetry is the whole safety of it: `25 janv. 1 234,56` is a statement row carrying an amount and no year, its four digits make 1234, and trusting a repaired run as far as a whole one would turn every amount printed after a month name into a date. Contiguous digits behave exactly as before, so no reading that was right comes back different.

- **A day carrying its ordinal is a date.** `readLeadingDate('1er janvier 2026')` returned null, and so did `1st January 2026`: the pattern let the day be followed by whitespace and by nothing else. The ordinal is a suffix on the day and can never be a month, so reading it is not guessing - and refusing it loses a date the page states plainly. The Spanish and Portuguese `1º` is the same shape and is deliberately left out: nothing measured carries it, and a pattern nobody has exercised is a pattern nobody has checked.

### Added

- **`few-spines`: almost nothing was grouped, and now it says so.** A spine belongs to a TABLE, and a whole document handed to `recordsFrom` flat has its width set by the widest row printed anywhere in it. Measured on a real annual report: 3115 rows, a widest row of eight, and SEVEN records - while the same document read page by page gives eleven hundred. The answer came back almost empty and said nothing, which is the one failure this library exists to prevent.

  The threshold is measured on 20 real reports, both ways round: handed a document flat the share of rows reaching the full width is 0,5 % at the median and under two per cent on 90 % of them, handed one page at a time it is 30 % at the median and under two on 3 % of them. A doubt that misfires on three pages in a hundred is the right trade against silence on an empty answer.

## [1.0.4] - 2026-08-12

### Added

- **`standardFontDataUrl` and `cMapUrl` reach pdf.js.** `PdfEngine.getDocument` could not carry them, so no reader could pass them whatever it did. They go through untouched, and a key the caller left out is left out rather than passed as `undefined`: pdf.js takes the key as given and resolves it against a base that does not exist outside a browser.

  **And what it does not do, because the warning invites the mistake.** Measured on 125 real annual reports: pdf.js prints `Ensure that the standardFontDataUrl API parameter is provided` on every one, three come back with genuinely broken text, and passing the pack changes not one character of any of them. The corruption is a subsetted font whose `ToUnicode` map is absent or wrong - the glyphs are embedded, their mapping to characters is not - and a pack of STANDARD fonts has nothing to say about a custom one. This option silences a warning and serves a document that really does use an unmapped standard font. It rescues nothing that is already lost at the source.

- **A merged column says so: the `merged-column` finding.** The opposite failure to `thin-column`, and the dangerous one. A column the cut never separated is filled on every row, exactly like a good one, so no fill rate can see it: the reading is wrong and silent about being wrong. Read as one figure, one such column produced 97 wrong values out of 162 on a real property schedule, and the merged money column of the corpus loan schedule had been pinned since August 3 with the note that nothing warns.

  It fires only when a cell CERTAINLY holds two values: nothing but numbers and separators, and every number carrying its own decimal mark. Without that second condition two integers separated by a space are indistinguishable from ONE number, the space being exactly what French notation puts between thousands - measured, the loose rule fires on 48 % of a column that is perfectly well cut and the strict one on none of it. On the two real geometries of the corpus: 93 to 94 % on the column that really is two, on each of the four table pages, and not one finding anywhere else.

- **`wellGrouped`: is this number grouped the way its document groups thousands?** `readNumber` throws the separators away, which is right for reading one number and wrong for deciding where two of them meet: `000 106 236 000,00` reads as a perfectly good hundred and six million, so a cut made there is well formed and still leaves 1 300 where the report prints 1 300 000. The value closes its sector either way, so no arithmetic catches it, and a quantity nothing cross-checks is where a wrong figure survives. Met on a real fund report by a consumer that had to write this itself.

- **`labels`: which cells could be the value a label announces.** `contract.ts`
  states the need in as many words and answered none of it - `SelfCheck.declared`
  is a LIST because "a document may announce several candidate values when its
  layout scattered a label from its number" - and three consumer applications
  wrote the search separately: four lines under a heading, the first amount to
  its right, a column index read out of a header cell. Same question, three
  geometries, no domain word in any of them.

  `labelledValues(rows, isLabel, isValue)` returns each label with the cells
  that could be its value, **closest first**, walking the row and the column.
  `columnOfHeader(rows, isHeader)` answers the third geometry and refuses when
  several columns match, because two of them is exactly the document nobody
  should read on a hunch.

  It will not pick. Handing back one value would decide between two readings of
  a layout, which is the plausible-but-wrong answer argued against everywhere
  else here. The list feeds `SelfCheck.declared` and `discrepancyOf` keeps the
  one that fits, so the document decides rather than a rule about how far a
  number usually sits from its heading.

  One rule costs a reading when it is missing, and it was met on a real pension
  record: a search **stops at the next label**. Two headings printed close
  together let the second one's figure count for the first as well - a doubled
  total, a false proof, and a refusal on a reading that was right.

  Unlike `records`, this one cannot be measured on the de-identified corpus: the
  mask replaces every wording, and the wording is what a label IS. Its cases
  come from the three consumers that met them, and its home for regression is
  the synthetic corpus, where the meaning is chosen.

## [1.0.3] - 2026-08-12

### Added

- **`records`: which rows belong to the same record, when a row is not one.**
  The ninth mechanism, and the one three consumer applications had each written
  separately. In a great many real documents a record occupies two or three
  PRINTED rows - a street on one line, the figures on the next, the postcode on
  a third - and every mechanism here worked on the printed row, so one row per
  record undercounts by three to five times without a word.

  `recordsFrom(rows)` returns `records`, `loose` and `findings`. What joins two
  rows is one sentence: a table has a SPINE, the rows carrying its full width,
  and a narrower row joins the nearest spine it fits BESIDE - every column it
  fills being a column that spine leaves empty.

  That second half is the whole difference from the rule everyone writes first,
  and a count cannot see it. Attaching each fragment to its nearest spine gets
  the same number of records on both measured documents and swallows twenty-
  three page-furniture rows INTO records on one of them: a page header sits one
  row from a spine, so proximity takes it. It cannot fill a column the spine
  leaves empty, so compatibility refuses it.

  Nothing is ever grouped away: every row comes back in a record or in `loose`.
  On a table where a record IS a row it returns one record per row and changes
  nothing, which is the case it was measured against. And it says
  `spine-not-sharp` rather than guess when a record that leaves a column empty
  is as wide as a rich fragment - a real property of some documents that no
  threshold removes, and the point at which a caller who knows its document
  takes over.

  Measured in `truecopydev/corpus`, `npm run banc-records`, on two real
  geometries whose judged answers are opposite.

- **`accentFree`, which was already here in private.** Lower-cases a text and
  strips its accents, so two spellings of one label compare equal. It served the
  month-name lookup and nothing else could reach it, yet every reader that
  compares a label read out of a document needs it: PDF producers disagree about
  accents, and a prescribed heading arrives with them on one file and without
  them on the next. It sits in `notation` beside `decimalMarkOf` for the same
  reason that one does - it is how the page was typeset, not what it means. It
  folds accents and nothing else: the eszett and the dotless i are different
  letters, and a caller who folds one knows something about its language that
  this library does not.

### Documentation

- **In Node, pass no engine.** The legacy pdf.js build is imported for you when
  `pdfjs` is left out, which the README said only obliquely: two consumers
  import it by hand in nine ingestion scripts, which works and is redundant.
  Said outright now, next to the reason the option exists at all.
- **`DEFAULT_LIMITS` is meant to be raised by a batch script.** Twenty megabytes
  and forty pages protect a browser tab; an annual report runs to 45 MB over 200
  pages, and two consumers raised the limits separately without anything saying
  they were supposed to. With a pointer to `keepPage`, which cuts at the right
  end of a long document.

## [1.0.2] - 2026-08-11

### Added

- **Every doubt is named, not only worded.** `readTable` now returns `findings`
  alongside `warnings`: the same list in two shapes, one sentence and one
  `code` - `blank-page`, `no-column`, `thin-column`, `pages-disagree` - with the
  page and the column it is about. `warnings` is derived from it, so a message
  and a code can never say different things. A program that has to act on a
  doubt was matching English prose to do it, and a message rewritten for clarity
  broke it: for a library whose product is the refusal, the refusal was the one
  thing not machine-readable.
- **`readTable` keeps the rows in their pages.** `pages` holds the same rows,
  laid out exactly like `boundaries`, so `pages[i]` and `boundaries[i]` are one
  page. `rows` is still the flat list and is exactly `pages.flat()`. Flattening
  loses which page a row came from, and some documents cannot be read without
  it: a page printing two tables side by side carries two runs of headings, and
  walking the rows in order alternates between them - a position inherits the
  heading of the other column, silently.
- **`keepPage`: which pages to open at all.** `maximumPages` cuts at the end and
  only there, which is the wrong end of a long document: an annual report prints
  its portfolio from page 313 to page 1427, and reading its first forty pages
  reads a cover and an auditor's opinion. Opening the engine on a page is what a
  reading costs - measured at 99 % of it on a 381-page report, against 0,02 s
  for the cut and 0,01 s for everything downstream. Pages that are kept keep the
  number the document gives them, and `maximumPages` now counts the pages
  opened, so it still bounds the work.
- **`decimalMarkOf`: the notation read off the document instead of guessed off a
  token.** `1,234` is one thousand two hundred and thirty-four in Luxembourg and
  one point two three four in Paris, and no amount of looking at those five
  characters decides which. The same question as the column cut, asked of
  numbers: what recurs over the document decides. Three kinds of evidence, none
  of which knows what a number means - a run carrying both marks, a mark
  repeated over groups of exactly three, a mark followed by anything but three
  digits. `null` when nothing settles it, and `readNumber(raw, decimalMarkOf(text))`
  composes because `readNumber` now takes that answer, `null` included.
- **`checkExtraction`: rows checked against their document in one call.** The
  rows may come from anywhere - a reader written against this contract, a
  spreadsheet, or a model handed the PDF and asked for a table. It rounds the
  sum to the document's precision, because `discrepancy` compares a float
  subtraction against exactly zero and a cent-sized residue turned a correct
  reading into `needs-review`; and it flags every row carrying a figure that
  appears nowhere in the document, read with the document's own decimal mark.
  Writing this by hand was the twenty lines everybody wrote the same way.
- **`npx truecopy --json <file>`.** The same reading as data: the rows, the rows
  per page, the cut, and the findings with their codes. The command printed
  prose only, so trying the library from an agent meant writing code first.

### Fixed

- **A number written with commas for its thousands was read truncated, in
  silence.** `findNumbers('TOTAL 48,275,477.16')` returned 48 275: the token
  pattern accepted a space or a dot between groups of three and not a comma, so
  the match stopped at the second one. `readNumber` read the same string
  correctly, which is what made it invisible. Any reading that ran over English
  notation in running text moves with this, and it moves toward the number the
  document prints.

## [1.0.1] - 2026-08-09

### Added

- **A skill, so a coding agent writes against the real API instead of inventing
  one.** truecopy was published after every model in service was trained, which
  makes it the one library a model cannot know: asked to read a table out of a
  PDF it produces plausible truecopy code, and the first thing it reaches for is
  `selfCheck() { return null }`, the exact dodge this library exists to catch.
  [`skills/truecopy/SKILL.md`](skills/truecopy/SKILL.md) ships in the package,
  so it is on disk and version-matched the moment you install: copy it into
  `~/.claude/skills/`, or add the repository as a plugin marketplace. It is
  plain markdown with no Claude-specific instruction in the body, so it serves
  as an `AGENTS.md` for anything else that reads one.
- **`npm run skill`, because a second copy of an API drifts.** It fails when the
  skill calls an export the package no longer has, names an entry point that is
  gone, or when `.claude-plugin/plugin.json` and `package.json` disagree on the
  version. `KindThreshold.column` becoming `share` is the case it exists for: a
  rename touches no prose file, and the skill would have gone on teaching the
  old name to the reader least able to notice.

### Fixed

- **A missing engine was reported as a locked document.** With `pdfjs-dist`
  absent and no engine passed in, the door refused with `not-opened` and the
  message "if it is password-protected, save an unprotected copy". That sends a
  reader hunting for a lock the file does not have, and an agent reading it
  writes that the document is protected: a wrong diagnosis stated confidently,
  which is the failure this library exists to prevent. `no-engine` is now its
  own refusal and its message names what to install. Met on a real document,
  while reading a UCITS annual report.
- **A release tag could still be walked forward.** The tag protection announced
  in the entry below forbade deletion and force-push, which reads like
  immutability and is not: "no force-push" blocks a **rewind**, while moving a
  release tag **onto a later commit** is a fast-forward and goes straight
  through, and forward is the direction that matters, since `main` advances
  after every release. Measured by trying it rather than by reading the setting,
  and the tag moved. `refs/tags/v*` now accepts no update at all.

### Changed

- **The em dash is gone from every page here, and cannot come back.** 84 of
  them across eleven files, all in the documentation and none in the source,
  with the README the one everybody reads on npm. Each was replaced by what its
  own sentence wanted, a colon, a comma, a full stop or a bracket, rather than
  by one substitution repeated 84 times. `npm run dashes` is now part of the
  gate and refuses the whole dash block. One of them was worth more than
  typography: the README quoted a warning this library emits and quoted it
  wrongly, with an em dash where the real string carries a spaced hyphen.
- **What a version number will do to you, narrowed.** The rule was "1.x.0 for a
  new export, a new option, a new entry point"; it is now a patch, and the
  second digit stays put. Almost every release adds surface, so the old rule
  spends a minor every week and the number stops carrying a signal: it took
  selfstore from 1.6 to 1.8 in three days. [RELEASING.md](RELEASING.md) is the
  whole contract: what earns which number, when a release is cut, and why
  nothing is ever unpublished.
- **A release now publishes the tag it says it does.** Dispatched without one,
  the publish workflow used to check out the default branch, so a release
  shipped whatever `main` happened to be at that minute, not the commit its
  notes describe and not the commit its provenance attests. The tag is now
  required, its version has to match `package.json`, and `refs/tags/v*` is
  protected against deletion and force-update: once `vX.Y.Z` exists it points
  where it points forever, which is what makes the attestation on the npm page
  worth checking.
- **The path from a commit to the registry is hardened.** Actions are pinned to
  a commit rather than to a movable tag, installs run with `--ignore-scripts`,
  what a consumer actually installs is audited, and the whole history is
  scanned for secrets. `main` takes no direct push and cannot merge red.
- **Publishing no longer holds a credential.** The publish workflow
  authenticated with `NPM_TOKEN`; it now authenticates by OIDC, and npmjs.com
  names this repository and this workflow file as the only thing allowed to put
  a version of this package on the registry. There is no secret left to rotate,
  leak or let expire, and an expired one is the worst of those: it publishes
  nothing while the job reports success. It is also the only path that stays
  open, since npm has stopped issuing classic automation tokens and now refuses
  direct publishing from the granular tokens that bypass two-factor auth. The
  file name is part of the permission: renaming `publish.yml` revokes it until
  the trusted publisher is updated to match.

## [1.0.0] - 2026-08-03

The first release. The API is what it is going to be: from here the version
moves in its third number, and the first two move only for a reason written
down in this file.

A parser that returns a plausible-looking table from a document it misread is
worse than one that returns nothing, because nobody checks a table that looks
right. This library is the pipeline around whichever reader ends up doing the
work: the door bytes come through, the checks that catch a wrong reading, a
way to see what it decided, and a conformance kit that goes red the day the
reading stops being honest.

### The mechanisms

Eight, in the order a document meets them (`open`, `notation`, `classify`,
`columns`, `roles`, `signature`, `schema`, `explain`), plus `layout` for the
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
  that the reading is right: it says nothing looked wrong from the shape of
  the page, and the difference between the two is the whole argument here.
- **The document checks itself.** A reading that contradicts what the document
  declares about itself never comes back as sound. Refusing beats a plausible
  table, and every value can be pointed at (`Place`, `placeOf`, `placesOf`,
  `ReviewableRow.where`), because a person confirms what they can find again.
- **No configuration per issuer.** The table is learnt from the table: a column
  full of dates is the date column whatever its header says, and a row that
  breaks what every other row does is a total, a balance or a footer. Reading
  no label is what survives an issuer never seen.
- **The cut keeps what recurs.** The spread of x over a whole page counts the
  letterhead, the address block and every word inside a description: measured
  on a real statement, twelve columns where the table has five.
  `boundariesFromRecurrence` keeps only the left edges that come back row after
  row, which needs no knowledge of the document at all. Where the page offers
  something better, `boundariesFromAnchors` takes it.
- **One engine, three rulers.** A PDF is measured in points, a table pasted
  with spaces in characters, a delimited file in the index of the field. The
  cut does not care which ruler measured them, so there is no second algorithm
  and no second set of thresholds, and the reading names the unit it worked
  in, because `cut at 1, 2` with no unit is a riddle.
- **One declaration, two outputs.** `schemaOf` yields the check and the record
  type, `RecordOf<typeof schema>`. A schema is pure data, so it survives JSON
  and can be served, versioned and swapped for another market without a deploy.
  `validateWith` takes any Standard Schema, so a row type declared in Zod or
  Valibot is not declared twice.
- **`explainDocument` puts the decision into words**: the cut, what each
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
cannot see that surface: the barrel is the entry point, so everything it
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
  of a pasted statement, and cutting on it would turn `12,40` into two
  columns. Alignment wins; only a tab overrides it, a tab never being
  punctuation.
- **No height on a `Place`, because none is known.** Inventing a line spacing
  would draw a rectangle on the page the document never had.
- **The pdf.js worker URL is not resolved for you.** Every bundler spells it
  differently, and picking one here would lock you into it.
