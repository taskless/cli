# Topic: create-sg-rule     (CLI v%(CLI_VERSION)s / topic v18)

%(ONE_COMMAND_PER_CALL)s

## You are here
This is `create-sg-rule`. It helps you write an ast-grep rule: a check
over the structure of a single source file, authored on this machine.
If that is not the kind of check you need, re-run `%(RECIPE_FETCH)sroute`
and follow its decision rather than adapting this recipe.

## Goal
Produce a verified ast-grep rule and its test cases, locally, without
contacting the Taskless service. You derive the rule yourself, write it
in the canonical on-disk shape, and check it with `validate` and
`verify` in a feedback loop. The files match what the service writes,
so every command treats them the same.

## Preconditions
- `.taskless/` directory exists.
- The agent can read/write files and run shell commands.
- No auth required.

<!-- on-demand -->
## One rule, one directory

Everything defining a rule lives in `.taskless/rules/sg/<id>/`. Writing
a rule means creating that directory; deleting a rule means deleting
it. No file outside it is touched either way, so two agents authoring
two rules never collide.

```
.taskless/rules/sg/no-eval/
    no-eval.yml                               the rule
    tests/fail/eval-of-payload/handler.ts     a case it must fire on
    tests/pass/json-parse/handler.ts          a case it must stay quiet on
```

Unlike Vale, an `sg` rule needs no second config file. It carries its
own `files` and `ignores` inside the rule, so the rule file is the
whole rule.

## Steps

1. **Learn the ast-grep rule format** from the upstream reference,
   https://ast-grep.github.io/guide/rule-config.html: fields, operators
   (`pattern`, `kind`, `regex`, `any`/`all`/`has`/`inside`/`not`) and
   meta-variables. Do not write a rule from memory.

2. **Gather and confirm the pattern**: code that should pass, code that
   should be flagged, the target language, and any exceptions. Search the
   codebase for real instances and confirm exclusions with the user.

3. **Check for an existing rule that already covers this.** Scan
   `.taskless/rules/sg/` and read each rule's `message`, `note`, and
   `rule` fields. If one overlaps, show the user and ask whether they
   would rather improve it, `%(RECIPE_FETCH)simprove-rule --anonymous`
   iterates a rule locally.

