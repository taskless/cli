---
"@taskless/cli": patch
---

`taskless verify` (formerly `taskless test`) now says when an ast-grep rule's `files:`/`ignores:` globs match no file in the project. A fixture snippet has no path, so the globs never apply to it, and a rule scoped to `lib/**` in a project that keeps its code in `src/` used to pass `taskless test` while `check` never ran it. The rule still passes; the result carries a notice naming the globs, on the human output and in `notices` under `--json`. Rules scoped by `language:` alone are not checked, since a project with no code in that language is honestly clean.
