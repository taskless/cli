# Topic: check     (CLI v%(CLI_VERSION)s / topic v6)

## Goal
Run the applicable rules against the codebase and report matches. Two
rule kinds run: **static** ast-grep rules in `.taskless/rules/sg/`, and
**runtime** rules in `.taskless/rules/runtime/` (a directory of ast-grep
capture rules plus a `check.ts`). Used standalone (full project scan),
in CI (diff-only scan), or after rule create/improve to validate.

## Preconditions
- `.taskless/` directory exists.
- At least one rule exists in `.taskless/rules/sg/` or
  `.taskless/rules/runtime/`. (If none exist, the CLI exits 0 with a
  friendly message suggesting `%(TASKLESS_CLI)s rule create`.)
- No auth required. Static rules always run; whether runtime rules run
  depends on auth state. See "What runs".

## What runs

`check` never requires auth. What it verifies depends on whether you are
logged in:

- **Logged in** (token or API key): `check` copies `.taskless/rules/`
  aside, signs every file of every rule (ast-grep, Vale, and runtime),
  and asks the Taskless service which of them are exactly what it
  issued. Every engine then runs from that copy, so what runs is what
  was checked. What happens to each rule:

  | Verdict | ast-grep / Vale | runtime |
  |---|---|---|
  | issued and unchanged | runs | runs |
  | **edited** since it was issued | **does not run, and `check` exits 1** | does not run (reported, exit unchanged) |
  | issued but missing from disk | warning only | warning only |
  | written locally (never issued) | runs, silently | does not run |
  | a **copy** of an issued rule under a new id | **does not run, and `check` exits 1** | does not run |
  | withheld for the plan | never happens | does not run, and `check` exits 1 |

  `check` also exits 1 if the service's answer leaves out a rule it was
  asked about, or if two engines hold a rule with the same id.
- **Logged out, `--anonymous`, no GitHub remote, or service
  unavailable**: nothing is verified. ast-grep and Vale rules run as they
  are on disk, runtime rules are **skipped** (reported, never run), and
  the exit code is unaffected. `check` prints ONE notice saying the rules
  were not verified and naming the fix: `%(TASKLESS_CLI)s auth login` (or
  a `TASKLESS_TOKEN` secret in CI), dropping `--anonymous`, the specific
  remote problem, or the GitHub App installation. It prints whether or not
  the project has runtime rules, because the static rules ran unverified
  either way. Pass the fix on to the user rather than ignoring it.
- **`--dangerously-run-scripts`**: nothing is verified and no network
  call is made, logged in or not. Every rule of every engine runs,
  runtime included, behind a prominent warning. This is the only way to
  run runtime rules unverified.

`check` NEVER changes `.taskless/rules/`. An edited or missing rule is
reported with the command that repairs it:
`%(TASKLESS_CLI)s rule restore <ruleId>`, or, when the organization's
plan does not include restoring rules, the git steps that do instead
(see "When the plan does not include restoring rules").

Notices about skipped runtime rules are human-readable stderr only.
Under `--json` they do NOT appear as warnings; instead an additive
optional `skipped: [{ rule, reason }]` array is included alongside the
unchanged `{ success, results }`, the not-verified notice is an entry
in `notices`, and the CI backstop
(`%(TASKLESS_CLI)s agent ci`) is the enforcement point.

## An edited rule

When `check` fails because a rule was edited, `failures` names the rule
and each file that differs (changed, removed, or added), and `integrity`
carries the same as data:

```json
"integrity": [
  { "ruleId": "no-simply-1a2b3c4d", "engine": "vale", "verdict": "unsafe",
    "files": [{ "path": ".vale.ini", "expected": "1;h=…", "got": "1;h=…" }] }
]
```

**Do not edit the rule back by hand, and do not delete it.** Run
`%(TASKLESS_CLI)s rule restore <ruleId>` (see
`%(TASKLESS_CLI)s agent recover-rule`). If the edit was intended, the
rule has to be improved through the service (`improve-rule`) or
rewritten as a local rule under a new id. An edited rule is exactly what
an agent tuning a rule until its own violation passes looks like, which
is why `check` refuses it.

## A copied or renamed rule