4. **Author the rule in the canonical shape.** Write the rule to
   `.taskless/rules/sg/<id>/<id>.yml`, where `<id>` is kebab-case and
   names both the directory and the file
   ([One rule, one directory](#one-rule-one-directory)). At minimum:
   - `id`: kebab-case, matching the filename (e.g. `no-eval`)
   - `language`: the target language, copied from [Languages](#languages)
   - `severity`: `error`, `warning`, `info`, or `hint`
   - `message`: a concise single-line explanation
   - `rule`: the ast-grep rule object

   Optional but useful: `note` (multi-line guidance, supports markdown),
   `fix` (auto-fix pattern), `ignores` (file patterns to skip).

   **Read every `kind:` off a real file.** A kind is a node name from
   the language's grammar, and guessing one is how a rule ends up a
   config error or matching nothing. Print the tree of a file the rule
   targets:

   ```
   %(TASKLESS_CLI)s ast <file>
   %(TASKLESS_CLI)s ast <file> --range 40:60
   ```

   It parses the file with the ast-grep this CLI ships, as the language
   its extension resolves to, which is the parser `check` uses for it.
   It prints named nodes only, so every kind it shows is one `kind:`
   accepts. `--range <line>` or `--range <from>:<to>` keeps the nodes on
   those lines and the ones enclosing them, `--lang <Language>` parses
   as another language, and `--json` gives the same tree as data. There
   is no need to locate an ast-grep binary yourself.

   A `language` spelling that only looks right can take every other sg
   rule down with it, so copy it rather than typing it.

5. **Check the rule against the quirks.** Read [Quirks](#quirks) and
   [Pattern quirks](#pattern-quirks) against what you just wrote, before
   writing any tests. Most get past `validate` and then fail the whole
   scan or match less than they should: a `$$$` next to a comma, a
   `kind:` you did not read off `%(TASKLESS_CLI)s ast`, a callee rule
   over `await f<T>(...)`, a `has`, `inside`, `follows` or `precedes`
   without `stopBy`, a `not` that reuses a metavariable.

6. **Write the tests.** Write at least two cases in each bucket under
   `.taskless/rules/sg/<id>/tests/`. These paths are the same ones the
   service writes; do not invent a different layout. Read
   [Fixtures](#fixtures) for how cases are laid out and judged and where
   to take them from, before writing the first one.

   **Both buckets must hold a case, and `verify` fails the rule if either
   one is empty.** An empty `fail/` is the only thing that demonstrates
   the rule can fire.

7. **Run the feedback loop.** Both commands take the rule's
   directory as their argument:
   ```
   %(TASKLESS_CLI)s validate .taskless/rules/sg/<id> --json
   %(TASKLESS_CLI)s verify   .taskless/rules/sg/<id> --json
   ```
   `validate` checks the rule is well-formed; run it the moment the rule
   exists. `verify` runs `validate` first, then the cases.

   - `ok: true` → go to step 8.
   - `ok: false` → read `errors` and fix, using
     [Feedback loop](#feedback-loop) to read them. Repeat up to 3 times.

8. **On success, report.** Show the rule directory and what is in it,
   plus a one-line summary of what the rule detects. Suggest
   `%(RECIPE_FETCH)scheck` to validate against the broader codebase.

9. **On failure, escalate, with confirmation.** If after the feedback
   loop the rule still cannot capture the user's cases:
   - Delete the candidate `.taskless/rules/sg/<id>/` directory, rule
     and tests together, so the repo is not left with a broken rule.
   - Tell the user the local rule could not capture the cases, and that
     generating via the Taskless service uses a generation and requires
     login.
   - Only after the user confirms, fetch
     `%(RECIPE_FETCH)screate-remote-rule` and follow it. Do not call the
     service silently.

<!-- on-demand -->
## Fixtures

How step 6's cases are laid out and judged, then where to take them
from, then what is particular to ast-grep's.

   %(FIXTURE_LAYOUT)s

   %(FIXTURE_SOURCES)s

Each case file takes the extension ast-grep parses as the rule's
`language:` (`.ts` for `TypeScript`, `.tsx` for `Tsx`, `.yml` for
`Yaml`), and sits at a path the rule's `files:` admits and its
`ignores:` does not. To show that `files:` or `ignores:` excludes a
path, put the offending file at that path in a `pass/` case beside a
clean file the scope admits, as the layout above describes. A `pass/`
case holding only the excluded file is never read and fails.

An empty `fail/` is not a neutral starting point to fill in later: it
is the only thing that demonstrates the rule can fire, and a rule that
matches nothing anywhere looks exactly like a rule that works without
it.

Where the rule has an arity boundary (the separator trap under
[Pattern quirks](#pattern-quirks)), put a case on each side of it. A
pattern that starts at two arguments when it was meant to start at one
passes a test suite whose fixtures all have two. Where the rule keys on
a callee that the repository awaits with a type argument
(`await f<T>(...)`), put that form among the `fail/` cases. Write it
only for such a callee: an awaited generic call to a function the
repository never awaits is not code it would accept, and the case would
teach the wrong shape.

<!-- on-demand -->
## Feedback loop

How to read what step 7's `validate` and `verify` report. Both answer
in the same shape:

```json
{"ok":true,"rules":[{"engine":"sg","ruleId":"no-eval",
 "status":"passed","ok":true,"errors":[],"ran":true}]}
```

| what `errors` says                              | fix                                             |
|-------------------------------------------------|-------------------------------------------------|
| the YAML doesn't match the schema               | check field types against the upstream schema   |
| a Taskless-required field is missing            | add `id`/`language`/`severity`/`message`/`rule` |
| a case didn't behave as expected                | fix the rule pattern OR the test case           |
| the rule's scope excluded a case                | move the fixture to a path `files:` admits      |
| a pass case showing an exclusion was never read | add a clean file the scope admits to that case  |

Every `regex`, at any depth, needs a `kind` beside it, or validation
fails. That includes `constraints`, `utils`, and every `not`, `has`,
`inside`, `any` and `all` sub-rule; see [Quirks](#quirks).

Pass a directory above a rule and every rule beneath it is checked,
one entry per rule in the report. `.taskless/rules/sg` covers every
ast-grep rule; no argument at all covers the project.

<!-- on-demand -->
## Languages

**`language` is ast-grep's vocabulary.** The vendored rule schema
types the field as a bare string with no enum, so the schema layer
accepts anything. `validate` checks it separately: an off-list spelling
is an error naming the accepted list, and a spelling ast-grep resolves
but does not itself use (`typescript` for `TypeScript`) is a notice.
Get it right anyway rather than leaning on that check. An unrecognized
name aborts config parsing, which takes every other sg rule in the
project down with it and reports nothing.
ast-grep (v%(AST_GREP_VERSION)s) parses:

  %(AST_GREP_LANGUAGES)s

Copy a spelling from that list rather than typing one that looks
right. Off-list spellings fail two different ways and neither is
caught locally: one ast-grep does not recognize at all takes the
whole scan down (`did not match any variant of untagged enum
SgLang`, so every other rule goes unreported too), and one it
recognizes but that names the wrong parser reports nothing and looks
like a clean codebase.

Three more `language:` mistakes have their own entries under
[Quirks](#quirks): copying a spelling from `detect --json`, treating
`Tsx` as an alias of `TypeScript`, and expecting `Markdown` to see
inside a line.

<!-- on-demand -->
## Quirks

Each of these, except the first, comes from a grammar or from ast-grep
itself, so a rule written carefully from the upstream reference still
hits them. Those fail in one of two ways:

- **Config error.** The scan exits 8 and names the problem. Loud, but
  it aborts config parsing, so every other `sg` rule in the project
  goes unreported until it is fixed. `validate` has ast-grep load each
  rule on its own, so it names the rule that has the error.
- **Silent.** The rule parses, validates, runs, and exits 0. What it
  misses goes unreported, which reads exactly like a clean codebase.

When a rule matches less than it should, check this list before
doubting the rest of the rule. Each entry was measured against the
ast-grep this CLI ships (v%(AST_GREP_VERSION)s). The last column says
whether `validate` reports it; where it says no, only you will notice.
A notice never fails the rule, because each of those shapes is
sometimes what the author meant. Read it and decide.

| quirk                                          | symptom                 | `validate` reports it       |
|------------------------------------------------|-------------------------|-----------------------------|
| a `regex` without a `kind`, at any depth       | refused by `validate`   | yes                         |
| `language:` copied from `detect --json`        | config error, or notice | yes                         |
| `TypeScript` declared over `.tsx` files        | silent                  | only if `files:` names .tsx |
| an inline construct named in a `Markdown` rule | config error, or silent | the `kind:` form only       |
| `$$$` next to a comma                          | silent                  | as a notice                 |
| a keyword named as a `kind`                    | config error            | yes                         |
| a callee rule over `await f<T>(...)`           | silent                  | as a notice                 |
| `follows` or `precedes` without `stopBy: end`  | silent                  | as a notice                 |
| `has` or `inside` without `stopBy`             | silent                  | as a notice                 |
| a `not` containing a bare metavariable         | silent                  | no                          |

### Every `regex`, at any depth, needs a `kind`

This one is a Taskless rule, wider than ast-grep's own check. ast-grep
refuses a bare `regex` only at the top of `rule` (a config error); in
any sub-rule it runs it against the text of every node it reaches,
which is ambiguous and slow. `validate` refuses a `regex` with no
`kind` beside it anywhere it appears: the top of `rule`,
`constraints.<VAR>`, `utils`, `not`, `has`/`inside` (however deeply
nested), `precedes`/`follows`, and each `any`/`all` branch.

A sibling `any:` whose every branch sets a `kind` counts, so a
metavariable that may capture one of several kinds keeps a single
regex. A callee is an `identifier` in `rpc()` and a
`member_expression` in `client.rpc()`:

```yaml
rule:
  pattern: "$CALLEE()"
constraints:
  CALLEE:
    any:
      - kind: identifier
      - kind: member_expression
    regex: "(^|\\.)rpc$"
```

An `all:` with one branch that sets a `kind` counts too. A `kind`
inside `not`, `has` or another relation does not, because it describes
a different node.

To find the kind, run `%(TASKLESS_CLI)s ast <file>` on a sample of
the code and take the named node the regex should match. Under
`constraints`, that is the node the metavariable captures, which is
not always the obvious one: the method `$M` captures in `$OBJ.$M()` is
a `property_identifier` in TypeScript, not an `identifier`. Read it off
the dump rather than guessing, and if the metavariable can capture
several kinds, list them in a sibling `any:` as above.

### `language:` copied from `detect --json`

`detect --json` reports the *repository's* languages, in a different
vocabulary. It says `C++` where ast-grep's list says `Cpp`. That one
happens to resolve, and `validate` reports it as a notice, but a
spelling ast-grep does not recognize at all is a config error.
Workaround: copy the spelling from the list in [Languages](#languages).

### `Tsx` and `TypeScript` are two parsers, not aliases

A rule that declares `TypeScript` does not read `.tsx` files at all,
so over a `.tsx` tree it reports nothing and exits 0. `validate` catches
it only when the rule's `files:` globs name `.tsx`; with no `files:`
it cannot tell. Workaround:
declare `Tsx` for `.tsx` files. A check that must cover both
extensions is two rules, one per parser.

### `Markdown` sees blocks only

tree-sitter-markdown splits block and inline grammars and ast-grep
exposes only the block tree, so `atx_heading`, `setext_heading`,
`fenced_code_block`, `list_item`, `paragraph`, `section` and
`document` are real kinds and everything inside a line is one opaque
`inline` node. There is no `link`, `emphasis` or `strong_emphasis`
kind; naming one is a config error, and writing it as a pattern
(`[$T]($U)`) matches nothing forever with no error at all.
Workaround: a rule about the words inside a line belongs to Vale, not
here. ast-grep also has no count and no absence assertion, so "every
doc has an h1" is not expressible as an `sg` rule at any severity.

<!-- on-demand -->
## Pattern quirks

The rest of the [Quirks](#quirks) table: the ones that come from how a
pattern or a relational rule is written rather than from the language.

### `$$$` next to a comma (the separator trap)

A `$$$` next to a comma does not mean "zero or more". The `,` in the
pattern is itself an AST node, and under ast-grep's default `smart`
strictness every node in the pattern must match, so a call with no
comma cannot match a pattern that has one. Given the four calls
`foo()`, `foo(1)`, `foo(1,2)`, and `foo(1,2,3)`:

| pattern            | what it matches                              |
|--------------------|----------------------------------------------|
| `foo($$$)`         | all four, `foo()` included                   |
| `foo($A, $$$)`     | `foo(1,2)` and `foo(1,2,3)`, never `foo(1)` |
| `foo($$$, $A)`     | `foo(1)` alone                               |
| `foo($A, $$$, $B)` | `foo(1,2)` alone                             |

A standalone `$$$` needs none of this. It is the comma beside it that
narrows the pattern. The two workarounds are not the same:

- **Trailing `$$$`**: write the pattern as an object with
  `strictness: ast`, which compares named AST nodes and ignores the
  separator. An object pattern also requires `context` and `selector`:
  ```yaml
  rule:
    pattern:
      context: foo($A, $$$)
      selector: call_expression
      strictness: ast
  ```
  This moves the boundary from two arguments to one, **not to zero**,
  `$A` still has to bind something, so `foo()` is still unmatched. And
  `strictness` is valid only inside the pattern object: at rule level
  ast-grep rejects it as an unknown field and fails the whole scan.
- **Leading `$$$`**: `strictness: ast` does not rescue it. Use `any`
  with one branch per arity you mean to cover.

This is upstream's intended behaviour (ast-grep/ast-grep#1365, closed
as working-as-intended), not a bug waiting on a release: 0.45.2
behaves identically, so there is no version to wait for.

### A keyword is not a valid `kind`

A concrete syntax tree prints keywords as nodes. For a constructor
parameter `readonly x: number` in TypeScript:

```
required_parameter
  readonly
  pattern: identifier
  type: type_annotation
```

but `kind: readonly` is a config error, ``Kind `readonly` is
invalid``. `readonly` is an anonymous token, and `kind:` accepts only
named nodes. A CST printout shows both the same way, so reading one
cannot tell you which names are valid kinds. This holds for every
keyword, not only `readonly`.

Workaround: read kinds off `%(TASKLESS_CLI)s ast <file>` instead, which
prints named nodes only. A name that appears there is a usable kind, and
a keyword never does. To match on the keyword, match
its named parent and test the parent's text. Cover every shape the
keyword appears in: after a decorator or an accessibility modifier
(`private readonly x`), and on an optional parameter (`readonly x?`),
which is an `optional_parameter`, not a `required_parameter`:

```yaml
rule:
  any:
    - kind: required_parameter
      regex: "^(?:@\\S+\\s+)*(?:(?:public|private|protected)\\s+)?readonly\\s"
    - kind: optional_parameter
      regex: "^(?:@\\S+\\s+)*(?:(?:public|private|protected)\\s+)?readonly\\s"
```

Anchoring at the start keeps a `readonly` type (`x: readonly string[]`)
and a parameter named `readonly` out. A decorator whose arguments
contain whitespace (`@Inject(A, B)`) defeats the `\S+`; add a fixture
for it if your codebase has one.

### An awaited generic call hides its callee

```ts
const r = await rpc<Foo>("x");   // missed
const s = await rpc("y");        // matched
```

With

```yaml
rule:
  kind: call_expression
  has: { field: function, kind: identifier, regex: "^rpc$" }
```

only the second call matches. The TypeScript grammar parses the first
as a call OF the await expression:

```
call_expression
  function: await_expression     <- not `rpc`
    await
    identifier
  type_arguments: <Foo>
  arguments: ("x")
```

So any rule keyed on the callee silently skips every awaited generic
call. The same happens in `Tsx`, and with `!`, `void` and `typeof` in
place of `await`, where the callee becomes a `unary_expression`.
`yield` is not affected. Workaround: accept the wrapped form as a
second branch, matching the same callee inside it.

```yaml
rule:
  kind: call_expression
  has:
    field: function
    any:
      - kind: identifier
        regex: "^rpc$"
      - kind: await_expression
        has: { kind: identifier, regex: "^rpc$", stopBy: neighbor }
```

The inner branch has to repeat whatever the plain branch matches. For
a method, `await client.rpc<Foo>()` wraps a `member_expression`, so
both branches test that instead:

```yaml
    any:
      - kind: member_expression
        has: { field: property, kind: property_identifier, regex: "^rpc$" }
      - kind: await_expression
        has:
          kind: member_expression
          stopBy: neighbor
          has: { field: property, kind: property_identifier, regex: "^rpc$" }
```

Add a `unary_expression` branch the same way if `!`, `void` or
`typeof` matter. The wrapped match spans the `await` too, so a `fix:`
on this rule rewrites it along with the call.

### `follows` and `precedes` need `stopBy: end` to cross punctuation

A sibling relation walks the immediate siblings, and in most grammars
the separators are nodes too. Between two array elements sits a `,`, so
the previous element is not the previous SIBLING. Measured on
TypeScript, `[10, 10, 30]` with

```
rule:
  kind: number
  follows: { kind: number }
```

matches nothing, and the same rule with `stopBy: end` inside `follows`
matches. If a sibling relation reports zero on input you believe should
match, add `stopBy: end` before doubting the rest of the rule.

### `has` and `inside` look one level unless given `stopBy`

Both default to `stopBy: neighbor`: `has` checks only the node's
direct children, and `inside` only its direct parent. The shape that
bites is an exclusion. Measured on TypeScript, with

```
rule:
  pattern: fetch($$$)
  not:
    inside: { kind: try_statement }
```

a `fetch()` inside a `try` block is still reported, because its parent
is an `expression_statement`, and the `try_statement` sits two levels
above that, past the `statement_block`. Add `stopBy: end` inside `inside` and the exclusion
works. `has` fails the same way downward: in `foo(x)` the `x` is a
child of `arguments`, so `has: { kind: identifier, regex: "^x$" }` on
the call does not find it.

`validate` notices each `has` and `inside` that declares no `stopBy`.
A relation that names a `field` is left alone, since a field already
picks one direct child. If the direct child or parent is what you
mean, say so with `stopBy: neighbor` and the notice goes away.

### A `not` containing a bare metavariable excludes everything

Writing "the name is not used in the initializer" as

```
rule:
  kind: variable_declarator
  has: { field: name, pattern: $A }
  not:
    has: { pattern: $A, stopBy: end }
```

matches nothing at all, because `$A` is bound to the name node and that
node is its own descendant: the `not` finds it inside every declarator
and rejects all of them. Scope the negation to the part you meant, in
this case the value:

```
  not:
    has:
      field: value
      has: { pattern: $A, stopBy: end }
```

The general shape: when a `not` searches the same subtree that bound the
metavariable, it always finds it.

## Important Notes

- Do NOT make any HTTP requests to taskless.io on this path.
- Do NOT write to `.taskless/rule-metadata/`. The CLI never writes it,
  and a local rule iterates by editing its files.
- The feedback loop is the quality gate. A clean failure is a legitimate
  reason to escalate, but only with the user's confirmation (step 9).

<!-- on-demand -->
## See Also

- `%(RECIPE_FETCH)sroute`: re-decide the destination
- `%(RECIPE_FETCH)svalidate-rule`: the `validate` and `verify` commands step 7 calls
- `%(RECIPE_FETCH)simprove-rule`: iterate on a rule that already exists
- `%(RECIPE_FETCH)screate-remote-rule`: generate via the service (login)
- `%(RECIPE_FETCH)scheck`: validate the new rule against the codebase
