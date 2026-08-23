# Public API

Every name this package exports, by entry point. Generated from `dist` by
`npm run api`, and checked by the gate: a surface that drifts from this file
fails before it is published.

It is committed because knip cannot see it. The barrel is the entry point, so
everything it re-exports counts as used and a name nobody imports stays green
forever. Here, adding one is a line in a diff.

```text
18 entry points, 68 values, 61 types
a name reachable through its own entry point and through the barrel is listed twice

truecopy
  value  accentFree
  value  assignRoles
  value  boundariesFromAnchors
  value  boundariesFromRecurrence
  type   Candidate
  value  carriesNumber
  value  carriesText
  type   Cell
  value  cellAt
  value  cellsOf
  value  checkContract
  value  checkExtraction
  type   CheckResult
  value  citedText
  value  classifyDocument
  value  columnAt
  value  columnBoundaries
  value  columnCount
  value  columnOfHeader
  type   ColumnProfile
  type   CompileOptions
  value  compilePattern
  value  conforms
  type   ContractOptions
  value  contractReport
  type   CoordinateUnit
  type   CorpusCase
  value  countMatches
  type   DecimalMark
  value  decimalMarkOf
  value  DEFAULT_LIMITS
  value  describeAnomaly
  value  describeDoubts
  type   Discrepancy
  type   Document
  value  documentFrom
  value  documentFromText
  type   DocumentKind
  value  documentWithoutSubstance
  value  dominantKind
  type   Doubt
  value  explainDocument
  type   ExplainOptions
  value  explainReading
  value  explainRows
  type   Extraction
  value  failures
  type   Field
  type   FieldFormat
  type   Finding
  value  findNumbers
  value  findRowAnomalies
  type   FoundNumber
  value  gapFor
  value  isOnlyNumber
  type   KindThreshold
  type   Labelled
  value  labelledValues
  type   LabelOptions
  type   LeadingDate
  type   Limits
  type   Look
  value  NEVER_MATCHES
  type   Notation
  value  numberedRows
  value  numberToken
  value  openDocument
  type   OpenOptions
  value  pageFrom
  type   PatternSet
  type   PdfEngine
  value  pdfWithPages
  value  pdfWithText
  type   Place
  type   PlacedWord
  value  placeOf
  value  placesOf
  type   PositionedItem
  value  positionedItems
  value  profileColumns
  type   ProfileOptions
  type   RawPattern
  value  readDate
  value  readDocument
  type   Reader
  type   Reading
  value  readLeadingDate
  value  readNumber
  type   ReadResult
  value  readTable
  type   RecordBlock
  type   RecordDoubt
  type   RecordFinding
  type   RecordOf
  type   Records
  value  recordsFrom
  type   RecordsOptions
  type   Refusal
  type   Requirement
  type   ReviewableRow
  type   RoleRule
  type   Row
  type   RowAnomaly
  value  rowsFrom
  value  rowToCells
  type   Schema
  value  schemaOf
  type   SchemaViolation
  type   SelfCheck
  value  sharesByKind
  type   SignatureOptions
  value  spineWidthOf
  type   StandardSchema
  type   Table
  type   TableOptions
  type   TextPage
  value  thresholdsFor
  value  toRawPattern
  type   Unreadable
  value  UnreadableDocument
  value  validate
  value  validateWith
  type   Verdict
  value  wellGrouped
  value  withDeadline

truecopy/open
  value  DEFAULT_LIMITS
  type   Limits
  value  openDocument
  type   OpenOptions
  type   PdfEngine
  value  positionedItems
  type   Unreadable
  value  UnreadableDocument
  value  withDeadline

truecopy/layout
  value  boundariesFromAnchors
  value  boundariesFromRecurrence
  value  cellsOf
  value  columnAt
  value  columnBoundaries
  value  documentFrom
  value  documentFromText
  value  gapFor
  value  pageFrom
  value  placeOf
  value  placesOf
  value  rowsFrom
  value  rowToCells

truecopy/table
  type   Doubt
  type   Finding
  value  readTable
  type   Table
  type   TableOptions

truecopy/notation
  value  accentFree
  type   DecimalMark
  value  decimalMarkOf
  value  findNumbers
  type   FoundNumber
  value  isOnlyNumber
  type   LeadingDate
  type   Notation
  value  numberToken
  value  readDate
  value  readLeadingDate
  value  readNumber
  value  wellGrouped

truecopy/classify
  value  classifyDocument
  type   DocumentKind
  type   PatternSet
  type   Requirement

truecopy/columns
  value  cellAt
  value  columnCount
  type   ColumnProfile
  value  dominantKind
  value  profileColumns
  type   ProfileOptions

truecopy/roles
  value  assignRoles
  type   RoleRule

truecopy/labels
  type   Candidate
  type   Cell
  value  columnOfHeader
  type   Labelled
  value  labelledValues
  type   LabelOptions
  type   Look

truecopy/records
  type   RecordBlock
  type   RecordDoubt
  type   RecordFinding
  type   Records
  value  recordsFrom
  type   RecordsOptions
  value  spineWidthOf

truecopy/signature
  value  findRowAnomalies
  type   KindThreshold
  type   RowAnomaly
  value  sharesByKind
  type   SignatureOptions
  value  thresholdsFor

truecopy/schema
  value  conforms
  type   Field
  type   FieldFormat
  type   RecordOf
  type   Schema
  value  schemaOf
  type   SchemaViolation
  type   StandardSchema
  value  validate
  value  validateWith

truecopy/cite
  value  carriesNumber
  value  carriesText
  value  citedText
  value  numberedRows

truecopy/pattern
  type   CompileOptions
  value  compilePattern
  value  countMatches
  value  NEVER_MATCHES
  type   RawPattern
  value  toRawPattern

truecopy/contract
  value  checkExtraction
  type   Discrepancy
  type   Extraction
  value  readDocument
  type   Reader
  type   Reading
  type   ReadResult
  type   Refusal
  type   ReviewableRow
  type   SelfCheck
  type   Verdict

truecopy/explain
  value  describeAnomaly
  value  describeDoubts
  value  explainDocument
  type   ExplainOptions
  value  explainReading
  value  explainRows

truecopy/kit
  value  checkContract
  type   CheckResult
  type   ContractOptions
  value  contractReport
  type   CorpusCase
  value  documentWithoutSubstance
  value  failures
  value  pdfWithPages
  value  pdfWithText
  type   PlacedWord

truecopy/mcp
  type   McpCapabilities
  type   McpResponse
  value  respond
  value  TOOLS
```
