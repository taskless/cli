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
 * WHY THE CALLER PASSES A PATTERN RATHER THAN A PREFIX.
 *
 * This used to take a bare string prefix and match any key starting with it,
 * while the `collectPins` it is paired with used a boundary-aware pattern
 * (`/^@ast-grep\/cli(-|$)/`). Two functions that are supposed to agree on what
 * counts as a pin disagreed on it, and only the `count !== pins.size` check
 * downstream kept that from mattering. Relying on a guard to paper over a
 * disagreement is not the same as not having one: the guard turns the
 * disagreement into a failed run, which is better than a wrong bump and worse
 * than the two agreeing in the first place.
 *
 * Taking the pattern means the caller hands BOTH functions the same constant,
 * so they cannot drift apart at all.
 *
 * @param source   the package.json text
 * @param pattern  anchored RegExp matching a package NAME, the same one the
 *                 caller enumerates pins with
 * @param from     the exact version every matching pin currently holds
 * @param to       the exact version to write
 */
function bumpPins(source, { pattern, from, to }) {
  // A /g regexp carries `lastIndex` between calls, so `.test()` would alternate
  // true and false down the file and silently skip every other pin. Refusing it
  // beats stripping the flag, because a caller passing /g also uses that same
  // constant for its own enumeration, where the bug would be just as quiet.
  if (pattern.global) {
    throw new Error(
      "the pin pattern must not be /g: a stateful lastIndex would skip pins"
    );
  }
  const matcher = new RegExp(
    `("([^"]+)"\\s*:\\s*")${escapeLiteral(from)}(")`,
    "g"
  );
  let count = 0;
  const bumped = source.replaceAll(matcher, (match, head, name, tail) => {
    if (!pattern.test(name)) {
      return match;
    }
    count += 1;
    return `${head}${to}${tail}`;
  });
  return { source: bumped, count };
}

module.exports = { bumpPins, escapeLiteral };
