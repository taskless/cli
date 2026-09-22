# Topic: create-vale-rule     (CLI v%(CLI_VERSION)s / topic v13)

## You are here
This is `create-vale-rule`. It helps you write a Vale rule: a check over
the words of a document, prose, markup, and the prose parts of code.
If that is not the kind of check you need, re-run `%(TASKLESS_CLI)s agent route`
and follow its decision rather than adapting this recipe.

## Goal
Produce a Vale rule that fires on the prose it should flag and stays
quiet on the prose it should not, scoped to the files it is about.

## Preconditions
- `.taskless/` directory exists.
- The agent can read/write files and run shell commands.
- No auth required.

## One rule, one directory

Everything that defines a Vale rule lives in
`.taskless/rules/vale/<id>/`. Writing a rule means creating that
directory. Deleting a rule means deleting it. No file outside it is
touched either way, so two agents authoring two rules never collide.

```
.taskless/rules/vale/no-simply/
    no-simply.yml          the style: what the rule looks for
    .vale.ini              the scope: which files it applies to
    .tests/fail/bad.md     prose it must flag
    .tests/pass/ok.md      prose it must leave alone
```

The rule is **incomplete until the style and the config both exist**,
and skipping the config fails silently rather than loudly: the rule
parses, the check passes, and nothing is ever reported. `verify` exists
to catch exactly that, so run it (step 6) before you believe a rule
works.

**The id appears four times and all four must agree:**

```
.taskless/rules/vale/no-simply/           <- the directory
.taskless/rules/vale/no-simply/no-simply.yml   <- the style file
no-simply.no-simply = YES                 <- the assignment in .vale.ini
tskl) rule = no-simply                    <- the breadcrumb in .vale.ini
```

The doubled `no-simply.no-simply` is not a typo. Vale names a check
`<style>.<rule>`, and here the rule's own directory is the style, so
both halves are the id. Anything else is a check that does not exist,
which Vale accepts without complaint.

You will not find a project-wide `.vale.ini` to edit. The config Vale
actually reads is assembled from every rule's own file at check time
and is gitignored. Editing it is pointless, the next check regenerates
it.

## Steps

1. **Say what the rule reads, then pick an extension point.** Write one
   sentence: "this fires when a document contains ___." Vale rules are
   built by extending one of its twelve checks, and the sentence tells
   you which. Twelve is measured, not counted off the docs: give Vale
   v%(VALE_VERSION)s an `extends` it does not know and it names the whole
   set back at you:

   ```
   'extends' key must be one of [capitalization conditional consistency
   existence occurrence repetition substitution readability spelling
   sequence metric script].
   ```

   The docs enumerate eleven, folding `readability` into `metric`. They
   are separate checks with separate fields.

| If the rule is about…                                                                   | extends          |
|-----------------------------------------------------------------------------------------|------------------|
| words or phrases that should not appear                                                 | `existence`      |
| preferring one term over another. **including the correct spelling of a product name** | `substitution`   |
| the case of a whole heading or sentence                                                 | `capitalization` |
| how many times something may appear                                                     | `occurrence`     |
| a word repeated back to back                                                            | `repetition`     |
| picking one of two acceptable spellings, consistently                                   | `consistency`    |
| "if X appears, Y must also appear"                                                      | `conditional`    |
| a length or ratio threshold, over the document or one `scope` of it                     | `metric`         |
| a readability grade, against a named formula                                            | `readability`    |
| a misspelling, against a dictionary                                                     | `spelling`       |
| phrases that must appear in a fixed order                                               | `sequence`       |
| anything the above cannot express (Tengo script)                                        | `script`         |

   **`capitalization` is about a whole scope, not a word.** It asks
   whether an entire heading or sentence matches a case pattern. It
   cannot express "the word GitHub, wherever it appears, is spelled
   thus". That is a `substitution`, because you are swapping a wrong
   spelling for a right one. Reaching for `capitalization` on a product
   name produces a rule that flags whole sentences: measured, a rule with
   `match: GitHub` reports `We host on Github and it is fine. should be
   GitHub`.

   For the five this recipe has no worked example of, `metric`,
   `readability`, `spelling`, `sequence`, `script`, read
   https://docs.vale.sh/styles before inventing something. Vale has no
   facility for a rule that does not extend one of these twelve, and an
   `extends` outside the set is not a rule that misbehaves: Vale exits 2
   and **every** Vale rule in the project goes unreported for that run.
   `verify` rejects it before Vale is invoked, and names the twelve.

   **The other seven have a worked rule at the end of this recipe**,
   nine rules between them, each with the near-miss that fails and why.
   Read the one closest to your intent before writing anything, the
   mistakes documented there are observed, and most of them fail
   silently.

2. **Write the style file** to
   `.taskless/rules/vale/<id>/<id>.yml`, where `<id>` is kebab-case and
   names both the directory and the file.

   **One exception: a `consistency` rule's id must be word characters
   only** (`izeise`, not `ize-ise`). That check compiles the id into its
   pattern as a regex group name, and a hyphen there fails the entire
   Vale run. `verify` catches it. Kebab-case is correct for the other
   eleven.

   Every rule carries:

| Field     | Required | Notes                                         |
|-----------|----------|-----------------------------------------------|
| `extends` | yes      | one of the twelve above                       |
| `message` | yes      | shown to the user; see the `%%s` table below  |
| `level`   | no       | `suggestion` (default), `warning`, or `error` |
| `scope`   | no       | narrow to part of a document; see below      |
| `link`    | no       | a URL the reader can follow for the reasoning |
| `limit`   | no       | cap findings from this rule per scope         |

   **`vocab` is not one of these.** It reads as though it were, but it is
   a per-check field: measured, only `existence`, `substitution`,
   `capitalization`, `conditional` and `repetition` accept it, and
   `occurrence`, `metric`, `readability`, `script` and `sequence` reject
   it. On one of those five it raises `E201` and takes every other Vale
   rule in the project down with it. It is listed with the per-check
   fields below.

   **The file extension must be `.yml`.** Measured: rename a working
   style file to `.yaml` and Vale loads nothing, no error, no warning,
   zero findings, and `<id>.<id> = YES` still parses. It is
   indistinguishable from a rule whose pattern never matched.

   **`scope` decides where the rule looks**, so getting it wrong is a
   silent under-fire rather than an error. An unrecognized scope is not
   rejected by Vale: `scope: fenced` loads, runs, and matches nothing.
   It is the worst of the three failures on this page, because unlike a
   bad `extends` or a foreign field it does not even take the run down to
   tell you. The rule is inert, forever. `verify` rejects a scope
   outside the table below, which is the only layer that ever will.

   Every value below was measured against Vale v%(VALE_VERSION)s by
   authoring a rule with that scope and a document the rule had to flag.
   "Fires" means the finding appeared; a scope that never fired is not on
   this list.

