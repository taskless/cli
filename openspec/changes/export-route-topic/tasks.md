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

## 3. What the consumer still does not get

- [ ] 3.1 The rendered recipe instructs a reader to run two CLI commands. `invocation` substitutes the binary name, so a consumer setting it to a phrase gets a malformed instruction rather than a clean absence. Decide whether a render option that drops those steps ships with the export or follows it
- [ ] 3.2 If it follows, say so where a consumer reads it, so the limitation is documented rather than discovered

## 4. Close out

- [ ] 4.1 Archive the change
