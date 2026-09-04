# Design

## The shape

`ReferenceRule.tests` goes from `Array<{ path, content }>` to:

```jsonc
// runtime — a case is a directory the check is given as its root
"tests": {
  "grouping": "case-directories",
  "files": [
    { "path": ".tests/pass/declared/src/config.ts", "content": "…" },
    { "path": ".tests/pass/declared/.env",          "content": "…" },
    { "path": ".tests/fail/undeclared/src/config.ts", "content": "…" },
    { "path": ".tests/fail/undeclared/.env",          "content": "…" }
  ],
  "cases": [
    { "bucket": "pass", "name": "declared", "path": ".tests/pass/declared",
      "files": [".tests/pass/declared/src/config.ts", ".tests/pass/declared/.env"] },
    { "bucket": "fail", "name": "undeclared", "path": ".tests/fail/undeclared",
      "files": [".tests/fail/undeclared/src/config.ts", ".tests/fail/undeclared/.env"] }
  ]
}

// vale — a case is one document
"tests": {
  "grouping": "case-documents",
  "files": [ { "path": ".tests/pass/README.md", "content": "…" }, … ],
  "cases": [
    { "bucket": "pass", "name": "README.md", "path": ".tests/pass/README.md",
      "files": [".tests/pass/README.md"] }, …
  ]
}

// sg — grouping is ast-grep's, inside the file
"tests": {
  "grouping": "ast-grep-test",
  "files": [ { "path": ".tests/no-eval-call-test.yml", "content": "…" } ]
}
```

Three decisions are worth the words.

**`cases[].files` names paths rather than repeating content.** Content lives in
`tests.files`, once. Two copies of a fixture's bytes in one document is a thing
that can disagree with itself, and the case that a consumer would then have to
decide which copy is authoritative is not one worth creating. Every entry
resolves against `tests.files`, and a test asserts it.

**`cases[].path` is what the runner is handed, and its type differs by engine
because the engines differ.** For `runtime` it is a directory: the harness calls
`executeRuntimeRule(root, rule)` with exactly that path, so a case's files are
the tree beneath it. For `vale` it is the document itself, because Vale lints
files and a bucket is one directory deep. `grouping` is what tells a consumer
which it is looking at, which is the whole point of publishing it.

**`bucket` is `pass`/`fail`, matching the directories.** Not ast-grep's
`valid`/`invalid`: those are keys in a file we are deliberately not restating,
and the corpus should use the vocabulary of the layout it is describing. The
cloud team has already adopted `pass`/`fail` on their side.

## Where the rule goes

The corpus publishes paths relative to a rule directory, and until now it never
said what that directory is. A consumer materializing a rule — ours, to run
`taskless verify` against, or its own generated answer to the same prompt, which
has to go somewhere the CLI will look — had to assume `.taskless/rules/<engine>/<id>/`.
Nothing in the file states it.

```jsonc
"layout": {
  "rulesRoot": ".taskless/rules",
  "ruleDirectory": ".taskless/rules/{engine}/{id}",
  "testsDirectory": ".tests",
  "engines": {
    "sg":      { "ruleFile": "{id}.yml", "ruleConfigFile": null,        "capturesDirectory": null },
    "vale":    { "ruleFile": "{id}.yml", "ruleConfigFile": ".vale.ini", "capturesDirectory": null },
    "runtime": { "ruleFile": "check.ts", "ruleConfigFile": null,        "capturesDirectory": "captures" }
  }
}
```

and on each entry, the same values already resolved:

```jsonc
{ "engine": "runtime", "id": "env-keys-declared",
  "directory": ".taskless/rules/runtime/env-keys-declared",
  "ruleFile": "check.ts", … }
```

**Both, and not one or the other.** The resolved `directory` needs no
substitution and cannot be got wrong, which is what a consumer wants for the
three rules in front of it. The template is what a consumer needs for a rule
that is not in the corpus at all — the one it just generated — and stating only
the resolved paths would leave three examples from which the pattern has to be
inferred, which is the same guess in a smaller costume.

**`ruleFile` resolved per entry answers a question the file lists cannot.**
`rule` carries `check.ts` and `captures/env-read.yml` as a flat list with no
indication which is the rule and which is supporting material. That was
assumable while the corpus held one rule per engine and unassumable the moment
it does not.

