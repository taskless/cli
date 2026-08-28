---
"@taskless/cli": patch
---

Tell the reader how to restore a canonical file a reference stub cannot find.

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
