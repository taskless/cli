## Context

See proposal.md for why. The device flow already lives behind `DeviceFlowProvider` (`requestDeviceCode`, `pollForToken`), so the change is where the polling state lives. Today it is in one process's loop. Here it moves to a file, so polling can span several short processes.

## Goals / Non-Goals

**Goals:** an agent in any harness can complete a login with ordinary, short, synchronous tool calls; the person approving sees the URL as soon as it exists.

**Non-Goals:** opening a browser for the user; changing the interactive (non-`--json`) flow; changing the service's device-flow endpoints or token lifetime.

## Decisions

- **One re-runnable command, not `--start`/`--wait` flags.** `auth login --json` decides from local state whether to start or continue. The agent's loop is "call until not `pending`", with nothing to choose between calls. Separate flags would make the agent pick the right one each time, and picking `--start` mid-flow would invalidate the URL the user is already on. Because every `pending` response repeats the URL and code, a caller that lost track can always show the right one.
- **The first call returns at once, without polling.** Polling before returning would delay the URL, which is the thing the person is waiting for.
- **Each call waits at most 45 seconds.** That is well under the two-minute default Bash timeout in Claude Code, and leaves margin for slower harnesses, while keeping the number of calls small. The service's `interval` and `slow_down` are honoured within that window as the current loop does. A call ends early if the code expires.
- **`AUTH_EXPIRED` is a new code.** Expiry is reported as `NETWORK_ERROR` today, which sends an agent to check connectivity. The remedy is different: call again and show the new URL.
- **A code found expired when a call starts is discarded silently, and a new login begins.** That covers a login abandoned in an earlier session. Reporting `AUTH_EXPIRED` there would fail an attempt this caller may never have made. Expiry _during_ a call is reported, because that caller was waiting on it.
- **The pending file sits beside the token file, with the same protections.** It is `.taskless/.auth-pending.json`, mode `0600`, and listed in `.taskless/.gitignore` through the same helper. It holds the `device_code`, `user_code`, verification URL, `interval`, and an absolute `expires_at`. It is deleted on success, denial, expiry, logout, and a successful interactive login.
- **The already-logged-in checks run first, unchanged.** A `TASKLESS_TOKEN`, or a saved token the service accepts, returns `already_logged_in` before any pending code is read or created.

## Risks / Trade-offs

- [A device code on disk can be redeemed by anyone who reads it before it expires] → `0600`, gitignored, deleted on every terminal state, and short-lived by the service's own `expires_in`. The token it yields is stored with exactly the same protections.
- [Two agents logging in to the same checkout at once share one pending code] → Both show the same URL and both see the same result, which is the right outcome for one repository's login.
- [A harness whose timeout is under 45 seconds] → The wait is a constant. Lower it if one turns up, since the cost of lowering it is only more calls.
