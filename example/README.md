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
        no-eval.yml                                  the rule
        tests/fail/eval-of-input/parse.js            code it must flag
        tests/pass/json-parse/parse.js               code it must leave alone
    vale/no-simply/
        no-simply.yml                                the rule
        .vale.ini                                    which files it applies to
        tests/fail/simply-in-prose/hedged.md         prose it must flag
        tests/pass/no-hedge/direct.md                prose it must leave alone
```

Two details in there need explaining.

**Each test case is a directory.** `verify` runs the engine's own check over
each case as if it were a small repository, so the rule's scope applies to its
fixtures the same way it applies to your code. A rule limited to some paths
needs its fixture at such a path inside the case. The directory name says what
the case shows.

**Only Vale has a per-rule `.vale.ini`.** Vale can't express "which files does
this apply to" inside the rule file, because it rejects unknown keys. Scope
needs somewhere else to live. ast-grep puts its equivalent (`files`, `ignores`)
inside the rule, so an `sg` rule gets no second file.

You won't find a project-wide `.vale.ini` or `sgconfig.yml` here. Both get
assembled from the per-rule configs when a check runs, and both are gitignored.
They're build output.

## What `check` reports

```
$ ./.taskless/bin/cli.mjs check

  example.cjs:7:10
  error[no-eval] Avoid eval. It executes whatever string it's handed.
  > eval("(" + raw + ")")
  note: `eval` runs arbitrary code with the caller's permissions. Parse the value
instead: `JSON.parse` for JSON, a real parser for anything else.


  example.html:7:11
  warning[no-simply] Avoid 'simply'. It tells the reader the work was easy.
  > simply

2 issues (1 error, 1 warning) across 2 files
```

One finding from each engine, merged into one report. The exit code follows
severity, so this run exits 1 on the `error`.

## Running it yourself, in this repo

The commands on this page run `./.taskless/bin/cli.mjs`, the launcher `init`
writes into a real install, which runs the CLI version the project records.
This example ships without one. To run the CLI in this checkout, build it first
and then call it from here:

```
pnpm --filter @taskless/cli build     # from the repo root
cd example
../packages/cli/dist/index.js check
```

Substitute that path for `./.taskless/bin/cli.mjs` in every command on this page.
Note that `check` writes the two assembled configs into `.taskless/`, so
expect them to appear after the first run. Both are gitignored.

## Checking the rules themselves

`check` runs rules against your code. Two other commands run against the rules:

```
$ ./.taskless/bin/cli.mjs validate   # are these rules well-formed?
$ ./.taskless/bin/cli.mjs verify     # do they fire where they should, and only there?
```

Both take a path: a rule directory, an engine directory, or nothing at all for
everything. `verify` runs `validate` first and stops if it fails. That way a broken
rule tells you what's broken.

## This example is tested

`packages/cli/test/example-project.test.ts` runs `check`, `validate`, and `verify`
against this directory and asserts on what comes back. A demo that's drifted
from the layout it demonstrates is worse than no demo. If the layout changes
and this stops being true, the build fails.
