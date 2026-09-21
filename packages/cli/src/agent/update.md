# Topic: update     (CLI v%(CLI_VERSION)s / topic v8)

## You are here
This is `update`. It tells you what an upgrade changed for the rules
ALREADY IN THIS PROJECT, and what to do about them.

It is not about installing. Running `%(TASKLESS_CLI)s` migrates the
`.taskless/` layout and refreshes the installed skills on its own. That
handles the DIRECTORY. This recipe handles the RULES, which no migration
can rewrite for you: a rewriter that now needs a `fix`, a rule whose
matching semantics shifted under a new engine, a rule that could now be
expressed better with a newly supported language.

An agent that has run a migration and watched it succeed will otherwise
reasonably conclude the upgrade is done. It is not. The directory is
migrated; the rules may still need work.

## Goal
Walk the ledger below from the version this project was last reconciled
to, up to the installed CLI, doing what each section says. Then record
that you finished.

## Preconditions
- `.taskless/` exists. If it does not, there are no rules to reconcile.
- You can read `.taskless/taskless.json`.

## Steps

1. **Find where to start.** Run:
   ```
   %(TASKLESS_CLI)s info --json
   ```
   and read `rules.reconciledTo`, plus `rules.engines.sg` and
   `rules.engines.vale` for the engine versions the rules were built
   against.

   **No `rules.reconciledTo` at all** means this project PREDATES the
   ledger, so treat it as `0.0.0` and walk every section. It does not
   mean the project is new: a project this CLI set up has the field
   stamped at creation, so an absent marker is the one case where none
   of the entries below have ever been applied.

   `rules.walk` on that same payload is this decision already made:
   `{ "from": ..., "to": ... }` when there is something to walk, and
   `null` when there is not. Prefer it to re-deriving the boundary
   yourself, so the offer and the enforcement cannot disagree.

2. **Walk forward, in order.** Start at the section after
   `reconciledTo` and continue to the installed version. Sections are
   cumulative, never replaceable: a later one can depend on an earlier
   one having run, so do not skip ahead to the newest.

3. **Do the work each section names.** Each says what changed and what
   it means for existing rules. A section that says there is nothing to
   do means exactly that; it is a claim, not an oversight.

4. **Record that you finished.** Run:
   ```
   %(TASKLESS_CLI)s update --rules
   ```
   Only after the walk is complete. There is no version to pass: the CLI
   stamps its own, because the only sensible endpoint of a walk is the
   version you are running.

   A partial or abandoned walk must not be recorded. The next agent
   starts from what you wrote and skips everything you did not do, and
   it will look like there was nothing to do. Nothing can check this for
   you: the CLI refuses to move the marker backwards, but it cannot tell
   whether you read the sections.

   This also records the engine versions the rules are now valid
   against, which is what lets a later upgrade say what moved.

## The ledger

### Migrating to 0.11.x

The vendored ast-grep moves from 0.41.0 to 0.45.2, and Vale from 3.18.0
to 3.20.0. Nine things follow for existing rules.

**Elixir stopped being linted as prose.** Vale 3.19.0 reads `.ex` and
`.exs` through a real parser, so it now sees comments and `@doc`
attributes and nothing else. On 3.18.0 those files had no parser and
were linted whole, so a Vale rule matching `[*.ex]` fired on function
names, atoms, and string literals as well as on comments.

Those findings are gone, and nothing errors or warns. A rule that
reported on Elixir code bodies now reports less, which is a drop you
would otherwise notice only as a suspiciously clean run. If the rule was
meant for prose, this is the behaviour you always wanted. If it was
being used to catch something in the code itself, that is a job for an
`sg` rule, and `%(TASKLESS_CLI)s rule create` will route it there.

**MDX components' children are prose now, and new findings appear.**
As of Vale 3.19.0 a JSX element's children are read as the Markdown
they are, so a rule over `.mdx` covers prose inside a wrapping
component such as `<Steps>` or `<Aside>` that it previously skipped.
Those children also carry the component name as a `text.class.<name>`
scope, which a rule can target.

