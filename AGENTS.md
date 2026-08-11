# AGENTS.md

Rules for any agent or contributor working in this repo. They are not tied to a
particular tool. This file is tracked by git, so a fresh clone has it: it must
stand on its own. `README.md` says what the library does, `API.md` is the
generated surface, `CONTRIBUTING.md` covers the human side and `RELEASING.md`
covers versions.

`truecopy` turns a PDF, a paste or a CSV into rows, and **refuses the readings it
cannot trust**. That refusal is the product. Everything below protects it.

## The line that is never crossed

**A reading that cannot be trusted is refused, never guessed.** Emitting a
plausible row for a document the parser did not understand is the one failure
this library exists to prevent - it happened on a points statement and produced
22 confident, absurd findings. When a shape is unknown, say so through the
result, do not interpolate.

Two consequences that look like details and are not:

- Extraction glues neighbouring columns together, so a `\b` after a number is a
  trap: `1 234 56789` can be two cells. Assert on the geometry, not on a regex
  that happens to pass today.
- Every claim the package makes about itself - in the README, the docs or the
  package metadata - must be true of the installed tarball. A keyword like `ocr`
  was removed for exactly this reason: it promised a capability the code does
  not have.

## The gate

```sh
npm run gate
```

= `format:check` + `dashes` + `lint` + `check` + `build` + `api` + `skill` +
`knip` + `dup` + `test:coverage`. Green before every push, no exception. When it
is red, fix the cause: never weaken a rule, raise a threshold or disable a test
to get through. Any exception needs explicit human approval in the PR.

Two of those checks are unusual and are load-bearing:

- `dashes` fails on any typographic dash. They are an AI signature and this repo
  refuses them, in prose as in code.
- `api` and `skill` regenerate the published surface. A drift there means the
  documentation and the packaged agent skill no longer describe the code.

## Git

- `main` is the only long branch. Work goes through `feature/*`, `fix/*`,
  `chore/*` or `docs/*` and a pull request - never a direct push to `main`.
- Branch and PR names follow open-source convention: English, kebab-case, and
  **no tool prefix** - not `claude/`, not `agent/`, not `codex/`. A merge commit
  carries the branch name into the history for good.
- Commits: conventional, English, pure ASCII. Author is always
  Florian Mousseau <florian.mousseau@gmail.com>. **No AI mention anywhere** - no
  co-author line, no trailer, no branding in a commit, a branch or a PR body.
  `gh pr create` sometimes adds a generated-by trailer: re-read the body and
  remove it.
- This repo is **public**, and a public commit is final: work goes through a
  pull request whatever its size. Since 9 August 2026 an agent merges its own,
  under one condition stricter than a private repo's: **the gate is really
  green - checks present AND passed**. A pull request carrying no check at all
  does not merge, whatever the reason for their absence.

## Releases

`RELEASING.md` is authoritative. The short version: **patch, unless an installed
app breaks**. A new export does not move the second digit - almost every release
adds one, so that criterion would move it forever. A burnt number is never
reclaimed, nothing is ever unpublished.

**An agent publishes to npm**, since 9 August 2026 and for the same reason the
merge moved: a fix nobody installs repairs nobody. What does not undo itself is
unchanged and is what keeps this safe - a burnt number is never reclaimed, so
the last digit moves, a patch when in doubt, and the gate is green before the
registry sees anything. A release stays a deliberate act with a reason, never
one because CI went green.

Two traps already paid, both in `publish.yml`:

- a `workflow_dispatch` without a tag input ships the default branch, not the
  tag you meant;
- branch protection named `non_fast_forward` does **not** freeze a tag - a tag
  walks forward happily. The rule that stops it is `update`.

## Scope

The reading corpus lives in a separate, private repo (`truecopydev/corpus`) and
stays private: it is the half a fork cannot copy. Never move a real document
geometry into this repo, and never commit a document that has not been
de-identified there first.
