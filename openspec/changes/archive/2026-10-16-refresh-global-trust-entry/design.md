## Context

`packages/cli/src/install/global-trust.ts` owns the entry: `inspect()` classifies a settings file as present, absent, or skip by looking for any string beginning `Taskless CLI:`, and `syncGlobalTrust()` writes only for `absent`. The wizard previews with `write: false`, shows `describeGlobalTrust()` lines in the summary, and writes on confirm; `init` only reads and warns through `globalTrustWarnings()`. `skills/taskless/SKILL.md` carries the same entry text inline for the classifier fallback, and `installed-documentation.test.ts` pins that the two texts agree.

## Goals / Non-Goals

**Goals:**

- One entry text, used by the wizard, the warning, and the skill body.
- An existing labelled entry converges on that text through the path a person already runs to update.

**Non-Goals:**

- Prompting from `init` in a TTY. `init` is the batch install for agents, scripts, and a person upgrading without prompts; the bare CLI is how a person updates, and it already asks.
- Covering arbitrary commands chained to a Taskless call. The entry is a statement about one package, not a general shell allowance.
- Any write outside the project from a non-interactive run.

## Decisions

**Stale is "labelled, text differs", not "matches a past wording we shipped".** The CLI has shipped exactly one wording, and the entry that was refused was hand-copied text, not that one. A list of historical wordings would not have caught the case that motivated this. The label is the ownership marker: a string beginning `Taskless CLI:` is ours, and we know which text works under it, so any other text under that label is always replaced with the current entry, with the user's yes in the wizard. A user who wants their own wording uses a different label, which the CLI never reads. Alternative considered: never rewrite, warn only. Rejected, since that leaves every existing user on whatever text they have forever.

**Replace in place, first labelled string only.** `inspect()` finds the index of the first labelled string and sets that index; position in the list is preserved, so a user who ordered their entries keeps that order. Duplicates beyond the first are left alone rather than deleted: removing strings from a user file is a larger edit than the one the summary line describes.

**`stale` is a fourth outcome state, not a flag on `absent`.** It flows unchanged through `--json` (`globalTrust[].state`), the summary (`REPLACE (global):`), and the warning, each of which needs to word it differently. `syncGlobalTrust({ write: true })` writes for `absent` and `stale`; the wizard's "anything to confirm" check becomes the same pair.

**The widened sentence names plumbing, not commands.** It lists the shapes agents actually produce (a variable assignment, `cd`/`mkdir`, a redirect of the call's output to a file) and says every other command on the line is judged on its own. Naming pipes was rejected: piping the output of downloaded code into another command is exactly the shape the classifier is right to look at.

**The skill fixes the cause; the entry is the backstop.** The standalone rule in the skill body is what stops agents producing the refused shape; the widened entry only keeps a slip from ending the session. The fallback's "present entry" branch needs the agent to read `~/.claude/settings.json`, which is a read of the user's own settings and not the self-modification the classifier refuses.

## Risks / Trade-offs

- [The classifier may still refuse plumbing despite the sentence] → The skill's standalone rule means the plumbing should not occur; the rerun-once-on-its-own instruction recovers when it does.
- [Skill body growth against its line cap] → The new guidance brought the body to exactly 150 lines, the cap at the time, so the cap is raised to 200 per the skill spec rather than compressing guidance an agent acts on.