This is the opposite direction from Elixir: coverage grew, so a rule
reports MORE than it did. Read the new findings as real, and narrow the
rule's `scope` only if the component's prose was deliberately out of
reach.

**An exception zone that did nothing now takes effect, and findings
disappear.** Vale 3.20.0 records the region each `<!-- vale <id>.<id> =
NO -->` and `= YES` pair covers, and suppresses any alert located
inside it. Through 3.19.0 an *inline* pair (at a list item's
continuation indent, with no blank line between it and the prose it
wraps) was read once per block, so the two halves cancelled out and the
zone did nothing at all.

So a marker already sitting in this project's documents was inert and
is now live. Nothing errors: findings a document has reported for as
long as the rule existed stop appearing, which reads as a rule that
broke. Before treating a drop as a regression, look for the
markers: `git grep -n '<!-- vale'`. Keep the zone if it was meant; if
it was a half-finished experiment, delete the pair and the coverage
comes back.

**A `raw`-scoped rule can be exempted in a document now.** Directives
reach `raw` rules as of 3.20.0. Before, they were applied to the parsed
document only and a `raw` rule fired straight through every zone, so a
rule about a shell command, a flag, or a package name could only be
removed, never exempted case by case. A rule that was narrowed or
abandoned for that reason is worth revisiting.

One caveat comes with it: at `raw` scope the directive line is itself
linted text, so a rule whose token appears in its own id reports a
finding on the marker that silences it. Rename the rule, or scope it.

**`sequence` accepts `exceptions`.** The field is new in 3.20.0 and
purely additive: no existing rule changes behaviour, and a sequence
rule that was over-firing on a known phrase can now carry it. Upstream
also changed how a negated sequence token is satisfied at a sentence
boundary. No shape we tried reproduced a difference between 3.19.0 and
3.20.0, so there is nothing to do unless you see one.

**A rewriter now requires `fix`.** `SerializableRewriter.required` goes
from `["rule","id"]` to `["id","fix","rule"]`, so a `rewriters:` entry
without a `fix:` is now rejected where it was accepted before.

Run `%(TASKLESS_CLI)s verify` and it names the offending rewriter
directly. It cannot be auto-fixed: `fix` is replacement text, which is
authorial intent. A rewriter with no `fix` could never have done
anything, so this surfaces a rule that was already dead rather than
breaking one that worked.

**Markdown is now a language, with a narrow shape.** `language:
Markdown` parses. What it sees is the BLOCK tree only: `document`,
`section`, `atx_heading`, `setext_heading`, `fenced_code_block`,
`list_item`, `paragraph`. Everything inside a line collapses into one
opaque `inline` node, so there is no `link`, no `emphasis`, no
`strong_emphasis`.

Two failure shapes, and they are opposites. `kind: link` is a HARD
CONFIG ERROR: exit 8, `Kind \`link\` is invalid`, which aborts config
parsing and takes every other rule's report down with it. A pattern like
`[$T]($U)` is the quiet one: it parses, runs, exits 0, and matches
nothing forever.

So "no bare URLs" and "link text must not say click here" are not
ast-grep rules even now. Use Vale, which reads prose, and note that Vale
DOES see YAML frontmatter: with `scope: raw` it sees the keys too, and
`extends: occurrence` with `min: 1` can require a field to be present.

**`sg run --lang` accepts the alias spellings.** At 0.41.0 `--lang C++`
was rejected while `language: C++` parsed. At 0.45.2 both are accepted.
This affects the flag only, not a rule's `language:` field, so no rule
file needs changing. It is recorded because the divergence used to be
documented as a thing to work around.

**Matching semantics moved, and a valid, unchanged rule can now match a
DIFFERENT SET OF NODES with no error and no warning.** Two shapes are
affected. Both were measured against the two binaries, so this section
says what to do rather than what to watch for.

