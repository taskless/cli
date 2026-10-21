## Why

From 0.13 user feedback: "I would like to have a copy/paste sentence/paragraph I can copy from the terminal." The trailer `init` and the wizard print after an install describes what to ask the agent ("just ask to onboard with Taskless …"), so there is nothing to select and paste; the user has to compose the prompt themselves.

## What Changes

- The onboarding trailer becomes two lines: one line of explanation naming the Taskless skill, then the prompt alone on the final line, `Onboard this project with Taskless`.
- The prompt line carries no quotes, bullet, or prefix, so a triple-click copies exactly the prompt.
- The prompt line is coloured so it reads as the thing to copy. Under `NO_COLOR` or a non-TTY stdout the same text prints plain, and the layout alone keeps it copyable.
- The wizard and `init --no-interactive` print the same trailer, as today.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `cli-init`: "Init prints a post-install onboarding trailer" is restated for a two-line trailer whose final line is the bare prompt, coloured on a colour terminal and plain otherwise.

## Delivery Shape

**Single PR.** The change is one function, its two call sites are untouched, and the spec, implementation, tests, and archive fit one small diff. The package is pre-1.0 and the change adds no surface, so the bump is `patch`.

## Impact

- **Code**: `packages/cli/src/commands/onboard.ts` (`getOnboardTrailer`, new `ONBOARD_PROMPT`).
- **Tests**: `packages/cli/test/onboard.test.ts` (coloured and plain trailer), `packages/cli/test/init-no-interactive.test.ts` (new wording, prompt as the final line).
