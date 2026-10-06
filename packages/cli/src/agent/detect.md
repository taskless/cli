# Topic: detect     (CLI v%(CLI_VERSION)s / topic v2)

## Goal
Scan the working directory for the linters it configures, the
languages it uses, the styles of any rules the repo already
authors, and what already runs commands for it: CI systems and
commit-hook tools. Offline and deterministic, no network, no auth, no state
change. This is the discovery step that feeds rule-authoring: the
routing flow reads `detect` to decide where a new rule should live.

## Preconditions
- None. Works in any directory; doesn't require `.taskless/`.

## Steps

1. **Invoke the CLI** with JSON output:
   ```
   %(TASKLESS_CLI)s detect --json
   ```

2. **Parse the response.** Shape:
   ```json
   {
     "success": true,
     "linters": [
       {
         "name": "eslint",
         "evidence": ["eslint.config.js", "dependency eslint (package.json)"]
       }
     ],
     "languages": ["typescript", "javascript"],
     "ruleStyles": [
       {
         "source": ".taskless/rules/sg",
         "description": "ast-grep rules with YAML metadata sidecars"
       }
     ],
     "ci": [
       {
         "name": "github-actions",
         "evidence": [".github/workflows/test.yml"]
       }
     ],
     "hooks": [
       {
         "name": "husky",
         "evidence": [".husky/", "dependency husky (package.json)"]
       }
     ]
   }
   ```
   - `linters`: each has a `name` and `evidence` (config-file paths,
     a pyproject table marker, or a dependency marker from the
     language's package file; not every entry is a path).
   - `languages`: inferred from manifests and the detected linters.
   - `ruleStyles`: how the repo authors its own rules, surfaced for
     downstream reuse.
   - `ci`: CI systems configured at the scan root (`github-actions`,
     `gitlab-ci`, `circleci`, `jenkins`, `azure-pipelines`,
     `bitbucket-pipelines`, `buildkite`, `drone`, `travis-ci`).
   - `hooks`: tools that run commands at commit time, configured at
     the scan root (`husky`, `lefthook`, `pre-commit`,
     `simple-git-hooks`, `lint-staged`). lint-staged is listed even
     though a hook manager has to call it, because it is what hands
     the staged files to a command.

   `ci` and `hooks` are read at the scan root only. A CI config or
   hook setup inside a sub-package is not this repository's, so it is
   not reported. Both say what is configured, not whether it already
   runs Taskless: read the files for that.

3. **Use the signals to route.** Feed the output into rule authoring:
   - A detected linter the repo already uses → author the rule there
     (`%(TASKLESS_CLI)s agent route`).
   - No suitable linter, local-only → `%(TASKLESS_CLI)s agent create-sg-rule`.
   - See `%(TASKLESS_CLI)s agent route` for the full decision.

## Errors

When `--json` is set, failures emit `{ ok: false, code, message }`:

| code             | meaning                    | fix                      |
|------------------|----------------------------|--------------------------|
| `INTERNAL_ERROR` | Internal schema validation | Report; likely a CLI bug |

## See Also

- `%(TASKLESS_CLI)s agent route`: decide where to author a rule from these signals
- `%(TASKLESS_CLI)s agent check`: run rules against the codebase
- `%(TASKLESS_CLI)s agent ci`: wire `check` into the CI systems `ci` reports
- `%(TASKLESS_CLI)s agent hooks`: run `check` before a commit, in the tool `hooks` reports