A rule under a new id that still carries a file Taskless issued to
another rule of this repository is a copy, not a local rule. The
service names the rule it came from. An ast-grep or Vale copy does not
run and `check` exits 1; a runtime copy does not run either (no exit
change). When the source rule is also missing from disk, the two are
one rename and are reported once, in place of the source's missing
warning:

```
vale rule bar-2 is a copy of Taskless rule foo-1, which was deleted (changed .vale.ini), so it did not run and `check` fails. Run `%(TASKLESS_CLI)s rule restore foo-1` to put back the issued rule, then delete .taskless/rules/vale/bar-2/.
```

In `integrity` the copy is `unknown` with a `copyOf`, and `files` is
what differs from the source (a file carried unchanged under a new name
is not listed). The source keeps its own `missing` entry:

```json
"integrity": [
  { "ruleId": "bar-2", "engine": "vale", "verdict": "unknown",
    "files": [{ "path": ".vale.ini", "expected": "1;h=…", "got": "1;h=…" }],
    "copyOf": { "ruleId": "foo-1", "revisionId": "…", "sourceMissing": true } },
  { "ruleId": "foo-1", "engine": "vale", "verdict": "missing", "revisionId": "…" }
]
```

**Restore the source and delete the copy.** Run
`%(TASKLESS_CLI)s rule restore <copyOf.ruleId>`, then remove
`.taskless/rules/<engine>/<ruleId>/`. Do not restore the copy's own id:
it was never issued. If the source is still present
(`sourceMissing: false`), just delete the copy. If the user genuinely
wants a new local rule, it must not carry Taskless's files unchanged;
write it from scratch. Renaming an issued rule is not a way to edit it.

`integrity` also lists `missing` rules (with the `revisionId` restore
would bring back), runtime rules the service never issued and copies of issued rules
(`unknown`),
rules the answer did not account for (`unaccounted`), and ids shared
across engines (`duplicate`). Locally written ast-grep and Vale rules
are never listed; they run. A copy is listed with its `copyOf`.

## When the plan does not include restoring rules

When the organization's plan is known not to include restoring rules,
every notice above gives git steps where it would name `rule restore`:

```
sg rule no-eval-3fa9c21b was edited since Taskless issued it (changed no-eval-3fa9c21b.yml), so it did not run and `check` fails. Restoring rules is not included in your organization's plan, so recover no-eval-3fa9c21b from git. If the change is not committed yet, `git restore --source=HEAD -- .taskless/rules/sg/no-eval-3fa9c21b/` puts it back. If it is, `git log -- .taskless/rules/sg/no-eval-3fa9c21b/` lists the commits that changed it, newest first, and `git restore --source=<commit>~1 -- .taskless/rules/sg/no-eval-3fa9c21b/` puts it back as it was before <commit>.
```

Follow the git steps, then run `check` again. Do not run
`rule restore` or `rule rollback` instead: the service refuses both on
this plan and answers with the same git steps. `integrity` is the same
on every plan.

Choosing the commit: `<commit>` is the commit that made the change,
and `~1` restores from its parent, the last commit that still held the
rule as issued. Restoring from `<commit>` itself puts back nothing for a
deleted rule, because the rule is not in that commit. When `git log`
lists several edits since the rule was issued, use the oldest of them.
For a change that is not committed yet, use the `HEAD` step. A rule
whose engine is not known is given as a quoted pathspec,
`'.taskless/rules/*/<ruleId>/*'`; pass it to git as written. For a
rename, recover the source, then delete the copy, as above.

## Withheld for the plan

When the organization's Taskless plan does not include runtime rules,
reconcile answers normally but declines to run them. `check` then:

- does not run them, and reports each in `skipped` with the reason
  `not included in your Taskless plan` (never as edited or drift);
- prints ONE notice naming the rules, the reason code, and the upgrade
  URL;
- **exits 1**, and under `--json` sets `success: false` and adds:
  ```json
  "entitlement": {
    "runtimeSignatures": false,
    "reason": "RUNTIME_SIGNATURES_NOT_IN_PLAN",
    "upgradeUrl": "https://…",
    "withheld": ["<rule name>"]
  }
  ```

