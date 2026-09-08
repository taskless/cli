---
"@taskless/cli": patch
---

Fixed reference stubs (`.claude/`, `.agents/`, etc.) freezing a stale,
unpinned `npx @taskless/cli` invocation into their own frontmatter
`description` forever, even on a nightly install whose canonical
`.taskless/skills/taskless/SKILL.md` correctly names the pinned
`@taskless/cli-nightly@<version>` package. A stub's `description` is copied
verbatim from source and, unlike canonical content, is never rewritten for
the current build target — so any CLI invocation baked into it would go
stale on the very first release that changed. The invocation is removed from
the skill and command `description` fields entirely: the canonical file
already carries the correct, per-build invocation, and a stub always defers
to it, so there is no longer a second copy that can drift.
