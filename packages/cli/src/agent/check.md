# Topic: check     (CLI v%(CLI_VERSION)s / topic v4)

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
  | withheld for the plan | never happens | does not run, and `check` exits 1 |

  `check` also exits 1 if the service's answer leaves out a rule it was
  asked about, or if two engines hold a rule with the same id.
- **Logged out, `--anonymous`, no GitHub remote, or service
  unavailable**: nothing is verified. ast-grep and Vale rules run as they
  are on disk, runtime rules are **skipped** (reported, never run), and
  the exit code is unaffected.
- **`--dangerously-run-scripts`**: nothing is verified and no network
  call is made, logged in or not. Every rule of every engine runs,
  runtime included, behind a prominent warning. This is the only way to
  run runtime rules unverified.

`check` NEVER changes `.taskless/rules/`. An edited or missing rule is
reported with the command that repairs it:
`%(TASKLESS_CLI)s rule restore <ruleId>`.

Notices about skipped runtime rules are human-readable stderr only.
Under `--json` they do NOT appear as warnings; instead an additive
optional `skipped: [{ rule, reason }]` array is included alongside the
unchanged `{ success, results }`, and the CI backstop
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

`integrity` also lists `missing` rules (with the `revisionId` restore
would bring back), runtime rules the service never issued (`unknown`),
rules the answer did not account for (`unaccounted`), and ids shared
across engines (`duplicate`). Locally written ast-grep and Vale rules
are never listed; they run.

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
   the plan (check `entitlement`), or a rule was edited or unaccounted
   for (check `failures` and `integrity`) (exit code 1); `success: true`
   with a non-empty `results` array means there are only
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
  edited, a rule was unaccounted for, or two engines share a rule id

## Errors

When `--json` is set, failures emit `{ ok: false, code, message }`:

| code          | meaning               | fix                              |
|---------------|-----------------------|----------------------------------|
| `SCAN_FAILED` | ast-grep scan errored | Report; check rule YAML validity |

## See Also

- `%(TASKLESS_CLI)s agent route`: add a rule if none exist
- `%(TASKLESS_CLI)s agent ci`: wire `check` into a CI pipeline
