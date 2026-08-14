# A Taskless install, as it actually looks

This is a small project with Taskless rules in it. Everything here is real: the
same layout you get after installing, so you can read it before you commit to
anything.

Two rules, one per engine.

## The files

| Path           | What it is                                              |
| -------------- | ------------------------------------------------------- |
| `example.cjs`  | A CommonJS module that calls `eval` on file contents     |
| `example.html` | A page with a Title Case heading and some hedging prose  |
| `.taskless/`   | The rules. No build output, no cached state.             |

## What a rule looks like

A rule is **one directory**. It holds everything that defines it. Adding a rule
means adding a directory. Removing one means removing that directory. No shared
file gets edited either way.

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

Two details in there need explaining.

**`.tests/` is dot-prefixed on purpose.** ast-grep discovers rules by walking
the rules tree, and it reads every `.yml` it finds as a rule. A plain `tests/`
directory would make it parse the test files as rules and fail the whole scan.
A dot-directory gets skipped by that walk. The test runner still finds it.

**Only Vale has a per-rule `.vale.ini`.** Vale can't express "which files does
this apply to" inside the rule file, because it rejects unknown keys. Scope
needs somewhere else to live. ast-grep puts its equivalent (`files`, `ignores`)
inside the rule, so an `sg` rule gets no second file.

You won't find a project-wide `.vale.ini` or `sgconfig.yml` here. Both get
assembled from the per-rule configs when a check runs, and both are gitignored.
They're build output.

## What `check` reports

```
$ npx @taskless/cli check

  example.cjs:7:10
  error[no-eval] Avoid eval. It executes whatever string it's handed.
  > eval("(" + raw + ")")

  example.html:7:11
  warning[no-simply] Avoid 'simply'. It tells the reader the work was easy.
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

Both take a path: a rule directory, an engine directory, or nothing at all for
everything. `test` runs `verify` first and stops if it fails. That way a broken
rule tells you what's broken.

## This example is tested

`packages/cli/test/example-project.test.ts` runs `check`, `verify`, and `test`
against this directory and asserts on what comes back. A demo that's drifted
from the layout it demonstrates is worse than no demo. If the layout changes
and this stops being true, the build fails.
