# Topic: info     (CLI v%(CLI_VERSION)s / topic v1)

## Goal
Report local Taskless state: CLI version, installed skill versions
per detected tool, and (unless `--anonymous`) the user's auth state.
Used as a health check, for staleness detection, and to confirm
which version of the CLI/skills the agent is talking to.

## Preconditions
- None. Works in any directory; doesn't require `.taskless/`.

## Steps

1. **Invoke the CLI** with JSON output:
   ```
   %(TASKLESS_CLI)s info --json
   ```
   For an offline/local-only state report (no auth probe), pass
   `--anonymous`:
   ```
   %(TASKLESS_CLI)s info --json --anonymous
   ```

2. **Parse the response.** Shape:
   ```json
   {
     "success": true,
     "version": "0.7.0",
     "harnesses": [
       {
         "name": "Claude Code",
         "skills": [
           { "name": "taskless", "installedVersion": "0.7.0",
             "currentVersion": "0.7.0", "current": true }
         ]
       }
     ],
     "tools": [
       { "name": "gh", "present": true, "path": "/opt/homebrew/bin/gh",
         "applicable": true },
       { "name": "git", "present": true, "path": "/usr/bin/git",
         "applicable": true },
       { "name": "jq", "present": false, "applicable": true }
     ],
     "loggedIn": true,
     "auth": { "user": "...", "email": "...", "orgs": ["..."] }
   }
   ```

3. **Report to the user.** Summarize:
   - CLI version
   - For each harness: number of installed skills, count out-of-date
   - Auth: logged in as <user> (orgs) OR not logged in

   `harnesses` is the agent harnesses Taskless installs into. `tools`
   is the command-line binaries found on PATH, and it is presence
   only: Taskless looked for a file of each name and ran none of
   them, so do not report a tool as working or name a version.
   `applicable: false` means the tool could do nothing in this
   repository whatever is installed, which is not the same as
   missing, and must not be reported as missing.

4. **Suggest reinit on staleness.** If any skill has `current: false`,
   suggest `%(TASKLESS_CLI)s` to reinstall and pull the latest
   bundle.

## Errors

When `--json` is set, failures emit `{ ok: false, code, message }`:

| code             | meaning                    | fix                      |
|------------------|----------------------------|--------------------------|
| `INTERNAL_ERROR` | Internal schema validation | Report; likely a CLI bug |

(Network errors during the auth probe are silently swallowed:
`info` falls back to reporting `loggedIn: false` rather than
failing.)

## See Also

- `%(TASKLESS_CLI)s agent auth`: log in / log out / status detail
- `%(TASKLESS_CLI)s agent check`: run rules against the codebase
