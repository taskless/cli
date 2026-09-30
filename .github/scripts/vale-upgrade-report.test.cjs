// SPDX-License-Identifier: MIT
"use strict";

/**
 * Tests for vale-upgrade-report.cjs.
 *
 * The failure worth guarding against is a report that reads as reassurance
 * when nothing was checked. "No failures" and "no report", "no new readers"
 * and "could not ask", each pair must render differently, because #427 was a
 * pull request whose silence looked exactly like a pass.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const { mkdtempSync, readFileSync, rmSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");

const {
  COMPARE_FILE_CAP,
  formatReport,
  isReader,
  main,
  summarizeContract,
} = require("./vale-upgrade-report.cjs");

/** The shape vitest's JSON reporter writes, reduced to what is read. */
const vitestReport = (...failures) => ({
  numTotalTests: 204,
  testResults: [
    {
      name: "/w/packages/cli/test/vale-schema-contract.test.ts",
      assertionResults: [
        { status: "passed", fullName: "a passing test", failureMessages: [] },
        ...failures.map(([fullName, message]) => ({
          status: "failed",
          fullName,
          failureMessages: [`${message}\n    at somewhere (file.ts:1:1)`],
        })),
      ],
    },
  ],
});

const readers = (added, complete = true) => ({
  added,
  complete,
  url: "https://github.com/vale-cli/vale/compare/v3.22.0...v3.23.0",
});

const report = (overrides) =>
  formatReport({
    from: "3.22.0",
    to: "3.23.0",
    contract: summarizeContract(vitestReport()),
    readers: readers([]),
    ...overrides,
  });

test("contract: names each failure with its file and first message line", () => {
  const contract = summarizeContract(
    vitestReport([
      "Vale schema contract agrees with every recorded verdict",
      "AssertionError: scope/doc-leaf-standalone (scope: doc(h1)): recorded ignored, Vale 3.23.0 says accepted",
    ])
  );
  assert.equal(contract.total, 204);
  assert.deepEqual(contract.failed, [
    {
      file: "vale-schema-contract.test.ts",
      name: "Vale schema contract agrees with every recorded verdict",
      message:
        "AssertionError: scope/doc-leaf-standalone (scope: doc(h1)): recorded ignored, Vale 3.23.0 says accepted",
    },
  ]);
  const section = report({ contract });
  assert.match(section, /\*\*1 of 204 failed\.\*\*/);
  assert.match(section, /vale-schema-contract\.test\.ts > Vale schema contract/);
  assert.doesNotMatch(section, /at somewhere/);
});

test("contract: a missing report says it did not run, never that it passed", () => {
  const section = report({ contract: summarizeContract(undefined) });
  assert.match(section, /\*\*Did not run\.\*\*/);
  assert.doesNotMatch(section, /pass against the new binary/);
});

test("contract: a clean report says so, with the count", () => {
  assert.match(report({}), /All 204 tests .* pass against the new binary/);
});

test("contract: a failure message cannot close the fence around it", () => {
  const contract = summarizeContract(
    vitestReport(["x", "expected ```` to equal ``` ```"])
  );
  const section = report({ contract });
  const fences = section.match(/^`{5}$/gm) ?? [];
  assert.equal(fences.length, 2, "a fence longer than any run in the text");
});

test("readers: lists only added, non-test Go files under internal/lint/", () => {
  assert.equal(isReader("internal/lint/code/kt.go"), true);
  assert.equal(isReader("internal/lint/quote.go"), true);
  assert.equal(isReader("internal/lint/code/kt_test.go"), false);
  assert.equal(isReader("internal/core/format.go"), false);
  assert.equal(isReader("internal/lint/testdata/a.md"), false);
});

test("readers: an added reader asks for a probe and a row", () => {
  const section = report({
    readers: readers(["internal/lint/code/kt.go", "internal/lint/code/toml.go"]),
  });
  assert.match(section, /- `internal\/lint\/code\/kt\.go`/);
  assert.match(section, /VALE_FORMAT_TIERS/);
  assert.match(section, /internal\/core\/format\.go/);
});

test("readers: none added is said, with the diff to check it by", () => {
  const section = report({});
  assert.match(section, /None under `internal\/lint\/`/);
  assert.match(section, /compare\/v3\.22\.0\.\.\.v3\.23\.0/);
});

test("readers: a failed fetch says it could not check, never that none were added", () => {
  const section = report({ readers: undefined, readersError: "GET x responded 502" });
  assert.match(section, /\*\*Could not check\*\* \(GET x responded 502\)/);
  assert.doesNotMatch(section, /None under/);
});

test("readers: a comparison at the API's file cap is flagged as possibly incomplete", () => {
  const section = report({ readers: readers([], false) });
  assert.match(section, new RegExp(`${COMPARE_FILE_CAP} or more files`));
});

test("main: compares from the pinned base version and writes the report", async () => {
  const directory = mkdtempSync(join(tmpdir(), "vale-upgrade-report-"));
  try {
    const out = join(directory, "report.md");
    const asked = [];
    await main({
      argv: [
        "--pinned",
        "3.22.0-20260921180930",
        "--to",
        "3.23.0",
        "--repository",
        "vale-cli/vale",
        "--contract",
        join(directory, "absent.json"),
        "--out",
        out,
      ],
      addedReaders: async (...args) => {
        asked.push(args);
        return readers(["internal/lint/code/kt.go"]);
      },
      readReport: () => undefined,
    });
    assert.deepEqual(asked, [["vale-cli/vale", "3.22.0", "3.23.0"]]);
    const written = readFileSync(out, "utf8");
    assert.match(written, /^## Measured against Vale 3\.23\.0$/m);
    assert.match(written, /Compared with 3\.22\.0/);
    assert.match(written, /\*\*Did not run\.\*\*/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("main: a fetch that throws is reported, not raised", async () => {
  const directory = mkdtempSync(join(tmpdir(), "vale-upgrade-report-"));
  try {
    const out = join(directory, "report.md");
    await main({
      argv: [
        "--pinned",
        "3.22.0-20260921180930",
        "--to",
        "3.23.0",
        "--repository",
        "vale-cli/vale",
        "--contract",
        "unused",
        "--out",
        out,
      ],
      addedReaders: async () => {
        throw new Error("GET x responded 403");
      },
      readReport: () => vitestReport(),
    });
    assert.match(readFileSync(out, "utf8"), /Could not check\*\* \(GET x responded 403\)/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