**`{engine}` and `{id}` are the only placeholders, and they are literal.** Not a
path DSL. `ruleFile` differs by engine as a function of the id — `{id}.yml` for
`sg` and `vale`, a constant `check.ts` for `runtime`, because a runtime rule is
a program rather than a document — and that difference is precisely the thing
worth publishing rather than describing.

**Everything is generated from `ENGINE_LAYOUTS`**, the table the CLI itself
dispatches on, so the block cannot describe a layout the CLI does not
implement. `@taskless/cli/layout` already publishes that table as a module and
was created for this exact complaint from the Cloud Generator team; a JSON
consumer should not have to import a bundle to learn what its paths are
relative to.

`.taskless` is the one value with nowhere to come from. It is a literal in about
fifteen places behind four constants that do not know about each other
(`CANONICAL_DIR` in `install/install.ts` and `install/canonical.ts`,
`TASKLESS_DIR` in `install/state.ts`, `TASKLESS_DIRECTORY` in `rules/scan.ts`
and `rules/vale/formats.ts`). One moves into `rules/layout.ts` beside the rest
of the table and `rulesRoot` reads it. Converging the other fourteen is a
tidy-up, and doing it inside a contract change would hide the contract change
inside a rename.

## Alternatives rejected

**Keep `tests` flat and add a sibling `cases` field.** Purely additive, so v1
consumers keep working. Rejected because it leaves the grouping stated twice —
once implicitly in the path prefixes, once explicitly — and the artifact would
have no way to say which is authoritative when they disagree. The consumer told
us a version bump is a signal they handle, so the cost of the clean shape is one
they have already priced.

**Case-relative file paths (`src/config.ts`, `.env`), as the issue sketched.**
Rejected because it loses where the file lives in our tree, and `vale`'s case is
a document rather than a directory, so there is nothing coherent for its one
file to be relative _to_. Publishing `path` and rule-relative file paths gives a
consumer both readings: strip the published prefix and you have the case-relative
form, with no layout knowledge involved.

**Synthesise `sg` cases from `valid:`/`invalid:`.** Rejected for now — see the
proposal. The YAML is what `ast-grep test` consumes, so extracting snippets
serves no run anybody makes.

## Constraint ids on verify output

`violations` is added alongside `errors` rather than replacing it:

```jsonc
{
  "engine": "sg",
  "ruleId": "no-eval-call",
  "ok": false,
  "errors": ["id: \"mismatched\" does not match the rule's directory …"],
  "violations": [
    {
      "constraintId": "sg-id-matches-directory",
      "message": "id: \"mismatched\" does not match the rule's directory …",
    },
  ],
}
```

**The message is repeated rather than joined by index.** An index join between
two arrays is a contract nobody can see, and it breaks the first time an error
is filtered or reordered on either side. Repeating the string makes the pairing
explicit and lets a consumer ignore `errors` entirely.

**Every `violations` message also appears in `errors`.** `errors` remains the
complete list; `violations` is the attributable subset. A consumer reading only
`errors` sees exactly what it sees today, which is what makes this additive.

**Internally, `errors` stays `string[]` and `violations` rides beside it.** The
first draft had every producer return `{ message, constraintId? }` and the JSON
boundary project both fields out of it, on the grounds that two parallel arrays
drift. Measured against the code, that trade inverts: `LayerResult.errors` is
consumed by 57 assertions across six test files, by `schemaLayer` shared with
the Vale path that has no constraints at all, and by the human renderer — so
the change would have been a large mechanical diff whose only purpose was to be
projected straight back into `errors: string[]` at the boundary, because the
published envelope keeps that shape either way.

The drift the first draft feared is real but local, and it is closed at the
site rather than by the type: every attributable failure is recorded through
one `violate()` call that writes both arrays, so a site cannot add a message to
one and forget the other. What the type could have prevented — threading two
lists separately through the layers — is not what this does.

`sg-fixture-id-matches-rule` needed one extra piece of state to attribute
honestly. It surfaces as the same "has no fixtures" shortfall a rule with no
cases at all produces, and those two want different advice: one author has
written nothing, the other has a file sitting right there that is silently not
counted. `fixtureCoverage` already skips a test file whose own `id:` names
another rule, so it now reports that it did, and only that case is attributed.
Without it the constraint could only have been attributed by guessing, which
this design rejects everywhere else.