| `scope`                | reaches                                                   |
|------------------------|-----------------------------------------------------------|
| *(omitted)*            | everything the format exposes as prose                    |
| `text`                 | prose only, not inline code, not fenced blocks           |
| `code`                 | inline code spans only                                    |
| `raw`                  | the unparsed document: prose, inline code, fenced blocks  |
| `heading`              | every heading                                             |
| `heading.h1`…`h6`      | headings of that level                                    |
| `paragraph`            | one paragraph at a time                                   |
| `sentence`             | one sentence at a time                                    |
| `list`                 | list items                                                |
| `blockquote`           | quoted blocks                                             |
| `link`                 | link text, not the URL                                    |
| `alt`                  | image alt text                                            |
| `summary`              | `<summary>` of a disclosure                               |
| `strong`, `emphasis`   | bold and italic runs                                      |
| `table`                | any part of a table                                       |
| `table.header`         | header cells                                              |
| `table.cell`           | body cells                                                |
| `table.caption`        | a table's caption                                         |
| `figure.caption`       | a figure's caption, but see below                        |
| `frontmatter`          | every YAML front-matter value                             |
| `frontmatter.<key>`    | one front-matter key's value                              |
| `text.class.<name>`    | HTML elements carrying that class                         |
| `comment`              | every comment, in a comment-tier format                   |
| `comment.line`         | `//`-style comments                                       |
| `comment.block`        | `/* … */`-style comments                                  |
| `doc(<selector>)`      | elements matched by a CSS selector; see below             |

   **`doc(<selector>)` picks part of a document by CSS selector**, the
   same way in every markup format, and a heading with everything under
   it is a `section`, so one section of a document is
   `doc(section:has(> h2:contains("Decision")))`. Chain it to narrow an
   ordinary scope to that element: `text & doc(...)` is prose inside it,
   `sentence & doc(...)` one sentence at a time inside it, `~doc(...)` is
   everything outside it. On its own, `doc(...)` lints what is INSIDE the
   element as one block, which is what `occurrence` (a section must say
   "we will") and `metric` (a section runs over budget) want. Measured: a
   `metric` with `scope: doc(section:has(> h2:contains("Consequences")))`
   and `formula: words` counts that section's words, not the document's.

   **A leaf element on its own is inert.** `doc(h2)` alone selects a
   heading, and a heading has nothing inside it to lint as a block, so the
   rule matches nothing, with no error anywhere. Write `text & doc(h2)`
   for the heading's own text. The same holds for `doc(p)` and `doc(li)`.
   `verify` accepts both spellings, because telling a leaf from a container
   needs the document; `test` shows which one fires.

   **The selector is Vale's to check, not `verify`'s.** A selector Vale
   cannot compile (`doc(h2[)`) fails the whole run at load with
   `E201 invalid selector in 'doc(...)'`, which `test` reports. A selector
   that compiles and matches nothing is silent, like any scope with no
   construct to find. `verify` checks that the term is `doc(` … `)` with
   something between, and no more.

   **`raw` subsumes `code` and `text`.** Measured on one document holding
   the token in prose, in an inline span, and in a fenced block: `text`
   found one, `code` found one, `[code, text]` found two, `raw` found all
   three. If you want prose and inline code but not fenced blocks, write
   the list, `raw` is not "a bit wider", it is everything.

   **Front matter is text, to `raw` and to every other scope but its
   own.** A product-casing rule under `scope: raw` flagged
   `target: taskless` in a blog post's front matter, where the lowercase
   value is a machine key the publish path reads, and capitalizing it
   would have broken the corpus. That is not a `raw` peculiarity:
   measured on Vale v%(VALE_VERSION)s with the same rule, `text`, the
   default scope and `[raw, code, text]` all reported the value on the
   front-matter line too, so dropping `scope: raw` on its own fixes
   nothing. `paragraph` and `sentence` skip it, and `frontmatter.<key>`
   matches only that key and never leaks into body prose; `~frontmatter`
   also left the key alone and fired on the body, but chained onto `raw`
   (`raw & ~frontmatter`) it matched nothing at all, so the negation
   does not rescue a `raw` rule. Three fixes, then: `scope: paragraph`
   or `sentence` when the rule is about prose, `frontmatter.<key>` when
   it is about a field, and in either case a `pass/` fixture that
   carries the machine key, so the rule cannot regress onto it without
   `test` saying so:

   ```markdown
   ---
   target: taskless
   ---
   Taskless compiles the correction into a rule.
   ```

   The first line is a machine key, read by the publish path. The last
   is prose, correctly cased. A rule that fires on this document is
   reading the wrong one.

   The same reach is useful in the other direction. `occurrence` with
   `min: 1` under `scope: raw` can require a front-matter field to
   exist, because `raw` reads the key and the value as one unparsed
   line. Measured: this fires on a document whose front matter has a
   `title` and no `description`, fires on one with no front matter at
   all, and stays quiet once the field is there.

   ```yaml
   extends: occurrence
   message: "A blog draft needs a description in its frontmatter."
   level: error
   scope: raw
   min: 1
   token: '(?m)^description: .+$'
   ```

   **Vale drops everything inside a `<figure>` element.** Measured: a
   `<figcaption>` nested in `<figure>` is invisible to *every* scope,
   `text` and `raw` included, so a `scope: figure.caption` rule over a
   normally-marked-up figure reports nothing and looks like a bad scope.
   A bare `<figcaption>` is linted, and `figure.caption` fires on it. If a
   fixture is not firing, check whether its subject is inside a `<figure>`
   before you touch the pattern.

   **`scope` also takes `~` and `&`.** `~code` is everything but inline
   code; `text & ~code` chains two operands; a list (`[code, text]`) is a
   union. All three parse and behave.

   **Negating an inline element removes its text from the paragraph, as
   of Vale 3.22.0.** `~link`, `~strong`, `~emphasis` and `~code` are the
   four. A rule with `text & ~link` still runs on every paragraph, and
   the link text inside a paragraph is blanked before the rule sees it,
   so a casing or wording rule can leave link text and bold terms alone
   without giving up the sentence around them. Positions after the
   blanked element do not move. Through 3.21.0 the same scope only kept
   the rule off the link's own fragment, and the paragraph still carried
   the link text, so a rule written this way now reports fewer findings.
   The release note spells these `text.raw` and `paragraph.link`; those
   dotted forms are not scopes on the binary, bare or negated, and
   `verify` rejects them. Write the bare inline name.

   **A negation over a scope Vale does not know is a silent no-op.**
   Measured: `~banana` and `text & ~banana` both fire on everything,
   because there is no such scope to subtract. A typo inside a `~` does
   not narrow the rule and does not widen it visibly. It removes the
   exclusion you wrote the rule for. `verify` checks the operands inside
   `~` and `&` as strictly as a bare one, for exactly this reason, the
   one place it is deliberately stricter than Vale itself.

   **`scope` is per-rule, and rules do not interact.** Taskless assembles
   every rule's matchers into one config for the run, which invites the
   assumption that one rule's `scope` narrows another's, or that two
   rules over the same file compete. They do not: each check carries its
   own scope and is evaluated independently. If a rule is over-firing,
   the cause is in that rule's own `scope` and glob, never in a
   neighbour's.

   **A directive turns any rule off, `raw` included, as of Vale 3.20.0.**
   `<!-- vale <id>.<id> = NO -->` opens a zone and `= YES` closes it.
   Vale records the region each directive covers and suppresses any
   alert located inside it, which reaches a `raw`-scoped rule too.
   Through 3.19.0 a directive was applied to the *parsed* document and
   `raw` reads the unparsed one, so a `raw` rule fired straight through
   every zone: a rule about a shell command, a flag, or a package name
   was exempt-or-remove with nothing in between. It is not any more.

   One thing to know before writing one over a `raw` rule: at `raw`
   scope the directive line is itself linted text. A rule whose token
   appears in its own id matches the marker that silences it, and
   reports a finding on the directive. Name the rule so its own id does
   not contain the word it looks for.

   **A zone is two lines, and no blank line may separate it from the
   prose it wraps.** Measured on Vale 3.20.0:

   - Inline at a list item's continuation indent works, and this is the
     form to reach for. The pair covers the lines between it and
     nothing else.
   - At column 0 it works too, and it ends any list it interrupts.
     Blocks that then reparse as indented code are already outside a
     prose rule's reach, so a zone placed there can move coverage
     rather than restore it.
   - A pair separated from its prose by blank lines, at an indent past
     the code-block threshold, suppresses nothing: what it wraps is not
     prose any more. Nothing reports that, either.

   Through 3.19.0 the first of those did nothing at all. An inline pair
   was read once per block, so the `NO` and the `YES` cancelled out
   before the paragraph was linted and the words stayed reported with
   no error and no warning. A zone had to wrap a whole step or a whole
   section at the margin, and exempting the two steps of this recipe
   that quote hedging words would have put 176 lines of prose out of
   reach to keep two words of an example. That price is gone.

   **A shown directive has to be inline or fenced, never a bare line.**
   A directive on a line of its own now takes effect on the recipe at
   any indent, and the CLI strips it before serving so a reader never
   sees it. Measured: a directive inside backticks and a directive
   inside a fenced block are both inert, which is why every directive
   quoted in this file is one or the other.

   **Then the fields the extension point adds**. This is where the rule
   actually lives, and each check reads only its own:

