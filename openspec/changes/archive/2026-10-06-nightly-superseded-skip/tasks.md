## 1. Spec

- [x] 1.1 Add "A superseded nightly is not published".
- [x] 1.2 Restate the version, gate, and announcement requirements in full as
      MODIFIED blocks under their existing titles.
- [x] 1.3 Dry-run `openspec archive` and confirm every prior scenario survives.

## 2. Implementation

- [x] 2.1 `nightly-pack.cjs`: a required `--date` on `--print-version`,
      rejected in pack mode, and `hasNewerNightly`.
- [x] 2.2 Workflow: stamp from `git log -1 --format=%cI`, check for a
      superseded build before publishing, and gate the breadcrumb on
      `published`.
- [x] 2.3 Breadcrumb: label the stamp as the commit time.
- [x] 2.4 Update the workflow header (D6) and the comments that assumed a
      clock stamp.

## 3. Tests

- [x] 3.1 `--date` is required, validated, and rejected in pack mode.
- [x] 3.2 An offset commit date stamps in UTC.
- [x] 3.3 `hasNewerNightly`: newer, older, equal, a lower base version, a bare
      string, and an unreadable version.
