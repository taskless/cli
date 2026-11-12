---
"@taskless/cli": patch
---

New `taskless ast <file>` prints a file's named-node AST, parsed by the bundled ast-grep as the language the file's extension resolves to, so every kind it shows is one a rule's `kind:` accepts. `--range <line>[:<line>]` cuts the tree to the nodes on those lines, `--lang` overrides the language, and `--json` emits the tree as data. `create-sg-rule` now sends authors to it for kinds instead of to ast-grep's `--debug-query`, which left agents hunting for an ast-grep binary.
