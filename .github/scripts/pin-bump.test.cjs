// SPDX-License-Identifier: MIT
"use strict";

/**
 * Tests for pin-bump.cjs.
 *
 * Two properties matter here and neither is about the happy path. The rewrite
 * must not touch a package it was not asked about, and it must agree with the
 * caller's own enumeration about what counts as a pin — a disagreement there
 * leaves a straggler at the old version, which for optional-dependency platform
 * packages means a different binary on one platform than on the others.
 */

const test = require("node:test");
const assert = require("node:assert/strict");

const { bumpPins } = require("./pin-bump.cjs");

/** The boundary-aware pattern sg-detect.cjs enumerates its pins with. */
const AST_GREP = /^@ast-grep\/cli(-|$)/;

const sourcePinnedAt = (version) =>
  `${JSON.stringify(
    {
      name: "@taskless/cli",
      dependencies: { "@ast-grep/cli": version, zod: "^4.0.0" },
      optionalDependencies: {
        "@ast-grep/cli-darwin-arm64": version,
        "@ast-grep/cli-linux-x64-gnu": version,
      },
    },
    undefined,
    2
  )}\n`;

test("every pin moves and nothing else does", () => {
  const before = sourcePinnedAt("0.45.2");
  const { source, count } = bumpPins(before, {
    pattern: AST_GREP,
    from: "0.45.2",
    to: "0.45.3",
  });

  assert.equal(count, 3);
  assert.equal(source.match(/0\.45\.3/g).length, 3);
  assert.doesNotMatch(source, /0\.45\.2/);
  assert.match(source, /"zod": "\^4\.0\.0"/);
  // The formatting is untouched, so the diff a reviewer reads is the versions.
  assert.equal(before.split("\n").length, source.split("\n").length);
});

/**
 * The dots in a version are regular-expression metacharacters. Unescaped,
 * `0.45.2` also matches `0145.2`.
 */
test("the version is matched literally, not as a pattern", () => {
  const { count } = bumpPins('{ "@ast-grep/cli": "0145.2" }', {
    pattern: AST_GREP,
    from: "0.45.2",
    to: "0.45.3",
  });
  assert.equal(count, 0);
});

test("the same version under an unrelated package is left alone", () => {
  const { source, count } = bumpPins(
    '{ "some-other-tool": "0.45.2", "@ast-grep/cli": "0.45.2" }',
    { pattern: AST_GREP, from: "0.45.2", to: "0.45.3" }
  );
  assert.equal(count, 1);
  assert.match(source, /"some-other-tool": "0\.45\.2"/);
});

/**
 * The reason the caller passes a pattern rather than a prefix. A bare prefix
 * match treats `@ast-grep/clippy` as a pin because the string starts the same
 * way, while the `collectPins` it is paired with — anchored on `(-|$)` — does
 * not. The two would then disagree about what a pin is, and only the caller's
 * count check would notice.
 */
test("a package that merely starts with the prefix is not a pin", () => {
  const { source, count } = bumpPins(
    '{ "@ast-grep/clippy": "0.45.2", "@ast-grep/cli-darwin-arm64": "0.45.2" }',
    { pattern: AST_GREP, from: "0.45.2", to: "0.45.3" }
  );
  assert.equal(count, 1);
  assert.match(source, /"@ast-grep\/clippy": "0\.45\.2"/);
  assert.match(source, /"@ast-grep\/cli-darwin-arm64": "0\.45\.3"/);
});

test("the Vale prefix carries its boundary in the pattern", () => {
  const pattern = /^@taskless\/vale-/;
  const { count } = bumpPins(
    '{ "@taskless/vale-linux-x64": "3.20.0-20260907164938", "@taskless/valet": "3.20.0-20260907164938" }',
    { pattern, from: "3.20.0-20260907164938", to: "3.21.0-20260914010203" }
  );
  assert.equal(count, 1);
});

/**
 * A /g regexp carries `lastIndex` between calls, so `.test()` alternates true
 * and false down the file and silently skips every other pin. Refusing it beats
 * stripping the flag: the caller uses that same constant for its own
 * enumeration, where the bug would be just as quiet.
 */
test("a stateful /g pattern is refused rather than silently skipping pins", () => {
  assert.throws(
    () =>
      bumpPins(sourcePinnedAt("0.45.2"), {
        pattern: /^@ast-grep\/cli(-|$)/g,
        from: "0.45.2",
        to: "0.45.3",
      }),
    /must not be \/g/
  );
});
