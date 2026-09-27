## Why

The setup wizard (bare `taskless` in a terminal) stops between choosing tools
and installing to ask **"Log in to taskless.io now?"**, after an
"Authentication" note about conversation history. Issue #402 asks for it to go:

- Every question in first-run setup is friction between a person and a working
  `check`.
- The free tier is local-only. Authoring and running `sg` and `vale` rules needs
  no account, so asking a free user to log in during setup sells them something
  they do not need yet.
- Login stays reachable where it is needed. `taskless auth login` is unchanged,
  and the commands that need an account already say so (`create-remote-rule`
  "(login)", the `AUTH_REQUIRED` errors and their `taskless auth login` remedy).

`taskless init` already runs without prompts and without an auth step, so the
wizard is the only place the prompt lives.

## What Changes

- **`cli-init`**: the requirement that the wizard explains the auth tradeoff and
  offers to log in is removed, and a requirement that the wizard does not offer
  to log in replaces it. The shared login routine requirement and the wizard
  cancellation requirement each carry one scenario about the auth step. A
  MODIFIED block cannot drop a scenario, so both are removed and re-added
  under new titles with every other scenario intact: "A single interactive
  login routine serves auth login" and "Cancelling the wizard writes nothing".
- The wizard's auth step (`wizard/steps/auth.ts`) is deleted.
- `WizardResult` drops `authPromptShown` and `authCompleted`. Nothing read
  them, and no telemetry event carried them, so no event changes shape. The
  per-run `cli_run` event keeps reporting `loggedIn`, resolved from the token,
  which is unaffected.

## Out of scope

How paid accounts authenticate for remote generation or runtime rules. That
path, `taskless auth login`, and every "run `taskless auth login`" remedy are
unchanged.

## Delivery shape

**Single PR.** The change is a deletion of roughly twenty lines of code plus
its spec, and each half is only correct with the other. It lands and archives
together.

## Impact

- `packages/cli/src/wizard/index.ts`, `packages/cli/src/wizard/steps/auth.ts`
  (deleted), `packages/cli/src/auth/login-interactive.ts` (comment only)
- `packages/cli/test/wizard-integration.test.ts`: the clack mock no longer
  routes a "log in" confirm, and a new test runs the wizard with no token and
  asserts nothing offers to log in
- `openspec/specs/cli-init/spec.md`
