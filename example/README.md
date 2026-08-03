# A reader that runs

```sh
npm install
npm run build
node example/read-a-statement.mjs
```

[`read-a-statement.mjs`](read-a-statement.mjs) builds a real PDF, opens it,
prints what the reading decided, and drives that reading through the contract.
Nothing in it is stubbed. The same call sequence works on a file somebody
dropped.

It is deliberately one file and one command. An example that needs a document
you do not have is an example you cannot run, so it makes its own.

## What it shows

|                    |                                                        |
| ------------------ | ------------------------------------------------------ |
| `openDocument`     | bytes to pages to rows, with the caps and the deadline |
| `explainDocument`  | what was decided, and why the total line was dropped   |
| `findRowAnomalies` | the table's own signature, learned from the table      |
| `readDocument`     | the contract: verdict, self-check, rows to review      |

**Three methods.** The reader implements `read`, `selfCheck` and
`rowsToReview`. It writes no `refuse`, and the last line of the output shows a
document without substance being refused anyway - the default errs toward
refusing, which is the only direction a default may err in.

## One warning to expect

pdf.js prints `Ensure that the standardFontDataUrl API parameter is provided`.
It wants that data to render a page; this library only reads where the text
sits, and never renders. The warning is harmless here.
