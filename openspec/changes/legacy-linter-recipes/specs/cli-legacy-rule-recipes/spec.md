## Purpose

Per-tool recipes that teach an agent to solve a request with the rules a linter the repository already runs ships, and to write a new rule in that linter only when the repository's own rules show how.

## ADDED Requirements

### Requirement: Legacy recipes use what a tool ships before anything is written

Every `create-legacy-rule` recipe, generic or per-tool, SHALL direct the agent to first establish whether a rule the tool already ships solves the request, including the tool's configurable catch-all rules. A recipe SHALL name the catch-all rules for its tool explicitly, because a search for the request's subject does not surface a catch-all rule.

A per-tool recipe SHALL state the check its tool always performs first:

- Ruff: whether `banned-api` (TID251) covers the request.
- ESLint: whether a core rule covers it, with `no-restricted-syntax` and `no-restricted-imports` (and their `@typescript-eslint/` counterparts) named as the catch-alls, before any plugin.
- Biome: whether an existing rule makes the problem go away, with `noRestrictedImports` and `noRestrictedGlobals` named as the catch-alls.
- pylint: whether a shipped message or the `deprecated-modules`, `preferred-modules`, or `bad-functions` options cover it.
- flake8: whether `banned-modules` from `flake8-tidy-imports` covers it. The flake8 recipe SHALL NOT include a discovery step.

#### Scenario: Ruff tries banned-api first

- **WHEN** the agent follows the Ruff recipe for a request to forbid an API
- **THEN** the recipe SHALL direct it to check `banned-api` before any other step

#### Scenario: ESLint tries a core rule before a plugin

- **WHEN** the agent follows the ESLint recipe
- **THEN** it SHALL check core rules and the named catch-alls before considering any plugin from the curated list

#### Scenario: flake8 goes straight to its catch-all

- **WHEN** the agent follows the flake8 recipe
- **THEN** it SHALL be directed to `banned-modules` without a rule-discovery step

### Requirement: Rule discovery is confirmed against the installed version

Where a tool's rule set is too large to match a request against locally, the recipe SHALL direct the agent to find candidate rules on the tool's rules page by web search or fetch, then confirm each candidate against the installed version with the tool's own command before enabling it. The Ruff recipe SHALL use `ruff rule <name or code>` and the Biome recipe `biome explain <rule>`.

The Ruff recipe SHALL state that a preview-only rule does not fire unless preview mode is enabled, and SHALL direct the agent to check the rule's preview status before enabling it. The pylint recipe SHALL state that `--help-msg` reports a message from an optional extension as nonexistent unless that extension is passed with `--load-plugins`.

#### Scenario: A Ruff rule is confirmed locally

- **WHEN** the agent finds a candidate Ruff rule on the web
- **THEN** it SHALL confirm it with `ruff rule` against the installed version before enabling it

#### Scenario: A preview-only Ruff rule is not enabled silently

- **WHEN** the confirmed Ruff rule is preview-only
- **THEN** the agent SHALL either enable preview mode for it with the user's knowledge or choose another rule, and SHALL NOT enable it in a configuration where it cannot fire

#### Scenario: A pylint extension message is looked up with its extension loaded

- **WHEN** the agent looks up a message that belongs to a pylint optional extension
- **THEN** it SHALL pass that extension with `--load-plugins` before concluding the message does not exist

### Requirement: The ESLint recipe carries a curated plugin list

The ESLint recipe SHALL carry a curated list of plugins, each with a one-line summary of what it covers and a link to its documentation, so the agent can choose whether to investigate further. At launch the list SHALL be `eslint-plugin-import`, `eslint-plugin-regexp`, `eslint-plugin-promise`, `eslint-plugin-n`, `eslint-plugin-react`, `eslint-plugin-react-hooks`, `eslint-plugin-jsx-a11y`, and `eslint-plugin-sonarjs`.

The recipe SHALL direct the agent to prefer a plugin the repository already has installed. Where a listed plugin does not declare support for the repository's installed ESLint major version, the recipe SHALL say so, and for imports SHALL name `eslint-plugin-import-x` as the alternative.

The list names rule sources, not individual rules. The recipe SHALL NOT embed a catalog of individual plugin rules.

#### Scenario: An installed plugin is preferred

- **WHEN** a request is covered by a plugin the repository already depends on
- **THEN** the agent SHALL use that plugin's rule rather than recommending another

#### Scenario: Each listed plugin links to its docs

- **WHEN** the ESLint recipe is rendered
- **THEN** every curated plugin SHALL appear with a one-line summary and a documentation URL

### Requirement: A new legacy rule is written only from the repository's own examples

A legacy recipe SHALL permit the agent to write a new custom rule in a linter only when the repository already has at least five custom rules for that linter, as counted by `detect --json`. The agent SHALL use those rules as its reference for structure and conventions.

The recipes SHALL NOT teach custom-rule authoring for any tool. They SHALL NOT carry instructions for writing an ESLint rule, a pylint checker, a flake8 plugin, or a Biome plugin of any kind. Below the threshold, a request no shipped rule solves SHALL return to `route`, which sends it to a Taskless rule.

#### Scenario: Five examples permit a new rule

- **WHEN** no shipped rule solves the request AND `detect` counts five or more custom rules for the linter
- **THEN** the agent MAY write a new custom rule modeled on those rules

#### Scenario: Fewer examples send the request back to Taskless

- **WHEN** no shipped rule solves the request AND `detect` counts fewer than five custom rules for the linter
- **THEN** the agent SHALL NOT write a custom rule in that linter
- **AND** it SHALL continue down the `route` ladder to a Taskless rule

### Requirement: A plugin the repository lacks is added only with consent

A legacy recipe SHALL treat recommending a plugin the repository does not have installed as adding a dependency. The agent SHALL ask the user before adding it, and SHALL state the package it would add.

#### Scenario: A missing plugin is proposed, not installed

- **WHEN** the best existing rule belongs to a plugin the repository does not depend on
- **THEN** the agent SHALL name the package and ask before adding it

### Requirement: A legacy rule hand-off says who runs it

Every legacy recipe SHALL end by naming the files it changed and telling the user how to run the linter to see the rule fire. It SHALL state that `taskless check` does not run external linters.

#### Scenario: The user is told how to see the rule fire

- **WHEN** the agent finishes a legacy rule
- **THEN** it SHALL name the changed files and the command that runs the linter
- **AND** it SHALL state that `taskless check` does not run that linter
