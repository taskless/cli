# Topic: info     (CLI v%(CLI_VERSION)s / topic v5)

%(ONE_COMMAND_PER_CALL)s

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
     "authState": "authenticated",
     "auth": { "user": "...", "email": "...", "orgs": ["..."] },
     "pinnedCli": [
       { "manifest": "packages/app/package.json",
         "location": "devDependencies", "name": "@taskless/cli",
         "spec": "^0.6.0", "installed": "0.6.3",
         "reason": "dependency" }
     ]
   }
   ```

3. **Report to the user.** Summarize:
   - CLI version
   - For each harness: number of installed skills, count out-of-date
   - Auth, from `authState` (see below)

   `harnesses` is the agent harnesses Taskless installs into. In a
   Taskless project where no harness is detected it holds one entry,
   `Agent Skills (.agents/)`: the default directory the skill is
   installed to, so its staleness is still reported. `tools`
   is the command-line binaries found on PATH, and it is presence
   only: Taskless looked for a file of each name and ran none of
   them, so do not report a tool as working or name a version.
   `applicable: false` means the tool could do nothing in this
   repository whatever is installed, which is not the same as
   missing, and must not be reported as missing.

   `loggedIn` is `true` only when the service accepted the token.
   `authState` says what the probe found, and each value asks for
   something different:

   | `authState`        | meaning                                         | tell the user                                     |
   |--------------------|-------------------------------------------------|---------------------------------------------------|
   | `authenticated`    | the token works; `auth` names the user and orgs | logged in as `<user>` (`<orgs>`)                  |
   | `rejected`         | the service refused the token: invalid or expired | log in again: fetch `%(TASKLESS_CLI)s agent auth` |
   | `unreachable`      | the service could not be reached                | the token is unverified, not bad; try again later |
   | `upgrade_required` | the service no longer supports this CLI version | upgrade the CLI before anything that needs the service |
   | `none`             | no token                                        | not logged in                                     |
   | `anonymous`        | `--anonymous` skipped the probe                 | nothing; auth was not checked                     |

   Do not send the user to log in for `unreachable`: their login may be
   fine, and logging in again cannot fix an outage.

4. **Suggest reinit on staleness.** If any skill has `current: false`,
   suggest `%(TASKLESS_CLI)s` to reinstall and pull the latest
   bundle.

5. **Name CLI pins.** `pinnedCli` lists every place the project names
   the Taskless CLI that needs a look: the file (`manifest`), where in
   it (`location`), and why (`reason`). A `dependency` is any
   `package.json` dependency on the CLI, whatever its version, since
   Taskless runs through the project launcher; offer to remove it.
   `installed` is the version it runs, or `null`. A `stale` script, CI,
   or hook line names a version older than `version`; offer to move it.
   A `nightly` one is left over after a release install; offer to move
   it back to `@taskless/cli`. Do not edit any of these files on your
   own; a pin can be deliberate.

## Errors

When `--json` is set, failures emit `{ ok: false, code, message }`:

| code             | meaning                    | fix                      |
|------------------|----------------------------|--------------------------|
| `INTERNAL_ERROR` | Internal schema validation | Report; likely a CLI bug |

(A failed auth probe never fails `info`: a rejected token, an
unreachable service, or a refused CLI version is reported in
`authState`, with `loggedIn: false`.)

## See Also

- `%(TASKLESS_CLI)s agent auth`: log in / log out / status detail
- `%(TASKLESS_CLI)s agent check`: run rules against the codebase
