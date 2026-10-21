## Why

The CLI decides colour once, in `util/color.ts`, and turned it on when EITHER stdout or stderr was a terminal. So `taskless init > out.txt` run from a shell wrote escape sequences into the file, in front of the onboarding prompt the user means to copy. Review of #559 caught it: the trailer requirement had to be worded around the behavior instead of stating the plain rule the issue asked for (#552: "Under `NO_COLOR` or a non-TTY stdout, the same text prints plain").

## What Changes

- `detectColorLevel()` checks stdout alone. A redirected stdout prints plain even when stderr is still a terminal; a terminal stdout keeps colour when only stderr is redirected. `NO_COLOR` and `FORCE_COLOR` keep their precedence.
- Most coloured output writes to stdout (notice boxes, `share`, the settings summary, the onboarding trailer), so it now follows the stream it actually writes to.
- Trade-off: chalk holds one level for both streams, so coloured text sent to stderr follows stdout instead. That covers the global-trust warning and the permission summary `init --json` prints to stderr, which lose colour when stdout is redirected: a highlight lost on a terminal, where the old rule corrupted a file. It also covers the wizard banner, which the `cli-init` spec sends to stderr. The wizard only starts when stdout is a terminal, so the banner keeps its colour whenever it prints, and `taskless 2> err.log` still writes its escapes into the log, as it did before this change.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `cli-init`: "Init prints a post-install onboarding trailer" states the shared colour rule as `NO_COLOR` or a non-terminal stdout, and its plain-output scenario names the redirected-stdout case.

## Delivery Shape

**Stacked on #559, merged atomically with `gh stack merge`.** This layer completes #559's fix: #559 introduces the coloured prompt line, and this layer makes it plain wherever stdout is not a terminal. #559 alone is safe to ship (it documents the old rule accurately), but the two are meant to land together. The package is pre-1.0 and no surface is added, so the bump is `patch`, carried in #559's existing changeset.

## Impact

- **Code**: `packages/cli/src/util/color.ts` (`detectColorLevel`), a comment in `packages/cli/src/commands/onboard.ts`.
- **Tests**: `packages/cli/test/color.test.ts` (stdout redirected with stderr on a terminal, and the reverse).
- **Behavior**: colour in every command, as described above.
