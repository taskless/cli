// SPDX-License-Identifier: MIT
"use strict";

/**
 * Tests for vale-gate.cjs — the decision that keeps an unrelated edit to
 * vale-manifest.json from publishing six packages.
 *
 * The interesting cases are all "what does the registry already have", so the
 * registry is stubbed throughout and nothing here touches the network. The
 * committed manifest is only read.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const { mkdtempSync, readFileSync, rmSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");

const { coversVersion, planPublish, main } = require("./vale-gate.cjs");

const MANIFEST = JSON.parse(
  readFileSync(join(__dirname, "vale-manifest.json"), "utf8")
);
const PINNED = MANIFEST.valeVersion;
const PACKAGES = MANIFEST.platforms.map((platform) => platform.package);

/** A registry stub answering from a {package: [versions]} table. */
const registry = (table) => async (packageName) => table[packageName] ?? [];

const allPublished = () =>
  Object.fromEntries(
    PACKAGES.map((name) => [name, [`${PINNED}-20260101000000`]])
  );

test("coversVersion matches the bare version and this workflow's stamps", () => {
  assert.equal(coversVersion(["3.17.1"], "3.17.1"), true);
  assert.equal(coversVersion(["3.17.1-20260810000724"], "3.17.1"), true);
  assert.equal(coversVersion([], "3.17.1"), false);
  assert.equal(coversVersion(["3.17.0", "3.16.9"], "3.17.1"), false);
});

test("coversVersion does not treat a longer version as covering a shorter one", () => {
  // Without the `-` separator, pinned "3.1" would read 3.1.1 as covered and a
  // real upstream bump would be silently skipped.
  assert.equal(coversVersion(["3.1.1"], "3.1"), false);
  assert.equal(coversVersion(["3.17.10"], "3.17.1"), false);
});

test("publishes when nothing is on the registry yet (pre-bootstrap)", () => {
  const plan = planPublish({
    manifest: MANIFEST,
    publishedByPackage: {},
    forced: false,
  });
  assert.equal(plan.shouldPublish, true);
  assert.equal(plan.reason, "missing");
  assert.deepEqual(plan.missing, PACKAGES);
});

test("skips when every package already carries the pinned version", () => {
  const plan = planPublish({
    manifest: MANIFEST,
    publishedByPackage: allPublished(),
    forced: false,
  });
  assert.equal(plan.shouldPublish, false);
  assert.equal(plan.reason, "already-published");
  assert.deepEqual(plan.missing, []);
});

test("publishes when the set is only partially published", () => {
  const published = allPublished();
  delete published[PACKAGES[3]];
  const plan = planPublish({
    manifest: MANIFEST,
    publishedByPackage: published,
    forced: false,
  });
  assert.equal(plan.shouldPublish, true);
  assert.deepEqual(plan.missing, [PACKAGES[3]]);
});

test("an explicit dispatch publishes even when everything is already out", () => {
  const plan = planPublish({
    manifest: MANIFEST,
    publishedByPackage: allPublished(),
    forced: true,
  });
  assert.equal(plan.shouldPublish, true);
  assert.equal(plan.reason, "forced");
});

test("main writes should_publish=false when the version is already out", async () => {
  const directory = mkdtempSync(join(tmpdir(), "vale-gate-"));
  const outputFile = join(directory, "output");
  const previous = process.env.GITHUB_OUTPUT;
  process.env.GITHUB_OUTPUT = outputFile;
  try {
    const plan = await main({ argv: [], published: registry(allPublished()) });
    assert.equal(plan.shouldPublish, false);
    assert.match(readFileSync(outputFile, "utf8"), /should_publish=false/);
  } finally {
    if (previous === undefined) delete process.env.GITHUB_OUTPUT;
    else process.env.GITHUB_OUTPUT = previous;
    rmSync(directory, { recursive: true, force: true });
  }
});

test("main writes should_publish=true when --force is passed", async () => {
  const directory = mkdtempSync(join(tmpdir(), "vale-gate-"));
  const outputFile = join(directory, "output");
  const previous = process.env.GITHUB_OUTPUT;
  process.env.GITHUB_OUTPUT = outputFile;
  try {
    const plan = await main({
      argv: ["--force"],
      published: registry(allPublished()),
    });
    assert.equal(plan.shouldPublish, true);
    assert.match(readFileSync(outputFile, "utf8"), /should_publish=true/);
  } finally {
    if (previous === undefined) delete process.env.GITHUB_OUTPUT;
    else process.env.GITHUB_OUTPUT = previous;
    rmSync(directory, { recursive: true, force: true });
  }
});

test("a 404 package reads as unpublished rather than failing the gate", async () => {
  // fetchPublishedVersions maps 404 -> []; the stub models that contract.
  const plan = await main({ argv: [], published: registry({}) });
  assert.equal(plan.shouldPublish, true);
  assert.deepEqual(plan.missing, PACKAGES);
});
