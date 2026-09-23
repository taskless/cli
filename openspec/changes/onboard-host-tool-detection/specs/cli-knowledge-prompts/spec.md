## ADDED Requirements

### Requirement: Host tool state is a render option, never an ambient read

`PromptOptions` SHALL accept `hostTools`, an optional list of the command-line tools the host was found to have. Each entry SHALL carry the tool `name`, a `present` boolean, and an `applicable` boolean, and MAY carry the `path` at which it was found.

The render path SHALL NOT discover this for itself. It SHALL NOT read `PATH`, SHALL NOT call the filesystem, and SHALL NOT spawn a process, for the same reason it does not read `process` for `invocation`: the module is imported by Workers without `nodejs_compat`, and the build refuses to emit a prompts entry whose graph reaches a node builtin. Detection lives in the CLI, which passes the result in.

Omitting `hostTools` SHALL render every host-tool-conditional passage at its default, which is the recipe's full text with no source dropped and no claim made about what is installed. A consumer of `@taskless/cli/prompts` has no `PATH` worth describing, so a recipe trimmed against the host's tooling would be describing the wrong machine.

When `hostTools` is supplied, a passage conditioned on a tool SHALL be selected on both fields. `applicable: false` SHALL take precedence over `present: false`, so a tool that could accomplish nothing here is reported as inapplicable rather than as missing, whether or not it is installed.

#### Scenario: No host tools supplied renders the full text

- **WHEN** a consumer calls `getPrompt("onboard")` with no options
- **THEN** every source in the recipe's menu SHALL be present
- **AND** the text SHALL make no claim about which tools the host has

#### Scenario: A supplied present tool renders as present, not verified

- **WHEN** a consumer calls `getPrompt("onboard", { hostTools: [{ name: "gh", present: true, applicable: true }] })`
- **THEN** the corresponding passage SHALL state that the tool is on the PATH
- **AND** SHALL state that Taskless did not run it

#### Scenario: Inapplicable outranks absent

- **WHEN** a consumer supplies a tool with `present: true` and `applicable: false`
- **THEN** the passage SHALL render the inapplicable reason
- **AND** SHALL NOT render the reason used for a tool that is merely missing

#### Scenario: The prompts entry graph stays host-free

- **WHEN** the package is built
- **THEN** the `prompts` entry chunk graph SHALL reach no node builtin and no host capability, the host-tool option notwithstanding