Report this to the user as a plan problem, not a code problem: the
rules did not stop matching, they stopped running. Do not edit or
delete the rules to make `check` pass, and do not suggest
`--dangerously-run-scripts` as a fix. Show the `upgradeUrl`. An
`entitlement` with an empty `withheld` does not fail the run.

## Flags
- `--json`: machine output (`{ success, results, skipped?, failures?, notices?, integrity?, entitlement? }`).
- `--anonymous`: run only static rules; skip runtime rules.
- `--dangerously-run-scripts`: run runtime `check.ts` unverified.
- `--timeout <seconds>`: per-runtime-check wall-clock bound (default 10).
- `--preserve-logs` / `-l`: keep this run's directory under
  `.taskless/.run/` (the snapshot that ran, the engine configs, and
  `engine.log`, `sg.log`, `vale.log`, `runtime.log`) instead of removing it.
  Its path is printed on stderr, or returned as `runDirectory` under
  `--json`. Use it to debug a rule that behaves unexpectedly; the logs hold
  matched source, so treat the directory like any local build output. It
  survives later runs until the `keepUntil` in its `preserve` file, a
  day out in unix milliseconds. Raise it to keep the directory longer, or
  delete the file to let the next run remove it.

## Steps

1. **Decide scope.** Default is a full project scan. If the user
   specified files (or you're in a CI context with a known diff),
   pass them as positional arguments.

2. **Invoke the CLI.** Either:
   ```
   %(TASKLESS_CLI)s check --json
   ```
   or, scoped to specific paths:
   ```
   %(TASKLESS_CLI)s check --json src/foo.ts src/bar.ts
   ```
   or, against a git diff:
   ```
   %(TASKLESS_CLI)s check --json $(git diff --name-only main...HEAD)
   ```
   Paths that don't exist on disk are silently filtered, so you can
   pipe raw `git diff` output directly without pre-filtering.

   When runtime rules were present but not run (e.g. logged out), the
   JSON also carries `"skipped": [{ "rule": "<name>", "reason": "…" }]`
   alongside `success`/`results`. Surface it so CI can tell that runtime
   rules did not execute. It never affects the exit code on its own; an
   accompanying `entitlement` with a non-empty `withheld` does (see
   "Withheld for the plan"), and so does a `failures` entry for an edited
   rule (see "An edited rule").

3. **Parse the JSON output.** Shape:
   ```json
   {
     "success": false,
     "results": [
       {
         "source": "ast-grep",
         "ruleId": "no-eval",
         "severity": "error",
         "message": "Avoid eval()",
         "note": null,
         "file": "src/foo.ts",
         "range": {
           "start": { "line": 12, "column": 4 },
           "end":   { "line": 12, "column": 14 }
         },
         "matchedText": "eval(input)",
         "fix": null
       }
     ]
   }
   ```

4. **Report findings to the user.** Group by `file`. Show `severity`,
   `message`, and `ruleId` for each finding; the `range.start` is the
   useful line/column to surface. The `success` field reflects
   error-severity findings: `success: false` means at least one
   `severity: "error"` finding exists, runtime rules were withheld for
   the plan (check `entitlement`), or a rule was edited, copied from an
   issued rule, or unaccounted for (check `failures` and `integrity`)
   (exit code 1); `success: true` with a non-empty `results` array
   means there are only
   warning/info/hint findings (exit code 0); `success: true` with an
   empty `results` array means the codebase is clean. Findings are
   never reported via the `{ ok: false, code, message }` envelope:
   the envelope only appears when the scan itself fails (e.g.
   `SCAN_FAILED`) and the normal results payload is absent.

## Exit codes

- `0`: All checks passed, no rules configured, or all supplied
  paths missing
- `1`: Errors detected, scan failed, runtime rules withheld because
  the plan does not include them, an issued ast-grep or Vale rule was
  edited or copied under a new id, a rule was unaccounted for, or two
  engines share a rule id

## Errors

When `--json` is set, failures emit `{ ok: false, code, message }`:

| code          | meaning               | fix                              |
|---------------|-----------------------|----------------------------------|
| `SCAN_FAILED` | ast-grep scan errored | Report; check rule YAML validity |

## See Also

- `%(TASKLESS_CLI)s agent route`: add a rule if none exist
- `%(TASKLESS_CLI)s agent ci`: wire `check` into a CI pipeline
