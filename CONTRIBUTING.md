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

## Branches

`main` is the only long-lived branch, and it is always releasable. Every change
lands as a small pull request against it: a short-lived topic branch, a green
gate, a squash merge, and the branch is deleted. There is no develop branch and
no release branch — a release is a tag cut from `main`, nothing more.

`main` is protected and takes no direct push, from anybody, including the
maintainer. That is not ceremony: a rule that its author can step over is a
preference, and the one thing a pull request guarantees is that the diff was
looked at once, on a page, by somebody who was not mid-thought.

The gate is a required check. A pull request cannot merge red.

## Commits

One change per commit, present tense, and a subject that says what the reader
gets rather than what the diff does: `feat: the reading names the unit it
measured in`, not `update explain.ts`.

## Versioning

Semantic versioning, and **releases are patches**. `1.0.x` covers a fix, a new
rule, an added function, an added option, a new entry point — everything that
does not break a caller.

The second digit does not move because a release added surface. Almost every
release adds surface, so a rule that spends a minor on it spends one every
week, and the number stops meaning anything. It moves when the maintainer
decides in writing that it should. The first moves for a break.

Why that is narrower than it looks, what a release costs once it is out, and
how one is actually cut: [RELEASING.md](RELEASING.md).

## Releasing

Merging does **not** publish. Your pull request carries its changelog entry
under `## [Unreleased]`, with no version number and no date; a separate release
pull request stamps those later over whatever has accumulated. Green CI is a
precondition for a release, never a reason for one.

The four steps, and why the bump does not travel inside a feature PR:
[RELEASING.md](RELEASING.md).

A version is never unpublished. Somebody's lockfile already has it.
