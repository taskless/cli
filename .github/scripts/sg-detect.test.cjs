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
const { mkdtempSync, readFileSync, rmSync, writeFileSync } = require("node:fs");
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
async function runDetect({
  upstream,
  packageJson,
  packageJsonSource,
  argv = [],
  release,
  wantNotes = false,
}) {
  const directory = mkdtempSync(join(tmpdir(), "sg-detect-test-"));
  const outputPath = join(directory, "github-output");
  const notesPath = join(directory, "release-notes.md");
  // --write rewrites the file on disk, so a test that exercises it needs a
  // package.json of its own. The committed one is never written to here.
  const packageJsonPath = join(directory, "package.json");
  if (packageJsonSource !== undefined) {
    writeFileSync(packageJsonPath, packageJsonSource);
  }
  const previous = process.env.GITHUB_OUTPUT;
  const releasesFetched = [];
  process.env.GITHUB_OUTPUT = outputPath;
  try {
    const comparison = await main({
      argv: wantNotes ? [...argv, "--notes-out", notesPath] : argv,
      latestVersion: async () => upstream,
      releaseFor: async (repository, tag) => {
        releasesFetched.push(`${repository}@${tag}`);
        return release;
      },
      packageJsonPath,
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
    // Read before the finally below removes the directory. `undefined` means
    // the script wrote nothing, which is a distinct answer from an empty file.
    let notesWritten;
    if (wantNotes) {
      try {
        notesWritten = readFileSync(notesPath, "utf8");
      } catch {
        notesWritten = undefined;
      }
    }
    const packageJsonWritten =
      packageJsonSource === undefined
        ? undefined
        : readFileSync(packageJsonPath, "utf8");
    return {
      comparison,
      outputs,
      notesWritten,
      releasesFetched,
      packageJsonWritten,
    };
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

test("sg-detect: --notes-out describes the bump upstream is proposing", async () => {
  const { notesWritten, releasesFetched } = await runDetect({
    upstream: "0.45.3",
    packageJson: pinnedAt("0.45.2"),
    release: {
      tag: "0.45.3",
      notes: "- feat: add min-severity cli",
      url: "https://github.com/ast-grep/ast-grep/releases/tag/0.45.3",
    },
    wantNotes: true,
  });

  // The tag is the bare npm version, not a `v`-prefixed one. Getting that wrong
  // degrades to a link rather than an error, so nothing else would catch it.
  assert.deepEqual(releasesFetched, ["ast-grep/ast-grep@0.45.3"]);
  assert.match(notesWritten, /^## Upstream release notes — 0\.45\.3$/m);
  assert.match(notesWritten, /^> - feat: add min-severity cli$/m);
});

test("sg-detect: --notes-out writes nothing, and asks nothing, when the pin is current", async () => {
  const { notesWritten, releasesFetched } = await runDetect({
    upstream: "0.45.2",
    packageJson: pinnedAt("0.45.2"),
    wantNotes: true,
  });

  assert.equal(notesWritten, undefined);
  assert.deepEqual(releasesFetched, []);
});

/**
 * The version comes from npm and the notes come from GitHub, so a tag npm has
 * and GitHub does not is a real state. The comparison has already succeeded by
 * then, and failing the run would throw that answer away.
 */
test("sg-detect: a version with no GitHub release still reports the bump", async () => {
  const { notesWritten, outputs } = await runDetect({
    upstream: "0.45.3",
    packageJson: pinnedAt("0.45.2"),
    release: undefined,
    wantNotes: true,
  });

  assert.equal(outputs.update, "true");
  assert.match(notesWritten, /Upstream published no release notes/);
  assert.match(
    notesWritten,
    /^https:\/\/github\.com\/ast-grep\/ast-grep\/releases$/m
  );
});

test("sg-detect: --json refuses to be combined with --notes-out", async () => {
  await assert.rejects(
    runDetect({
      upstream: "0.45.3",
      packageJson: pinnedAt("0.45.2"),
      argv: ["--json"],
      wantNotes: true,
    }),
    /cannot be combined with --notes-out/
  );
});

/** A package.json shaped like the real one: prettier-formatted, mixed fields. */
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

test("sg-detect: --write bumps every pin in the file on disk", async () => {
  const { packageJsonWritten, outputs } = await runDetect({
    upstream: "0.45.3",
    packageJson: pinnedAt("0.45.2"),
    packageJsonSource: sourcePinnedAt("0.45.2"),
    argv: ["--write"],
  });

  assert.equal(outputs.update, "true");
  assert.doesNotMatch(packageJsonWritten, /0\.45\.2/);
  assert.equal(packageJsonWritten.match(/0\.45\.3/g).length, 3);
});

test("sg-detect: --write leaves the file alone when the pin is current", async () => {
  const before = sourcePinnedAt("0.45.2");
  const { packageJsonWritten } = await runDetect({
    upstream: "0.45.2",
    packageJson: pinnedAt("0.45.2"),
    packageJsonSource: before,
    argv: ["--write"],
  });

  assert.equal(packageJsonWritten, before);
});

/**
 * The half-applied bump this guard exists for. `packageJson` says there are
 * three pins; the source text on disk only spells two of them at the old
 * version, so a rewrite would leave a straggler behind — a different ast-grep
 * on one platform than on the others.
 */
test("sg-detect: a pin the rewrite cannot reach fails the run", async () => {
  await assert.rejects(
    runDetect({
      upstream: "0.45.3",
      packageJson: pinnedAt("0.45.2"),
      packageJsonSource: sourcePinnedAt("0.45.2").replace(
        '"@ast-grep/cli-linux-x64-gnu": "0.45.2"',
        '"@ast-grep/cli-linux-x64-gnu": "0.45.1"'
      ),
      argv: ["--write"],
    }),
    /expected to rewrite 3 @ast-grep\/cli\* pins, rewrote 2/
  );
});

test("sg-detect: --json refuses to be combined with --write", async () => {
  await assert.rejects(
    runDetect({
      upstream: "0.45.3",
      packageJson: pinnedAt("0.45.2"),
      argv: ["--json", "--write"],
    }),
    /cannot be combined with/
  );
});
