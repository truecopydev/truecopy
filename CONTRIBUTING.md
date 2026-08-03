# Contributing

Issues and pull requests are welcome. This page is short because almost
everything is held by one command rather than by a convention you have to
remember.

## The gate

```sh
npm install
npm run gate
```

Format, lint (zero warnings), typecheck, build, `knip`, `jscpd`, tests,
coverage. It runs on every push and every pull request, and it is the same
command locally and in CI — if it is green on your machine it is green here.

Coverage thresholds are **100 %** on statements, branches, functions and lines,
and they are a ratchet: they only ever go up. That is not a target, it is a
floor. A library that measures other people's readings measures itself first.

## What a change needs

- **A test that fails without it.** Every rule in `src/` exists because a real
  document broke something; the test is what stops it breaking again.
- **A line in [`CHANGELOG.md`](CHANGELOG.md)**, under a `## [Unreleased]`
  heading, saying what changed and why somebody would care. Not what the
  function is now called.
- **No new runtime dependency.** The package ships none. `pdfjs-dist` is an
  optional peer the caller owns, loaded only when a PDF turns up.
- **Nothing about your documents.** The library never learns what a cell means:
  the caller names the kind, this code counts, divides and compares. A change
  that teaches it what a debit is belongs in the application, not here.

Regular expressions here run over whole documents, line by line, so every
quantifier must be bounded. `eslint-plugin-regexp` refuses the two shapes that
are not — that is the fifth law, held by a tool rather than by a comment.

## Commits

One change per commit, present tense, and a subject that says what the reader
gets rather than what the diff does: `feat: the reading names the unit it
measured in`, not `update explain.ts`.

## Versioning

Semantic versioning, and the majority of releases are **patches**.

- **1.0.x** — anything that does not change what a caller writes.
- **1.x.0** — a new export, a new option, a new entry point.
- **x.0.0** — a break.

The first two numbers do not move without the maintainer deciding they should,
in writing, in the changelog. A rename that is convenient is not a reason.

## Releasing

1. Move the `[Unreleased]` entries under a `## X.Y.Z` heading and write the
   paragraph that says what the release is for.
2. `npm version X.Y.Z`, which runs nothing but the bump and the tag.
3. Push the commit and the tag.
4. Run the **publish** workflow. It runs `npm ci`, then `npm publish`, and
   `prepublishOnly` puts the whole gate in front of the registry. Publishing
   with `--provenance` is what puts the verified badge on the npm page.
5. Cut the GitHub release from the tag, with the changelog section as its body.

A version is never unpublished. Somebody's lockfile already has it.
