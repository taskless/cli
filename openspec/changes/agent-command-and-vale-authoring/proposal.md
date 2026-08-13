## Why

`add-vale-rule-engine` shipped a chooser without a destination. `engine-selection` teaches an agent to decide a rule belongs to `vale`, and then there is nowhere to go: `static.txt` is 76 lines of ast-grep authoring, and its only mention of Vale is a See Also line telling the reader to _confirm_ `sg` was right. An agent that follows the procedure correctly and lands on `vale` dead-ends, and so does one that lands on `runtime`. That was recorded as a deliberate non-goal at the time (`add-vale-rule-engine/design.md:16` excludes "generating Vale rules and authoring the committed `.vale.ini`"), but the chooser is what makes the gap reachable, and it is now shipped.

The same work exposed that the surface an agent reads is shaped for a human. `taskless help` names the command after a human's reason for typing it; agents are not asking for help, they are fetching a procedure. And the surface is addressed longform — `taskless help rule create` resolves by joining positionals — so an agent must know both the words and their order. Hyphenated single tokens read as literal strings an agent copies rather than a phrase it might paraphrase, which is the failure this surface cannot afford.

## What Changes

- **BREAKING** — `taskless help <topic>` becomes `taskless agent <topic>`. The command is named for who reads it.
- **BREAKING** — topic addressing flattens to a single token. `taskless help rule create` becomes `taskless agent create-rule`; the `positionals.join("-")` resolution is removed rather than generalized.
- **BREAKING** — authoring topics are renamed to verb-noun, matching what `route` decides:
  - `static` → `create-sg-rule`
  - `existing` → `create-legacy-rule`
  - new `create-vale-rule`
  - new `create-runtime-rule`
- **BREAKING** — `TOPICS` in `@taskless/cli/prompts` renames with them. `["static", "engine-selection"]` becomes `["create-sg-rule", "create-vale-rule", "create-runtime-rule"]`. No alias is kept. Pre-1.0, a backwards-incompatible change is a **MINOR** bump.
- `route` becomes the single front door, returning a concrete next command rather than a category. Its decision set is the four `create-*-rule` topics; service generation stays an escalation for when local authoring cannot express the rule, not a peer destination.
- **BREAKING** — `engine-selection` merges into `route` and stops existing as a topic. Its criterion distributes: `route` applies it to dispatch, and each `create-*-rule` recipe states the evidence that makes its own engine right. That is what keeps it exportable — a consumer outside the CLI has no `route` step and cannot run `taskless detect --json`, so a chooser topic was unusable to it anyway.
- `create-vale-rule` covers what no topic covers today: authoring a Vale style file under `vale/rules/`, scoping it with a `.vale.ini` section, and writing `pass/`/`fail` fixtures. Consistent with `create-sg-rule`, the agent writes these files; no CLI writer is introduced.
- The scaffolded `.vale.ini` ships **no section**, so a fresh project lints nothing until a user scopes something deliberately. `create-vale-rule` teaches writing that first section.
- Vale's stderr diagnostics on a successful run surface as notices. This is required by the change above, not incidental: with no section to copy, the likely first mistake is a rule assignment at top level, which Vale reports as `W101 ... is ignoring it` on stderr and which today is discarded — reproducing the silent-disable class the Vale work exists to eliminate.

## Capabilities

### New Capabilities

- `cli-agent-authoring`: the four `create-*-rule` procedures — what each engine's authored artifacts are, where they live, and what makes one complete. Covers the Vale authoring path that has no home today.

### Modified Capabilities

- `cli-help`: the command renames to `agent` and topic addressing flattens to a single token. Longform resolution is removed.
- `cli-rule-routing`: `route` dispatches to a concrete `create-*-rule` topic rather than a category, absorbing the engine decision it previously deferred to `engine-selection`.
- `cli-knowledge-prompts`: `TOPICS` renames, gains the Vale and runtime authoring topics, and loses `engine-selection`; pre-1.0 breaking changes are restated as MINOR.
- `cli-vale-rule-engine`: the scaffolded config carries no section, and Vale's stderr diagnostics on a zero-exit run become notices.

## Impact

- **`packages/cli/src/commands/help.ts`** — renamed, positional-join resolution removed.
- **`packages/cli/src/help/*.txt`** — two renames, two new files, and ~306 cross-references across 77 files that name `taskless help`.
- **`packages/cli/src/prompts/index.ts`** — `TOPICS`/`INTERNAL_TOPICS` membership and the `PromptTopic` union.
- **`@taskless/cli/prompts`** — published, typed export. The platform generator consumes `TOPICS` and deploys separately from the CLI, so it breaks on upgrade rather than at build time. Flagged in the changeset.
- **`packages/cli/src/filesystem/migrations/0004-vale-engine.ts`** — `VALE_CONFIG_CONTENT` drops its `[*]` section.
- **`packages/cli/src/rules/vale/run.ts`** — stderr captured on a zero-exit run and returned as a notice.
- **`skills/taskless/SKILL.md`** — the one skill naming `taskless help`.
- **Telemetry** — `cli_help` events carry a `topic` whose vocabulary changes; dashboards keyed on `static` go quiet.

## Delivery Shape

**Single PR**, stacked on #100. The rename is mechanical but total: a half-renamed command surface is not a shippable intermediate state, and splitting the topic renames from the command rename would leave cross-references pointing at commands that do not exist yet. Reviewable because the diff is overwhelmingly one substitution repeated, with four files of genuinely new prose.
