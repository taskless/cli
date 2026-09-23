---
"@taskless/cli": patch
---

`taskless info --json` renames its `tools` key to `harnesses`, and gives
`tools` to the command-line binaries found on `PATH`.

**This is the consumer-visible part.** The array that lists Claude Code,
Codex, Cursor and OpenCode, with each one's installed skills and their
staleness, is unchanged in shape — it now lives under `harnesses`. Anything
reading `.tools[].skills` from `info --json` reads `.harnesses[].skills`
instead. The new `tools` array carries `{ name, present, applicable, path? }`
for `gh`, `git` and `jq`.

`present` is established by looking for a file of that name on `PATH`.
Taskless does not spawn a detected binary, does not read its version, and does
not hash it, so `present: true` is presence and not a working install. A
sha256-against-published-releases tier was considered and dropped on
measurement: GitHub publishes digests for `gh`'s release archives and
installers rather than for the extracted binary, and a Homebrew-installed `gh`
2.97.0 matched 0 of the 21 official digests — a tier that reports "unverified"
for the ordinary macOS install path is worse than no tier at all.

`applicable` is the separate question of whether a tool could accomplish
anything where it is being asked to. `gh` in a repository with no GitHub
`origin` is present and inapplicable, and reporting that as "missing" would
produce the one instruction that cannot help — "install `gh`".

The `onboard` recipe (topic v4) uses both. Its source menu now states what was
found rather than telling the agent to run `command -v gh`, says in one line
why a source is not offered instead of dropping it silently, and no longer
names Linear as the expected issue tracker: a bug-tracker scan is offered when
the agent has an MCP that reaches one, with Jira and Linear as examples of the
class. `@taskless/cli/prompts` is unaffected — with no host state supplied the
recipe renders its full menu, unchanged.

`patch` rather than `minor`: the package is `0.y.z`, where semver puts added
surface outside the stability guarantee.
