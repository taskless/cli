## Why

Writing an ast-grep rule means knowing the node kinds of the target language, and the CLI gave no way to see them. `create-sg-rule` told authors to read kinds off `--debug-query=ast` without saying how to run ast-grep, so agents went hunting for the binary: under `~/.npm/_npx` or `.taskless/.cache`, into `/usr/bin/sg` (shadow-utils on Linux, not ast-grep), or by pasting whole files as patterns. About 7 of 40 onboarding runs in the October to November agent survey reported it, across C#, Dart, Rust and PHP (#673).

## What Changes

- New `taskless ast <file>` prints the file's named-node AST, parsed by the bundled ast-grep as the language the file's extension resolves to. The language is asked of the binary (a `scan --inspect entity` probe against an empty config), so it is the resolution `check` gets, not a second table.
- Named nodes only, so every kind shown is one `kind:` accepts. Each node carries its field name, 1-based line and 0-based byte column range, and leaves carry their source text.
- `--lang <Language>` overrides the language, `--range <line>[:<line>]` cuts the tree to the nodes touching those lines and the nodes enclosing them, `--json` emits the tree as data. Failures under `--json` use the standard envelope: `INVALID_INPUT` for a missing, empty, unrecognized or oversized file and for a bad flag, `ENGINE_UNAVAILABLE` when there is no ast-grep, `SCAN_FAILED` when ast-grep prints no tree.
- `create-sg-rule` (topic v15) tells authors to read every `kind:` off `ast`, and stops naming `--debug-query`. The `sg-regex-needs-kind` message names `ast` as where to find a kind.

The tree comes from `ast-grep run --debug-query=ast` with the file's contents as the pattern, the only file-tree output ast-grep has. That passes the file through argv, so a file past the platform's argument limit (128 KiB per argument on Linux) is refused with a message saying so. The `--pattern` subtree filter the issue lists as optional is left out: `--range` covers the length problem without a second ast-grep invocation.

## Capabilities

### New Capabilities

- `cli-ast`: the `taskless ast` command.

### Modified Capabilities

- `cli-agent-authoring`: the ast-grep authoring recipe directs kind lookups to `taskless ast`.

## Impact

- `packages/cli/src/commands/ast.ts`, `src/rules/ast-dump.ts`, `src/schemas/ast.ts`, the command registry, `src/rules/verify.ts`, and the `create-sg-rule` recipe.
- Delivery shape: **single PR**. One read-only command, its recipe pointer, and tests, well under the review size.