| extends          | its fields                                                                   |
|------------------|------------------------------------------------------------------------------|
| `existence`      | `tokens` (a list) or `raw`; `ignorecase`, `nonword`, `exceptions`, `append`, `vocab` |
| `substitution`   | `swap` (a map of observed → expected); `ignorecase`, `nonword`, `exceptions`, `capitalize`, `pos`, `vocab` |
| `capitalization` | `match`; `style` (with `$title`), `exceptions`, `threshold`, `indicators`, `prefix`, `vocab` |
| `occurrence`     | `token`, `max` and/or `min`; `ignorecase`                                    |
| `repetition`     | `tokens`; `alpha`, `ignorecase`, `exceptions`, `max`, `vocab`                |
| `consistency`    | `either` (a map of the two acceptable forms); `ignorecase`, `nonword`        |
| `conditional`    | `first`, `second`; `exceptions`, `ignorecase`, `vocab`                       |
| `metric`         | `formula`, `condition`                                                       |
| `readability`    | `metrics` (a list of formula names), `grade`                                 |
| `spelling`       | `aff`, `dic`, `custom`, `filters`, `ignore`, `threshold`                     |
| `sequence`       | `tokens` (each a `pattern`/`tag` map); `ignorecase`, `exceptions`             |
| `script`         | `script` (Tengo source)                                                      |

   The list above is measured, not transcribed: every entry was added to
   a minimal rule of that check and the run watched for `E201`. Three
   corrections fall out of it, all against the published docs:
   `capitalization` takes `prefix` (singular) and rejects both `prefixes`
   and `suffixes`, it rejects `ignorecase`, and `occurrence` rejects
   `exceptions` and `vocab`.

   **Field names are matched case-insensitively, but `extends`, `message`
   and `level` are not.** Measured: `Tokens:` and `ignoreCase:` are read
   exactly as their lowercase spellings, while `EXTENDS:` fails with
   "Missing the required 'extends' key". Their *values* are case-sensitive
   too, `level: WARNING` and `extends: Existence` are both rejected.
   Write everything lowercase and none of this can bite you.

   **A field from the wrong check is the loudest failure Vale has.**
   `tokens` on an `occurrence` check gives
   `E201 … has invalid keys: 'tokens'`, exit 2, and, because Vale reads
   one assembled config per run. **no** Vale rule in the project reports
   anything. `verify` rejects the rule before Vale is invoked, so this
   cannot reach `check`.

   **Two checks are exempt, and that is not a licence.** Measured,
   `consistency` and `spelling` accept any key at all: `bananafield:
   true` on either loads without complaint and is ignored. A misspelled
   field on those two is a silent no-op instead of a loud one, so the
   schema cannot catch a typo there and neither can Vale. Read the field
   list twice when writing those two.

   **What `%%s` fills with depends on the extension point.** Getting this
   wrong is the one mistake in this recipe that passes every check below
. The rule fires, the fixtures are green, and only a human reading the
   message sees that it is nonsense.

| extends          | `%%s` count | fills with, left to right                             |
|------------------|-------------|-------------------------------------------------------|
| `existence`      | one         | the matched text                                      |
| `substitution`   | **two**     | the **replacement**, then the matched text            |
| `capitalization` | one         | the scope that failed (the whole heading or sentence) |

   Measured: a `substitution` message with a single `%%s` interpolates the
   *replacement*, not the match, so `"Use GitHub not %%s"` against the text
   `Github` renders `Use GitHub not GitHub`.

   For the other nine, do not guess. Write the message, run step 6, and
   read it back off the finding, no test you can write catches a wrong
   `%%s`, so your own eyes on the rendered message are the check.

   ```yaml
   # existence, flag these tokens wherever they appear
   extends: existence
   message: "Avoid '%%s', it hides the work from the reader"
   level: warning
   ignorecase: true
   tokens:
     - simply
     - just
   ```

   ```yaml
   # substitution, first %%s is the replacement, second is what was found
   extends: substitution
   message: "Use '%%s' instead of '%%s'"
   level: warning
   ignorecase: true
   swap:
     utilize: use
     "in order to": to
   ```

   ```yaml
   # capitalization, a whole heading must be in sentence case
   extends: capitalization
   message: "'%%s' should be in sentence case"
   level: warning
   scope: heading
   match: $sentence
   exceptions:
     - Taskless
     - API
   ```

   `match` takes `$sentence`, `$title`, `$lower`, or `$upper`. A literal
   string is legal but means "this whole scope must read exactly that",
   which is almost never what anyone wants. See step 1.

   **`$sentence` means first word capitalized, everything else lowercase
, proper nouns included.** It is not "sentence case allowing proper
   nouns". Measured with `exceptions: [Taskless, API]` on headings:

