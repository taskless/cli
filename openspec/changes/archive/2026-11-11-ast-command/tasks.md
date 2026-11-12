## 1. Command

- [x] 1.1 Resolve a file's language by asking the bundled ast-grep (`scan --inspect entity` against an empty config)
- [x] 1.2 Dump the named-node tree through `run --debug-query=ast` and parse it, with fields, positions and leaf text
- [x] 1.3 Add `taskless ast <file>` with `--lang`, `--range`, `--json`, `-d`, and the standard error envelope
- [x] 1.4 Register `ast` in the subcommand registry

## 2. Pointers

- [x] 2.1 `create-sg-rule`: read kinds off `ast`, drop `--debug-query`, bump the topic to v15
- [x] 2.2 `sg-regex-needs-kind`: name `ast` as where to find a kind

## 3. Tests

- [x] 3.1 Parser, range filter and language-probe units
- [x] 3.2 Against the bundled binary: every language dumps in the parsed format, every language's extension resolves, `sgconfig.yml` is ignored, `$FOO` in PHP is dumped as written
- [x] 3.3 The built CLI: text and JSON output, `--range`, `--lang`, and each `INVALID_INPUT` refusal, including an oversized file
