# What four readers rebuilt

Four applications install this library: fidalo (bank statements), relevedecarriere
(pension records), titelia (UCITS fund reports) and murparmur (French REIT annual
reports). This is what they wrote AROUND it, read across all four on 12 August 2026.

An earlier survey looked at one consumer and found five defects
(`murparmur/docs/truecopy-defauts.md`). Reading four at once answers a different
question, and a better one: **what did two or three of them build separately?**
A mechanism one project needs is that project's business. A mechanism three
projects wrote three times, each without knowing about the others, is a hole in
this library.

Nothing below is a preference. Each point names where the code is and what was
measured.

## 1. A record that spans several lines

**Three of the four wrote it, and it breaks a mechanism this library already
ships.**

| where                                                  | what it handles                                                          |
| ------------------------------------------------------ | ------------------------------------------------------------------------ |
| `murparmur/src/lib/domain/inventaire.ts:485`           | the street on one line, the postcode on the next, the figures on a third |
| `titelia/src/lib/sources/inventaire.ts:284`            | a name printed on two baselines with its own figures BETWEEN them        |
| `fidalo/src/lib/statement-parser/semantics/headers.ts` | a wording that wraps onto a second line                                  |

The measurement is not marginal. murparmur reads 424 buildings over twenty
reports assuming one record per physical line, and 2 110 grouping into blocks
first: a factor of five. titelia shipped six nameless positions to production,
one of them 1,19 % of a fund, because the row carrying the amounts carried no
name and nothing but the arithmetic was checked.

All eight mechanisms here (`open`, `notation`, `classify`, `columns`, `roles`,
`signature`, `schema`, `explain`) work on the physical line. Worse, `signature`
works AGAINST these documents: a continuation line carries one filled cell, so
it breaks the table's type signature and comes back as an anomaly when it is a
valid fragment.

What is missing is a ninth mechanism that groups rows into records before
`signature` and `schema` speak. It stays domain-free: what joins two lines is
that one of them cannot stand alone in the shape the table has established.

## 2. The value that goes with a label

**Three of the four wrote it, in three different shapes, and this library
documents the need without answering it.**

- `relevedecarriere/src/lib/domain/preuves.ts:72` - `valeurApres`: a reach of
  four lines below the label, stopping at the NEXT label. Without that second
  bound, two schemes printed close together made the second one's figure count
  for the first as well: a doubled total, so a false proof, so a refusal on a
  correct reading.
- `titelia/src/lib/sources/inventaire.ts:635` - `declaredTotal`: the first cell
  that parses as an amount, on the row whose first cell closes the statement.
- `murparmur/src/lib/domain/inventaire.ts:392` - `colonneDesSurfaces`: the same
  question one axis over, a header cell giving the index of a column. Requiring
  the unit inside each cell returned 0 surfaces out of 289; reading it from the
  header returned 162.

None of the three carries a domain word. And `contract.ts` states the need in as
many words: `SelfCheck.declared` is a LIST because "a document may announce
several candidate values when its layout scattered a label from its number". The
type accommodates the problem and no mechanism finds the values.

## 3. A cell holding two columns

**Two of the four met it, neither got a word from this library.**

The column cut merges two neighbours and their contents land in one cell.
Downstream, nothing distinguishes it from a wide column.

- titelia returns EVERY ambiguous cut and lets the document choose
  (`splitsGlued`, `wellGrouped`, `glued`, `inventaire.ts:134-216`). The cut is
  genuinely undecidable inside the cell: "1 300 000 106 236 000,00" reads two
  ways, both well formed, because the French thousands separator is a space. The
  sub-total printed above resolves it.
- murparmur refuses a column whose header declares two units
  (`DECLARATION_UNITE`). Read as a surface, one such column produced 97 wrong
  values out of 162, up to "4 802 180 000 152 200 m2".

Two consequences for this library:

- **A `Doubt` is missing.** A header cell carrying two unit declarations where
  its neighbours carry one is a local signal, no domain knowledge required, and
  exactly what a layer that certifies a reading should say out loud.
