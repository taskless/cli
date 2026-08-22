// SPDX-License-Identifier: MIT
"use strict";

/**
 * Tests for update-badges.cjs.
 *
 * Both detect scripts are stubbed and the payload directory is a temp one, so
 * nothing here touches the network or the committed `.shields/` files.
 *
 * The rules under test are the two that are easy to get backwards: a run that
 * finds nothing new must not rewrite anything (every rewrite becomes a commit
 * to main, and a commit to main costs a Validate run and a nightly publish),
 * and the date must not be allowed to sit still forever, or a dead job renders
 * as a healthy one.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");

const { main, planBadge } = require("./update-badges.cjs");

const comparisonOf = (pinned, upstream) => ({
  pinned,
  upstream,
  ahead: pinned !== upstream,
});

/** Run main() against a temp directory seeded with `files`. */
async function run({ files = {}, vale, sg, now, argv = ["--write"] }) {
  const directory = mkdtempSync(join(tmpdir(), "update-badges-test-"));
  const silenced = console.log;
  console.log = () => {};
  try {
    for (const [name, contents] of Object.entries(files)) {
      writeFileSync(join(directory, name), contents);
    }
    const result = await main({
      argv,
      directory,
      now: new Date(now),
      detect: { vale: async () => vale, sg: async () => sg },
    });
    const read = (name) => {
      const path = join(directory, name);
      return existsSync(path)
        ? JSON.parse(readFileSync(path, "utf8"))
        : undefined;
    };
    return { ...result, vale: read("vale.json"), sg: read("sg.json") };
  } finally {
    console.log = silenced;
    rmSync(directory, { recursive: true, force: true });
  }
}

const badge = (message, color) =>
  `${JSON.stringify({ schemaVersion: 1, label: "vale", message, color }, null, 2)}\n`;

test("badges: an empty .shields writes both payloads", async () => {
  const result = await run({
    vale: comparisonOf("3.17.1", "3.18.0"),
    sg: comparisonOf("0.41.0", "0.41.0"),
    now: "2026-08-21T06:17:00Z",
  });

  assert.equal(result.changed, true);
  // The live case this shipped against: Vale pinned at 3.17.1 with 3.18.0
  // upstream is yellow, ast-grep level with upstream is green.
  assert.deepEqual(result.vale, {
    schemaVersion: 1,
    label: "vale",
    message: "3.17.1 · 2026-08-21",
    color: "yellow",
  });
  assert.deepEqual(result.sg, {
    schemaVersion: 1,
    label: "sg",
    message: "0.41.0 · 2026-08-21",
    color: "green",
  });
});

test("badges: nothing new upstream writes nothing", async () => {
  const result = await run({
    files: {
      "vale.json": badge("3.17.1 · 2026-08-19", "yellow"),
      "sg.json": badge("0.41.0 · 2026-08-19", "green").replace(
        '"vale"',
        '"sg"'
      ),
    },
    vale: comparisonOf("3.17.1", "3.18.0"),
    sg: comparisonOf("0.41.0", "0.41.0"),
    now: "2026-08-21T06:17:00Z",
  });

  assert.equal(result.changed, false);
  // Two days on, the recorded date is still the truth it was written with.
  assert.equal(result.vale.message, "3.17.1 · 2026-08-19");
});

test("badges: a date older than the staleness horizon is refreshed", async () => {
  const result = await run({
    files: { "vale.json": badge("3.17.1 · 2026-08-01", "yellow") },
    vale: comparisonOf("3.17.1", "3.18.0"),
    sg: comparisonOf("0.41.0", "0.41.0"),
    now: "2026-08-21T06:17:00Z",
  });

  assert.equal(result.changed, true);
  assert.equal(result.vale.message, "3.17.1 · 2026-08-21");
});

test("badges: bumping the pin turns the badge green and redates it", async () => {
  const result = await run({
    files: { "vale.json": badge("3.17.1 · 2026-08-20", "yellow") },
    vale: comparisonOf("3.18.0", "3.18.0"),
    sg: comparisonOf("0.41.0", "0.41.0"),
    now: "2026-08-21T06:17:00Z",
  });

  assert.deepEqual(result.vale, {
    schemaVersion: 1,
    label: "vale",
    message: "3.18.0 · 2026-08-21",
    color: "green",
  });
});

test("badges: without --write nothing is written but the answer is reported", async () => {
  const result = await run({
    vale: comparisonOf("3.17.1", "3.18.0"),
    sg: comparisonOf("0.41.0", "0.45.1"),
    now: "2026-08-21T06:17:00Z",
    argv: [],
  });

  assert.equal(result.changed, true);
  assert.equal(result.vale, undefined);
  assert.equal(result.sg, undefined);
});

test("badges: an unreadable payload is replaced rather than preserved", async () => {
  const result = await run({
    files: { "vale.json": "{ not json" },
    vale: comparisonOf("3.17.1", "3.18.0"),
    sg: comparisonOf("0.41.0", "0.41.0"),
    now: "2026-08-21T06:17:00Z",
  });

  assert.equal(result.vale.message, "3.17.1 · 2026-08-21");
});

test("badges: the payload carries only the shields endpoint schema", () => {
  // No `checkedAt` sidecar. Shields validates the payload it fetches, and a
  // record nobody reads is not a staleness signal anyway — the date is in the
  // message for exactly that reason.
  const planned = planBadge({
    label: "vale",
    comparison: comparisonOf("3.17.1", "3.18.0"),
    today: "2026-08-21",
    previous: undefined,
  });

  assert.deepEqual(Object.keys(planned), [
    "schemaVersion",
    "label",
    "message",
    "color",
  ]);
});

test("badges: a payload written the same day is left alone", () => {
  const previous = {
    schemaVersion: 1,
    label: "sg",
    message: "0.41.0 · 2026-08-21",
    color: "green",
  };

  assert.deepEqual(
    planBadge({
      label: "sg",
      comparison: comparisonOf("0.41.0", "0.41.0"),
      today: "2026-08-21",
      previous,
    }),
    previous
  );
});
