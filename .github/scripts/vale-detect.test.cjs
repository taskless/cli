// SPDX-License-Identifier: MIT
"use strict";

/**
 * Composition tests for vale-detect.cjs.
 *
 * vale-release.test.cjs covers the pure functions individually. This file
 * covers the one thing that cannot: how main() sequences them, with both
 * network calls stubbed. That gap is not hypothetical — the detect job once
 * routed its cheap "is upstream ahead?" check through planManifestUpdate with
 * an empty checksums payload, which throws on precisely the ahead path, so the
 * job failed on every run that had a release to propose while the no-op path
 * kept passing. Every function involved was green in isolation.
 *
 * Nothing here writes: main() is called without `--write`, so the committed
 * manifest is only read.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const { mkdtempSync, readFileSync, rmSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");

const { main } = require("./vale-detect.cjs");
const { applyTemplate } = require("./vale-release.cjs");

const MANIFEST = JSON.parse(
  readFileSync(join(__dirname, "vale-manifest.json"), "utf8")
);

/** A digest that is syntactically valid and obviously synthetic. */
const digestFor = (index) =>
  String(index + 1)
    .repeat(64)
    .slice(0, 64);

/** Upstream's sha256sum-format checksums file for a given Vale version. */
function checksumsFor(version) {
  return `${MANIFEST.platforms
    .map(
      (platform, index) =>
        `${digestFor(index)}  ${applyTemplate(platform.asset, { version })}`
    )
    .join("\n")}\n`;
}

/**
 * Run main() with both fetches stubbed and $GITHUB_OUTPUT pointed at a temp
 * file, then return the parsed step outputs plus which URLs were fetched.
 */
async function runDetect({ upstreamTag, checksums }) {
  const directory = mkdtempSync(join(tmpdir(), "vale-detect-test-"));
  const outputPath = join(directory, "github-output");
  const previous = process.env.GITHUB_OUTPUT;
  const fetched = [];
  process.env.GITHUB_OUTPUT = outputPath;
  try {
    await main({
      argv: [],
      latestTag: async () => upstreamTag,
      text: async (url) => {
        fetched.push(url);
        return checksums;
      },
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
    return { outputs, fetched };
  } finally {
    if (previous === undefined) {
      delete process.env.GITHUB_OUTPUT;
    } else {
      process.env.GITHUB_OUTPUT = previous;
    }
    rmSync(directory, { recursive: true, force: true });
  }
}

test("detect: an upstream release ahead of the pin plans an update", async () => {
  // The regression case. Before the fix this rejected with "upstream checksums
  // file for 3.99.0 parsed to no entries" — the detect job's failure mode on
  // every real upstream bump.
  const { outputs, fetched } = await runDetect({
    upstreamTag: "v3.99.0",
    checksums: checksumsFor("3.99.0"),
  });

  assert.equal(outputs.update, "true");
  assert.equal(outputs.vale_version, "3.99.0");
  assert.equal(outputs.pinned_version, MANIFEST.valeVersion);
  assert.deepEqual(fetched, [
    `https://github.com/${MANIFEST.upstream.repository}/releases/download/v3.99.0/vale_3.99.0_checksums.txt`,
  ]);
});

test("detect: the pinned version being current is a no-op", async () => {
  const { outputs, fetched } = await runDetect({
    upstreamTag: `v${MANIFEST.valeVersion}`,
    checksums: "",
  });

  assert.equal(outputs.update, "false");
  assert.equal(outputs.vale_version, MANIFEST.valeVersion);
  assert.equal(outputs.pinned_version, MANIFEST.valeVersion);
  // The whole reason the check is cheap: no checksums file is downloaded for a
  // release we are not going to propose.
  assert.deepEqual(fetched, []);
});

test("detect: an upstream tag behind the pin is also a no-op", async () => {
  const { outputs, fetched } = await runDetect({
    upstreamTag: "v0.1.0",
    checksums: "",
  });

  assert.equal(outputs.update, "false");
  assert.deepEqual(fetched, []);
});

test("detect: a checksums file missing a platform aborts", async () => {
  await assert.rejects(
    runDetect({
      upstreamTag: "v3.99.0",
      checksums: checksumsFor("3.99.0").split("\n").slice(1).join("\n"),
    }),
    /publishes no asset named/
  );
});