- **`wellGrouped` belongs in `notation`.** "Is this number grouped the way this
  document groups its thousands" is pure typography, and titelia measured what
  it buys: without it, a cut leaves 1 300 where the report prints 1 300 000. The
  value still closes its sector, so no arithmetic ever catches it. A quantity
  nothing cross-checks is precisely where a silent lie fits.

## 4. Folding accents, which this library already does in private

`notation.ts:280` holds `accentFree`, used so a table of month names need not
carry every spelling. It is not exported, so:

| where            | copies                                                      |
| ---------------- | ----------------------------------------------------------- |
| fidalo           | 15                                                          |
| titelia          | 5, one of them a file of its own (`src/lib/domain/fold.ts`) |
| murparmur        | 4                                                           |
| relevedecarriere | 0, it reads no accented label                               |

Three consumers, twenty-four copies, one line each. Exporting it costs a line in
`API.md`.

## What this library already has, and nobody uses

Three findings of the same kind, and they are the uncomfortable ones: the answer
shipped and the consumer wrote its own anyway.

**`checkExtraction` does what titelia and relevedecarriere each built by hand.**
`readVerifiedInventory` (titelia) and `preuves.ts` (relevedecarriere) both sum
what was read, compare it against what the document declares, and refuse the
gap. Two measurable reasons neither reached for the library version:

- **Granularity.** It takes a whole `Document`. titelia needs it per section AND
  per heading: one Echiquier report carries eleven inventories over 943 pages,
  one DNCA report twenty-five sub-funds over 573.
- **Scope of the invented-value check.** The set of figures "written in the
  document" is built from `document.text` entire. Over a 200-page report, any
  number anywhere validates any row. murparmur hit exactly this defect on its own
  version and fixed it by bounding the search to the lines the reader CITED, and
  by comparing digits over neighbouring tokens rather than over flattened text:
  flattened, "410" appears three times inside "142939028066171005" without a
  single 410 existing. The guard looked strong and protected almost nothing.

**`decimalMarkOf` and `readNumber(raw, mark)` shipped in 1.0.2 for this.** titelia
still declares its own `Notation = 'fr' | 'en'` and its own `parseAmount`,
murparmur its own `nombre()`. Both are on 1.0.2.

**The legacy build is already the default.** `open.ts:270` imports it when the
caller passes no engine. Nine scripts (four in murparmur, five in titelia) import
`pdfjs-dist/legacy/build/pdf.mjs` and pass it in, each carrying the same comment
about DOMMatrix. The README states the choice under Requirements; what it never
says is the sentence that would have saved those nine imports: **in Node, omit
the option.**

## Two smaller things, both measured twice

- **Limits for batch ingestion.** murparmur raises them to 80 MB / 600 pages /
  180 s, titelia to 200 MB / 2000 pages / 1 200 s, each with the same reasoning
  written out: the defaults protect a browser tab, and a REIT annual report
  runs to 45 MB. Two independent readers reaching the same conclusion is an
  argument for a named profile beside `DEFAULT_LIMITS`, or at least a line
  saying `maximumBytes` is meant to be raised by a script.
- **`standardFontDataUrl` is never passed to pdf.js.** `open.ts` calls
  `getDocument({ data })` and the `PdfEngine` interface cannot carry the option.
  This one corrupts the TEXT: "TAqgie Viqqe" for "Typologie Ville", "B ALLAN -M
  IR e" for a commune published on a public site. Only one consumer measured it,
  and it is the most serious thing in this file. It does not even need a
  consumer to reproduce: `npm run test:coverage` prints
  `UnknownErrorException: Ensure that the standardFontDataUrl API parameter is
provided` four times, on this repository's own PDF fixtures.

## What must not come here

The line holds and this survey confirms it. None of the following belongs in this
library, whatever the duplication:

- titelia's `Dialect`: which wording opens a French statement rather than a
  Luxembourg one.
- murparmur's `SURFACE_MAXIMALE_M2`, its street words, its typology table.
- fidalo's locale profiles.

That is the meaning of the documents, and it travels as data. What is listed
above is shape, typography and arithmetic - which is what this library is for.
