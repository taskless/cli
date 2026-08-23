Delivery shape: **single PR**. The change is recipe text plus a spec delta — there is no intermediate state that ships a half-migrated product, and nothing here can land independently of the rest.

## 1. Recipe

- [x] 1.1 Bump the `onboard.txt` header from `topic v1` to `topic v2` — required by the canonical recipe template in `openspec/specs/cli-agent/spec.md`
- [x] 1.2 Add a precondition stating that the routing criterion lives in `route` and is read rather than restated, so a later editor does not "helpfully" inline the table
- [x] 1.3 Insert the new step 2 (fetch `agent route`, run `detect --json`), renumbering the steps below it. Say explicitly that the destination _command_ is not chosen here — the recipe is read for its criterion, but `route`'s own steps 5-7 commit to a single destination for a single request, which is not what onboarding is doing yet
- [x] 1.4 Extend the bullet format to `- <name> [<destination>]: <description>` with worked examples covering more than one destination, and state that the annotation is provisional
- [x] 1.5 Note in the materialization step that `route` is already in context and needs re-fetching only if the session lost it
- [x] 1.6 Add `taskless agent detect` to `## See Also` and say what each of the two routing references is for

## 2. Spec

- [x] 2.1 Write the `cli-onboard` delta as a MODIFIED requirement carrying the full new requirement text — the enumerated list is normative, so an added item is a modification of the whole
- [x] 2.2 Fix the stale item directing materialization at `npx @taskless/cli help rule create`; `taskless help` no longer exists and the recipe routes through `route`
- [x] 2.3 Add scenarios for the route-first pass and the annotated bullet shape; keep the existing bullet-shape scenario's neighbours intact

## 3. Verification

- [x] 3.1 `pnpm openspec validate onboard-route-first --strict`
- [x] 3.2 `pnpm --filter @taskless/cli build` then `pnpm --filter @taskless/cli test` — the suite executes `dist/index.js`, so the build is not optional
- [x] 3.3 Confirm `taskless agent onboard` and `taskless onboard --force` still print identical bytes (covered by `test/onboard.test.ts`, but the assertion is only as good as a build having run)
- [x] 3.4 Add the changeset
