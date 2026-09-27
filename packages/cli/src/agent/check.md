# Topic: check     (CLI v%(CLI_VERSION)s / topic v3)

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

`check` never requires auth. The two rule kinds run differently:

- **Static rules** (`.taskless/rules/sg/<id>/<id>.yml`) are inert ast-grep patterns
  and **always run**, in every mode, with no network call. The offline
  linter posture.
- **Runtime rules** (`.taskless/rules/runtime/<name>/`) execute a
  `check.ts` (arbitrary code), so they run ONLY when that code is
  verified:
  - **Logged in** (token or API key): each rule's `check.ts` is
    reconciled against the Taskless service; rules the server blessed
    (`run`) execute, and the rest are withheld and reported (advisory).
    **One exception fails the run:** if the organization's plan does not
    include runtime rules, the service withholds them for the plan and
    `check` exits 1 even with no findings. See "Withheld for the plan".
  - **Logged out, `--anonymous`, no GitHub remote, or service
    unavailable**, runtime rules are **skipped** (reported, never run).
    Static rules still run.
  - **`--dangerously-run-scripts`**: runs every runtime rule trusting
    local signatures, with no network call, behind a prominent warning.
    This is the only way to run runtime rules unverified.

Notices about skipped/withheld runtime rules are human-readable stderr
only, and apart from a withhold for the plan they never change the exit
code. Under `--json` they do NOT appear
as warnings; instead an additive optional `skipped: [{ rule, reason }]`
array is included alongside the unchanged `{ success, results }`. The
authoritative allow-list is the server's; the CI backstop
(`%(TASKLESS_CLI)s agent ci`) is the enforcement point for runtime rules.

## Withheld for the plan

When the organization's Taskless plan does not include runtime rules,
reconcile answers normally but declines to run them. `check` then:

- does not run them, and reports each in `skipped` with the reason
  `not included in your Taskless plan` (never as unsafe or drift);
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
- `--json`: machine output (`{ success, results, skipped?, entitlement? }`).
- `--anonymous`: run only static rules; skip runtime rules.
- `--dangerously-run-scripts`: run runtime `check.ts` unverified.
- `--timeout <seconds>`: per-runtime-check wall-clock bound (default 10).

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
   "Withheld for the plan").

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
   `severity: "error"` finding exists, or runtime rules were withheld
   for the plan (check `entitlement`) (exit code 1); `success: true`
   with a non-empty `results` array means there are only
   warning/info/hint findings (exit code 0); `success: true` with an
   empty `results` array means the codebase is clean. Findings are
   never reported via the `{ ok: false, code, message }` envelope:
   the envelope only appears when the scan itself fails (e.g.
   `SCAN_FAILED`) and the normal results payload is absent.

## Exit codes

- `0`: All checks passed, no rules configured, or all supplied
  paths missing
- `1`: Errors detected, scan failed, or runtime rules withheld because
  the plan does not include them

## Errors

When `--json` is set, failures emit `{ ok: false, code, message }`:

| code          | meaning               | fix                              |
|---------------|-----------------------|----------------------------------|
| `SCAN_FAILED` | ast-grep scan errored | Report; check rule YAML validity |

## See Also

- `%(TASKLESS_CLI)s agent route`: add a rule if none exist
- `%(TASKLESS_CLI)s agent ci`: wire `check` into a CI pipeline
