## Why

An agent cannot log a user in today. `auth login` prints a URL and code, then blocks while it polls, and agent harnesses return a command's output only when it exits. So the URL the user needs is held behind a wait for that same user, and a tool timeout (two minutes by default in Claude Code) usually ends the call first. Under `--json`, the mode an agent would reach for, the URL is not printed at all. The `auth` recipe tells the agent to run `auth login` and relay the URL, which it cannot do.

The version-pin gate makes this more pressing. `auth` is one of the few commands that runs on any CLI version, and the recipes send agents to it whenever a command needs a token.

## What Changes

- `auth login --json` becomes a step an agent repeats until it finishes, and never blocks for longer than a bounded wait:
  - The first call requests a device code, saves it locally, and returns at once with `{ ok: true, status: "pending", verificationUrl, userCode, expiresAt }`.
  - Each later call polls that saved code for at most 45 seconds. It returns `pending` again (same URL and code), `{ ok: true, status: "authenticated" }` once approved, or an error.
  - A code that expires during a call fails with a new `AUTH_EXPIRED` error code. A denial fails with `AUTH_REQUIRED`, as today. Either one discards the saved code, so the next call starts over.
  - A saved code found already expired is discarded, and the call starts a new login rather than failing on an attempt the caller may never have seen.
- **BREAKING (output)**: `auth login --json` now prints a success envelope where it printed nothing. "Already logged in" becomes `{ ok: true, status: "already_logged_in", source: "saved" | "environment" }`. Exit codes are unchanged, and the package is pre-1.0.
- The pending code is saved to `.taskless/.auth-pending.json`, mode `0600`, and added to `.taskless/.gitignore` the same way the token file is. A device code is a credential until it expires: whoever holds it receives the token the user approves.
- `auth logout` and a successful interactive login also discard a pending code.
- Without `--json`, `auth login` is unchanged: one blocking call for a person at a terminal.
- The `auth` recipe's login branch runs `auth login --json` in a loop: show the URL and code from the first `pending`, keep calling until the status is not `pending`, and show the new URL if the code changes.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `cli-auth`: `auth login --json` prints a success envelope, and completes across repeated, bounded calls.

## Impact

- `packages/cli/src/commands/auth.ts`, `packages/cli/src/auth/login-interactive.ts` (or a new sibling for the stepped flow), `packages/cli/src/auth/token.ts` (pending-code storage beside the token), `packages/cli/src/types/errors.ts` (`AUTH_EXPIRED`).
- `packages/cli/src/agent/auth.md`, with a topic version bump.
- No service change: the CLI already polls the device-flow token endpoint, and this only moves the polling across process boundaries.
- Delivery shape: **stacked on #562 (`cli-version-pin-gate`), merging forward**. #562 lands first and is safe on its own. This change is one PR above it: one command's JSON mode, its storage, and its recipe, which only work together. It stacks because both edit `auth.md`, and #562's topic v4 note on running `auth` from any version is the context this recipe builds on.
