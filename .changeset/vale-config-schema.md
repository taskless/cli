---
"@taskless/cli": patch
---

`verify` validates a Vale rule's `.vale.ini` against a schema and names the constraint each rejection violates. The config is parsed into an ordered structure and checked there: an assignment above the first matcher, a matcher without its `tskl) rule` breadcrumb, a key naming another rule, a value other than `YES`/`NO`, a `BasedOnStyles` assignment with any value, a config with no matcher or no `YES`, and a `NO` matcher that precedes every `YES` (both judged by each matcher's final verdict, so a `YES` a later `NO` in the same matcher overrides does not count) are each rejected under a `vale-config-*` constraint that `verify --json` reports in `violations[]` and `reference.json` publishes. A repeated key, a `[*]` matcher, and a `.taskless/**` matcher are reported as a notice without failing the rule.

`check` runs the same schema before assembling the Vale run config, and a rejected config refuses the Vale engine for that run: the failure names the rule and the line, reaches the exit code, and ast-grep still runs. A rule is never silently left out of the assembled config. Accepted configs are written verbatim under their breadcrumb, so the one string edit assembly used to make (dropping a copied-in `StylesPath`) is gone; that line is now a rejection. Advisories reach `check`'s notices. To find every rejected line at once, run `taskless verify`.

This is still `patch`. The package is `0.y.z`, and every config the schema refuses was already being misread by Vale: a rule enabled nowhere with a `W101` on stderr, a rule silently overriding a neighbour, a disable the following enable cancelled. The release surfaces a defect the consumer already had rather than introducing one, the same call as linting files over 128 KB again in 0.11.3.