| Heading                           | Result                                         |
|-----------------------------------|------------------------------------------------|
| `Getting started with the API`    | quiet                                          |
| `Getting started with APIs`       | quiet, an exception covers its plural         |
| `Taskless and the API`            | quiet, an exception may lead the scope        |
| `Getting started with Kubernetes` | **fires**: a proper noun you did not list     |
| `getting started lowercase`       | **fires**: the first word must be capitalized |
| `Getting Started With Title Case` | **fires**                                      |

   So `exceptions` is not decoration: every proper noun, product name and
   acronym the docs use has to be listed, or the rule flags correct
   headings. Collect them from the docs before writing the rule, and
   expect to add to the list.

3. **Know what you are writing: `tokens` and `swap` keys are patterns,
   not literals.** They compile as Go regular expressions.

   *This step is about `tokens` and `swap` only. A `capitalization`,
   `occurrence` or `metric` rule has neither, skip to step 4.*

   - `(?:…)`, `[…]`, `|`, `+`, `?` all work.
   - **Lookaround and backreferences work, and they are not free.**
     Vale compiles a pattern with Go's own `regexp` first and falls
     back to `regexp2` when that engine refuses it, so `(?=…)`,
     `(?<=…)` and `\1` are all available even though Go's `regexp` has
     none of them. Measured on Vale v%(VALE_VERSION)s with throwaway
     rules, each firing on its `fail/` fixture and quiet on `pass/`: a
     repeated-word `\b(\w+) \1\b`, a `foo(?= bar)` lookahead, and a
     `(?<=x )y` lookbehind. The fallback engine backtracks and is the
     slower of the two, so keep lookaround off a pattern that runs
     over every file in the project, and prove any rule that uses one
     with a fixture rather than trusting the syntax. "X but not when
     followed by Y" is therefore writable as a single `substitution`,
     but splitting it or narrowing with `scope` is still the cheaper
     rule when either will do.

     Two measured limits sit on top of that, and both are silent:

     - **A backreference does nothing in `swap`.** The same
       `(\w+) \1` that fires under `tokens` and under `raw` produces
       no finding as a `swap` key, with nothing on stderr and the
       rule loading cleanly, so the rule looks healthy and never
       fires at all. A repeated-word check has to be an `existence`
       rule; it cannot be a `substitution`.
     - **A trailing lookahead in `tokens` or `swap` has to peek at a
       non-word character.** The implicit `\b` is appended after the
       lookahead (the lookahead is zero-width, so the position is
       still where the match ended), which puts the boundary between
       the match and the text peeked at. `foo(?= bar)` fires;
       `foo(?=bar)` can never match, whatever the document says. Use
       `raw` when the lookahead has to land on a word character.
   - **Word boundaries are applied for you, around the whole pattern.**
     Measured: `Github` does not fire inside `GithubToken`, and the
     multi-word `click here` does not fire inside `Clicking here`.
   - **A hyphen is a boundary, so a hyphenated compound is not
     protected.** `obviously` fires inside `obviously-named`, while
     `obviously_stale` is safe because `_` is a word character. Do not
     reach for a hyphenated compound as a `pass/` near-miss; it is the
     case most likely to fire.
   - **Regex metacharacters in a real phrase are live.** "maybe?" is a
     pattern meaning "mayb" followed by an optional "e". Escape it.
   - **Overlapping alternatives resolve first-wins**, one finding per
     match. If `can login` and `login with` both match a sentence, you
     get whichever is written first, once, not both.
   - `ignorecase: true` matches any casing **and still skips text that
     already equals the replacement.** Measured with `Github: GitHub`:
     `github` and `Github` are flagged, `GitHub` is not. You do not need
     `ignorecase: false` to protect the correct spelling.
   - `raw` takes a full regex, used verbatim, when `tokens` is too
     restrictive; `nonword` removes the implicit boundaries from
     `tokens`.
   - **`raw` entries concatenate, they do not alternate.** `tokens` is
     a list of alternatives. `raw` is not: Vale joins every entry into
     one pattern, back to back, with nothing between them. Measured on
     Vale v%(VALE_VERSION)s with two entries, `\bstops ` and `being\b`:
     `It stops being.` fires, and a document holding either half alone
     does not. So a second entry added to widen a rule never fires on
     its own, and its `fail/` fixture fails, which is how this was
     found. Alternation goes inside one entry, as `(a|b|c)`:

     ```yaml
     # wrong: the second entry is appended to the first, so the new
     # branch never fires on its own
     extends: existence
     raw:
       - "\\bstops being\\b[^.!?\\n]{0,80}\\band becomes\\b"
       - "[A-Z][^.!?\\n]{3,70}[.!?] (The|That|This|It)('s| is| was) the (problem|twist|point)\\b\\."
     ```

     ```yaml
     # right: one entry, the branches alternated inside it
     extends: existence
     raw:
       - "(\\bstops being\\b[^.!?\\n]{0,80}\\band becomes\\b|[A-Z][^.!?\\n]{3,70}[.!?] (The|That|This|It)('s| is| was) the (problem|twist|point)\\b\\.)"
     ```

     No `nonword` there, and none is needed: `nonword` governs
     `tokens`, which Vale wraps in `\b…\b` unless it is set, and a
     `raw` entry is used verbatim. Measured, `nonword: true` beside a
     `raw` list changes nothing. Write the boundaries you want into the
     pattern, as above.

     `verify` reports a `raw` list with more than one entry, on the
     rule's `notice` rather than in `errors`:

     ```
     <id>: raw has N entries; Vale joins them into one pattern with no separator, so the second never matches on its own. Write one entry with (a|b) unless the join is intended.
     ```

     If the join is intended, and the pieces are only split for
     readability, the notice is yours to read and set aside.
   - **A token made only of punctuation can never match without
     `nonword: true`.** The boundaries above are `\b`, which needs a word
     character on the inside. An em dash has none, on either side.
     Measured against `This is a sentence, with an em dash.`:

     ```yaml
     # fires on nothing, ever, and reports no error
     extends: existence
     message: "Use a comma, not an em dash"
     tokens:
       - ', '
     ```

     ```yaml
     # fires
     extends: existence
     message: "Use a comma, not an em dash"
     nonword: true
     tokens:
       - ', '
     ```

     The first rule verifies, tests green if its `fail/` fixture is
     missing the dash, and reports nothing forever. Any token whose
     pattern contains no `\w` (punctuation, an emoji, a bare symbol)
     needs `nonword: true`.

   - **A bare word finds senses you did not mean.** `landed on` in a rule
     <!-- vale no-hedging.no-hedging = NO -->
     about jargon also matches "the plane landed on time"; `simply` in a
     rule about hedging also matches "simply connected" in a maths doc.
     <!-- vale no-hedging.no-hedging = YES -->
     Narrow the token to the **collocation** you actually object to
     (`landed on a decision`, not `landed on`), and check that you got it
     right by writing the `pass/` fixture from the literal sense *first*:
     put the innocent sentence in `pass/` before you write the guilty one
     in `fail/`. A rule whose `pass/` bucket was written afterwards tends
     to contain only sentences the author already knew were safe.

   Vale also understands the markup, which decides what counts as text
   before your pattern ever runs. Measured in markdown:

   - **URLs and code spans are not prose.** A `Github` key fires on
     `Plain Github here` and not on `https://Github.com/x` or
     `` `Github/docs` ``.
   - **Link text *is* prose.** In `[click here](https://example.com)`,
     `click here` is matched. The URL is not. With no `scope`, a rule
     fires on both link text and ordinary prose; `scope: link` narrows it
     to link text alone. Measured: without a scope the token hit both the
     link and the sentence; with `scope: link`, only the link.

