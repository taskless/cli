## 1. Spec

- [x] 1.1 Add the requirement to `cli-init` as an ADDED block, separate from
      the upgrade trailer, so no standing requirement is restated and the
      no-op scenario keeps holding.
- [x] 1.2 Dry-run `openspec archive` and compare the scenario count in
      `cli-init` before and after.

## 2. Detector

- [x] 2.1 Move `compareVersions` to `util/version-compare.ts`, unchanged.
- [x] 2.2 `install/pinned-cli.ts`: read `package.json`, report bounded pins
      whose ceiling is at or below the running version, in the three
      dependency fields and in scripts.
- [x] 2.3 Treat an absent or unparseable `package.json` as no pins.

## 3. Wiring

- [x] 3.1 Batch `init`: print the notice after the upgrade trailer, not gated
      on the run having changed anything; add `pinnedCli` to the envelope.
- [x] 3.2 Wizard: print the notice after the outro.
- [x] 3.3 When the run migrated, state the breakage as certain: name the
      schema version and `SCAFFOLD_VERSION_MISMATCH`, and put the bump in the
      same commit as `.taskless/`.

## 4. Recipe

- [x] 4.1 `update` topic v13: a step offering the bump, without making it
      silently, before recording the walk.

## 5. Tests

- [x] 5.1 Detector: the spec table in both directions, every dependency
      field, the nightly name, scripts, an unreadable `package.json`.
- [x] 5.2 Integration: notice order and content, `package.json` untouched,
      the no-op re-install, and the `--json` field.

## 6. Review fixes

- [x] 6.1 Judge a dependency by its installed version as well as its range.
- [x] 6.2 Compare exact and installed versions with semver precedence, so an
      older nightly of the same base is stale.
- [x] 6.3 Name each pin's target on the package that publishes it.
- [x] 6.4 Do not call a fresh install (migration from schema 0) an upgrade.
- [x] 6.5 `init` recipe topic v3: `pinnedCli` in the envelope and field list,
      the stop rule, and a bump step.
- [x] 6.6 Script regex: left boundary, punctuation-terminated versions, one
      report per repeated pin.
- [x] 6.7 Tests: the ordering guard, wizard coverage, fresh install, nightly
      ordering, installed versions.
