#!/usr/bin/env node
// SPDX-License-Identifier: MIT
"use strict";

/**
 * Move a family of exact dependency pins from one version to another, in the
 * package.json SOURCE TEXT rather than in a parsed object.
 *
 * Shared by the two upgrade detectors — ast-grep's and Vale's — because the
 * rewrite is the same operation on a different prefix, and because the count
 * check below is the kind of guard that is worth having exactly one of.
 *
 * WHY TEXT AND NOT JSON. Parsing and re-serializing would reformat a file this
 * repository formats with prettier, and it would do so in CI, where no
 * `lint-staged` runs to normalize it back. The bump would then arrive as a
 * whole-file diff with six version strings buried in it. A targeted replacement
 * leaves every byte it did not have to touch, so the review is the versions.
 *
 * WHY THE COUNT IS RETURNED RATHER THAN ASSUMED. A pin the pattern fails to
 * match is the failure that matters: it leaves a straggler at the old version,
 * and because these platform packages are selected by optional dependency, a
 * straggler is a DIFFERENT BINARY on one platform than on the others. Callers
 * compare this count against the pins they independently enumerated and abort
 * on a mismatch, so the two disagreeing is a failed run rather than a
 * half-applied upgrade that looks fine in review.
 */

/** Escape a version for literal use in a regular expression. */
function escapeLiteral(text) {
  return String(text).replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);
}

/**
 * @param source  the package.json text
 * @param prefix  package-name prefix, e.g. `@taskless/vale-` or `@ast-grep/cli`
 * @param from    the exact version every matching pin currently holds
 * @param to      the exact version to write
 */
function bumpPins(source, { prefix, from, to }) {
  const pattern = new RegExp(
    `("${escapeLiteral(prefix)}[^"]*"\\s*:\\s*")${escapeLiteral(from)}(")`,
    "g"
  );
  let count = 0;
  const bumped = source.replaceAll(pattern, (_match, head, tail) => {
    count += 1;
    return `${head}${to}${tail}`;
  });
  return { source: bumped, count };
}

module.exports = { bumpPins, escapeLiteral };
