# Security

## Reporting

Report a vulnerability privately through GitHub's
[security advisory form](https://github.com/truecopydev/truecopy/security/advisories/new),
or by email to <florian.mousseau@gmail.com>. Please do not open a public issue
for it.

You will get an acknowledgement within a week. If the report holds, the fix and
the advisory go out together.

## Supported versions

The latest `1.x` release. There is no backport branch.

## What the surface actually is

Worth knowing before you look, because most of the usual surface is not here:

- **No network, ever.** No fetch, no telemetry, no remote configuration. The
  bytes a caller hands over never leave the process.
- **No filesystem.** The library runs in a browser. Only `bin/truecopy.mjs`,
  the command-line entry point, reads a path — and it reads only the file named
  on the command line.
- **No runtime dependency.** `pdfjs-dist` is an optional peer, loaded on demand
  and owned by the caller.

What is left, and what a report is most likely to be about:

- **A pattern that hangs the page.** `pattern.ts` compiles regular expressions
  that may arrive as untrusted data and are applied to untrusted data. A source
  over 1000 characters, or one carrying a nested quantifier, compiles to
  `NEVER_MATCHES` rather than throwing — the feature degrades, the page lives.
  A shape that gets past that guard and goes super-linear is a vulnerability.
- **A document that never finishes opening.** `openDocument` caps the bytes,
  caps the pages and holds a deadline. A file that defeats all three is a
  vulnerability; the tab freezing is the whole thing this is meant to prevent.
- **A defect in pdf.js.** Reported upstream, not here — but tell us anyway, so
  the peer range can move.

A reading that comes back **wrong** is a bug, not a vulnerability. A reading
that comes back wrong **and says nothing** is the defect this library exists to
prevent, and it is worth an issue of its own.
