## 1. Spec

- [x] 1.1 Dry-run `pnpm openspec archive runtime-entitlement-withheld` against a
      WIP commit and confirm every scenario title in `cli-check`,
      `cli-rule-reconciliation`, and `cli-generated-rule-delivery` survives, plus
      the added ones. The `cli-check` exit-code requirement is MODIFIED under its
      unchanged title and restates all three standing scenarios.

## 2. Parse the entitlement

- [x] 2.1 Add a `parseEntitlement(value: unknown)` normalizer beside
      `reconcile` returning `Entitlement | undefined` per design decision 3
      (`runtimeSignatures === false` only; drop `withheld` entries without a
      string `file`; keep `upgradeUrl` only as an absolute `https:` URL).
- [x] 2.2 Carry `entitlement?: Entitlement` on `ReconcileResponse`, populated by
      `reconcile`.
- [x] 2.3 Surface `entitlement` on `RestoreOutcome` `ok` from the raw restore
      body with the same normalizer; do not hand-widen the generated type.
- [x] 2.4 Unit-test the normalizer: absent, `true`, `false` with and without
      `withheld`, malformed entries, non-https and relative URLs.

## 3. Check fails and explains

- [x] 3.1 Split `selectBlessedRuntimeRules`' non-`run` rules into
      entitlement-withheld (reported path in `entitlement.withheld`) and the
      rest; give the former the plan skip reason and keep today's reason for the
      latter.
- [x] 3.2 Exclude entitlement-withheld rules from restore targets (the server
      already omits them from `missing`; guard anyway so an `unsafe` listing
      cannot race a withhold into a repair).
- [x] 3.3 Carry the normalized entitlement on `RuntimePlan`, and add one plan
      notice naming the withheld rules, reason, and upgrade URL.
- [x] 3.4 In `check`, force exit code 1 and `success: false` when the plan's
      entitlement has a non-empty `withheld`; add the optional `entitlement`
      field to `schemas/check.ts` and emit it under `--json`.
- [x] 3.5 Tests: withheld-only run exits 1 with the notice; mixed run executes
      blessed rules and still exits 1; no `entitlement` is byte-identical to
      today; `runtimeSignatures: false` with empty `withheld` exits 0; degrade
      paths unchanged.

## 4. Write-time warnings

- [ ] 4.1 Restore notice in `repairWithheldRules`: when the restore outcome
      carries `runtimeSignatures: false`, replace the "blessed through the
      ordinary path" sentence with one saying the bytes were restored but will
      not run on the current plan.
- [ ] 4.2 `rule create` / `rule improve`: when the generated status carries
      `runtimeSignatures: false` and a written rule is a runtime rule, push the
      warning into `notices` (read defensively off the body until the schema
      carries it).
- [ ] 4.3 Tests for both, including static rules and legacy responses emitting
      nothing.

## 5. Docs and release

- [ ] 5.1 Update `agent/check.md` and `agent/ci.md`: a withheld runtime rule
      exits 1 with `entitlement` in `--json`, and a CI recipe should report it
      as a plan problem rather than a findings failure.
- [ ] 5.2 Changeset (`patch`, pre-1.0) stating the exit-code change and what a
      CI owner does about it.
- [ ] 5.3 `pnpm typecheck` and `pnpm lint`.
- [ ] 5.4 Archive the change on this PR.

## 6. Follow-up, after taskless/taskless#207 deploys

- [ ] 6.1 Regenerate `api.schema.json` / `api.d.ts` and replace the defensive
      reads in 2.3 and 4.2 with the typed field. May land as its own PR.
      Do not regenerate before the cloud restores `signature` on the
      config-based (static) file sets: the live schema drops it today as an
      interim state, and a refresh now would vendor that gap.
