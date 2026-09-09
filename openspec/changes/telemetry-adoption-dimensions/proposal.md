## Why

`cli_run` counts invocations. It cannot count _workspaces_, and almost every
adoption metric worth reporting is per-workspace rather than per-invocation.

The gap is structural, not a matter of tuning dashboards. Today the finest
identity we carry is `cli` — the anonymous UUID in
`$XDG_CONFIG_HOME/taskless/anonymous_id`. It is per config directory, so:

- one developer working across five repositories is one `cli`, and their five
  projects are indistinguishable from five runs in one;
- a fresh CI container regenerates the file on every job, so each CI run looks
  like a brand-new install.

Both distortions push the same direction — they inflate breadth and deflate
depth — and neither is measurable after the fact. There is no property stored on
past events that separates a CI run from a human one, which means the existing
series cannot be cleaned retroactively, only replaced going forward.

**Retention cannot be backfilled.** A four-week retention number needs four
weeks of a property that already exists. Every week the dimensions are absent is
a week the cohort clock is not running, which is why this change is scoped to
the dimensions and defers the analysis built on top of them.

## What Changes

Five new super-properties on every captured event, and one count added to an
existing event.

**`workspaceId`** — a SHA-256 hash of the workspace root's absolute path, where
the root is the git top-level when there is one and the resolved working
directory otherwise. Anchoring on the top-level is what makes it a workspace
identifier rather than a directory identifier: `check` run from `packages/cli`
and from the repository root must report the same workspace, and they only do if
the path is resolved upward first.

**`repositoryId`** — a SHA-256 hash of a canonical `{host}/{owner}/{repo}`
derived from the `origin` remote, and **not GitHub-specific**. `ghOwner` is
GitHub-only by construction, because it exists to answer a GitHub question. A
repository identifier answers "how many distinct codebases", which a GitLab or
self-hosted repository participates in exactly as much as a GitHub one, so
excluding them would understate deployment breadth and do it silently. Where no
remote resolves, the sentinel `[unknown]` is sent, matching `ghOwner`'s existing
treatment.

**`envOS`** — `process.platform`.

**`ci`** — a boolean, true when `process.env.CI` holds a positive value.

**`ciProvider`** — the detected provider, `[unknown]` when `ci` is true but no
provider is recognized, `[none]` when `ci` is false.

**`languageStack`** — the languages evidenced by manifest files at the workspace
root, so the rule corpus can be prioritized against the stacks that actually run
it.

**`ruleCount` on `cli_check_completed`** — the number of rules the scan had
loaded. The event reports findings but not how many rules were live, so a scan
with zero findings and a scan with zero rules are the same event today. That
also blocks the two ratios that ask whether authored rules become recurring
infrastructure, which is the product's central claim.

### Two decisions worth stating rather than assuming

**`ghOwner` stays unhashed.** A GitHub owner is public identity, and the value
is load-bearing precisely because it is legible: excluding `taskless` from
external-owner counts, and eyeballing a cohort for plausibility, both need the
name. Hashing it would buy no privacy that matters and cost the metric its
usefulness.

**`repositoryId` is hashed, and the reason is not the same reason.** A repository
_name_ can be an unannounced product; an owner name generally cannot. That is
the line: owner legible, repository not.

Neither hash is a secret, and the spec says so, because a hash of a public
repository URL is reversible by anyone who can enumerate candidate URLs. It is a
stable pseudonym. `workspaceId` is different in kind — local absolute paths
contain usernames and are not enumerable — so hashing there is genuinely
protective. Recording which is which prevents a later reader from assuming a
guarantee that was never made.

## Capabilities

### Modified Capabilities

- `analytics`: the standard-properties requirement covers five new dimensions;
  the taxonomy requirement adds `ruleCount` to `cli_check_completed`.

### Added Capabilities

- `analytics`: workspace and repository identity, execution environment
  dimensions, and the language stack dimension, each as its own requirement, so
  the hashing boundary and the sentinel treatment are stated where they apply.

## Impact

- `openspec/specs/analytics/spec.md` — two requirements amended, three added.
- `packages/cli/src/telemetry.ts` — resolves and attaches the new super-properties.
- `packages/cli/src/util/git-remote.ts` — gains a host-agnostic repository
  canonicalization beside the existing GitHub-only one.
- `packages/cli/src/detect/scan.ts` — `LANGUAGE_MARKERS` is exported for reuse.
- `packages/cli/src/commands/check.ts` — `scanCounts` gains `ruleCount`.
- No command behavior changes, and no failure path is added: every resolution
  falls back to a sentinel, consistent with the existing rule that telemetry is
  never a precondition.

## Deferred, deliberately

- **`cli_rule_verified`.** Fixture-verification counts would need a new event on
  `rule verify`, which reverses the standing decision that verify rides on
  `cli_run` alone. It serves one lower-tier metric and is not worth reopening
  that decision inside a change whose value is time-sensitive.
- **Rule-resolution rate.** Deriving "a finding was fixed" needs stable finding
  identity across runs — rule, file, line — which is a materially larger privacy
  question than anything here. It should be proposed on its own.
- **`cli_installed` is misnamed.** It fires on `init` and the wizard, so it
  measures initialization, not installation. Renaming it is a separate change;
  until then, install counts should be derived as the first `cli_run` per `cli`
  id rather than from the event that sounds like it.
