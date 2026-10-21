## Why

The installer never says the CLI collects telemetry, and the only opt-outs are two environment variables documented in a collapsed README section. A team that wants telemetry off has to set a variable on every machine and every CI runner, and nobody learns the switches exist unless they go looking.

## What Changes

- **Both install paths say the CLI collects telemetry.** The wizard, and `init` in human mode, print once that Taskless collects anonymous telemetry and name all three opt-outs. Neither says anything when telemetry is already off.
- **`init --json` reports `telemetry: { enabled }`,** and the `init` recipe tells the agent to relay the notice and offer the `taskless.json` opt-out, making the edit only when the user asks. Agents run `init`, not the wizard, so without this the user an agent installs for would never hear it.
- **`"telemetry": false` in `.taskless/taskless.json` turns telemetry off.** The file is checked in, so this disables telemetry for everyone working in the repository, CI included. Like the environment opt-out it skips the work, not just the send: no client, no anonymous ID, no git spawn, nothing read beyond the manifest. Only the literal `false` counts.
- **Every gate that asks "is telemetry on" honors it.** `isTelemetryEnabled` takes the project directory, so the survey invite and `feedback send`/`dismiss` stay quiet under the manifest opt-out as they do under the environment one.
- **README** documents the setting and closes an unbalanced parenthesis in the Telemetry paragraph.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `analytics`: telemetry can be disabled by the project manifest.
- `cli-init`: the wizard and `init` disclose telemetry and its opt-outs; `init --json` reports whether it is on.
- `cli-agent`: the `init` recipe relays the opt-out to the user.

## Impact

- `packages/cli/src/telemetry.ts`: manifest opt-out; `isTelemetryEnabled(cwd)` becomes async.
- `packages/cli/src/survey/invite.ts`, `commands/feedback.ts`: pass the project directory to the gate.
- `packages/cli/src/wizard/index.ts`, `commands/init.ts`: the notice, and the `telemetry` envelope field.
- `packages/cli/src/agent/init.md`: topic v13, the envelope field and a step relaying the opt-out.
- `packages/cli/src/filesystem/manifest.ts`: the `telemetry` field on the manifest type. No migration: the CLI never writes it, and existing writes preserve unknown fields.
- `packages/cli/README.md`.
- Delivery shape: **single PR**. The change is small and each part is only a few lines.