**A rule was silently dead and now fires.** If a rule uses `nthChild`
with an `ofRule` whose body binds a metavariable:

```
nthChild:
  position: 2
  ofRule: { pattern: $S }
```

then at 0.41.0 it matched **nothing**, because `ofRule` reused one
environment across siblings: the first match committed `$S` and every
later sibling failed the consistency check and went uncounted. It now
counts correctly and reports.

So the rule is not broken, it was inert, and the findings it produces on
this version have never been seen. Run `%(TASKLESS_CLI)s check` and read
them as new: they are real matches the rule was always meant to make,
and they may be numerous on a codebase that has never been checked
against it. Fixtures are no help here, since a rule that matched nothing
passed the `pass/` side of its own tests.

A rule whose `ofRule` used a non-binding matcher, `kind:` or `regex:`
with no metavariable, is unaffected: only binding was broken.

**A metavariable is now empty where it used to carry a value.** If a
rule binds a metavariable inside a negated `not` and then references it
in `message`, `fix`, or a constraint:

```
follows:
  not:
    pattern: return $A
  stopBy: end
message: "found after $A"
```

then at 0.41.0 `$A` rendered with a value leaked from the candidate the
negation REJECTED. A `not` contributes no bindings by definition, since
a successful negation means the inner rule did not match, so that value
was never meaningful. It is now unbound and renders empty.

This one will not change your finding counts. The match is identical:
same file, same range, same rule. Only the rendered output differs, so
grep your rules for a metavariable that appears both inside a `not` and
in a `message` or `fix`. A `fix` in that shape has been writing the
leaked text into people's files.

