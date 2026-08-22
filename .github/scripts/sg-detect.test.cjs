// SPDX-License-Identifier: MIT
"use strict";

/**
 * Tests for sg-detect.cjs.
 *
 * The registry call is stubbed everywhere, so nothing here touches the network.
 * The committed packages/cli/package.json is read once, on purpose: the "the
 * repository's real pins are readable and exact" case is the one that fails
 * silently in production if someone loosens a pin to a range, and a fixture
 * would not notice.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const { mkdtempSync, readFileSync, rmSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");

const { collectPinnedVersion, isAhead, main } = require("./sg-detect.cjs");

const CLI_PACKAGE_JSON = JSON.parse(
  readFileSync(
    join(__dirname, "..", "..", "packages", "cli", "package.json"),
    "utf8"
  )
);

/** Run main() with the registry stubbed and $GITHUB_OUTPUT captured. */
async function runDetect({ upstream, packageJson, argv = [] }) {
  const directory = mkdtempSync(join(tmpdir(), "sg-detect-test-"));
  const outputPath = join(directory, "github-output");
  const previous = process.env.GITHUB_OUTPUT;
  process.env.GITHUB_OUTPUT = outputPath;
  try {
    const comparison = await main({
      argv,
      latestVersion: async () => upstream,
      packageJson,
    });
    const outputs = Object.fromEntries(
      readFileSync(outputPath, "utf8")
        .split("\n")
        .filter(Boolean)
        .map((line) => {
          const at = line.indexOf("=");
          return [line.slice(0, at), line.slice(at + 1)];
        })
    );
    return { comparison, outputs };
  } finally {
    if (previous === undefined) {
      delete process.env.GITHUB_OUTPUT;
    } else {
      process.env.GITHUB_OUTPUT = previous;
    }
    rmSync(directory, { recursive: true, force: true });
  }
}

const pinnedAt = (version) => ({
  dependencies: { "@ast-grep/cli": version },
  optionalDependencies: {
    "@ast-grep/cli-darwin-arm64": version,
    "@ast-grep/cli-linux-x64-gnu": version,
  },
});

test("sg-detect: the repository's own pins are exact and agree", () => {
  // Not a fixture. If someone changes a pin to `^0.41.0` or bumps one platform
  // without the others, the badge has no honest value to show and this is
  // where that is caught.
  assert.match(collectPinnedVersion(CLI_PACKAGE_JSON), /^\d+\.\d+\.\d+$/);
});

test("sg-detect: an upstream release ahead of the pin is reported", async () => {
  const { comparison, outputs } = await runDetect({
    upstream: "0.45.1",
    packageJson: pinnedAt("0.41.0"),
  });

  assert.deepEqual(comparison, {
    pinned: "0.41.0",
    upstream: "0.45.1",
    ahead: true,
  });
  assert.equal(outputs.update, "true");
  assert.equal(outputs.sg_version, "0.45.1");
  assert.equal(outputs.pinned_version, "0.41.0");
});

test("sg-detect: the pin being current is a no-op", async () => {
  const { comparison, outputs } = await runDetect({
    upstream: "0.41.0",
    packageJson: pinnedAt("0.41.0"),
  });

  assert.equal(comparison.ahead, false);
  assert.equal(outputs.update, "false");
});

test("sg-detect: an upstream version behind the pin is not ahead", async () => {
  const { comparison } = await runDetect({
    upstream: "0.40.9",
    packageJson: pinnedAt("0.41.0"),
  });

  assert.equal(comparison.ahead, false);
});

test("sg-detect: --json prints the comparison and nothing else", async () => {
  const lines = [];
  const original = console.log;
  console.log = (line) => lines.push(line);
  try {
    await runDetect({
      upstream: "0.45.1",
      packageJson: pinnedAt("0.41.0"),
      argv: ["--json"],
    });
  } finally {
    console.log = original;
  }

  assert.equal(lines.length, 1);
  assert.deepEqual(JSON.parse(lines[0]), {
    pinned: "0.41.0",
    upstream: "0.45.1",
    ahead: true,
  });
});

test("sg-detect: disagreeing pins abort rather than picking one", () => {
  assert.throws(
    () =>
      collectPinnedVersion({
        dependencies: { "@ast-grep/cli": "0.41.0" },
        optionalDependencies: { "@ast-grep/cli-darwin-arm64": "0.40.0" },
      }),
    /pins disagree/
  );
});

test("sg-detect: a range instead of an exact pin aborts", () => {
  assert.throws(
    () => collectPinnedVersion(pinnedAt("^0.41.0")),
    /not an exact major\.minor\.patch/
  );
});

test("sg-detect: no @ast-grep dependency at all aborts", () => {
  assert.throws(
    () => collectPinnedVersion({ dependencies: { typescript: "5.9.2" } }),
    /declares no @ast-grep\/cli\* dependency/
  );
});

test("sg-detect: an upstream prerelease on latest aborts loudly", () => {
  // Better a failed run than a badge silently comparing 0.41.0 against
  // something it cannot order.
  assert.throws(
    () => isAhead("0.41.0", "0.46.0-alpha.1"),
    /upstream ast-grep version is not an exact major\.minor\.patch/
  );
});

test("sg-detect: ordering is numeric, not lexical", () => {
  assert.equal(isAhead("0.9.0", "0.10.0"), true);
  assert.equal(isAhead("0.10.0", "0.9.0"), false);
  assert.equal(isAhead("1.0.0", "0.99.99"), false);
});
