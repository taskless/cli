---
"@taskless/cli": patch
---

`taskless check` now marks every notice it prints. A run with more than one advisory used to print the first behind a `Notice: ` marker and the rest as bare, unindented lines with nothing identifying them as notices — so a Vale config advisory sitting beside Vale's own diagnostic read as stray output. `verify` had the same defect and it was fixed earlier; `check` did not get the fix until now.

The cause was that notices were joined into one string before they reached the renderer, so `check --json` also published array elements that were several notices glued together, with no separator a consumer could rely on to split them back apart. Notices are now carried as a list from producer to output: in `check --json` the `notices` array keeps its name and type, and only its element boundaries change — one element is now exactly one notice.

**What a consumer crosses:** the optional `notice` string on `verify --json` and `test --json` per-rule results is now a `notices` array of strings, present and empty rather than absent when there is nothing to say. The same replacement applies to the exported `verifyOutputSchema` (its `schema` layer) and `valeVerifyOutputSchema`. Read `notices` where you read `notice`, and render one marker per element instead of splitting on a separator. It was replaced rather than mirrored because a joined `notice` kept alongside would preserve the convention this change removes, and nothing ever published the separator that would have made splitting it safe. `check --json` consumers need change nothing.
