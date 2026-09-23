## 1. Implementation

- [x] 1.1 Move every in-directory edit ahead of the directory rename, so the
      rename is the commit point.
- [x] 1.2 Make `renameRuleFile` finish a rename interrupted between the file
      rename and the `id:` rewrite.
- [x] 1.3 Make the fixture predicate skip a name already at the target prefix,
      rewriting only its `id:`.
- [x] 1.4 Commit file rewrites by renaming a temporary sibling.

## 2. Tests

- [x] 2.1 Inject a crash at three named `rename` destinations, resume, and
      assert directory, fixture name and `id:` all agree.
- [x] 2.2 Prove the crash-resume and double-suffix cases fail against the
      previous source.
- [x] 2.3 Keep the double-run snapshot idempotency coverage passing.

## 3. Spec

- [x] 3.1 ADD the crash-resilience requirement to `cli-taskless-bootstrap`.
- [x] 3.2 Dry-run `openspec archive` and compare requirement and scenario
      counts before and after.
