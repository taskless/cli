# A Taskless install, as it actually looks

This is a small, real project with Taskless rules in it. Nothing here is a
fixture assembled by a test — it is the layout you get, laid out the way you
would find it, so you can read it before installing anything.

Two rules, one per engine.

## The files

| Path           | What it is                                                     |
| -------------- | -------------------------------------------------------------- |
| `example.cjs`  | A CommonJS module that calls `eval` on file contents            |
| `example.html` | A page with a Title Case heading and some hedging prose         |
| `.taskless/`   | The rules, and nothing else — no build output, no cached state  |

## What a rule looks like

A rule is **one directory**, and it holds everything that defines it. Adding a
rule means adding a directory; removing one means removing that directory. No
shared file is edited either way.

```
.taskless/rules/
    sg/no-eval/
        no-eval.yml                       the rule
        .tests/no-eval-20260814-test.yml  its test cases
    vale/no-simply/
        no-simply.yml                     the rule
        .vale.ini                         which files it applies to
        .tests/fail/hedged.md             prose it must flag
        .tests/pass/direct.md             prose it must leave alone
```

Two things in there are worth explaining, because neither is obvious.

**`.tests/` is dot-prefixed on purpose.** ast-grep discovers rules by walking
the rules tree, and it reads every `.yml` it finds as a rule. A plain `tests/`
directory would have it try to parse the test files as rules and fail the whole
scan. A dot-directory is skipped by that walk while the test runner still finds
it.

**Only Vale has a per-rule `.vale.ini`.** Vale cannot express "which files does
this apply to" inside the rule file — it rejects unknown keys — so scope needs
somewhere else to live. ast-grep puts its equivalent (`files`, `ignores`)
inside the rule, so an `sg` rule needs no second file and does not get one.

You will not find a project-wide `.vale.ini` or `sgconfig.yml` here. Both are
assembled from the per-rule configs when a check runs, and both are gitignored
— they are build output, not something to edit.

## What `check` reports

```
$ npx @taskless/cli check

  example.cjs:7:10
  error[no-eval] Avoid eval — it executes whatever string it is handed.
  > eval("(" + raw + ")")

  example.html:7:11
  warning[no-simply] Avoid 'simply' — it tells the reader the work was easy, not what to do.
  > simply

2 issues (1 error, 1 warning) across 2 files
```

One finding from each engine, merged into one report. The exit code follows
severity, so this run exits 1 on the `error`.

## Checking the rules themselves

`check` runs rules against your code. Two other commands run against the rules:

```
$ npx @taskless/cli verify     # are these rules well-formed?
$ npx @taskless/cli test       # do they fire where they should, and only there?
```

Both take a path — a rule directory, an engine directory, or nothing at all for
everything. `test` runs `verify` first and stops if it fails, so a broken rule
tells you what is broken rather than complaining that its fixtures are
incomplete.

## This example is tested

`packages/cli/test/example-project.test.ts` runs `check`, `verify`, and `test`
against this directory and asserts on what comes back. A demo that has drifted
from the layout it demonstrates is worse than no demo, so if the layout changes
and this stops being true, the build fails rather than leaving something
misleading in the repository.
