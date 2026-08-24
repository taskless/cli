---
"@taskless/cli": patch
---

Let ast-grep rules see inside hidden directories such as `.github/`.

ast-grep's file walker skips dot-directories unless told otherwise, and
`runAstGrepScan` never told it otherwise. No `sg` rule could match anything
under `.github/`, `.circleci/`, `.vscode/` or `.husky/`, so `check` reported
nothing and exited 0 on a workflow file it flags correctly the moment the same
bytes live in a non-hidden directory. Vale has no such blind spot, which left
the two static engines disagreeing about whether `.github/` existed at all.
Both `check` and the runtime engine's ast-grep narrow now pass
`--no-ignore hidden`.

Only `hidden` is passed, and deliberately not `vcs`: `.gitignore` is still
respected, so the wider walk does not start reporting findings in `dist/` or
anywhere else a project has already said it does not want scanned. Rule
discovery is untouched — `ruleDirs` walks by its own rules, so a rule's
`.tests/` directory is still skipped rather than parsed as a rule.

`.taskless/` is excluded from the wider walk, because it is hidden too and
reaching it is not a fix. A rule definition is structured YAML full of `id:`,
`language:`, `severity:` and `rule:` keys, so an ordinary user-written Yaml rule
fires on the CLI's own rule files — a finding in a directory the user did not
author and cannot edit without disabling their rule. The exclusion applies only
when `check` walks the whole project on its own; an explicit path stays a
request, which is the rule the Vale runner already follows.

`.git/` is excluded on the same terms. ast-grep has no exclusion of its own for
it and `.gitignore` does not list it, so the default hidden-directory skip was
the only thing holding it back: without this, a whole-project `check` descended
into `.git/objects` and `.git/logs` on every run, and `.git/hooks/*` scripts
matched language rules never meant to lint VCS internals.

Both engines now decide "whole project" the same way, and it is no longer
`paths.length === 0`. An explicit `.` is normalized to the literal path `"."`
before it reaches either runner, so a length test read the most ordinary way of
asking for a whole-project check as a user-named path and skipped the exclusions
— `check` was clean while `check .` reported findings inside `.taskless/`. Vale
was already wrong in the same way and for the same reason, independently of the
hidden-directory change, so the predicate is now shared rather than written
twice.
