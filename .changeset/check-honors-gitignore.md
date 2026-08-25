---
"@taskless/cli": patch
---

Keep a whole-project `check` out of the paths git ignores.

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
against the pinned 0.41.0, it skips a hidden-_and_-ignored `.turbo/` too. Vale
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
