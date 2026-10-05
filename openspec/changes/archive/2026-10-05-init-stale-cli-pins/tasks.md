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