4. **Scope the rule** by writing `.taskless/rules/vale/<id>/.vale.ini`.
   This is the step that is easy to skip and impossible to notice
   skipping. A rule with no config is enabled nowhere: it parses, it
   runs, and it reports nothing.

   The whole file, for a rule that applies to markdown:

   ```ini
   # Which files this rule applies to.
   [*.md]
   tskl) rule = no-simply
   no-simply.no-simply = YES
   ```

   Three lines, and each one earns its place:

   - `[*.md]` is a **matcher**: a glob over paths, deciding which files
     this rule sees. Match it to the files the rule is actually about,
     such as `[*.{md,markdown}]` or `[docs/**/*.md]`. A rule can declare
     several matchers if it needs to. Before you widen a glob, check the
     reach table below, what Vale does to a file it cannot parse is not
     "nothing".
   - `tskl) rule = <id>` is a breadcrumb Taskless reads to attribute the
     matcher back to this rule after assembly interleaves every rule's
     matchers into one file. Vale parses the key and ignores it. Write it
     in every matcher you add, or the tooling loses track of who owns
     what.
   - `no-simply.no-simply = YES` turns the rule on. The first half is
     the style, which is this rule's directory; the second is the check
     inside it, which is the file. Both are the id.

   **Do not write `BasedOnStyles`, empty or otherwise.** Older versions
   of this recipe put `BasedOnStyles =` in every matcher, on the belief
   that it kept Vale's bundled styles from loading. It never did that
   (no bundled style loads unless a run-level `BasedOnStyles` names one,
   and the assembled header names none), and as of Vale 3.22.0 an empty
   value has a meaning: it clears every setting the file inherited from
   an earlier matcher. Taskless assembles every rule's matchers into one
   file in id order, so a rule writing the line under `[docs/**]`
   silences every alphabetically earlier rule under `docs/`, and
   `[*.md]` beside another rule's `[*.{md,markdown}]` silences the first
   on every `.md` file. Only two rules with byte-identical globs escape,
   because Vale merges those into one section. `verify` rejects the key
   in any matcher, and `%(TASKLESS_CLI)s init` deletes it from configs
   written by the older recipe.

   **Scope a rule *out* with a second matcher, not a cleverer glob.** A
   glob says which files a rule sees; it has no way to say "these but not
   those". The exclusion is a second matcher that assigns `NO`, and
   because precedence here is positional (a later matcher wins), the
   exclusion goes **after** the inclusion:

   ```ini
   # Every markdown file…
   [*.md]
   tskl) rule = no-simply
   no-simply.no-simply = YES

   # …except the changelog, which quotes release notes verbatim.
   [CHANGELOG.md]
   tskl) rule = no-simply
   no-simply.no-simply = NO
   ```

   Write the breadcrumb in the second matcher too, or `verify` rejects
   the matcher as unattributed. Reversing the two blocks would silently
   re-enable the rule on the file you meant to exempt, so the schema
   rejects a `NO` matcher that precedes every `YES`: with no style
   loaded the rule is off until something turns it on, which makes such
   a `NO` either dead or overridden. Put the `NO` after the `YES` it
   narrows.

   **Do NOT write `StylesPath` or `MinAlertLevel` here.** Those describe
   the run rather than a rule, and the assembler supplies them. A copy in
   a rule's config is rejected, not dropped: the file you write is the
   file Vale reads, byte for byte, so nothing is edited on the way in.

   Keep assignments underneath a matcher. An assignment above the first
   `[…]` line belongs to no matcher; Vale would ignore it after a
   warning on stderr and leave the rule enabled nowhere, so the schema
   rejects it instead.

   **The config is schema-checked.** `verify` parses `.vale.ini` into a
   structure and validates it against a schema keyed by the rule's
   directory name, naming the line and the `vale-config-*` constraint
   behind each rejection. `check` runs the same schema before assembling
   the run config, and a rejected config refuses the Vale engine for
   that run: the failure names the rule and the line, the exit code is
   non-zero, and the other engines still run. A rule is never quietly
   left out. What is **rejected**:

   - anything assigned above the first matcher (`StylesPath`,
     `MinAlertLevel`, or a rule assignment)
   - a matcher without a `tskl) rule = <id>` breadcrumb naming this rule
   - an assignment key other than `<id>.<id>` (a key naming another rule
     is a cross-rule override, which a rule cannot do)
   - a value other than `YES` or `NO`
   - a `BasedOnStyles` assignment, with any value, empty included
   - a config with no matcher, or one that never assigns `YES`
   - a `NO` matcher that precedes every `YES` matcher

   What is **advised**, on the rule's notice, without rejecting:

   - the same key assigned twice inside one matcher (Vale keeps the last
     assignment as of 3.21.0; 3.20.0 kept the first). The rejections
     above judge each matcher by that final verdict, so a `YES` that a
     later `NO` in the same matcher overrides does not count as enabling
     the rule: if it was the only `YES`, the config is rejected, not
     advised
   - a `[*]` matcher, which reaches every file Vale can read
   - a matcher under `.taskless/**`, which a whole-project `check`
     already excludes, and which silences the rule over a fixture
     bucket you name on purpose (step 6)

   Each advisory has a legitimate reading, which is what separates the
   two lists. Fix a rejection before moving on; read an advisory and
   decide.

   **What a matcher's glob is allowed to catch.** Vale (v%(VALE_VERSION)s)
   treats a file one of four ways, decided by extension. The lists are
   rendered from the pinned Vale version, not written out here, so they
   track the shipped binary.

   - **markup**: the document is prose and the format's own non-prose
     constructs are skipped. This is the tier every `scope:` value
     assumes; `scope: heading` has nothing to find outside it:
     %(VALE_MARKUP_FORMATS)s
   - **comment text only**: the comments are linted and the code body
     <!-- vale no-hedging.no-hedging = NO -->
     is invisible, which is exactly right for "comments must not say
     'obviously'":
     <!-- vale no-hedging.no-hedging = YES -->
     %(VALE_COMMENT_FORMATS)s
   - **plaintext fallback**: everything else, `.yml` `.toml` `.sh`
     `.sql` and every extension not named above included. There is no
     parser, so the whole file is linted as prose: a rule matched to
     YAML flags key names and values, not just the comments. If that is
     not what the rule means, narrow the glob rather than accepting it.
     These land here despite reading like markup, so a `scope:` value
     has nothing to act on in them: %(VALE_PLAINTEXT_FORMATS)s
   - **not supported**: Vale parses these only by shelling out to an
     external program, and this build does not support any format that
     needs one:
     %(VALE_CONVERTER_FORMATS)s

     Do not tell the user to install the program. Taskless excludes these
     files from the run whatever is installed, so that a repository
     checks the same way on every machine; `.xml` could not work anyway,
     since an XSLT stylesheet is specific to the document.

   **A single unreadable file fails the whole Vale pass.** Vale exits 2
   with an `E100` runtime error and abandons the run, `--no-exit` does
   not suppress it, so every other Vale rule over every other file goes
   unreported. `[*.{md,typ}]` is not a slightly wider `[*.md]`; it is a
   matcher that takes `check` down the first time the repo grows a
   `.typ` file. Never put one of those extensions in a glob.

   **A large file is linted, not skipped.** Vale's cost is linear in a
   file's size as of 3.21.0 (a 3MB single-block document measures
   ~230ms), so no file is excluded on size and a broad matcher such as
   `[*.md]` at the project root reaches a generated changelog or an
   exported note like any other document. If such a file should not be
   checked, narrow the section rather than expecting `check` to skip
   it.

   That example changed with Vale v3.18.0, which is the point: the
   dangerous extension is whichever one the list above says needs a
   program, not the one you remember. `.mdx` was the example until that
   release parsed it natively, and `.typ` took its place.

   **`.mdx` is supported** as of Vale v3.18.0, which parses it natively
   rather than shelling out. `[*.{md,mdx}]` is a legitimate matcher
   again, the example this recipe used to warn about is no longer the
   broken one. Check the lists above rather than reaching for that
   memory: `.typ` moved the opposite way in the same release, so a
   matcher covering Typst is now the one that takes the run down.

   **In `.mdx`, a component's children are prose as of v3.19.0.** Vale
   reads a JSX element's children as the Markdown they are, so text
   inside a wrapping component (`<Steps>`, `<Tabs>`, `<Aside>`) is
   linted at its own source position. Only tags, attributes, `{...}`
   expressions, self-closing elements, and an element opened and closed
   on one standalone line are still treated as code.

   Two consequences for a rule you write against MDX. Coverage grew,
   so a rule can now fire in prose it never reached before, which is a
   finding count that moves without the rule changing. And the children
   carry the element's name as a class scope, exactly as MyST and
   Quarto directives do, so `scope: text.class.Aside` targets one
   component's content. That is an open family: `verify` accepts any
   `text.class.<name>` tail, because the set of component names is the
   author's, not Vale's.

