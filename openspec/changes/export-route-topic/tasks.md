# Tasks

One PR, alongside the export it describes.

## 1. Export it

- [x] 1.1 Move `route` from `INTERNAL_TOPICS` to `TOPICS`, and rewrite both doc comments so the old justification does not stand next to the new behaviour
- [x] 1.2 Confirm the completeness check still holds: the topic moved between lists rather than appearing or vanishing

## 2. Say so in the spec

- [x] 2.1 Amend the exported-topics requirement to cover the chooser as well as the destinations
- [x] 2.2 Record why the withholding argument failed, in the requirement rather than only in a commit message. It was tried in production and produced a generator that could not name `vale`
- [x] 2.3 Carry every existing scenario into the MODIFIED delta, and verify by archiving on a scratch commit. A delta replaces a requirement rather than patching it
- [x] 2.4 Keep the requirement's TITLE unchanged. **Measured**: `openspec archive` matches a MODIFIED block to the standing requirement by title, so renaming it applies nothing — the standing text survives untouched and the delta is discarded, while `openspec validate --strict` still passes. The amended framing lives in the body instead

## 3. Make the export usable by the consumer asking for it

- [x] 3.1 Add `mechanics: false`, which replaces the two CLI-running steps with a statement of what the caller supplies. `invocation` could not do this job: it substitutes a binary NAME inside a command, so a consumer with no CLI setting it to a phrase renders `Run: <phrase> detect --json` — an instruction to execute something that does not parse
- [x] 3.2 Keep the evidence rather than dropping the steps. The routing criteria are stated in terms of linters, languages, rule styles, `loggedIn` and `ghOwner`, so a consumer that reads "nothing here" loses the inputs and not just the commands
- [x] 3.3 Render the steps as whole blocks through the variable table rather than stripping them afterwards, so the default can be proved unchanged. **Measured byte-identical**: 18161 bytes before and after, `diff` clean
- [x] 3.4 Point `TASKLESS_CLI` and the new blocks at one invocation resolver, so the command inside a step and the command elsewhere in the recipe cannot disagree
- [x] 3.5 Absorb each step's connective into the substitution. Replacing only the command left `This returns` with nothing to refer to and `and note` as a sentence fragment — a malformed rendering, which is the defect this option removes rather than relocates. Asserted by a test rather than read once

## 4. Close out

- [ ] 4.1 Archive the change
