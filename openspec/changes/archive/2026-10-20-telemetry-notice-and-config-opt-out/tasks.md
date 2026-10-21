## 1. Config opt-out

- [x] 1.1 Read `"telemetry": false` from `.taskless/taskless.json` in `getTelemetry`, returning the no-op client before any other work
- [x] 1.2 Make `isTelemetryEnabled(cwd)` honor the manifest, and pass `cwd` from the survey gate and `feedback`
- [x] 1.3 Document the field on the manifest type
- [x] 1.4 Test: no client constructed, no anonymous ID written, non-`false` values stay on, an unreadable manifest stays on

## 2. Wizard notice

- [x] 2.1 Print the notice once in a completed wizard run, only when telemetry is on
- [x] 2.2 Test both states

## 3. init

- [x] 3.1 Print the notice in human-mode `init` before the onboarding trailer, only when telemetry is on
- [x] 3.2 Add `telemetry: { enabled }` to the `init --json` envelope
- [x] 3.3 `init` recipe (topic v13): document the field and add a step relaying the opt-out
- [x] 3.4 Test both modes and both states in-process, so no test run sends real telemetry

## 4. Docs and release

- [x] 4.1 README: the setting, its repo-wide scope, and the parenthesis fix
- [x] 4.2 Changeset (patch)
