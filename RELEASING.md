# Releasing

What a version number means here, when one is published, and what will never
change under you.

## The promise that actually matters

truecopy reads other people's documents. The number on the package is not what
you are trusting: the reading is, and a reading is not something a changelog
can promise in prose.

So the library ships the check instead of the promise.
[`checkContract`](src/kit.ts) runs your corpus against your reader and writes a
report you commit. **A truecopy upgrade that changes what your documents read
as moves a line in that file**, in your repository, in a pull request, where
somebody has to look at it. Not in a table that quietly went from twenty-six
records to twenty-four.

That is the mechanism, and it is worth more than any compatibility claim made
here: a promise about readings is exactly the kind nobody can verify, which is
why this library exists.

Everything below is about the package.

## What earns which number

**Patch, unless a caller breaks.** Move the last digit. That is the rule, not
the default with exceptions.

| Bump      | When                                                                                                                                                       |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **major** | Existing code stops compiling, or reads differently without changing a line.                                                                               |
| **minor** | Almost never. Reserved for what no reader could take for a routine release: a different way of using the library altogether. A new entry point is not one. |
| **patch** | Everything else, without an exception to look for: a fix, a new rule, a `.d.ts` correction, an added function, an added option, a new subpath.             |

**The second digit stays put.** It does not move because a release added an
export, and it does not move because a release feels big. It moves when the
maintainer decides in writing that it should, in the changelog, having said
what makes this one different, and that decision has not been made yet.

This is narrower than what CONTRIBUTING.md said until now, which read "1.x.0 for
a new export, a new option, a new entry point". The reason it changed is
[selfstore](https://github.com/selfstoredev/selfstore), which shipped that
exact rule and went from 1.6 to 1.8 in three days: almost every release adds
surface, so the minor climbs continuously and the patch digit never moves at
all. A version number is a signal about how much has changed. When it moves at
the same speed whatever happens, it stops carrying one.

What a release is worth installing for belongs in its CHANGELOG entry, which
says it in prose and in detail. The digit cannot say it and should stop trying.

Two consequences, because they are where semver usually gets bent:

- **A fix that changes a reading an app could have relied on is still a patch**
  if the old reading was wrong. The changelog says so explicitly, by name, and
  the conformance report is what makes it visible on the consumer's side.
- **A new default is a major**, even when the code compiles. A silent change of
  behaviour is the one that costs a debugging afternoon.

## When a release is cut

Merging to `main` does **not** publish. A release is a deliberate act with a
reason: a fix someone is waiting for, or a batch of work worth installing.

The rule, in one line: **no more than one release a day, unless the second one
repairs the first.**

Green CI is a precondition for a release, never a reason for one.

## Nothing gets unpublished

Published versions stay published, even superseded ones, even mistakes. The
`0.0.1` → `0.1.2` line from 2 and 3 August 2026 is still on npm, published while
the API was still moving; **1.0.0 (3 August 2026) is the first release meant to
be depended on**, and the earlier ones stay where they are.

Two reasons, both concrete:

- **An unpublished version number is burned forever.** npm never lets it be
  reused, so the history acquires a hole no future release can fill.
- **A lockfile somewhere pins that exact version.** A caret range resolves
  forward; `npm ci` resolves to the exact entry in the lock. Unpublishing it
  turns somebody's reproducible install into a failing one, with no warning and
  nothing they can do about it.

The tool for a release that should not be used is `npm deprecate`, which leaves
it installable and says so at install time. The tool for a broken release is
the next release.

## The mechanism, not just the intention

A rule that depends on remembering it gets broken. So the bump does not travel
inside the feature PR: if it did, every merge would already be a release, and
not publishing would take more effort than publishing.

- **A feature PR carries its CHANGELOG entry under `## [Unreleased]`**, written
  while the reasoning is fresh, by whoever has it. No version number, no date.
- **A release is its own PR**: it stamps `[Unreleased]` with a number and a
  date, and bumps `package.json`. Nothing else.

Entries accumulating under `[Unreleased]` is the normal state of `main`, not a
backlog to clear. Batching becomes the path of least resistance, which is the
only kind of rule that survives.

## The steps

1. `main` is green and `[Unreleased]` holds something worth installing.
2. Open the release PR: stamp the section as `## [X.Y.Z] - YYYY-MM-DD`, bump
   `package.json` **and `.claude-plugin/plugin.json`**, which carries the same
   number because the skill it ships documents that surface. `npm run skill`
   fails when the two disagree, so this is not a step to remember.
   Merge it.
3. Run the **release** workflow with `X.Y.Z`. It checks that `package.json` and
   the changelog agree, then cuts the tag and the GitHub Release from that
   section.
4. Run the **publish** workflow with `vX.Y.Z`. It publishes that tag (not
   `main`) with `--provenance`, and `prepublishOnly` puts the whole gate in
   front of the registry.

Both are manual, and both are meant to be. A tag must not be able to publish on
its own: tags get pushed to see what CI says.

`refs/tags/v*` accepts no update at all: not a deletion, not a rewind, and not
a move forward. A tag, once cut, points where it points forever, which is what
makes the provenance attestation on the npm page mean anything.

Naming the third one matters, because forbidding the first two is not enough and
reads as though it were. "No force-push" only blocks a **rewind**; walking a
release tag **forward** onto a later commit is a fast-forward, so it goes
through, and forward is the direction that matters, since `main` advances after
every release. The rule that closes it is `update`.

An entry that only restates the diff is not an entry: the changelog says what
changed and **why**, in prose, because the why is the part nobody can recover
from the code six months later.

There is no develop branch and no release branch. See
[CONTRIBUTING.md](CONTRIBUTING.md).
