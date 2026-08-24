---
"@taskless/cli": patch
---

Fail `test` for an ast-grep rule that never demonstrates it can fire.

`verify` checked that a rule's `-test.yml` existed and never read what was in
it, and `ast-grep test` reports an empty `invalid:` bucket as `1 passed; 0
failed` and exits zero. A rule whose fixtures were all `valid:` therefore
reported `ok: true, ran: true` while `check` found nothing anywhere — verified
looking verified, having proved nothing. `test` now counts the `valid:` and
`invalid:` entries across every test file a rule owns and requires both, which
is the rule Vale fixtures have always been held to.

**This rejects rules that passed before.** Any sg rule with an empty or absent
`invalid:` bucket now fails `test` until a fixture is added that the rule
actually matches. That is the intended effect: adding one is how the underlying
mistake surfaces.

The mistake that prompted this is worth knowing about, because the pattern
looks correct. A trailing `$$$` next to a comma does not mean "zero or more" —
the comma is itself an AST node, and under ast-grep's default `smart`
strictness every node in the pattern must match, so `fetch($URL, $$$REST)`
never matches `fetch(url)` and silently starts at two arguments. A leading
`$$$` is worse: `foo($$$, $A)` collapses to exactly one argument. Upstream
considers this intended and 0.45.2 behaves identically, so there is no version
to upgrade to; write the pattern as an object with `strictness: ast` to ignore
the separator, or use `any:` with one branch per arity. `verify --schema` now
carries a worked example, and the behaviour is pinned against the vendored
binary so a bump that changes it fails loudly.