5. **Write the fixtures.** Two directories inside the rule, both flat.
   Vale lints the whole fixture tree, so a document nested a level
   deeper would be linted and never checked against either bucket, which
   `test` rejects by name rather than skipping. Keep both one level
   deep:

   ```
   .taskless/rules/vale/<id>/.tests/pass/ok.md    # rule must stay quiet
   .taskless/rules/vale/<id>/.tests/fail/bad.md   # rule must fire
   ```

   **The leading dot on `.tests/` is required.** ast-grep walks the
   rules tree and parses every `.yml` it reaches as a rule, and a plain
   `tests/` directory fails that scan for the whole project. A
   dot-directory is skipped. Do not rename it.

   Give the fixtures an extension your matcher's glob matches. A `.txt`
   fixture under a `[*.md]` matcher is never linted, so the `fail/`
   document silently passes.

   **The `pass/` bucket is not "correct prose".** Correct prose proves
   nothing. The rule was never going to fire on it. Fill it with the
   near-misses that would catch an over-broad pattern. What counts as a
   near-miss depends on the rule's shape:

   - **`tokens`/`swap` rules**: the noun form you are not flagging, the
     word inside a longer word, the term in a URL or a code span, the
     correct spelling itself.
   - **`scope`d rules**: the same phrase *outside* the scope. A rule
     with `scope: link` needs the phrase in ordinary prose; a rule with
     `scope: heading` needs it in body text. Without that, nothing proves
     the scope is doing anything.
   - **`capitalization` rules**: a scope that is entirely exceptions, a
     scope whose exception word comes first, and the plural of an
     exception.

   That is the half of the fixture set that has to work for you.

   **When the rule's subject normally appears in code, the `fail/`
   fixture must carry it three ways**, inline in a code span, inside a
   fenced block, and in ordinary prose, in that one document. A rule
   about a command, a flag, a package name or an env var has a subject
   that lives in fenced blocks in every real README, and the default
   scope cannot see fenced blocks at all. A `fail/` fixture written only
   in prose therefore fires, goes green, and the rule then catches none
   of the real violations. Measured on one document holding the token in
   all three places: the default scope found one of three, `raw` found
   three. If the fixture fires on the prose line and not on the other
   two, the answer is `scope: raw`. See step 2 for what that costs.

   **Fixtures run under a config that isolates this rule, so a green
   `test` is not evidence the rule reaches any real file.** `test`
   generates its own `.vale.ini` pointing at the fixture directory and
   enabling only `<id>.<id>`; your rule's own matcher globs are not
   consulted. So a glob of `packages/cli/src/**/*.ts` that matches
   nothing in the repository still produces a rule that verifies, tests
   green, and reports forever. The only check for that is a real
   `check` over a real file:

   ```
   %(TASKLESS_CLI)s check <a real path the rule should flag> --json
   ```

   Do that once, on a file you have deliberately made violate the rule,
   before you believe the rule works.

   **A voice or tone rule is a floor, not a ceiling.** A regex catches
   the shape it was written for and nothing beyond it, so a rule about
   how prose sounds only ever holds the misses already measured. From a
   repository running eleven such rules: an antithesis rule keyed on
   "not" and "never", the sentence a reader called out had neither, and
   twelve days later `The correction was right. The place it landed was
   the problem.` passed the widened rule for the same reason. Treat
   every miss as the next branch, and grow the fixtures with it:

   - The sentence that got through becomes a `fail/` fixture, dated.
   - The legitimate uses of the same words go into `pass/` in the same
     change, so the branch cannot drift wider than what was measured.

   ```
   I've seen that read as a hole in his argument. It's the frame proving itself.   (fail, first miss)
   The correction was right. The place it landed was the problem.                  (fail, twelve days on)
   Two collections beats one. This is the answer we shipped in June.               (pass, must keep passing)
   ```

   **Run a new branch over the repository's own prose before it ships
   at `warning`, and record the count beside the branch.** Fixtures say
   the branch fires where it should; only the corpus says how often it
   fires where it should not, and a rule with no number gets switched
   off the first week it fires on real prose. A verdict-noun branch
   that read as broad returned one hit outside its fixtures. Keep the
   count in a comment next to the pattern, dated, so the next author
   knows what the branch cost when it was written:

   ```yaml
   # Every branch measured against the repo's 1,100 markdown files on
   # 20 September. Corpus false positives per branch: 0, 0, 4, 2, 1. All
   # of the four were written by the assistant, never by the human author.
   ```

   There is no single command that runs one Vale rule over the project
   and counts (taskless/cli#379 tracks one). `test` isolates the rule
   but sees only its fixtures. The workable way is a whole-project
   `check` filtered afterwards by rule id:

   ```
   %(TASKLESS_CLI)s check --json | jq '[.results[] | select(.ruleId == "<id>")] | length'
   ```

   A finding carries no record of which alternative matched, so to
   count one branch, run the rule with that branch as its only `raw`
   entry, note the number, then fold it back into the alternation. Drop
   `| length` to read the hits themselves, which is what tells you
   whether a hit is a false positive or a real one nobody had noticed.

6. **Verify, then test.** Two commands, both taking the rule's
   directory as their argument, both run from the project root:

   ```
   %(TASKLESS_CLI)s verify .taskless/rules/vale/<id> --json
   %(TASKLESS_CLI)s test   .taskless/rules/vale/<id> --json
   ```

   `verify` asks whether the rule is well-formed: the style file parses,
   `extends` names one of the twelve checks, `message` is present, `level`
   is one Vale accepts, every `scope` operand is one Vale honors, every
   field belongs to the check the rule extends, and the config declares a
   matcher that enables `<id>.<id>`. It does **not** need fixtures, so run
   it as soon as the style file exists.

   Those checks are measured against Vale v%(VALE_VERSION)s rather than
   transcribed from its docs, and they run **before** Vale is invoked.
   That ordering matters for two of them: an unknown `extends` and a
   foreign field each fail the whole Vale run rather than just this rule,
   so letting either reach the binary would take every other Vale rule's
   findings down with it.

   `test` runs the rule against both buckets. It runs `verify` first and
   stops if that fails, so a malformed rule tells you what is malformed
   instead of complaining about fixtures.

   Both report the same shape:

   ```json
   {"ok":true,"rules":[{"engine":"vale","ruleId":"no-simply",
    "ok":true,"errors":[],"ran":true}]}
   ```

   `ok` is the answer. `errors` names what failed, one string per
   problem. Exit code is 0 when every rule passed and 1 otherwise, so
   both are safe to script.

   Pass a directory above a rule and every rule beneath it is checked,
   reported one entry per rule. `.taskless/rules/vale` covers every Vale
   rule; no argument at all covers the project.

   **`test` answers pass-or-fail and never shows you the finding**, so
   it cannot tell you that a `substitution` message renders its two
   `%%s` slots in the wrong order: the rule fires, the fixture is
   satisfied, and `test` reports `ok`. To read the rendered message,
   the line numbers and the matched text, name the bucket to `check`:

   ```
   %(TASKLESS_CLI)s check .taskless/rules/vale/<id>/.tests/fail --json
   ```

   **That works because a path you name is honored.** `.taskless/` is
   excluded from the *whole-project* walk only, so a bare `check` over
   the project reports nothing from anyone's fixtures while the command
   above reports every finding in that bucket. Measured on this build:
   a whole-project `check` returned no result under `.taskless/`, and
   the same rule's `fail/` bucket named explicitly returned its
   findings with the message text rendered.

   **If that command returns `results: []` for a rule whose `test` is
   green, suspect the rule's own config before the pattern.** A
   `[.taskless/**]` matcher setting `<id>.<id> = NO` turns the bucket
   off for exactly this invocation, which is the one shape that
   reproduces "`test` says the fixture fired, `check` on the same
   fixture says nothing". Measured: adding that matcher to a working
   rule left `test` at `ok: true` and emptied `results`. The tell is
   in the same envelope, as a notice reading `matcher [.taskless/**]
   is unnecessary`. `verify` reports it too, as an advisory. Delete
   the matcher; step 4 explains why no rule needs one.

   Read `results` there. Ignore `success` and the exit code: `success`
   says the run worked rather than that the fixture behaved, and the
   exit code follows severity, so a `level: error` rule exits 1 on
   `fail/` while a `warning` rule exits 0 and both are correct. `test`
   answers pass-or-fail; `check` shows you the finding.

   **An empty `results` is a clean pass only when nothing else in the
   envelope says otherwise.** Two things can leave a file unchecked
   while `results` reads `[]` for it, and both are reported, so read
   for them before you believe the silence:

   - **A `vale-parse-error` finding.** A document whose front matter
     Vale cannot parse used to abort the whole invocation, and `check`
     returned `[]` for the run, indistinguishable from a clean pass.
     Now the run retries around the file Vale blames and files it as a
     finding of its own, at `severity: "error"`, so a file that
     could not be read never reads as a file with nothing to report.
     Measured, with an unquoted colon in a front-matter value:

     ```json
     {"source":"vale","ruleId":"vale-parse-error","severity":"error",
      "message":"Vale could not check this file: E201: yaml: mapping values are not allowed in this context",
      "file":"broken.md", …}
     ```

     Every other file's findings are reported normally, and no rule of
     yours ran over this one. If it is a fixture, `test` shows the same
     gap from the other side: a `fail/` fixture Vale cannot parse
     reports as `fail fixture did not fire`, and a `pass/` fixture it
     cannot parse stays green, since a rule that never ran cannot fire.
     Fix the front matter rather than the pattern.

   - **A `notices` entry.** Under `--json` the key is absent when there
     is nothing to say, so its presence is the signal. One notice
     reads `Vale did not check N file(s): …` and names documents in a
     format this build has no converter for, which `check` excludes
     rather than letting one of them take the run down; another begins
     `Vale reported while running:` and carries whatever Vale wrote to
     stderr on a run that still exited zero. The one to expect there is
     the `W101` warning about a rule assignment placed above any
     matcher, the mistake step 4 warns of. `test` surfaces the same
     text as a per-rule `notice`, printed even on a pass.

   A `failures` key is the third case and the loud one: the engine was
   present and did not finish (a malformed rule, a timeout), `success`
   is `false`, and `results` holds only what the other engines
   reported. Only `results: []` with no `vale-parse-error` finding, no
   `notices` and no `failures` is the clean pass it looks like.

   **The binary that answers is the vendored one, and only that one
   counts.** `verify`, `test` and `check` all run the Vale that ships
   with this CLI, v%(VALE_VERSION)s, which is what every measurement in
   this recipe was taken on. A bare `vale` on your `PATH` proves nothing
   about what `check` will report: one first attempt validated a rule
   set against Homebrew's 3.15 while Taskless pinned 3.20, and rules
   that passed on one and not the other told nobody anything. Do not
   run `vale` directly, and do not add config to make a bare run
   behave. The matcher that comes from doing so is `[.taskless/**]`
   with the rule set to `NO`, meant to keep a bare run quiet over
   fixtures that hold violations on purpose. It does not stay confined
   to the invocation it was written for: a whole-project `check` skips
   `.taskless/` without its help, and on a fixture bucket you name it
   is the one thing acting, which is how it empties the `check` above
   while `test` stays green. `verify` reports it as an advisory (step 4
   lists it). A rule needs the matchers for the files it is about and
   no more.

   When a `fail/` document does not fire, work down this list before
   touching the pattern. The cause is usually further up:
   - Read the finding first, with the `check` on the `fail/` bucket
     above. What the run saw is cheaper than any guess about why it
     saw nothing, and it separates "no finding" from "a finding whose
     message is wrong".
   - Does the rule have a `.vale.ini` at all?
   - Is the assignment underneath a `[…]` matcher?
   - Is it spelled `<id>.<id>`, both halves the same?
   - Does the matcher's glob match the fixture's extension?
   - Only then: does the pattern actually match the text?

   A `pass/` document that fires means the pattern is too broad. Look
   for a missing word boundary, an unescaped metacharacter, or a swap
   key that also matches the form you meant to allow.

7. **Report.** Show the rule directory you created and what is in it, a
   one-line summary of what the rule flags, and the glob it is scoped
   to. The scope is a decision the user should see rather than one
   buried in a config. Note that a whole-project `%(TASKLESS_CLI)s check` skips
   your fixtures: `.taskless/` is excluded from the project walk, by
   design. `test` is what exercises them.

## Worked rules

Nine rules that work, each paired with the near-miss that fails. Every
one was run against the bundled Vale; the "what goes wrong" lines are
observed behavior, not warnings in principle. Find the entry closest to
your intent and start there.

### 1. Ban a word or phrase, `existence`

> "Our docs shouldn't hedge."

```yaml
extends: existence
message: "Avoid hedging: '%%s'"
level: warning
ignorecase: true
tokens:
  - we think
  - it seems
  - sort of
```

**Goes wrong:** dropping `ignorecase: true` when you meant any casing.
`We think` at the start of a sentence then sails through. And a phrase
with punctuation is a *pattern*: `maybe?` means "mayb" plus an optional
"e", so it matches `mayb`. Escape it: `maybe\?`.

### 2. Prefer one term over another, `substitution`

> "Say 'sign in', not 'login', when it's a verb."

```yaml
extends: substitution
message: "Use '%%s' instead of '%%s'"
level: warning
ignorecase: true
swap:
  'login (?:to|into)': sign in to
  'to login': to sign in
```

**Goes wrong:** one `%%s` instead of two. Measured, `"Use sign in not
%%s"` against `login to` renders **"Use sign in not sign in to"**, the
replacement, twice. The rule fires, both fixtures pass, and only a human
reading the message sees it. Two `%%s`, always, in that order.

### 3. Enforce a product's spelling, `substitution`, not `capitalization`

> "It's 'GitHub', never 'Github' or 'github'."

```yaml
extends: substitution
message: "Use '%%s' instead of '%%s'"
level: error
ignorecase: true
swap:
  github: GitHub
```

**Goes wrong:** reaching for `capitalization` because the complaint is
about capitals. Measured, `match: GitHub` flags whole sentences:
`'We host on Github and it is fine. should be GitHub'`, because that
check tests a *scope*, not a word. Note also that `ignorecase: true` is
safe here: Vale skips text already equal to the replacement, so the
correct `GitHub` is not flagged.

### 4. Sentence-case headings, `capitalization`

> "Headings are sentence case; our product names keep their capitals."

```yaml
extends: capitalization
message: "'%%s' should be in sentence case"
level: warning
scope: heading
match: $sentence
exceptions:
  - Taskless
  - API
  - Kubernetes
```

**Goes wrong:** a short `exceptions` list. `$sentence` lowercases
everything after the first word, proper nouns included, so every product
name and acronym in the docs must be listed or correct headings get
flagged. Collect them from the docs first; expect to add more.

### 5. Restrict a rule to link text, any check, plus `scope`

> "'click here' is useless link text."

```yaml
extends: existence
message: "Link text '%%s' says nothing, name the destination"
level: warning
scope: link
ignorecase: true
tokens:
  - click here
  - read more
```

**Goes wrong:** omitting `scope: link`. Measured, the token then fires
on `[click here](…)` **and** on "click here to focus the search box" in
ordinary prose, which is a false positive on a sentence that is fine.
Whenever a rule is about a *place* in the document, the `pass/` fixture
must contain the same phrase outside that place, otherwise nothing
proves the scope works.

### 6. Cap how often something appears, `occurrence`

> "At most one exclamation mark per paragraph."

```yaml
extends: occurrence
message: "Too many exclamation marks"
level: warning
scope: paragraph
token: "!"
max: 1
```

**Goes wrong:** forgetting `scope`. The count is per scope, so with no
scope you are capping the whole document rather than the paragraph.
Note `token` here is singular, this check takes one, not a `tokens` list.

### 7. Catch a doubled word, `repetition`

> "'the the' keeps slipping through review."

```yaml
extends: repetition
message: "'%%s' is repeated"
level: warning
alpha: true
tokens:
  - '[^\s]+'
```

**Goes wrong:** leaving the pattern unquoted. Measured, an unquoted
`[^\s]+` in YAML silently matches nothing, zero findings, no error, no
diagnostic. Quote any pattern containing a backslash. This is the
failure mode this recipe warns about most, arriving through YAML rather
than through Vale.

### 8. One spelling or the other, consistently, `consistency`

> "Pick -ize or -ise and stick to it."

```yaml
extends: consistency
message: "Use '%%s' consistently"
level: warning
nonword: true
either:
  organize: organise
```

**The id must be word characters only.** `consistency` is the one
extension point that compiles the rule's own name into the pattern, as
a `(?P<id>…)` capture group, and Go's `regexp` rejects a group name containing
a hyphen. Measured: an id of `ize-ise` fails with `E201 … invalid group
name` and takes **every** Vale rule in the project down with it, because
Vale reads one config for the whole run. Name this one `izeise` or
`spelling_variants`. Kebab-case is right everywhere else.

**Goes wrong:** expecting it to pick a winner. It flags the *second*
form once both appear in a document, it enforces internal consistency,
not house style. If you want one specific spelling, that is a
`substitution`.

### 9. Require a definition, `conditional`

> "An acronym must be spelled out before it's used."

```yaml
extends: conditional
message: "'%%s' has no definition"
level: warning
scope: text
ignorecase: false
first: '\b([A-Z]{3,5})\b'
second: '(?:\b[A-Z][a-z]+ )+\(([A-Z]{3,5})\)'
```

`first` is what must be justified; `second` is what justifies it.
Measured: `Application Programming Interface (API)` licenses every later
`API`, while an undefined `XYZ` is flagged.

**Goes wrong:** swapping the two, which inverts the rule into "flag the
definition when the acronym is missing".

## Important Notes

- Vale reads one document at a time and has no cross-document view. A
  rule about consistency *between* documents cannot be written here.
- Prose inside code is still prose: comments and docstrings are Vale's
  subject, and a rule about them belongs under a matcher whose glob
  covers the source files.
- Do NOT add a `[*]` matcher to widen a rule that isn't firing. Matchers
  from every rule are assembled into one config, so `[*]` applies this
  rule to every file the walk reaches and turns one rule's scoping bug
  into a flood of false positives.

## See Also

- `%(TASKLESS_CLI)s agent route`: re-decide the destination
- `%(TASKLESS_CLI)s agent check`: run every engine over the repo
- `%(TASKLESS_CLI)s agent create-sg-rule`: author a rule over code structure
