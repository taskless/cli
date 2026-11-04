## Why

`agent ok` and `check` tell the reader to fix a stale CLI or skill by running the CLI with no arguments. That only installs from a terminal, where it opens the wizard. Anywhere else it prints the topic index and exits 0 with nothing changed, so a reader following the step ends up where they started, with no error to say so.

## What Changes

- The cli step's command becomes `<launcher> <package>@<latest> init`.
- The skill step's command becomes `<invocation> init`.
- The step text says `init` rather than "with no arguments".

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `cli-agent`: the fixing commands for the cli and skill parts of `agent ok` name `init`.

## Impact

- `packages/cli/src/install/freshness.ts` and its tests. `check`'s notice takes the same steps, so it changes with it.
- Delivery shape: **single PR**. The spec, the fix, and the archive land together, because it is a two-line behavior change.
