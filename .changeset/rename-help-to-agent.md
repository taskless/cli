---
"@taskless/cli": patch
---

Complete the `help` → `agent` rename. The user-facing command was renamed in
0.10.0, but the internals kept the old name: the recipe directory moved from
`packages/cli/src/help/` to `packages/cli/src/agent/`, the `cli-help` OpenSpec
capability is now `cli-agent`, and the shipped skill and `/tskl` command no
longer tell agents to run the removed `npx @taskless/cli help <topic>` (they
now use `agent`, with the single-token topic names — `route`, `improve-rule`,
`delete-rule`, `create-sg-rule`, and siblings).

**Telemetry rename (hard cut, no dual-emit).** The `cli_help` event is renamed
to `cli_agent`. The `topic` property is unchanged. PostHog dashboards keyed on
`cli_help` will need updating — nothing is emitted under the old name.
