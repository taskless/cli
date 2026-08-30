# @taskless/cli

## 0.11.0

[Compare with v0.10.2](https://github.com/taskless/cli/compare/v0.10.2...v0.11.0)

### Minor Changes

- f7ee186: Partition `.taskless/` by rule engine. Migration `0004` moves ast-grep rules to `sg/rules/` and `sg/rule-tests/`, the runtime tree to `runtime/rules/` and `runtime/rule-tests/`, and scaffolds an inert `vale/`. Files move byte-for-byte, so runtime rule signatures survive.

  The directory a rule sits in now **is** its engine: dispatch reads the path and never parses a rule file to decide who owns it. `check` runs ast-grep against the committed `.taskless/sg/sgconfig.yml` instead of generating an ephemeral config each run.

  A rule engine the CLI does not recognize is now rejected with a message instead of failing silently: an unsupported engine from the server previously exited 0 with no output, which read as success.

  Runtime rules are discovered under `runtime/rules/` rather than the pre-migration `runtime-rules/`. Migration `0004` moves that tree byte-for-byte, so the signatures the server validates are unchanged.

  `check` and `rule verify` read the committed `.taskless/sg/sgconfig.yml` rather than writing an ephemeral config on every run, so the config ast-grep uses is the one you can edit and review. A pre-migration rule set still gets a generated config, so an unmigrated project keeps running.

  Existing projects keep working without action. The pre-`0004` `.taskless/rules/` still runs as ast-grep, and a delivered rule that names no engine is still treated as ast-grep — a rule engine this CLI does not recognize is rejected rather than guessed at. A migration that would have to merge a file into an engine directory now refuses up front with `SCAFFOLD_CONFLICT` rather than failing part-way.

- d4fca88: Add a `@taskless/cli/prompts` subpath export exposing the CLI's knowledge prompts as importable, topic-keyed render functions.

  `getPrompt(topic, options?)` and the `PROMPTS` map return fully rendered recipe text, with every `%(KEY)s` placeholder already resolved from values the package holds, so a consumer never handles a template dialect. Topic names are typed as `PromptTopic` and start at `static`, the one recipe a service-side consumer can act on; everything else stays internal until a consumer needs it. `PromptOptions` covers the anonymous variant, a `packageManagerDlx` override, and `header: false` for callers placing the text in an LLM system prompt, where the CLI version in the header would otherwise churn the prompt-cache key on every publish.

  The export is sourced from the same embedded recipes and the same render path `taskless help <topic>` serves, so the two surfaces cannot drift, and it carries no CLI runtime, so a Worker can import it without pulling in the command tree.

- 8c91857: Name the CLI by its full invocation everywhere an agent is told to run it.

  Agent recipes said `taskless agent route` — a binary almost nobody has on `PATH` — in 114 places, `npx @taskless/cli …` in 40 more, and only the second form was rewritten for non-prod builds. A nightly's recipes therefore sent readers to the released package. All of it now renders through one new sprintf variable, `%(TASKLESS_CLI)s`, which resolves to a caller-supplied invocation, else the build's own invocation when that build is not prod, else the agent-fill marker `<taskless-cli>`.

  `@taskless/cli/prompts` gains `getInstructions(topic, options?)` and `getRawInstructions(topic, options?)`, both returning `{ text, variables }`. The raw form hands back the unrendered template and the list of variables it contains, so a host that knows its own launcher can render the text itself; `variables` comes from sprintf-js's own parse rather than a regex over the template. `PromptOptions.invocation` is the only way a consumer sets `TASKLESS_CLI` — the render path stays free of `process` so it remains importable from a Worker.

  Fixes launcher detection in user-facing error messages. `getCliPrefix()` read only `npm_config_user_agent`, which every pnpm entry point sets, so running the CLI from a `package.json` script told the user to run `pnpm dlx @taskless/cli@latest`. Detection now reads the path the binary was launched from, recognizes npx and `pnpm dlx` only, and answers "unknown" for everything else. The package specifier comes from the build target, so a nightly's error messages name `@taskless/cli-nightly` at its own version.

- a5cff75: Report a missing GitHub remote as a boundary on remote rule generation, not as a broken repository.

  Remote rule generation needs a verifiable org, which comes from a GitHub `origin`. Local rule authoring, `verify`, `test` and `check` do not, and never did. Previously all three no-remote situations failed with one code and a message telling the user to fix their repository, which reads as a setup or auth problem rather than as one tier being unavailable. A project that is not a git repository at all, such as a notes vault, had no obvious path forward.

  Three codes replace the single collapsed one, because the remedies differ and an agent has to pick one:

  | Code                      | Situation                             | Remedy                          |
  | ------------------------- | ------------------------------------- | ------------------------------- |
  | `NOT_A_GIT_REPOSITORY`    | the directory is not a git repository | `git init`, or author locally   |
  | `NO_ORIGIN_REMOTE`        | a git repository with no `origin`     | add a remote, or author locally |
  | `UNSUPPORTED_REMOTE_HOST` | an `origin` that is not GitHub        | author locally                  |

  `NO_GITHUB_REMOTE` is **retained** and remains a valid member of the error-code contract, so consumers and recipes that branch on it keep working. Error codes are an agent contract: adding one is safe, renaming one is not.

  Each message now names the local authoring path that still works, so the refusal is something a reader can route around rather than a dead end. None of the three is ever reported as an authentication failure, which is pinned by a test: an agent that saw `AUTH_REQUIRED` here would send the user through `auth login`, which cannot fix any of them.

  Telling "not a git repository" from "no `origin`" needs a second question, since both fail the same `git remote get-url origin` call. That probe runs only on the failure path, so an ordinary run still spawns one process rather than two.

  `taskless info --json` now also reports `repositoryUrl` and `ghOwner`, so a caller deciding whether remote generation is available reads the same resolution the CLI enforces instead of shelling out to git and reaching a different answer. `repositoryUrl` is the canonical GitHub URL or `null`; `ghOwner` is the owner segment or the literal `[unknown]`. Both resolve without failing, including on a host with no git installed, and both are present under `--anonymous` because capability state is not auth state. `taskless auth` is unchanged and stays plain text.

  Telemetry now records `gh_owner`, so it is possible to see which GitHub owners use the CLI, including on anonymous runs. It resolves from the git remote rather than from the token, and is the owner segment when one is found or the literal `[unknown]` when not, so runs with no resolvable owner stay countable rather than disappearing from aggregates. `gh_owner` rather than `gh_org` because the first path segment of a GitHub URL is an organization or a user account, and telling them apart needs an authenticated API call an anonymous run cannot make; owner type is never inferred.

  `route` no longer offers remote generation when no GitHub owner is identifiable, reading `ghOwner` from the `info --json` call it already makes rather than re-deriving the remote, and says the tier is unavailable rather than silently dropping it. `create-remote-rule` guards the same constraint itself, before it collects anything, for the times an agent reaches it without going through `route`. Both state that `auth login` does not fix it: no GitHub owner is a property of the project, not the session.

- 38f7676: `taskless update` now tells an agent what an upgrade changed for the rules already in a project, and records when that work is done.

  **BREAKING for anyone scripting `taskless update`.** It used to mean "reinstall the skills non-interactively", which is what `taskless init --no-interactive` already does through the same code path, and what running `taskless` does on its own. Scripts relying on the old behavior should call `taskless init --no-interactive`.

  The word is reclaimed for the job an agent actually needs. Running the CLI migrates the `.taskless/` layout and refreshes skills: that is the directory, and it is automatic. No migration can rewrite the rules themselves, and a rewriter that now requires a `fix`, or a rule whose matching semantics shifted under a new engine, is a question about content. An agent that has run a migration and watched it succeed will otherwise reasonably conclude the upgrade is finished.

  `taskless update` with no flags serves a ledger: one section per release, in order, saying what that version means for existing rules. Sections are cumulative, and a version with nothing to do says so explicitly, because an agent cannot tell "nothing here" from "nobody wrote this". The first entry covers 0.11.0: the newly required `fix` on rewriters, Markdown's block-only grammar and its two opposite failure shapes, `sg run --lang` accepting alias spellings, and the matching-semantics changes that alter what a valid rule matches with no error at all.

  `taskless update --reconciledTo=<version>` records that the walk finished, in a new `rules` section of `.taskless/taskless.json` alongside the existing `install`. It stores the CLI version and the ast-grep and Vale versions the rules are now valid against.

  The two namespaces are separate because they drift. `install` records how the scaffold got here and moves on a skills refresh; `rules` records what the rules are valid against and moves only on a completed reconciliation. Keying rule work off `install.cliVersion` would let an agent skip entries it never performed, and it would fail quietly: the walk would report nothing to do while the rules stayed wrong.

  The version is validated rather than trusted. A value ahead of the installed CLI is rejected, since this build carries no entries for it, and the marker is never moved backwards.

  `taskless info --json` reports both namespaces, so an agent reads where to start from the same payload it already fetches.

- 6b07695: Ship Vale as per-platform binary packages.

  The CLI now declares `@taskless/vale-<os>-<cpu>` as `optionalDependencies` pinned
  to an exact version, so installing it also brings down a verified Vale binary for
  the host platform — no lifecycle script, and nothing to download at runtime. Only
  the matching platform installs; unsupported hosts install cleanly with none
  present and continue to fall back to a `vale` found on `PATH`.

- 0e03ee9: Add Vale as a second static-tier rule engine, give every engine one rule layout, and rename the agent-facing command.

  `check` now dispatches by engine and runs ast-grep, Vale, and runtime rules
  concurrently, merging their findings into one result set. An unavailable Vale
  reports itself and the other engines still return. A Vale that times out or
  rejects its config fails the check rather than passing as a clean run.

  **Every rule is now one directory**, `.taskless/rules/<engine>/<id>/`, holding
  the rule, any per-engine config, and its tests in `.tests/`. Writing a rule
  means creating a directory and deleting one means `rm -rf`. Nothing outside it
  is touched either way, so concurrent authors never collide on a shared file.

  Vale rules carry their own `.vale.ini` declaring which files they apply to.
  The single config Vale reads is assembled from those per-rule files on each
  run, gitignored, and regenerated, so hand edits to it have no effect. ast-grep
  keeps its `files`/`ignores` inside the rule and needs no second file.

  **`rule verify` is replaced by two path-addressed commands.** `verify <path>`
  checks that a rule has the components its engine requires and needs no tests,
  so it works while you're still authoring. `test <path>` runs the rule's tests,
  after running `verify` and stopping if that fails. Both take a rule directory,
  an engine directory, or nothing at all for the whole project, and both report
  one result per rule. Addressing by path rather than id removes the ambiguity
  that arose when two engines held the same rule id.

  Projects on an older layout migrate automatically on the next command.

  **BREAKING: `taskless help <topic>` is now `taskless agent <topic>`.** The
  command is named for who reads it. Agents fetching a procedure are not asking
  for help, and the old name is gone rather than aliased.

  **BREAKING: topics are addressed by a single token.** `taskless help rule
create` becomes `taskless agent create-sg-rule`; multiple positionals are no
  longer joined into a topic key. A topic name is now a literal string an agent
  copies rather than a phrase it can reorder. The renames:

  | Was                | Now                                     |
  | ------------------ | --------------------------------------- |
  | `rule create`      | `create-sg-rule` / `create-remote-rule` |
  | `rule improve`     | `improve-rule`                          |
  | `rule delete`      | `delete-rule`                           |
  | `rule verify`      | `verify-rule`                           |
  | `rule meta`        | `rule-meta`                             |
  | `static`           | `create-sg-rule`                        |
  | `existing`         | `create-legacy-rule`                    |
  | `engine-selection` | `route`                                 |

  `route` now applies the engine reasoning itself and names a concrete
  `create-*-rule` topic, so `engine-selection` is removed rather than renamed —
  its criterion is stated once, in `route`. Every authoring recipe is rewritten
  for the rule-directory layout.

  **BREAKING for `@taskless/cli/prompts` consumers.** `engine-selection` is no
  longer exported. `TOPICS` is now `create-sg-rule`, `create-vale-rule`, and
  `create-runtime-rule`, so a consumer that decides an engine can reach the
  procedure for each destination. Because the export is a string union, a
  consumer passing the removed name dynamically breaks on upgrade rather than at
  build time.

### Patch Changes

- 87abaf3: Fix the pass/fail counts reported when a rule's `ast-grep` tests fail.

  `ast-grep test` echoes the source of a failing test case, and `verify` scraped
  its counts with unanchored regexes over stdout and stderr combined — so a
  fixture containing text like `'7 passed; 0 failed'` was read as the summary and
  `verify` reported `✗ failed (7 passed, 0 failed)` for a run that actually had 0
  passed and 1 failed. The counts are now read from the summary line itself
  (`test result: ok.` / `Error: test failed.`), with ANSI colors stripped first.

  This only affected the reported numbers, never the pass/fail verdict, which
  comes from the exit code — but those numbers are handed to the agent driving
  `improve-rule`, where a wrong count can steer the next edit. Test output is also
  now decoded with a `StringDecoder` per stream, so a multi-byte character split
  across a chunk boundary is no longer mangled.

- 8e4084c: Upgrade the vendored ast-grep from 0.41.0 to 0.45.2, and add `Markdown` and
  `Dart` to the languages `sg` rules can target.

  **One breaking change reaches user rules.** A `rewriters:` entry now requires a
  `fix:`. It was optional in 0.41.0, and the regenerated rule schema makes
  `verify` name the offending rewriter directly. It cannot be migrated for you:
  `fix` is replacement text, so a tool can find every affected rewriter but
  cannot write one. Nothing shipped here uses `rewriters:`, so this only affects
  rules you wrote yourself. Elsewhere the schema barely moves: `matches:` widens
  from a plain utility-rule id to also accept a parameterized call object, which
  is backward compatible, and the top-level property set is unchanged.

  **`Markdown` is narrower than the name suggests, and the routing recipes now
  say so.** tree-sitter-markdown splits its grammar into block and inline halves
  and ast-grep exposes only the block tree. `atx_heading`, `setext_heading`,
  `fenced_code_block`, `list_item`, `paragraph`, `section` and `document` are
  real kinds, and headings discriminate by level. Everything inside a line is one
  opaque `inline` node: there is no `link`, `emphasis` or `strong_emphasis`.
  Naming one is a config error that exits 8 and takes the whole scan with it;
  writing it as a pattern instead matches nothing forever with no error at all.
  So "link text must not read click here" is a Vale rule, not an `sg` rule, and
  "every doc has exactly one h1" is neither, because ast-grep has no count and no
  absence assertion. `.md` is the first extension both static engines claim, so
  `route` now says which question each answers rather than leaving it to the file
  extension.

  Also: the `sg` alias is deprecated as of ast-grep 0.45.0 and prints a banner to
  stderr on every run. On a host where only `sg` resolves, that banner used to be
  decoded into user-facing messages as if an engine had reported it. It is now
  stripped.

- 307fb3a: Keep a whole-project `check` out of the paths git ignores.

  `check` reported prose findings from inside gitignored directories. The case
  that surfaced it was a git worktree at `worktrees/<name>/`, which is a complete
  second checkout: every Vale rule fired again over another branch's documents,
  including code an agent was mid-edit on. That makes the finding count move when
  a worktree appears or disappears with nothing in the output explaining why, and
  the general shape is the same for `dist/`, vendored trees, and local scratch
  directories — a check reporting on files nobody maintains.

  Only one engine was wrong, which is why it was hard to attribute. ast-grep's
  walker is the `ignore` crate and `sgWalkArgv` has always passed `--no-ignore
hidden` without `vcs`, so a bare scan already skipped `worktrees/`; measured
  against ast-grep 0.41.0, it skips a hidden-_and_-ignored `.turbo/` too. Vale
  has no notion of a VCS and walked everything. So the two static engines
  disagreed about which files the project contains, and only the prose findings
  duplicated. On a fixture repository with a worktree present, a bare `check`
  went from 6 findings to 4; the two that left were both Vale, both a second copy
  of a finding already reported against the tracked file.

  The set comes from `git ls-files --others --ignored --exclude-standard
--directory -z`, which is the complement of the tracked-plus-untracked set the
  question is usually phrased as. The complement is the one that scales:
  `--directory` collapses a wholly-ignored directory to a single entry, so
  `node_modules/` costs one line rather than forty thousand, and the result is
  short enough to hand Vale as `--glob` exclusions without meeting `ARG_MAX`. No
  new dependency — `.gitignore` is not one file or one syntax question once
  nested ignore files, `.git/info/exclude`, a global `core.excludesFile` and
  negation patterns are involved, and git already answers all of it in one call.

  The exclusion belongs to the walk `check` chose for itself. `check
worktrees/probe` names an ignored path deliberately and still checks it, on the
  same terms as the existing `.taskless/` exclusion. A directory that is not a
  git repository, or a host with no `git` on its `PATH`, gets an empty ignore set
  and the walk that shipped before this change. Standing _inside_ an ignored
  directory is treated as explicit too: git answers `./` there, meaning
  "everything here", and honouring that would return an empty check with nothing
  saying why.

  The converter skip notice no longer names files inside ignored paths. An
  `.adoc` under `worktrees/` is not a file this run declined to convert; it is a
  file this run was never going to open, and naming it would send the reader to
  investigate a directory the exclusion is there to keep out.

- 1fb9dda: Rewrite the CLI README around what you actually do with Taskless: installing it,
  driving it from your coding agent with the `taskless` skill and `/tskl` command,
  running `taskless check` in CI, and where to find the docs. Telemetry — and the
  two environment variables that turn it off — is now stated plainly instead of
  being left to the source.
- 93ed5ec: Name Codex in the install picker, so Codex users can see that it supports them.

  Codex has always been detected and installed into `.agents/`. The tool-selection
  step just never said so: it read `Claude Code / Cursor / OpenCode / Agent
Skills`, and the entry that serves Codex is the one whose label only makes sense
  if you already know `AGENTS.md` is the file Codex reads. A GPT-centric founder
  looked at that list and concluded we did not support GPT. He was wrong, and the
  list is why he thought it. Somebody who believes their harness is unsupported
  does not file a bug, they leave.

  The picker now offers a `Codex` row alongside the generic `Agent Skills` row,
  both pointing at `.agents/`. Two rows for one directory is deliberate: people
  scan a list for the name of the tool they use, and `Agent Skills` still has to
  be there for anyone on a harness the catalog does not enumerate. Neither label
  is redundant, so neither one goes.

  That makes the catalog a list of rows rather than a list of directories, which
  was an assumption the code held in three places. A single `.agents/` selection
  used to match one row; it now matches two, and would have been pre-checked
  twice, planned twice, written twice, and reported twice in the install summary.
  The pre-checked set, `detectSelectedDirectories`, and the install plan all
  collapse the catalog on `dir` first. The dedupe is on the directory rather than
  on the Codex row specifically, so the next pair of rows that share a
  destination inherits it instead of reintroducing the bug. Ticking either row
  selects `.agents/` once, and ticking both is the same install as ticking one.

- f13d501: Stop corrupting non-ASCII characters in ast-grep's error output.

  `runAstGrepScan` and the runtime narrow both decoded ast-grep's stderr one
  chunk at a time with `chunk.toString()`. A multi-byte UTF-8 sequence split
  across a chunk boundary was decoded as two invalid sequences, and both halves
  became replacement characters before the pieces were joined — the original
  bytes unrecoverable by then. Each stream now uses a single `StringDecoder`,
  flushed on close, matching what the Vale runner and `verify` already do.

  The corrupted text only ever reached an error message, so no scan result was
  ever wrong. But that message is the one a user reads when ast-grep rejects a
  rule file, naming a rule id or a path — which is exactly where a non-ASCII
  character turns up.

- 71f4394: Tell the routing recipe what the local engines can actually read.

  `route` chose between `sg`, `vale`, and the runtime tier on the shape of the
  evidence alone, and had nothing to say about language reach — so a rule over a
  GitHub Actions workflow was escalated to `create-runtime-rule`, which needs a
  login, because nothing stated that ast-grep parses YAML. It does. Nothing in
  the repository could have said so either: the vendored ast-grep schema types
  `language` as a bare string with no enum, `verify` never checks the field, and
  `detect --json` reports the repo's own languages in a different vocabulary.
  Vale self-reports nothing at all.

  `route` now states both engines' reach, and `create-vale-rule` repeats Vale's
  where a matcher is written. Both read the lists from constants pinned to the
  engine versions this CLI ships, rather than from prose typed into the recipe —
  an engine bump that changes what a binary parses now fails a vendor-contract
  test instead of leaving a confident, wrong sentence in front of an agent.
  Vale's reach was measured by probing the shipped binary, tier by tier, since it
  publishes no capability listing.

  The Vale half carries a hazard worth naming on its own. Vale supports
  reStructuredText, AsciiDoc, XML, DITA, and MDX by shelling out to an external
  converter, and this CLI ships none of them — so one such file caught by a
  rule's glob exits 2 with an `E100` and abandons the whole run, silencing every
  other Vale rule over every other file. `create-vale-rule` had been offering
  `[*.{md,mdx}]` as its example of widening a matcher.

  `.xml` is the one entry where naming the converter is not enough. It needs
  `xsltproc` **and** an XSLT stylesheet, and a stylesheet is document-specific, so
  there is nothing to ship and installing the program does not make `.xml`
  lintable — unlike `asciidoctor`, which genuinely fixes `.adoc`. Vale says so
  differently depending on the host, too: `xsltproc not found` where the program is
  absent, `no XSLT transform provided` where it is present, and macOS ships
  `/usr/bin/xsltproc` while a typical Linux CI image does not. The contract test
  now asserts Vale's checker tag, which is the same everywhere, rather than a
  substring of the converter name.

- 9e886b8: Spell the telemetry property `ghOwner` rather than `gh_owner`.

  Telemetry names events in `snake_case` (`cli_run`, `cli_check_completed`) and properties in `camelCase` (`cliVersion`, `durationMs`, `errorCount`). `gh_owner` was added in the previous change with the event convention applied to a property by mistake, and it was the only property in the codebase spelled that way.

  No migration is needed for anyone reading this: the property was introduced in this same unreleased cycle, so no stable build ever emitted `gh_owner` and no saved insight can be filtering on it.

  The convention is now stated normatively in the `analytics` spec, so it can be checked rather than inferred from whichever names happen to exist.

- 87392fa: Make `--help` work on every command, instead of running the command.

  `taskless check --help` printed no usage — it ran `check`. So did every other
  subcommand: `--help` was parsed as an unrecognized flag and the command body
  executed anyway, which meant asking `init` how it works installed skills, and
  asking `check` how it works migrated the `.taskless/` scaffold. The only place
  help worked was the bare `taskless --help`, whose own output tells you to run
  `taskless <command> --help`.

  `--help` and `-h` are now recognized at every depth, including nested commands
  (`taskless auth login --help` describes `login`, not `auth`), and a working
  directory passed before the command (`taskless -d ./repo check --help`) no
  longer confuses which command you asked about. The usage text itself is
  unchanged, and nothing else about how commands run has changed.

- ac83a00: Hold the agent-facing recipes to the house writing style.

  `packages/cli/src/agent/*.txt` is bundled into the published CLI and served by `taskless agent <topic>`, so it is text users and agents read on every authoring run. It was the largest prose surface the house-style rules did not cover. `no-em-dashes`, `no-blocklist-phrases` and `no-hedging` now reach it, and the 270 existing em and en dashes are rewritten as periods, commas, colons or parentheses depending on what each one was doing.

  No instruction changed meaning. The recipe-content tests, which assert exact phrases from `route.txt`, `create-sg-rule.txt`, `create-vale-rule.txt` and others, all still pass.

  Two scoping notes worth knowing for anyone widening further. These files are `.txt`, which Vale treats as plain text: there is no markdown parser, so fenced blocks and code spans are **not** skipped the way they are in a `.md` file, and command examples are checked as prose. And `create-vale-rule.txt` and `verify-rule.txt` are excluded from `no-hedging`, because both teach rule authoring through a worked example named `no-simply` and the token appears throughout as an identifier rather than as hedging.

- 32da4f9: Stop the engine-partition migration from relocating a rules tree that is already partitioned.

  A `.taskless/` with no `taskless.json` — a manifest that was never committed, or was deleted — reads as version 0, so every migration runs against it. Migration `0004` then applied its `rules/` → `sg/rules/` move to a tree already in the current layout, burying every rule at `.taskless/sg/rules/sg/<id>/`; `0005` scaffolded fresh empty engine directories over the gap. Nothing errored. `check` scanned a tree with no rules in it and exited 0 on a clean report, so a project that had silently stopped being checked was indistinguishable from one that passes.

  `0004` now reads the shape of `.taskless/rules/` before moving it. A tree holding engine directories and no loose rule files is newer than the migration, not older, so it is left alone. A genuinely pre-`0004` tree of flat `rules/<id>.yml` files still moves wholesale, as before. And a tree holding both — an already-partitioned layout with a stray `rules/<id>.yml` beside it, as a merge-conflict leftover produces — migrates only the stray files: moving the directory to collect them would carry the partitioned rules down with it, and `0005` never brings them back, which is the same silent clean pass by another route.

- 8d9d9cf: A project with no recorded rules marker now walks the ledger from the beginning, and `taskless update --rules` replaces `--reconciledTo=<version>`.

  Previously an absent `rules.reconciledTo` meant "nothing to walk", on the reasoning that a project created at the installed version has no history. That was right about new projects and wrong about every existing one: a project that predates the ledger has had none of its entries applied, so reading absence as up to date silently excused exactly the population the entries were written for. The 0.11.x entry would have reached nobody.

  Absent now means `0.0.0`, so every section applies. New projects stay correct because `init` stamps the marker at creation, which is what makes the two distinguishable: present means accounted for, absent means predates the ledger. The stamp never overwrites an existing marker, so re-running setup cannot reset one a real walk earned.

  `--reconciledTo=<version>` is replaced by the flag `--rules`, which stamps the running CLI's version. The value was never load-bearing: the CLI knows its own version, the only sensible endpoint of a walk is the installed one, and accepting a value only made it possible to claim a walk that did not finish. Removing it removes the two guards that existed to police it and every way of supplying it wrongly. The backwards guard remains, because an older CLI running on the same project would otherwise rewind the marker.

  The ledger heading is now `Migrating to 0.11.x`, since the entry describes the release series rather than one patch.

- e25117b: Report the `.taskless/` layout migration on the `--json` envelope.

  `check`, `verify`, and `test` migrate the scaffold before they can do their real
  work, and that rewrites files in the working tree: rules move into per-rule
  directories, configs are deleted, `taskless.json` and `.gitignore` are rewritten.
  Until now the only trace was one line of prose on stderr, so a CI script reading
  `{"success":true}` had no way to learn that its checkout had changed underneath
  it. The migration would then land in an unrelated commit, or run mid-suite and
  fail tests that had nothing to do with the change being made.

  Those commands now carry a `migrated` field when, and only when, a migration
  ran:

  ```json
  {
    "success": true,
    "results": [],
    "migrated": {
      "from": 3,
      "to": 5,
      "applied": [4, 5],
      "files": {
        "added": [".taskless/rules/sg/no-eval/no-eval.yml"],
        "modified": [".taskless/taskless.json"],
        "removed": [".taskless/sgconfig.yml"]
      }
    }
  }
  ```

  The field is absent when nothing happened, so presence is the signal and no
  consumer has to read empty arrays to decide. Paths are relative to the project
  root and sorted.

  The migration keeps happening automatically, because these commands need a known
  layout to run at all and the alternative is a hard failure on every upgrade. The
  human notice improved to match the new field: it names the source and target
  versions up front, and prints the files it touched on completion.

- 0cc713e: Split the release pipeline so each workflow file carries one release design.

  `release.yml` held two jobs with opposite trust properties behind one header.
  It is now `release-cli-changeset.yml` — which reads contributor-authored
  changesets and opens the Version Packages PR holding no npm credential and no
  OIDC identity — and `release-cli.yml`, which keeps the credential-free
  "is this version already on npm?" gate together with the publish job it
  protects, so an OIDC-capable job is never instantiated on an ordinary merge.
  `vale-binaries.yml` is renamed `release-vale.yml` to match.

  The build and publish steps themselves are unchanged — same triggers, same
  `permissions: {}`, same action pins, same OIDC trusted publishing behind the
  same `npm-production` approval. Two operational details do differ: `check` and
  `publish` no longer share the `release-*` concurrency group, and the release
  now runs as two workflow runs instead of one, so its check contexts are
  `Release CLI Version PR / …` and `Release CLI / …` rather than `Release / …`.
  Neither is a required check.

  The header comments also get one correction: they claimed `npm-production` had
  no required reviewers, and it has had one all along, so a release has always
  waited for a human approval that the file said was not there.

  Publish unreleased work on `main` as `@taskless/cli-nightly`.

  Every push to `main` that has changesets pending now publishes the CLI under a
  second package name, stamped `<next-version>-<yyyymmddhhmmss>x<short-sha>` — so
  merged-but-unreleased behavior is installable with `npx @taskless/cli-nightly`.
  A nightly is the same build as the release it anticipates and keeps the
  `taskless` executable, so it is a drop-in; the rename happens at pack time, so
  `@taskless/cli`'s own version history stays releases-only. Installing both
  globally collides on the binary and is unsupported.

  Two credential-free gates decide whether anything is built — pending changesets
  first (before any install), then whether the commit already has a nightly — so
  the publishing job is never instantiated on an ordinary push, and the merge of a
  Version Packages PR publishes the real release and no nightly with no rule
  special-casing it.

  A nightly now ships instructions for itself. The skills, commands, and recipes
  a nightly installs name `npx @taskless/cli-nightly@<version>` — pinned to the
  build being installed — instead of `npx @taskless/cli`. Previously a nightly
  carried the released CLI's text verbatim, so an agent following it ran the
  released binary: no error, just instructions for a different package, on a
  build installed precisely to exercise unreleased behavior. The version is
  stamped once and passed to both the build and the pack, so the version the
  instructions name is always the version on npm, and a nightly build without a
  valid version fails rather than falling back.

  The nightly's duplicate-suppression gate also now fails closed. An unreadable
  registry response used to read as "this commit has no nightly", and since each
  build stamps a fresh timestamp, a re-run after one would have published a
  second nightly for the same commit successfully and silently.

- 226061d: A nightly now reports the version it is, not the release it anticipates.

  Installing a nightly wrote the previous release into `.taskless/taskless.json`
  — `install.cliVersion: "0.10.2"` — while the skills written beside it, by the
  same command in the same run, pinned every invocation to
  `@taskless/cli-nightly@0.11.0-…`. The manifest attributed the install to a
  version that never performed it, which matters because `install.cliVersion` is
  what answers "what installed this?", and that question gets asked precisely
  when someone is running a nightly to reproduce unreleased behavior.

  A nightly's version is stamped when the publishable artifact is produced, and
  the committed `package.json` is deliberately left untouched — so the build was
  reading a file that could not know the answer. It now takes the same stamp that
  names the published package, so the version a nightly reports and the version
  it sends an agent to are the same string by construction.

  This also corrects `taskless --version`, the CLI version in recipe headers, and
  the `cliVersion` telemetry property on nightly builds. Released builds are
  unaffected. A nightly that cannot determine its own version now fails the build
  rather than quietly reporting the released one.

  The build now also refuses to emit a nightly whose reported version and
  embedded invocation disagree. Both derive from the same stamp, so they cannot
  diverge today — but that was true of the two values in this bug as well, right
  up until one of them started reading `package.json` instead. Deriving from one
  source is not the same as being checked against it.

- c4a252b: Onboarding now reads the routing surface before it proposes rule candidates.

  The `onboard` recipe asked the agent to synthesize its bullet list of
  hypothetical rules first and consult `route` only afterwards, once per accepted
  bullet. So the list a user picked from was written without knowing what kind of
  rule anything would be, or what the repository already lints — and a candidate
  with nowhere to go looked exactly like a good one until the user had already
  chosen it.

  The recipe now fetches `taskless agent route` and runs `taskless detect --json`
  before proposing anything, and each bullet carries the destination it would
  route to: `- no-direct-db-access [sg]: …`. The annotation is provisional —
  `route` still decides for real at materialization time, when it has the rule's
  full description — but an unroutable candidate is now visible while it is still
  cheap to drop.

  The destination criterion itself has not moved. It is still defined once, in
  `route`; onboarding reads it rather than carrying a copy that would drift.

- a7ec7a1: Complete the `help` → `agent` rename. The user-facing command was renamed in
  0.10.0, but the internals kept the old name: the recipe directory moved from
  `packages/cli/src/help/` to `packages/cli/src/agent/`, the `cli-help` OpenSpec
  capability is now `cli-agent`, and the shipped skill and `/tskl` command no
  longer tell agents to run the removed `npx @taskless/cli help <topic>` (they
  now use `agent`, with the single-token topic names — `route`, `improve-rule`,
  `delete-rule`, `create-sg-rule`, and siblings).

  **Telemetry rename (hard cut, no dual-emit).** The `cli_help` event is renamed
  to `cli_agent`. The `topic` property is unchanged. PostHog dashboards keyed on
  `cli_help` will need updating — nothing is emitted under the old name.

- bafeeed: Stop a nightly from writing a `.taskless/README.md` that sends the reader to
  the released package.

  `.taskless/README.md` is written into the user's repository and overwritten on
  every migration run, so what it names is shipped content. It hardcoded
  `@taskless/cli@latest`, which meant a nightly wrote a README instructing its
  reader to install the release over the nightly they had installed minutes
  earlier to exercise unreleased behavior.

  The obvious repair was not available. `applyCliInvocation` rewrites
  `npx @taskless/cli` and `npx @taskless/cli@latest` and nothing else, and the
  README shows two launchers, so routing it would have corrected the `npx` line
  and left the `pnpm dlx` line naming the release. One right line beside one
  wrong one is worse than two consistently wrong ones, because it looks fixed.

  So the two halves of the answer are now handled separately, which is how
  `util/package-manager.ts` already frames it. The **specifier** is a build-time
  fact and was the whole bug: it comes from `pinnedSpecifier()` and is applied to
  both launchers, so a nightly names `@taskless/cli-nightly` at its own version
  on the `pnpm dlx` line and the `npx` line alike. The **launcher** is a runtime
  fact and stays a menu in every build. This file is read long after it is
  written, by someone who may reach for either package manager, and detecting the
  launcher would make its bytes depend on how one particular run happened to be
  launched, in a file many projects commit and the migration rewrites every time.
  A `self` build, whose invocation is a path that no launcher fronts, gets that
  one invocation instead of a menu. A released build's README is byte-identical
  to before.

  The `agent` topic index carried the same defect in its human-facing hint and is
  now routed through `applyCliInvocation`, which is all that line needs.

  Third time for this defect class, so it also gains a lint rule of its own.
  `no-unrouted-cli-invocation` reports a string literal under `packages/cli/src/`
  that names the released package outside a call to `applyCliInvocation`. It sits
  on source rather than on the build output because nothing about the artifact
  distinguishes routed content from unrouted content: a prod build legitimately
  contains every one of these strings, and the rewrite happens at runtime.

- afb4831: Let ast-grep rules see inside hidden directories such as `.github/`.

  ast-grep's file walker skips dot-directories unless told otherwise, and
  `runAstGrepScan` never told it otherwise. No `sg` rule could match anything
  under `.github/`, `.circleci/`, `.vscode/` or `.husky/`, so `check` reported
  nothing and exited 0 on a workflow file it flags correctly the moment the same
  bytes live in a non-hidden directory. Vale has no such blind spot, which left
  the two static engines disagreeing about whether `.github/` existed at all.
  Both `check` and the runtime engine's ast-grep narrow now pass
  `--no-ignore hidden`.

  Only `hidden` is passed, and deliberately not `vcs`: `.gitignore` is still
  respected, so the wider walk does not start reporting findings in `dist/` or
  anywhere else a project has already said it does not want scanned. Rule
  discovery is untouched — `ruleDirs` walks by its own rules, so a rule's
  `.tests/` directory is still skipped rather than parsed as a rule.

  `.taskless/` is excluded from the wider walk, because it is hidden too and
  reaching it is not a fix. A rule definition is structured YAML full of `id:`,
  `language:`, `severity:` and `rule:` keys, so an ordinary user-written Yaml rule
  fires on the CLI's own rule files — a finding in a directory the user did not
  author and cannot edit without disabling their rule. The exclusion applies only
  when `check` walks the whole project on its own; an explicit path stays a
  request, which is the rule the Vale runner already follows.

  `.git/` is excluded on the same terms. ast-grep has no exclusion of its own for
  it and `.gitignore` does not list it, so the default hidden-directory skip was
  the only thing holding it back: without this, a whole-project `check` descended
  into `.git/objects` and `.git/logs` on every run, and `.git/hooks/*` scripts
  matched language rules never meant to lint VCS internals.

  Both engines now decide "whole project" the same way, and it is no longer
  `paths.length === 0`. An explicit `.` is normalized to the literal path `"."`
  before it reaches either runner, so a length test read the most ordinary way of
  asking for a whole-project check as a user-named path and skipped the exclusions
  — `check` was clean while `check .` reported findings inside `.taskless/`. Vale
  was already wrong in the same way and for the same reason, independently of the
  hidden-directory change, so the predicate is now shared rather than written
  twice.

- 066e5d8: Stamp a `self` build with the release it anticipates rather than the one it follows.

  `build:self` reported the committed package version, so on a `main` carrying
  unreleased work it wrote `install.cliVersion: "0.10.2"` into the committed
  `.taskless/taskless.json`. That names a release predating the tree, and it is
  indistinguishable from the value a real install of that release would write, so
  the file silently lost whatever it held.

  A self build now stamps `<next>-self`, where `<next>` is what the pending
  changesets propose. The suffix names what the build anticipates rather than what
  it follows, and it is unmistakable in a diff. It is safe for the reconciliation
  ledger, which compares the numeric core, so `0.11.0-self` and `0.11.0` are the
  same version to a walk, exactly as a nightly and its release are.

  Only the `self` target changes. A prod build still reports the committed
  version.

- 73cdc45: Fail `test` for an ast-grep rule that never demonstrates it can fire.

  `verify` checked that a rule's `-test.yml` existed and never read what was in
  it, and `ast-grep test` reports an empty `invalid:` bucket as `1 passed; 0
failed` and exits zero. A rule whose fixtures were all `valid:` therefore
  reported `ok: true, ran: true` while `check` found nothing anywhere — verified
  looking verified, having proved nothing. `test` now counts the `valid:` and
  `invalid:` entries across every test file a rule owns and requires both, which
  is the rule Vale fixtures have always been held to.

  **This rejects rules that passed before.** Any sg rule with an empty or absent
  `invalid:` bucket now fails `test` until a fixture is added that the rule
  actually matches. That is the intended effect: adding one is how the underlying
  mistake surfaces.

  The mistake that prompted this is worth knowing about, because the pattern
  looks correct. A trailing `$$$` next to a comma does not mean "zero or more" —
  the comma is itself an AST node, and under ast-grep's default `smart`
  strictness every node in the pattern must match, so `fetch($URL, $$$REST)`
  never matches `fetch(url)` and silently starts at two arguments. A leading
  `$$$` is worse: `foo($$$, $A)` collapses to exactly one argument. Upstream
  considers this intended and 0.45.2 behaves identically, so there is no version
  to upgrade to; write the pattern as an object with `strictness: ast` to ignore
  the separator, or use `any:` with one branch per arity. `verify --schema` now
  carries a worked example, and the behaviour is pinned against the vendored
  binary so a bump that changes it fails loudly.

  `create-sg-rule` states all of this where a pattern is written: the arity table
  measured against the pinned binary, both remedies and the fact that
  `strictness: ast` moves a trailing `$$$` from two arguments to one rather than
  to zero, and the fixture requirement with a case on each side of an arity
  boundary. It also names ast-grep's `language:` vocabulary from the same pinned
  constants — nothing local validates that field, an unrecognized spelling takes
  the whole scan down, and `Tsx` is a different parser from `TypeScript` rather
  than an alias. `improve-rule` gains the two notes that matter when a rule is
  rewritten rather than written: read the pattern for a comma-adjacent `$$$`
  before reporting it as too narrow, and re-check both fixture buckets after the
  service returns a narrowed rule.

- 9e87aa6: Stop a rule with no tests from failing every other rule's ast-grep test run.

  Migration `0005` created a rule's `.tests/` only as a side effect of moving a test file into it, so an ast-grep rule that had no test at version 3 — or one whose test file did not match the `<id>-YYYYMMDD-test.yml` shape the migration can attribute to a rule — arrived in the new layout with no tests directory at all. Assembly then named that directory as a `testConfigs` entry anyway, and ast-grep 0.41.0 treats a `testDir` it cannot read as fatal to the whole invocation rather than to the one rule: `taskless test` on _any_ rule died with `Cannot read rule directory .taskless/rules/sg/<other-id>/.tests` and exit 6, naming a rule the author had never touched. `--filter` does not scope that away, so there was no way to run one rule's tests around it.

  `0005` now gives every `rules/sg/<id>/` a `.tests/`, holding a committed `.gitkeep` when it would otherwise be empty — git does not track empty directories, so without one the repair would not survive a commit and the failure would come back in CI. Assembly separately omits any `testDir` that is not on disk, which is what rescues a project a nightly already stamped at version 5: migrations short-circuit once the manifest is at the latest version, so those installs never re-run the amended `0005`, and the same state is reachable at any version by creating a rule directory by hand. Neither change turns a missing test into a pass — `verify` still reports "No test file found" and `test` still reports "Skipped: no test file found", both reading the rule directory rather than the generated config.

- 3927c29: Tell the reader how to restore a canonical file a reference stub cannot find.

  The stub written into `.claude/`, `.cursor/`, `.opencode/`, and `.agents/` was
  two sentences: this is a stub, read `.taskless/skills/<name>/SKILL.md`. When
  that canonical file is not on disk, the agent does not fail to find a skill. It
  finds the skill, follows it to a path that does not exist, and the stub says
  nothing about what to do next. Command stubs had the identical shape and the
  identical dead end.

  Two ordinary situations produce it. An install writes untracked files, so a
  worktree created before they are committed has the stub and not the canonical
  file, which is how it was first hit. And a project that ignores
  `.taskless/skills/` commits the stub and never the canonical file, permanently.
  Nothing in the CLI causes the second case: `addToGitignore` is only ever called
  with `.env.local.json`, `/sgconfig.yml`, and `.run/`. A repository that builds
  the CLI makes that choice for itself, and this one does.

  Both stubs now carry one more line naming the command that restores the file.
  The command is `init` rather than a bare run, because a bare invocation
  installs only from a TTY; without one it prints a preamble and hands off to
  `agent`, which is precisely the context an agent reading a stub is in. And it
  is this build's invocation rather than a hardcoded `npx @taskless/cli`, passed
  through the same rewrite canonical content uses, so a `dev` or `self` build
  names its own binary and a nightly names the nightly instead of sending someone
  to install the released package over it.

  Stub frontmatter still carries no version, and nothing added here varies per
  release, so the footprint outside `.taskless` moves once and then holds. A stub
  already on disk is rewritten once by the next install, detected on a fragment
  of the sentence that is the same in every build so a prod install and a local
  one do not rewrite each other's stubs on every run.

- 5031fbd: Stop deriving `--json` error codes from the text of an error message.

  `rule create` and `rule improve` chose between `AUTH_REQUIRED` and
  `NO_GITHUB_REMOTE` by running `/git remote|origin/i` over the human-readable
  message that `resolveIdentity` threw. The codes exist so a machine consumer
  never parses English, and the code itself was being picked by parsing English.
  It happened to be right only because both repository-URL messages contain the
  words "git remote"; rewording or translating either one would have silently
  told every `--json` consumer to log in when the real problem was the project's
  git remote.

  Each failure now throws a `CLIError` carrying its own `CLIErrorCode`, and both
  call sites read that field through one shared helper. No new code was added.

  The emitted codes for existing scenarios are unchanged:

  | Condition                                   | Code               |
  | ------------------------------------------- | ------------------ |
  | Not logged in                               | `AUTH_REQUIRED`    |
  | Not a git repository, or no `origin` remote | `NO_GITHUB_REMOTE` |
  | `origin` remote is not on `github.com`      | `NO_GITHUB_REMOTE` |

  One code does change, for a scenario that is unreachable today: an unexpected
  throw from the org-resolution step now reports `INTERNAL_ERROR` rather than
  whichever of the two codes its wording happened to match. That step swallows
  every network and HTTP error and falls back to a nil-UUID org subject, so it
  cannot fail in normal operation; anything escaping it is a CLI bug rather than
  a state the caller can act on.

- a596e54: Close the gaps in `create-vale-rule` that produce a rule which is green
  everywhere and reports nothing.

  A malformed Vale rule fails loudly. A Vale rule that is merely _wrong_ passes
  `verify`, passes `test`, and never fires — and nobody re-checks a green rule.
  The recipe now documents each of those failures as an observed behavior of the
  pinned Vale binary rather than as a caution in principle:
  - **The measured `scope` vocabulary**, with what each value actually reaches.
    `raw` subsumes `code` and `text`; `~` negation and `&` chaining are accepted;
    and a negation over a scope Vale does not know (`~fenced`) is a silent no-op
    that removes the exclusion you wrote the rule for.
  - **`scope` is per-rule.** Taskless assembles one config per run, which invites
    the assumption that scopes interact. They do not.
  - **A `raw`-scoped rule cannot be suppressed** by `<!-- vale Rule = NO -->`,
    because it reads the unparsed document — so a rule about a shell command needs
    `raw` and trades away per-case exemption.
  - **A punctuation-only token needs `nonword: true`**, because Vale wraps every
    token in word boundaries and an em dash has no word character on either side.
  - **How to scope a rule _out_**, with a second matcher assigning `NO`.
  - **Collocation guidance** for a banned word, checked by writing the `pass/`
    fixture from the literal sense first.
  - **Fixture design for a subject that appears in code**: `fail/` must carry it
    inline, fenced, and in prose.
  - **`limit`** in the common-fields table, **`vocab`** with the per-check fields
    it actually belongs to, and that Vale loads only `.yml` — a style file renamed
    to `.yaml` is silently not loaded at all.
  - **Fixtures run under an isolating config**, so a green `test` is not evidence
    the rule's matcher glob reaches any real file.

  Vale's check types are now enumerated from the binary rather than the docs.
  There are **twelve**, not eleven: the docs fold `readability` into `metric`.
  The per-check field tables are measured the same way, which corrects three
  published claims: `capitalization` takes `prefix` (singular) and rejects
  `prefixes` and `suffixes`, `capitalization` rejects `ignorecase`, and
  `occurrence` rejects `exceptions` and `vocab`.

  `verify` now schema-checks a Vale rule structurally, before Vale is invoked.
  It previously validated `level` and the presence of the rule's `.vale.ini`, so
  `extends: nonsense` and `scope: fenced` both verified clean. It now also checks:
  - **`extends`** against the twelve check types, naming the accepted set.
  - **`scope`** as a grammar over measured operands — a bare value, a list, `~`
    negation, `&` chaining — rather than a flat enum, which would have rejected
    working rules. It is deliberately stricter than Vale in one place: a negation
    over an operand Vale does not know (`~fenced`) fires on everything, having
    silently lost its exclusion, and is rejected.
  - **Per-check fields**, so a field belonging to another check type is caught
    before Vale reports `E201`. `consistency` and `spelling` are exempt because
    the binary accepts any key on those two.

  The ordering is the point for two of the three: Vale reads one assembled config
  per run, so an unknown `extends` or a foreign field reaching the binary takes
  down **every** Vale rule's findings, not just the offending rule's.

  The schema is hand-authored, because Vale publishes no JSON Schema and its
  machine-readable field knowledge is behind a paid hosted MCP. What holds it to
  the binary is a corpus of 82 minimal rules, each with a document it must flag,
  run through both the vendored Vale and the schema, asserting the two agree —
  with guards so that a rule which "did not fire" because its fixture was
  unreachable cannot pass as a measurement. A Vale upgrade that changes the
  vocabulary fails a test that names the value.

- 4960987: Stop one AsciiDoc file from disabling every Vale rule in the project.

  Vale supports AsciiDoc, reStructuredText, XML/DITA and MDX, but it parses none
  of them by itself — it shells out to `asciidoctor`, `rst2html`, `dita` or
  `mdx2vast`, and the `@taskless/vale-*` packages ship the binary with none of
  those alongside it. On a host without the converter Vale does not skip the file:
  it prints one `E100 [lintAdoc] Runtime error` on stderr, writes nothing at all to
  stdout, and exits 2. The abort is Vale's own and it is not scoped to the file
  that caused it, so every finding from every other file in the run was destroyed
  before it was ever serialized. Measured against the example project, adding a
  single `.adoc` took a check that reported five Vale findings across four files
  down to zero — reported as a raw JSON blob among the results, and exiting 1 the
  same way any ordinary failing check does.

  `runVale` now excludes the converter-dependent extensions from Vale's own walk,
  so the rest of the project is checked normally and the skipped files are named
  in a notice that says which converter would put them back in scope. The tiers
  live in one table in `rules/capabilities.ts` — the same record the agent recipes
  render their format lists from — measured against the pinned binary rather than
  transcribed from documentation. That is how `.asc` and `.rest`, a third AsciiDoc
  spelling and a second reStructuredText one that crash identically and were in
  neither bug report, ended up covered. Measurement also corrected four
  extensions that a documentation reading had put in the wrong tier: `.tex`,
  `.rmd`, `.mkd` and `.mkdn` are all read as plain text by this Vale, not parsed,
  so excluding them would have dropped files Vale lints perfectly well. A
  per-extension test re-measures every row against the real Vale — each tier by
  the property only that tier has, since ordinary prose fires in all of them — so
  a version bump that moves a format between tiers fails there instead of silently
  turning the engine off again.

  The engine moves to Vale 3.18.0 in the same release, and the table carries a
  standing instruction to re-measure every row on a version bump — so every row
  was re-probed against the new binary rather than carried over. Eight moved.
  `.mdx` gains a native parser and leaves the unsupported tier, so a matcher like
  `[*.{md,mdx}]` — the worked example above — is legitimate again, and `[*.{md,typ}]`
  takes its place as the broken one. `.typ` moved the opposite way: Typst now
  parses through `typst2vast`, an external program this build does not ship, so a
  Typst file is excluded from the run rather than read as prose the way 3.17.1
  read it. `.rmd` and the new `.qmd` and `.myst` are parsed as markup, and `.qml`,
  `.scss` and the new `.qdoc` are comment-aware where they previously fell through
  to plain text.

  The `.typ` move is the one that mattered to get right. An extension missing from
  the table is read as prose, which is harmless — but the moment Vale routes it to
  a converter, that same omission is a crash that takes down every Vale rule in
  the run. Bumping the binary without re-measuring would have introduced exactly
  the failure this table exists to prevent, under an extension nobody was
  watching. Re-probing also caught one change the release notes do not mention:
  PHP comment extraction now requires a real `<?php` tag, where 3.17.1 linted a
  bare `//` comment without one.

  Two details are load-bearing and were both wrong on the first attempt. Vale
  honours exactly one `--glob` and keeps the last, so the `.taskless/` exclusion
  and the format exclusions have to travel as one negated alternation or the first
  is silently discarded. And Vale matches a `--glob` against the basename only
  when the pattern contains no `/` — combined with `.taskless/**` the whole
  expression goes path-wise, at which point a bare `*.adoc` stops matching
  `docs/guide.adoc` and the crash survives one directory down from wherever it was
  tested. Vale's error output is also decoded now rather than forwarded verbatim,
  so a failure reads as a sentence naming the missing program instead of a
  five-field JSON object.

  **These formats are now stated as unsupported rather than as needing a tool.**
  The notice used to end "Install it and put it on your PATH to have these files
  checked", which offered a path this build does not ship, does not test, and for
  `.xml` cannot deliver — an XSLT stylesheet is specific to the document, so no
  install makes it lintable. It also made behaviour host-dependent: macOS ships
  `/usr/bin/xsltproc` and typical Linux CI images do not, so the same repository
  checked differently depending on the machine. The exclusion is unconditional
  for that reason, and the programs are still named as the reason rather than as
  a remedy.

  The comment tier was reconciled against Vale's own documentation at
  docs.vale.sh/formats/code, which adds `.bsh`, `.csx`, `.pod`, `.py3` and `.sbt`
  once measured. It also documents `.pyi`, `.qml` and `.scss` as comment-aware,
  and on 3.17.1 a bare non-comment line in each of them lints. 3.18.0 makes the
  claim true for `.qml` and `.scss` and still not for `.pyi`, which stays in the
  plaintext tier. That divergence is the argument for probing rather than
  transcribing: the docs describe whatever Vale is current, and copying the list
  would have shipped `.pyi` as comment-aware and been wrong for both builds. `.pod` is a reminder of how easily this is misread — it lints Perl
  comments but not POD blocks, so probing it with `=head1` looks like no support
  at all.

- 616c14e: Derive the Vale rule schema's vocabulary from the vendored binary instead of
  transcribing it by hand.

  `pnpm generate:vale-schema` runs the pinned Vale against rules it writes itself
  and emits `src/generated/vale-vocabulary.ts` — twelve check types, three levels,
  ten per-check field tables, twenty-eight scope operands, two open scope
  families — plus a divergence report. `src/schemas/vale-rule.ts` imports it and
  stays what it was: the zod layer, the scope grammar, and the error messages that
  explain blast radius to an author. Every corpus row that predates the generation
  passes against the generated schema unmodified, and rows were added to cover
  ground the generation newly measured.

  One of those measurements found a real gap. Vale decodes a check's own fields
  case-insensitively, so `Tokens:` means `tokens:`, but a few keys are read off
  the raw mapping before that decode and are not synonyms of their capitalised
  spellings. Assuming that set was the three header keys was wrong: `scope` and
  `name` are read literally too, so `Scope: raw` fails the run with
  `E201 has invalid keys: 'scope'` while the schema, having lowercased it, was
  accepting it. For `scope` that was the worse half of the bug, because
  canonicalising the key also routed the value past the scope grammar, which is
  the only thing that ever inspects it. The set is now derived as a per-key
  two-run differential (the lowercase spelling must run clean; the capitalised one
  either runs clean too or draws a diagnostic) and emitted as
  `VALE_LITERAL_KEYS`, with corpus rows for `Scope:`, `Name:` and, as the contrast
  that keeps them from proving too much, `Tokens:`.

  What a transcription lost was not the answer but the question. Every value in the
  previous schema _was_ measured — by a script that was then discarded, leaving the
  next person to raise `VALE_VERSION` with a failing test and no way to reproduce
  the measurement it was failing against.

  The measuring is also where the errors live, so the generator is built around one
  rule: **every verdict comes from the process exit status and the structured JSON
  output, never from matching stdout against an error phrase.** A Go panic contains
  no `has invalid keys` string, so a phrase-grep scores a crash as a clean run —
  which is exactly how a tokenless `sequence` rule once came to look like a check
  that validates nothing. A run's outcome is a closed set of `clean`, `diagnostic`,
  `panic`, and `unrecognized`, and the last one is fatal at every call site.

  Two of the four vocabularies are self-enumerating: an unknown `extends` or
  `level` makes the binary name its own accepted set. If either of those lines
  stops matching, generation **fails** rather than emitting a short enum — a
  truncated enum is _stricter_ than the binary, which is the direction that blocks
  rules that would have worked.

  The other two are honest about their limit, and the artifact says so. `E201`
  names the key you got wrong and never the ones you could have used, and an
  unrecognized `scope` raises nothing at all — so field tables and scope operands
  are **verified, not discovered**, from a candidate list seeded from four sources
  with its provenance recorded. A scope verdict is three-valued, and a `scope: raw`
  reach probe must fire on every fixture, so an operand cannot be dropped because
  its fixture was never linted.

  Where the binary and Vale's documentation disagree, `vale-vocabulary-report.md`
  records it rather than either side being quietly dropped: `meta` and
  `meta.class.<kind>` are documented and never fire; `frontmatter` and
  `frontmatter.<key>` fire and are documented nowhere; `consistency` and `spelling`
  validate no keys at all.

- 520a382: Validate an sg rule's `language:` field in `verify`, instead of leaving it to
  ast-grep at `check` time.

  Nothing local had an opinion on the field. The vendored rule schema types it as
  a bare string with no enum, so `verify` returned `ok: true` for any spelling and
  the binary was the first thing to object — in the two ways it objects, both of
  them late:
  - A name ast-grep does not recognize fails `SgLang` deserialization, which
    aborts parsing of the single config Taskless assembles per run. One typo takes
    every _other_ sg rule down with it. `verify` now fails that rule by name,
    prints the accepted spellings, and suggests the obvious canonical one where
    there is one (`C#` → `CSharp`).
  - A recognized name pointing at the wrong parser reports nothing and reads as a
    clean codebase. `Tsx` and `TypeScript` are two parsers, not aliases, so a
    `TypeScript` rule scoped to `**/*.tsx` matches nothing and exits zero.
    `verify` fails that rule, and notices the half-dead case where a `{ts,tsx}`
    glob reaches both.

  Case variants and ast-grep's extension aliases are accepted rather than
  rejected, since ast-grep accepts them itself: `typescript`, `TYPESCRIPT` and
  `ts` all reach TypeScript. They get a notice naming the canonical spelling, so
  rules already written the lowercase way — including the ones in this
  repository — keep passing.

  The `files:` scan reads both shapes ast-grep allows for a glob entry, the plain
  string and the `{ glob, caseInsensitive }` object, so the wrong-parser check is
  not silently skipped for rules written the second way.

- db8adfa: Resolve the ast-grep binary without relying on an install-time step, and drop
  the `@ast-grep/cli` wrapper from what consumers install.
  - **The wrapper moves to `devDependencies`.** The seven `@ast-grep/cli-<platform>`
    packages were already declared in `optionalDependencies`, and the CLI already
    resolved them by path — the wrapper was a leftover whose only job is a
    `postinstall` that hardlinks the binary into itself so its `bin` entries work.
    Nothing here invoked those entries. Consumers now install only the platform
    package matching their host, and the wrapper's `postinstall` — which leaves a
    placeholder text file where the binary should be under `pnpm dlx`'s strict
    isolation — is out of the shipped product entirely. It stays as a
    `devDependency` because `fetch-ast-grep-schema` reads its version.
  - **Platform packages are pinned exactly.** They were carets, and the wrapper
    had been enforcing alignment implicitly by pinning its own
    `optionalDependencies`; without it, two hosts could resolve different ast-grep
    versions against the same rules and disagree about findings. This change makes
    the pin explicit without moving the version; the upgrade itself is a separate
    change.
  - **Binary resolution exhausts every candidate before failing.** It now searches
    the platform package, `node_modules/.bin`, then `sg` and `ast-grep` on `PATH`,
    and throws naming what it tried. Previously it returned a bare `"sg"` and let
    `spawn`'s `ENOENT` be the error, from a caller that could not say where it had
    looked.

  Alpine improves as a side effect: upstream publishes no musl build and marks its
  Linux packages `libc: ["glibc"]`, so today the wrapper's `postinstall` resolves a
  package that does not exist and exits 1, failing the install wherever dependency
  scripts run. Installing now succeeds and resolution falls through to `PATH`.

## 0.10.2

[Compare with v0.10.1](https://github.com/taskless/cli/compare/v0.10.1...v0.10.2)

### Patch Changes

- 1cd0f89: Treat the Taskless organization UUID as the one canonical identity, and become
  forward-compatible with the server's coming identity cleanup.
  - **Stop consuming `installationId`.** It is dropped from the `WhoamiOrg` type
    and from the `taskless rule meta --json` output (it was already optional and
    absent for public repos). The CLI never used it and it should not round-trip
    through us.
  - **Namespace the GitHub org id.** `WhoamiOrg.orgId` is now optional and a new
    `githubOrgId?: number` is added, so a consumer reads `githubOrgId ?? orgId`
    and keeps working across the server's rename. It is a convenience id, never an
    identity.
  - **Identify on the canonical id.** `decodeOrgId` validates the token's `id`
    claim (a UUID string) and the legacy `orgId` claim (numeric, or a numeric
    string) independently: a valid `id` wins, an invalid `id` still lets a valid
    `orgId` through, and a non-numeric `orgId` is rejected rather than smuggled in
    as an identity. PostHog then groups organizations on that canonical id. Tokens
    that don't yet carry an `id` claim fall back to the numeric claim, so grouping
    is unchanged until the server starts sending it.
  - **Always have a known org id.** When neither a matched org nor a token claim
    resolves, the canonical id falls back to the nil UUID
    (`00000000-0000-0000-0000-000000000000`) instead of being absent — so the org
    subject and telemetry group are always a stable, known value and unattributed
    usage lands in one bucket. As a result, a write from a token missing org info
    now sends the nil-UUID subject rather than failing with a re-authenticate
    error.
  - **Tolerate `number | string` on the legacy path.** The canonical `id` stays a
    UUID `string`, but `decodeOrgId` accepts either type since we can't promise
    what a legacy claim carries.

## 0.10.1

[Compare with v0.10.0](https://github.com/taskless/cli/compare/v0.10.0...v0.10.1)

### Patch Changes

- 53b2d30: Add a help recipe for the `detect` command.

  `detect` is a registered subcommand, so it appeared in the `taskless help`
  topic index — but `taskless help detect` had no backing `detect.txt` and fell
  through to "Unknown command", exiting 1. Every other registered command already
  had a matching help file; `detect` was the lone gap. The new recipe documents
  the `--json` output shape (linters, languages, ruleStyles) and cross-links to
  the `route`/`existing` authoring flow that consumes it.

## 0.10.0

[Compare with v0.9.0](https://github.com/taskless/cli/compare/v0.9.0...v0.10.0)

### Minor Changes

- da74920: Send an `x-taskless-cli-version` header on every request to the Taskless service (rule generation, reconcile, `whoami`, and the device-auth flow) declaring the CLI's version. The service uses this to gate capability-dependent responses — notably runtime rules — on the CLI being new enough to handle them; a request without the header is treated as a pre-runtime CLI. The version is also emitted with the CLI's telemetry so usage is recorded client-side rather than inferred server-side.
- 19f4327: Send the acting organization's identity on every write request. The CLI now resolves which Taskless org owns the current repository by matching the repo's git remotes (`origin` → `upstream` → rest) against the canonical owner URLs returned by `whoami`, and sends that org's Taskless UUID as the subject on rule generation, iterate, and reconcile calls. This fixes multi-org users being routed to whichever org their token happened to pin; the server authorizes the chosen org per request. When no remote matches a known org, the CLI falls back to the token's numeric `orgId` claim, so single-org behavior is unchanged.

  The client-side owner-URL canonicalizer is a verbatim port of the server's shared implementation, so both sides compare by exact string equality across SSH, `ssh://`/`git://`, port, and `www.` remote forms.

  `rule create`/`rule improve` now handle two additional generation states: `classifying` (a transient pre-build phase) and `unsupported`, a terminal state emitted when the request needs a capability the organization's plan doesn't include (for example, runtime rules) — surfaced with a clear message and the new `RULE_UNSUPPORTED` error code. When the server can't act on a repository for the selected org (its GitHub App installation doesn't cover the repo, or membership changed), the CLI now explains the coverage cause rather than only suggesting re-authentication.

- f392880: Add server-owned rule reconciliation and runtime rules to `taskless check`. Authenticated runs reconcile the repo's rules against the Taskless service and execute only the server-blessed set. A new class of **runtime rules** (`.taskless/runtime-rules/` — one or more ast-grep capture rules plus a `check.ts` assertion) runs through a local harness: the capture rules narrow with ast-grep, and only on a match is `check.ts` invoked via a bundled `tsx`. Because `check.ts` is arbitrary code, it runs only when its signature is validated by the server; otherwise it is skipped and reported. Adds the `--dangerously-run-scripts` (run runtime rules unverified) and `--timeout` flags.

  (Backfills the changeset that was missed when this work landed across #47, #49, and #50.)

## 0.9.0

### Minor Changes

- 9be2000: Require Node.js 22+ and make `taskless detect` monorepo-aware.
  - **Node floor raised to 22+.** Node 20 reached end-of-life, and detect now uses
    the built-in `fs.glob` walker (Node 22+). This is a breaking engine change,
    which pre-1.0 is a minor bump.
  - **`detect` is monorepo-aware.** A single bounded tree walk (curated ignore
    list + depth cap) finds linter configs and language manifests anywhere in the
    repo, not just the root, so a linter configured in a sub-package is detected
    with its path as evidence.
  - **languages → linters flow.** A linter's dependency evidence is read only from
    its own language's manifest (`package.json` for node, `pyproject.toml` /
    `requirements.txt` for Python), parsed with real parsers (`smol-toml`,
    `yaml`), instead of conflating ecosystems. A malformed manifest drops only its
    own signal.
  - **Dropped the `frameworks` field** from `detect` output. The routing recipe
    never consumed it; the contract now matches its sole consumer.
  - **Filled obvious linter gaps** for languages detect already recognizes:
    golangci-lint (Go), Clippy (Rust), and PHPStan / PHP_CodeSniffer / Psalm
    (PHP).

- 7a29587: Add a local-first rule-routing layer. A new deterministic `taskless detect`
  command plus `route`/`existing`/`static`/`remote` recipes let the agent author
  rules in an existing linter or as a local ast-grep rule on-device, only
  escalating to the login-gated service (with confirmation) when a rule cannot be
  built locally. The skill now engages this routing flow when a user names a
  linter instead of suppressing itself.

### Patch Changes

- a668855: Drop the unused `installedAt` timestamp from the install manifest.

  The timestamp was written into `.taskless/taskless.json` on every install but
  never read, so it only produced spurious diffs in committed manifests (e.g.
  after `pnpm build:self`). A new schema migration (v3) strips it from existing
  manifests, and install output is now deterministic. No user-facing behavior
  changes.

## 0.8.1

### Patch Changes

- b2fd824: Stop stamping a version into reference stubs to keep the footprint outside `.taskless/` stable across releases.
  - **Version-free stubs**: `buildSkillStub` / `buildCommandStub` no longer write `metadata.version` into the reference stubs installed into tool directories. Previously every release that bumped the bundled version counted as drift, so `update` rewrote every stub even when its `name`/`description` were unchanged — pure churn in projects that consume Taskless.
  - **Drift is name/description only, going forward**: `stubFrontmatterDrifted` regenerates a stub when its discoverable `name`/`description` changes — not on every version bump. The canonical version still lives in `.taskless/` (the skill `SKILL.md` frontmatter), which is where staleness checks already read it from.
  - **One-time migration**: `stubFrontmatterDrifted` also treats the presence of a `metadata.version` field as drift, so the next `init` / `update` rewrites each already-installed stub once to strip the obsolete line. After that pass the stub footprint is byte-stable across releases and only changes when the shim's `name`/`description` does.
  - **Command shim cleanup**: removed the stale `metadata.version` from the `/tskl` command source. It had been pinned at `0.6.0` while its body last changed in `0.7.0`; the field was only ever consumed to stamp stubs, so it is now dead.

  No functional change between 0.8.0 and this release — stub frontmatter was never a documented public API. Expect a single one-time rewrite of existing stubs (to drop the version line); thereafter installs and `update` runs no longer report or rewrite stubs purely because of a version bump.

- 48506ff: Make the wizard's tool-selection step manifest-aware so unchecking a location removes Taskless from it.
  - **Manifest-driven pre-check**: the `taskless init` tool-selection multiselect now pre-checks the union of directories recorded in the install manifest and detected tool directories — previously it pre-checked detected tools only. A location Taskless already installed into (notably `.agents/`, which has no detection signal of its own) now shows checked, so it can be unchecked to remove the stubs. The install engine already performed manifest-diffed, target-scoped removal; this only surfaces it in the UI.
  - **Three-state hint**: each entry is hinted by origin — `installed` (recorded in the manifest, takes precedence), `detected` (tool present), or `not detected`.
  - **Itemized removal confirmation**: when unchecking a location triggers removals, the confirm prompt now names each target and its stub count (e.g. `Remove Taskless from .claude/ (2 stubs)?`) instead of a generic message.

  The non-interactive `init --no-interactive` / `update` paths are unchanged, and the canonical `.taskless/` store is never removed.

## 0.8.0

### Minor Changes

- d254b67: Install a single canonical skill/command store with thin per-tool reference stubs.
  - **Canonical store**: `taskless init`/`update` now writes the skill and command content exactly once, to `.taskless/skills/<name>/SKILL.md` and `.taskless/commands/tskl/<name>.md`. This Taskless-owned directory is never a tool install target, so no install or cleanup step can ever delete it.
  - **Reference stubs**: each enabled tool directory (`.claude/`, `.cursor/`, `.opencode/`, `.agents/`) receives a thin reference stub instead of a full copy — an ordinary file (never a symlink) carrying `name`/`description` frontmatter, a `metadata.type: shim` marker, and a body that delegates to the canonical file. This ends the N-identical-copies drift of the previous per-tool full-copy model. `.claude/` and `.cursor/` also receive a `tskl` command stub; `.opencode/` and `.agents/` receive skills only.
  - **Per-target install mode**: `.taskless/taskless.json` records a `mode` (`canonical` | `reference`) per target. The field is additive and backward-compatible — a manifest written before this change reads its entries as `canonical`, so no schema migration is needed.
  - **Self-healing convergence**: `applyInstallPlan` rewrites a reference file unless it is already a current, non-drifted shim stub. Full per-tool copies left by older installs, manually-created symlinks, and stubs whose frontmatter has drifted are all converged into stubs on the next `init`/`update`. The destructive `rm -rf` glob cleanup is removed; cleanup is now driven solely by the recorded-manifest diff and scoped to each target's own directory.
  - **Wizard tool selection**: the wizard's location step is reframed as "which tools do you want to enable Taskless for?" — a fixed multiselect of `.claude/`, `.cursor/`, `.opencode/`, `.agents/`, with detected entries pre-checked and `.agents/` the default when nothing is detected. The canonical `.taskless/` store is always written and is not a selectable entry.
  - **No symlinks**: the CLI never creates symlinks for skills or commands. Symlink-based skill discovery is unreliable across Cursor, OpenCode, and Codex, and breaks on Windows checkout.

- f6fbaba: Add `taskless onboard` post-install discovery flow and migrate recipe rendering to sprintf-js.
  - **`taskless onboard` subcommand**: a thin gate that prints an agent-facing recipe walking the host AI tool through mining the codebase, agent-memory files (CLAUDE.md / AGENTS.md / .cursorrules), recent PR review comments (via `gh`), and issue-tracker tickets (via MCP) for high-signal rule candidates. Output is a bullet list the user can materialize via `taskless rule create`. Three modes: default prints the recipe (refused if already complete), `--force` re-runs regardless of state, `--mark-complete` writes `install.onboarded: true` (invoked only by the agent after explicit user confirmation). `--force` and `--mark-complete` are mutually exclusive.
  - **`install.onboarded` manifest field**: optional 3-state boolean (absent / `false` / `true`) added to `.taskless/taskless.json`. `taskless init` never writes it; only `taskless onboard --mark-complete` does. Re-installs preserve the existing value.
  - **Post-install onboarding trailer**: after a successful `taskless init` (both wizard and `--no-interactive` paths), the CLI prints a one-line trailer pointing the user at the new flow. Wording adapts to the install plan: when commands were installed (Claude Code, Cursor), the trailer mentions `/tskl onboard`, the Taskless skill, and `taskless onboard`; when no commands were installed (OpenCode, Codex, `.agents/` fallback), it mentions the skill and the CLI only. `taskless update` does not print the trailer.
  - **Skill description trigger expanded**: the consolidated `taskless` skill now also volunteers Taskless when the user asks to add/write/create a rule and has NOT named a specific lint/format/static-analysis tool. Suppressing examples (illustrative — any named tool of this kind suppresses): `eslint`, `ruff`, `biome`, `ast-grep`. Behavior on this trigger is a quiet single-line offer, not a full recipe; declines are sticky within the conversation only and never written to disk. Replaces the prior blanket "do NOT trigger on generic ESLint/linting" carve-out.
  - **Recipe substitution refactor**: recipe rendering switched from ad-hoc `{{KEY}}` `replaceAll` calls to `sprintf-js` named arguments. All recipes now use `%(KEY)s` placeholders. `CLI_VERSION` and `INPUT_SCHEMA` continue to resolve to system-rendered values; `PACKAGE_MANAGER_DLX` joins them as an "agent-fill" marker rendered as `<package-manager-dlx>`. Recipes that contain literal `%` characters must escape as `%%` per sprintf-js conventions.

## 0.7.0

### Minor Changes

- 33010d4: Add Codex support and expand Cursor with slash commands.
  - **Codex detection**: `taskless init` now detects OpenAI Codex via `.codex/` directory or `.codex/config.toml` and labels the install as Codex in the summary. Skills are written to `.agents/skills/<name>/SKILL.md` — Codex's documented read path, which happens to match our existing fallback location, so users with `.codex/` previously fell into the generic fallback path silently. Codex receives no command files: custom slash commands are deprecated upstream and skills are the official replacement.
  - **Cursor commands**: the Cursor descriptor now ships our `tskl` slash commands to `.cursor/commands/tskl/<name>.md`, mirroring what Claude Code receives. Cursor 1.6 added commands as a real authored surface; previously Cursor users only got skills.
  - **Wizard label**: detected-tool hints in the install location prompt now name the tool (e.g. `detected (Codex)`) instead of just "detected".

- f11cb5f: Consolidate the 10 per-task Taskless skills into one. The `taskless` skill is now a small router whose body tells the agent to fetch the canonical recipe via `npx @taskless/cli help <topic>` rather than carrying full per-task instructions inline. Recipes live in the CLI bundle so the agent always reads the version current to the installed CLI. This addresses customer reports of the Taskless plugin causing other skills to be evicted from the working set.

  **Breaking changes:**
  - **Skill names removed.** `taskless-check`, `taskless-ci`, `taskless-create-rule`, `taskless-create-rule-anonymous`, `taskless-delete-rule`, `taskless-improve-rule`, `taskless-improve-rule-anonymous`, `taskless-info`, `taskless-login`, `taskless-logout` no longer exist. The single `taskless` skill replaces them. Existing v0.6 installs auto-migrate when the user runs `npx @taskless/cli` (the install plumbing reads the manifest, deletes obsolete files, writes the consolidated skill).
  - **Slash commands collapsed.** The 6 commands under `commands/tskl/` are replaced by a single `/tskl` router that accepts a free-form `$ARGUMENTS` ask.
  - **CLI verb renamed: `rules` → `rule` (singular).** `taskless rule create`, `taskless rule improve`, `taskless rule delete`, `taskless rule verify`, `taskless rule meta`. The plural form is no longer recognized — there is no compatibility alias. Pipelines and scripts must update.
  - **`--schema` flag removed.** Schemas are now embedded inline in `taskless help <topic>` output via `z.toJSONSchema()` (zod 4 built-in). Agents that previously parsed `--schema` output should fetch the relevant `help` topic and read the embedded code-fenced JSON Schema block.
  - **Telemetry rename (hard cut, no dual-emit).** `cli_help_*` events are renamed to `help_<topic>` (intent), `help_index` (no-args fetch), and `help_unknown` (unrecognized topic). Action commands now emit `cli_<action>` (start) and `cli_<action>_completed` (with `success`, `durationMs`, `errorCode?` properties). PostHog dashboards keyed on the old names will need updates.

  **New features:**
  - **Global `--anonymous` flag.** Recognized on every command. Per-command behavior: `info` skips the API/auth probe; `auth login` errors with "auth commands cannot be anonymous"; `rule create`/`rule improve` exit with a pointer to `taskless help <topic> --anonymous` (the local-only flow runs in the agent per the architecture decision in the OpenSpec change).
  - **`taskless help <topic> --anonymous`.** Variant lookup serves `<topic>.anonymous.txt` when present and falls back to the canonical recipe otherwise. Build-time map keeps lookup O(1).
  - **Standardized JSON error envelope.** When `--json` is set, failures emit `{ ok: false, code: "<CODE>", message: "<...>" }` with stable codes (`AUTH_REQUIRED`, `NO_GITHUB_REMOTE`, `RULE_GENERATION_FAILED`, `RULE_NOT_FOUND`, `INVALID_INPUT`, `NETWORK_ERROR`, `SCAN_FAILED`, `INTERNAL_ERROR`). Recipes reference these codes by name in their `## Errors` sections.
  - **Recipe template.** Every help text follows the same shape: Goal / Preconditions / Steps / Input schema (where applicable) / Errors / See Also. Header line includes the CLI version and a topic version. `{{INPUT_SCHEMA}}` and `{{CLI_VERSION}}` placeholders are interpolated at runtime.
  - **Bare `taskless` non-TTY routing.** Without a TTY, bare `taskless` now prints a short context preamble followed by the topic index (instead of citty's default usage screen). TTY behavior unchanged — still launches the wizard.

  **Migration:**

  Run `npx @taskless/cli` after upgrading. The wizard reads your existing manifest, computes the diff (10 obsolete skills + 6 obsolete commands removed, 1 new skill + 1 new command added), confirms with you, then applies.

## 0.6.0

### Minor Changes

- 64f2c4f: Add interactive `init` wizard. Running `taskless` in a terminal (or `taskless init`) now launches a `@clack/prompts` wizard that lets you pick install locations, choose optional skills (currently `taskless-ci`), and walks through the auth tradeoff before writing anything.

  **Breaking:** bare `taskless` (no subcommand) now delegates to `init` when stdout is a TTY. Non-TTY invocations still print top-level help. For scripted installs, pass `--no-interactive` to `taskless init` to preserve the previous behavior (install mandatory skills to every detected tool location, no prompts).

  Also adds:
  - `install` field in `.taskless/taskless.json` (migration 2) tracking per-target skills and commands, used by the wizard to compute a diff and surgically remove files on re-run
  - `taskless-ci` skill in the bundle as an optional opt-in, with agent-facing instructions that cover CI discovery, full-scan/diff-scan patterns, and non-destructive config generation for any CI system the agent recognizes
  - `taskless check <paths...>` for diff-only scanning in CI (silently filters missing paths so `git diff` output can be piped in directly)
  - `cliVersion` and `scaffoldVersion` attached to every PostHog telemetry event, for deprecation tracking

## 0.5.4

### Patch Changes

- 60f8dba: Show auth status when running `taskless auth` without a subcommand, with a hint to run `auth login` if not authenticated.

## 0.5.3

### Patch Changes

- cf813da: Add multi-tool detection for `taskless init`. The CLI now detects and installs skills for OpenCode (`.opencode/`, `opencode.jsonc`, `opencode.json`), Cursor (`.cursor/`, `.cursorrules`), and Claude Code (now also via `CLAUDE.md`). When no tools are detected, skills are installed to `.agents/skills/` as a fallback.

## 0.5.2

### Patch Changes

- 64b836f: Add explicit `commandName: "-"` to anonymous skill frontmatter

  The anonymous skills (`taskless-create-rule-anonymous` and `taskless-improve-rule-anonymous`) were missing the `metadata.commandName` field. Added `commandName: "-"` for consistency with all other skills that don't expose a slash command.

- a4c78fb: Fix "auth login" to use the correct CLI command

  Replaced bare `taskless auth login` references with the proper `npx @taskless/cli@latest auth login` invocation in skills, generated commands, CLI error messages, and rules help text. CLI error messages now dynamically detect the invoking package manager via `npm_config_user_agent`. Skills default to `npx` with a note to prefer the project's package manager.

- 321d285: Fix crash during init when `.taskless/taskless.json` contains corrupt or unparseable JSON. The CLI now treats a corrupt manifest the same as a missing one, allowing migrations to re-run and rewrite it.

  Add `module` and `exports` fields to package.json to ensure ESM resolution works correctly on older Node versions or when package.json resolution is incomplete.

## 0.5.1

### Patch Changes

- 57ccac7: Add anonymous telemetry via PostHog to track CLI command usage

## 0.5.0

### Minor Changes

- 75f3b80: Remove global XDG auth token storage (`~/.config/taskless/auth.json`) in favor of per-repo tokens only. Authentication is now scoped to each repository via `.taskless/.env.local.json`. A deprecation notice is shown when a legacy global token file is detected. The device flow now sends a repository URL hint to the auth server.
- 75f3b80: Reorganize CLI internals into domain directories (`auth/`, `api/`, `rules/`, `filesystem/`, `install/`, `util/`), add a migration-based `.taskless/` bootstrap system, and upgrade from Zod 3 to Zod 4. The filesystem layer introduces numbered migrations with idempotent re-runs, version tracking in `taskless.json`, and automatic v0-to-v1 migration for existing installations. Zod 4 enables native `z.fromJSONSchema()` and `z.toJSONSchema()`, replacing the `zod-to-json-schema` dependency.

### Patch Changes

- 75f3b80: Add anonymous rule creation and improvement skills that work without API authentication. The existing `/tskl:rule` and `/tskl:improve` commands now check auth status via `taskless info --json` and transparently delegate to anonymous variants when not logged in. Anonymous skills use the `rules verify` feedback loop to iteratively validate agent-generated rules against the ast-grep schema.
- 75f3b80: Add `rules verify` command with three-layer validation: Layer 1 validates rule YAML against the official ast-grep JSON schema (fetched at build time via codegen), Layer 2 checks Taskless-specific requirements (required fields, regex-requires-kind, test file existence), and Layer 3 runs `sg test` for the specified rule. Includes `--schema --json` mode that outputs the ast-grep schema, Taskless requirements, and curated examples for agent consumption.
- 75f3b80: Harden CLI security: remove `shell: true` from `spawn` calls to eliminate shell injection surface, add rule ID validation (`/^[a-z0-9][a-z0-9-]*$/`) to prevent path traversal in file operations, escape regex metacharacters in `sg test --filter` arguments, and replace fragile string-based error parsing with structured return types.

## 0.4.0

### Minor Changes

- Remove scaffold dependency from CLI. Identity is now resolved from JWT (`orgId`) and git remote (`repositoryUrl`) instead of `taskless.json`. Add per-repo token storage in `.taskless/.env.local.json`, ephemeral `sgconfig.yml` generation for check command, and fetch OpenAPI schema from live URL.

### Patch Changes

- 48991e6: Fix CLI auth to check token expiry instead of just token existence, preventing commands from reporting a logged-in state with an expired JWT
- 7397516: Write sidecar metadata files from generator API response to `.taskless/rule-metadata/`, fixing metadata not being persisted during rule create and improve flows
- 7397516: Add `rules meta` CLI subcommand to read sidecar metadata for a rule. Update create-rule skill to check for similar existing rules before creating, and improve-rule skill to use `ticketId` from metadata for the iterate API. Fix test directory references and skill-to-skill handoff in both skills.

## 0.3.0

### Minor Changes

- 771a13b: Add `--schema` flag to CLI commands with `--json` support. When passed, prints Input Schema, Output Schema, and Error Schema as JSON Schema objects and exits. Introduces Zod as the single source of truth for CLI I/O validation and schema generation.

## 0.2.1

### Patch Changes

- 230091e: Fix `init` to clean up stale skills and commands from previous naming conventions before installing. Removes all `taskless-*` and `use-taskless-*` skill directories and both `taskless/` and `tskl/` command directories, then installs a fresh set. Also fixes the embedded command glob and tool registry to use the current `tskl` path.

## 0.2.0

### Minor Changes

- ecf338d: Add `rules improve` CLI subcommand and `taskless-improve-rule` skill for iterating on existing rules via the new `/cli/api/rule/{ruleId}/iterate` endpoint. The skill guides agents through a decision tree: iterate on a single rule, replace it entirely, or expand into multiple rules. Also updates `rules create` to accept `successCases`/`failureCases` as arrays (matching the updated API schema).
- ecf338d: Rename skills from `use-taskless-*` to `taskless-*` and commands from `taskless:*` to `tskl:*`. Skill directories now follow the `taskless-<verb>-<noun>` convention (e.g., `taskless-create-rule`, `taskless-improve-rule`). Cross-references in skill instructions now use skill names instead of command names for compatibility with non-command agentic systems.
- ecf338d: Replace hand-written fetch calls with a typed API client powered by `openapi-fetch` and `openapi-typescript`. Request and response types are now generated from the OpenAPI schema at `.generated/schema.json`, removing manual type definitions for API interactions. Rule file types (`GeneratedRule`, etc.) are now derived from the schema.

## 0.1.5

### Patch Changes

- 87d5644: Fixes command in info skill

## 0.1.4

### Patch Changes

- f9d7ac6: Updates skills to collect additional information

## 0.1.3

### Patch Changes

- 914dc37: Fix ast-grep binary not found when CLI installed via pnpm dlx. The strict dependency isolation prevents @ast-grep/cli's postinstall from resolving platform-specific binary packages, leaving a placeholder text file instead of the real binary. Now resolves the platform binary directly from our own module context.

## 0.1.2

### Patch Changes

- fe18d42: Fix `rules create` requiring scaffold version 2026-03-03 which doesn't exist yet, causing users on the latest scaffold (2026-03-02) to be told to update when they're already current

## 0.1.1

### Patch Changes

- 5e0864a: Use default API URL for rule and update-engine providers instead of requiring env var

## 0.1.0

### Minor Changes

- 00320f6: Replace stdin JSON input with --from file flag for rules create

### Patch Changes

- 00320f6: Add update-engine command for requesting scaffold upgrades
- 00320f6: Replace version compatibility ranges with per-subcommand minimum scaffold versions

## 0.0.7

### Patch Changes

- 1f96316: chore: Modernize build tooling and version syncing
  - Replaced link-skills.sh with TypeScript for consistency across all build scripts
  - Refactored package.json scripts to use npm-run-all2 (run-s) for cross-platform sequential execution, removing all && chains
  - Simplified turbo.json by removing root tasks in favor of explicit run-s orchestration via namespaced sub-scripts (build:_, bump:_)
  - Fixed link-skills to also symlink commands/ into .claude/commands/ (was a broken symlink)
  - Version syncing (bump:sync) now also updates .claude-plugin/plugin.json and root package.json to stay in sync with CLI version
  - Disabled unicorn/no-null eslint rule globally, removing inline overrides

## 0.0.6

### Patch Changes

- 872d378: Add `taskless help <command>` subcommand with rich help text for all commands. Help files are plain .txt embedded at build time via import.meta.glob. Supports nested commands (e.g., `taskless help auth login`).
- 382ddfa: Fix YAML frontmatter line wrapping that broke skill installation. The `yaml` library's default 80-character line width was folding long strings (like `description`) across multiple lines, which broke frontmatter parsers expecting single-line values. Disabled line wrapping with `lineWidth: 0` for all YAML serialization (frontmatter, rule files, and test files).
- 9734356: Restructure skills distribution and CLI commands. Move skills from plugins/ to skills/ at repo root. Add multi-channel distribution (CLI init, Claude Code Plugin Marketplace, Vercel skills CLI). Add generate-commands and sync-skill-versions scripts. Restructure CLI with auth and rules subcommand groups, check command with JSON output, and init with org/repo config.
- cd4a671: Skills now invoke `taskless help <command>` as their first step instead of hardcoding CLI documentation. Commands with JSON support (check, rules create) use --json flag. Add link-skills to build graph.

## 0.0.4

### Patch Changes

- Add `taskless rules create` and `taskless rules delete` commands for generating and managing ast-grep rules via the taskless.io API. Includes whoami integration for `taskless info`, a new minimum spec version (2026-03-03) requiring `orgId` and `repositoryUrl` in project config, and executable permissions on the built CLI output.

## 0.0.3

### Patch Changes

- Add check command with ast-grep scanning, version compatibility, and formatting support
- 82ad614: Add init/update command with skill installation and staleness detection

## 0.0.2

### Patch Changes

- Add `taskless info` subcommand that outputs CLI version as JSON. Replace stub entry point with citty-based subcommand structure. Version is injected at build time via Vite define.
