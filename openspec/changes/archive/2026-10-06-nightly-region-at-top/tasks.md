## 1. Spec

- [x] 1.1 Restate "A published nightly is announced on the pending release pull
      request" in full as a MODIFIED block under its existing title, placing
      the region at the top of the description.
- [x] 1.2 Dry-run `openspec archive` and confirm every prior scenario survives.

## 2. Implementation

- [x] 2.1 `upsertRegion` inserts the region at the top, below a leading stack
      region when there is one.
- [x] 2.2 Update the file header and the workflow header comment, and drop the
      note about the two writers disagreeing, which no longer holds.

## 3. Tests

- [x] 3.1 Rewrite the placement tests from "at the end" to "at the top".
- [x] 3.2 Cover a region above a stack region (moved below it) and a stack
      region that is not leading (ignored).
- [x] 3.3 Assert that `canonicalizeBody` in `stack-breadcrumb.cjs` leaves an
      annotated body unchanged.