**Root metavariables and comments** also changed upstream
(ast-grep/ast-grep#2868), but no shape we tried reproduced a difference,
including the TSX case that PR names. Nothing to do unless you see one.

### Migrating to 0.11.2

Vale moves from 3.20.0 to 3.21.0, and ast-grep from 0.45.2 to 0.45.3.
Nothing installed migrates for ast-grep: its one user-visible change is
that an inline `ast-grep-ignore` comment takes effect only as the
comment's first alphabetic text, which the 0.45.3 changeset describes
and no rule file carries. Six things follow for existing Vale rules,
every one measured against both binaries; the last is behaviour a rule
can now use, not a change to one it has.

**A duplicated matcher now keeps its LAST assignment.** Where a rule's
`.vale.ini` repeats a `[glob]` section, or repeats a key inside one,
3.20.0 kept the first value and 3.21.0 keeps the last (upstream 1e4f6ed,
"let the project's rule settings win"). Precedence across different
matchers was already last-wins, so the two directions now agree, and the
guidance to put a disable AFTER the enable it narrows is right for both
shapes. A rule that relied on the old order is one whose second
assignment was being ignored; it now takes effect, and the rule turns on
or off where it did not before. `git grep -c '^\[' .taskless/rules/vale`
finds a config with more than one section per rule to read.

**A `metric` rule's `scope` is honored.** Through 3.20.0 a `metric`
measured the whole document whatever its `scope` said; 3.21.0 measures
the blocks the scope names, and only an absent scope, or `scope: text`,
still means the document. A `metric` with `scope: sentence` or
`scope: paragraph` now reports per block, so its findings move, appear,
or disappear. If the document-wide reading was what you wanted, delete
the `scope`.

**Notebooks are read cell by cell.** `.ipynb` had no parser, so a rule
matching `[*.ipynb]` was linting the notebook's JSON: cell source,
outputs, and metadata alike. 3.21.0 reads a Markdown cell as Markdown
and a code cell as its kernel's comments, and reads raw cells and
outputs not at all. Findings drop, and `Line` now points into the
notebook file. Nothing warns; a suspiciously clean run over notebooks is
this.

**An unknown `action` name fails the run at load.** Measured on
3.20.0, a rule carrying `action: {name: bogus}` loaded, and the run
died only when that rule fired, as an `E100` with no file and no line.
3.21.0 refuses it when the rule loads, as an `E201` naming the file, so
a rule that has been carrying a bad action without ever matching now
fails every check, not just the ones where it matched. `verify` rejects
a name outside `replace`, `remove`, `suggest`, `convert`, `edit`, so run
it: the rule is named directly.

**`BlockIgnores` and `TokenIgnores` apply to HTML.** A rule's
`.vale.ini` carrying either key under an `[*.html]` matcher was ignored
through 3.20.0 and takes effect on 3.21.0. Findings inside the ignored
region disappear.

Upstream also says a `sequence` rule with a negated scope (`~list`,
`~code`) reported every match twice (vale-cli/vale#1169). No shape we
tried reproduced a difference between the two binaries, including the
one that PR's own test uses, so it is recorded the way the ast-grep
root-metavariable case is: nothing to do unless you see one.

**`scope: doc(<selector>)` selects part of a document by CSS selector**,
which a rule could not do before: `text & doc(section:has(> h2:contains("Decision")))`
is the prose of one section, `~doc(...)` is everything outside it, and
a `metric` scoped to `doc(...)` puts a word budget on that section
alone. `%(TASKLESS_CLI)s agent create-vale-rule` has the shapes and the
one trap (a leaf element on its own, `doc(h2)`, is inert; chain it).
No existing rule changes; this is a reason to revisit one that was
narrowed by hand.

### Migrating to 0.11.3

**Files over 128KB are linted again.** 0.11.2 skipped any target file
over 128KB that a matcher's section reached, naming it in a `notices`
entry instead of checking it, because Vale 3.20.0's cost grew
superlinearly with the size of one Markdown block and a single large
file could consume the whole run's time budget. 3.21.0, the Vale that
0.11.2 itself shipped, made that cost linear (a 3MB single-block file
measures ~230ms where 3.20.0 took ~81s), so the skip is gone. A file
that was reported as skipped now produces findings, and the `notices`
entry that named it no longer appears. Nothing in a rule changes; if a
large generated file was being kept quiet by that skip, narrow the
matcher's section so it is not reached.

**A Vale rule's `.vale.ini` is validated against a schema, and a
config `check` used to tolerate now refuses the Vale run.** Every
config was carried into the run verbatim; nothing checked that a
matcher carried its breadcrumb, that an assignment named this rule and
not another, or that the run-level keys stayed out. Each of those is a
config Vale accepts and reads as something other than what its author
wrote, with a zero exit and an empty report. Now `verify` rejects such
a config, naming the line and the `vale-config-*` constraint, and
`check` refuses the Vale engine over it: the failure names the rule and
the line, the exit code is non-zero, and ast-grep still runs. Run
`%(TASKLESS_CLI)s verify` to see every rejected line at once. The four
most likely to trip an existing rule: an assignment above the first
matcher (`StylesPath`, `MinAlertLevel`, or the rule's own key, which
Vale was ignoring with a `W101`); a matcher with no `tskl) rule = <id>`
breadcrumb; a key naming another rule (`no-hedging.no-hedging = NO`
inside `no-simply`'s config, which was a cross-rule override); and a
`NO` matcher declared before every `YES`, which the `YES` was
overriding. A `.taskless/**` matcher is reported as unnecessary rather
than rejected, since `check` excludes that tree before Vale runs;
delete it. `%(TASKLESS_CLI)s agent create-vale-rule` lists every
rejection and advisory.

## Errors

With `--json`, `--rules` failures emit `{ ok: false, code, message }`:

| code            | meaning                                        | fix                                        |
|-----------------|------------------------------------------------|--------------------------------------------|
| `INVALID_INPUT` | no `.taskless/`, or an older CLI would rewind the marker | set the project up, or upgrade first |

## See Also

- `%(TASKLESS_CLI)s agent check`: run every engine over the repo
- `%(TASKLESS_CLI)s agent improve-rule`: rewrite a rule the walk flagged
- `%(TASKLESS_CLI)s agent info`: what is installed, and staleness
