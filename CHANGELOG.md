# Changelog

Every change a caller could notice, and why it was made. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); what each number
means and when one is published is [RELEASING.md](RELEASING.md).

Entries land here under `## [Unreleased]`, with no version and no date. A
release PR is what stamps them.

## [Unreleased]

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
